import type { ExpenseDraft } from '../types/expense';
import type { MerchantRule } from './database';

const totalLabels = [
  { re: /総合計/, score: 120 }, { re: /お会計/, score: 115 },
  { re: /お支払(?:い)?(?:金額|額)?/, score: 112 },
  { re: /(?:ご)?利用金額/, score: 110 }, { re: /決済金額/, score: 110 },
  { re: /支払金額/, score: 108 }, { re: /現計/, score: 105 },
  { re: /合計/, score: 100 }, { re: /今回利用/, score: 95 },
];
const excludedLabels = /商品合計|値引(?:き)?合計|割引(?:き)?合計|小計|税(?:込|抜|額)?|内消費税|お預(?:り|かり)?|預り|お釣り?|釣銭|残高|ポイント|チャージ|現金受領/;
const storeNoise = /領収|レシート|電話|TEL|日時|担当|支払い完了|利用履歴|取引履歴|決済完了|住所|都道府県|登録番号|責No|レジ|ありがとう/iu;
const categoryHints: [RegExp, string][] = [
  [/薬局|ドラッグ|クリニック|病院|医院/, '医療'],
  [/駅|鉄道|交通|タクシー|バス|JR|Suica|PASMO/i, '交通費'],
  [/レストラン|食堂|カフェ|珈琲|喫茶|寿司|ラーメン|焼肉|弁当/, '食費'],
  [/スーパー|マート|市場|青果|酒店/, '食費'],
];

export interface PositionedTextLine {
  text: string;
  frame: { x: number; y: number; width: number; height: number };
  elements?: Array<{ text: string; frame: { x: number; y: number; width: number; height: number } }>;
}

const ocrCorrections: [RegExp, string][] = [
  [/合\s*[言詰]?\s*[十計]/gu, '合計'],
  [/小\s*[言詰]?\s*[十計]/gu, '小計'],
  [/お\s*預\s*[りリ]/gu, 'お預り'],
  [/お\s*釣\s*[りリ]/gu, 'お釣り'],
  [/フ[アァ]\s*ミリ[一ー]\s*マ[一ー]ト/gu, 'ファミリーマート'],
  [/セブン[イィ]\s*レブ[ソン]/gu, 'セブンイレブン'],
];

const normalize = (value: string) => {
  let normalized=value.normalize('NFKC').replace(/[‐‑‒–—―]/g, '-').trim();
  for(const [pattern,replacement] of ocrCorrections) normalized=normalized.replace(pattern,replacement);
  return normalized;
};
const compact = (value: string) => normalize(value).replace(/\s+/g, '');
const merchantKey = (value: string) => compact(value).replace(/[・.\-_'’`]/g, '').toLocaleLowerCase('ja-JP');
const amounts = (value: string) => [...normalize(value).matchAll(/([¥￥]\s*)?(-?\s*\d{1,3}(?:\s*[,，]\s*\d{3})+|-?\s*\d+)(\s*円)?/g)]
  .map((match) => ({ value: Number(match[2]!.replace(/[\s,，]/g, '')), currency: Boolean(match[1] || match[3]) }))
  .filter((item) => item.value > 0 && item.value < 10_000_000);

function detectMerchant(lines: string[], rules: MerchantRule[]) {
  const topText = merchantKey(lines.slice(0, 14).join('\n'));
  for (const rule of rules) {
    if (rule.aliases.some((alias) => topText.includes(merchantKey(alias)))) {
      return { name: rule.name, category: rule.category, storeConfidence: 1, categoryConfidence: 0.85 };
    }
  }
  const explicit = lines.find((line) => /^(?:店舗名|加盟店名?|利用店名)\s*[:：]?/u.test(line));
  const explicitName = explicit?.replace(/^(?:店舗名|加盟店名?|利用店名)\s*[:：]?/u, '').trim();
  const generic = lines.slice(0, 14).find((line) => {
    const value = compact(line);
    return value.length >= 2 && value.length <= 40 && !storeNoise.test(value) && /(?:店|屋|館|薬局|スーパー|マート)$/u.test(value);
  });
  const fallback = lines.slice(0, 8).find((line) => /[A-Za-z\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(line) && !storeNoise.test(line) && !totalLabels.some(({ re }) => re.test(compact(line))));
  const name = explicitName || generic || fallback || '';
  const hinted = categoryHints.find(([re]) => re.test(name));
  return { name, category: hinted?.[1] ?? 'その他', storeConfidence: explicitName ? 0.95 : generic ? 0.75 : fallback ? 0.5 : 0, categoryConfidence: hinted ? 0.65 : 0.25 };
}

function detectDate(text: string) {
  const matches = [...normalize(text).matchAll(/(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})日?/g)];
  for (const match of matches) {
    const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]);
    const check=new Date(y,m-1,d);
    if (check.getFullYear()===y && check.getMonth()===m-1 && check.getDate()===d) {
      return { value:`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`, count:matches.length };
    }
  }
  return { value:'', count:matches.length };
}

function detectTotal(lines: string[]) {
  const scored: { value:number; score:number; reason:string }[]=[];
  lines.forEach((line,index) => {
    const windows=[line, lines.slice(index,index+2).join(''), lines.slice(index,index+3).join('')].map(compact);
    for (const window of windows) {
      const label=totalLabels.find(({re})=>re.test(window));
      if (!label || excludedLabels.test(window)) continue;
      const labelEnd=window.search(label.re) + (window.match(label.re)?.[0].length ?? 0);
      for (const amount of amounts(window.slice(labelEnd))) {
        scored.push({value:amount.value,score:label.score+(amount.currency?12:0)+index/lines.length*8,reason:window});
      }
    }
  });
  const safeGlobal=new Map<number,number>();
  lines.forEach((line,index)=>{
    const context=compact(lines.slice(Math.max(0,index-2),index+1).join(''));
    if (excludedLabels.test(context)) return;
    for(const amount of amounts(line)) if(amount.currency) safeGlobal.set(amount.value,(safeGlobal.get(amount.value)??0)+1);
  });
  for (const candidate of scored) candidate.score += ((safeGlobal.get(candidate.value)??0)-1)*8;
  const bestByValue=new Map<number,{value:number;score:number;reason:string}>();
  for(const candidate of scored) if(candidate.score>(bestByValue.get(candidate.value)?.score??-1)) bestByValue.set(candidate.value,candidate);
  const ranked=[...bestByValue.values()].sort((a,b)=>b.score-a.score);
  if (!ranked.length) {
    const repeated=[...safeGlobal.entries()].filter(([,count])=>count>=2).sort((a,b)=>b[1]-a[1]);
    if(repeated.length===1) return {value:String(repeated[0]![0]),confidence:0.6,candidates:[String(repeated[0]![0])]};
    return {value:'',confidence:0,candidates:repeated.map(([value])=>String(value))};
  }
  const ambiguous=ranked[1] && ranked[0]!.score-ranked[1].score<18;
  return {value:ambiguous?'':String(ranked[0]!.value),confidence:ambiguous?0.45:Math.min(ranked[0]!.score/132,1),candidates:ranked.slice(0,3).map(c=>String(c.value))};
}

export function parseReceiptText(rawLines: string[], merchantRules: MerchantRule[] = []): ExpenseDraft {
  const lines=rawLines.flatMap((line)=>normalize(line).split(/\r?\n/)).map(normalize).filter(Boolean);
  const text=lines.join('\n');
  const merchant=detectMerchant(lines,merchantRules);
  const date=detectDate(text);
  const total=detectTotal(lines);
  const warnings:string[]=[];
  if(date.count>1) warnings.push('複数の日付が見つかりました。');
  if(date.value){const age=Math.abs(Date.now()-new Date(`${date.value}T12:00:00`).getTime())/31_556_952_000;if(age>2) warnings.push('日付が2年以上前です。確認してください。');}
  if(total.candidates.length>1&&!total.value) warnings.push('合計金額の候補が複数あります。');
  if(!total.value) warnings.push('合計金額を確認してください。');
  const sourceType=/支払い完了|決済完了|取引履歴|利用履歴/u.test(text)?'payment_screenshot':'receipt';
  const fieldConfidence={storeName:merchant.storeConfidence,date:date.value?(date.count===1?0.95:0.7):0,amount:total.confidence,category:merchant.categoryConfidence};
  return {storeName:merchant.name,date:date.value,amount:total.value,category:merchant.category,paymentMethod:/PayPay/i.test(text)?'PayPay':'未設定',note:'',sourceType,confidence:Object.values(fieldConfidence).reduce((a,b)=>a+b,0)/4,rawText:text,fieldConfidence,warnings,amountCandidates:total.candidates};
}

function verticalOverlap(a: PositionedTextLine, b: PositionedTextLine) {
  const top=Math.max(a.frame.y,b.frame.y);
  const bottom=Math.min(a.frame.y+a.frame.height,b.frame.y+b.frame.height);
  return Math.max(0,bottom-top)/Math.max(0.001,Math.min(a.frame.height,b.frame.height));
}

/** Restores visual receipt rows that OCR APIs often return as separate columns. */
export function reconstructReceiptRows(positionedLines: PositionedTextLine[]): string[] {
  const usable=positionedLines
    .filter((line)=>line.text.trim() && Number.isFinite(line.frame.y))
    .sort((a,b)=>a.frame.y-b.frame.y || a.frame.x-b.frame.x);
  const rows: PositionedTextLine[][]=[];
  for(const line of usable){
    const center=line.frame.y+line.frame.height/2;
    const row=rows.find((candidate)=>{
      const anchor=candidate[0]!;
      const anchorCenter=anchor.frame.y+anchor.frame.height/2;
      const tolerance=Math.max(anchor.frame.height,line.frame.height)*0.55;
      return verticalOverlap(anchor,line)>=0.35 || Math.abs(center-anchorCenter)<=tolerance;
    });
    if(row) row.push(line); else rows.push([line]);
  }
  return rows
    .sort((a,b)=>Math.min(...a.map(v=>v.frame.y))-Math.min(...b.map(v=>v.frame.y)))
    .map((row)=>row.sort((a,b)=>a.frame.x-b.frame.x).map((line)=>normalize(line.text)).join(' ').trim())
    .filter(Boolean);
}

export function parseStructuredReceipt(positionedLines: PositionedTextLine[], merchantRules: MerchantRule[] = []): ExpenseDraft {
  const rows = reconstructReceiptRows(positionedLines);
  const draft = parseReceiptText(rows,merchantRules);
  // Arithmetic is corroboration, never permission to invent a missing total.
  const labelled = (label: RegExp, signed = false): number | undefined => {
    const values = rows.flatMap(row => {
      const value = compact(row);
      const match = value.match(label);
      if (!match) return [];
      const rest = value.slice((match.index ?? 0) + match[0].length);
      const numbers = [...rest.matchAll(/[¥￥]?(-?\d[\d,]*)円?/g)]
        .map(m => Number(m[1]!.replace(/,/g,'')))
        .filter(n => Number.isSafeInteger(n) && Math.abs(n) < 10_000_000);
      return numbers.length === 1 ? [signed ? Math.abs(numbers[0]!) : numbers[0]!] : [];
    });
    const unique = [...new Set(values)];
    return unique.length === 1 ? unique[0] : undefined;
  };
  const cash = labelled(/お預(?:り|かり)?|預り金額/);
  const change = labelled(/お釣り?|釣銭/);
  const merchandise = labelled(/商品合計/);
  const discount = labelled(/値引(?:き)?合計|割引(?:き)?合計/, true);
  const checks: Array<{value:number;label:string}> = [];
  if (cash !== undefined && change !== undefined && cash >= change)
    checks.push({value:cash-change,label:'お預り－お釣り'});
  if (merchandise !== undefined && discount !== undefined && merchandise >= discount)
    checks.push({value:merchandise-discount,label:'商品合計－値引合計（税の扱いも確認）'});
  for (const check of checks) {
    if (draft.amount && Number(draft.amount) !== check.value) {
      draft.warnings ??= [];
      draft.warnings.push(`${check.label}は${check.value}円です。合計との違いを確認してください。`);
      if (draft.fieldConfidence) draft.fieldConfidence.amount = Math.min(draft.fieldConfidence.amount, 0.45);
    }
    if (!draft.amount && check.value > 0) {
      draft.warnings ??= [];
      draft.warnings.push(`${check.label}は${check.value}円です。画像で合計を確認してください。`);
    }
  }
  if (draft.fieldConfidence) draft.confidence = Object.values(draft.fieldConfidence).reduce((a,b)=>a+b,0)/4;
  return draft;
}

import type { ExpenseDraft } from '../types/expense';
import type { MerchantRule } from './database';

export interface PositionedTextLine {
  text: string;
  frame: { x: number; y: number; width: number; height: number };
  elements?: Array<{ text: string; frame: { x: number; y: number; width: number; height: number } }>;
}

/** Labels used to identify the total payment amount on receipts */
const totalLabels: Array<{ re: RegExp; score: number }> = [
  { re: /総合計/, score: 120 },
  { re: /お会計/, score: 115 },
  { re: /お買上(?:金額|合計)?/, score: 115 },
  { re: /領収金額/, score: 115 },
  { re: /お支払(?:い)?(?:金額|額|総額)?/, score: 112 },
  { re: /請求(?:金額|額)/, score: 112 },
  { re: /税込合計/, score: 112 },
  { re: /(?:ご)?利用金額/, score: 110 },
  { re: /決済金額/, score: 110 },
  { re: /支払金額/, score: 108 },
  { re: /現計/, score: 105 },
  { re: /合計/, score: 100 },
  { re: /今回利用/, score: 95 },
];

/** Labels to exclude when searching for total amounts */
const excludedLabels = /商品合計|値引(?:き)?合計|割引(?:き)?合計|小計|税(?:込|抜|額)?|内消費税|お預(?:り|かり)?|預り|お釣り?|釣銭|残高|ポイント|チャージ|現金受領|対象額|課税額/;

/** Common header/footer noise lines to ignore when guessing merchant names */
const storeNoise = /領収|レシート|請求書|適格請求書|納品書|電話|TEL|FAX|日時|担当|支払い完了|利用履歴|取引履歴|決済完了|住所|都道府県|登録番号|T\d{13}|責No|レジ|ありがとう|インボイス|店舗コード|売上票|http|www/iu;

/** Canonical merchants commonly printed as logos or split across several OCR lines. */
const knownMerchants: Array<{ name: string; category: string; aliases: string[]; pattern?: RegExp }> = [
  { name:'ヨドバシカメラ', category:'その他', aliases:['ヨドバシカメラ','Yodobashi Camera','ヨドバシ'] },
  { name:'ビックカメラ', category:'その他', aliases:['ビックカメラ','ビッグカメラ','Bic Camera'] },
  { name:'セブン-イレブン', category:'食費', aliases:['セブン-イレブン','セブンイレブン','7-Eleven'], pattern:/(?:^|[^\d])7\s*[-‐ー]?\s*11(?:[^\d]|$)/imu },
  { name:'ファミリーマート', category:'食費', aliases:['ファミリーマート','FamilyMart','ファミマ'] },
  { name:'ローソン', category:'食費', aliases:['ローソン','LAWSON'] },
  { name:'ミニストップ', category:'食費', aliases:['ミニストップ','MINISTOP'] },
  { name:'イオン', category:'食費', aliases:['イオン','AEON'] },
  { name:'イトーヨーカドー', category:'食費', aliases:['イトーヨーカドー','イトーヨーカ堂'] },
  { name:'西友', category:'食費', aliases:['西友','SEIYU'] },
  { name:'業務スーパー', category:'食費', aliases:['業務スーパー'] },
  { name:'オーケー', category:'食費', aliases:['オーケーストア','OKストア'] },
  { name:'ドン・キホーテ', category:'日用品', aliases:['ドン・キホーテ','ドンキホーテ','Don Quijote'] },
  { name:'マツモトキヨシ', category:'日用品', aliases:['マツモトキヨシ','マツキヨ'] },
  { name:'ウエルシア', category:'日用品', aliases:['ウエルシア','Welcia'] },
  { name:'スギ薬局', category:'日用品', aliases:['スギ薬局'] },
  { name:'ダイソー', category:'日用品', aliases:['ダイソー','DAISO'] },
  { name:'ユニクロ', category:'その他', aliases:['ユニクロ','UNIQLO'] },
  { name:'ニトリ', category:'日用品', aliases:['ニトリ','NITORI'] },
  { name:'マクドナルド', category:'食費', aliases:['マクドナルド',"McDonald's",'McDonalds'] },
  { name:'スターバックス', category:'食費', aliases:['スターバックス','Starbucks'] },
];

/** Automatic category hints based on merchant name keywords */
const categoryHints: Array<[RegExp, string]> = [
  [/薬局|ドラッグ|クリニック|病院|医院|調剤|サプリ/, '日用品'],
  [/駅|鉄道|交通|タクシー|バス|JR|Suica|PASMO|ICOCA|高速|駐車場|コインパーキング|ガソリン|給油|エネオス|出光|コスモ/i, '交通費'],
  [/レストラン|食堂|カフェ|珈琲|喫茶|寿司|ラーメン|焼肉|弁当|居酒屋|バル|ベーカリー|パン|ファストフード|マクドナルド|すき家|吉野家|ガスト|サイゼリヤ|スターバックス/, '食費'],
  [/スーパー|マート|市場|青果|酒店|精肉|鮮魚|食品|イオン|イトーヨーカ堂|西友|ライフ|業務スーパー|オーケー/, '食費'],
  [/100円|ダイソー|キャンドゥ|セリア|日用品|ホームセンター|コーナン|カインズ|ニトリ|マツモトキヨシ|ウエルシア|スギ薬局|ココカラファイン/, '日用品'],
  [/書店|文具|本屋|ブック/, 'その他'],
  [/ユニクロ|GU|ZARA|服|衣料|アパレル/, 'その他'],
];

/** Fixes common OCR label or text misrecognitions */
const ocrCorrections: Array<[RegExp, string]> = [
  [/合\s*[言詰]?\s*[十計]/gu, '合計'],
  [/小\s*[言詰]?\s*[十計]/gu, '小計'],
  [/お\s*預\s*[りリ]/gu, 'お預り'],
  [/お\s*釣\s*[りリ]/gu, 'お釣り'],
  [/お\s*買\s*上/gu, 'お買上'],
  [/お\s*支\s*払\s*い?/gu, 'お支払い'],
  [/登\s*録\s*番\s*号/gu, '登録番号'],
  [/フ[アァ]\s*ミリ[一ー]\s*マ[一ー]ト/gu, 'ファミリーマート'],
  [/セブン[イィ]\s*レブ[ソン]/gu, 'セブンイレブン'],
  [/セブン\s*[-ー‐]?\s*イレブン/gu, 'セブン-イレブン'],
];

/** Normalizes OCR raw text (Unicode NFKC, dash unifying, applying OCR fixups) */
export function normalize(value: string): string {
  let normalized = value.normalize('NFKC').replace(/[‐‑‒–—―]/g, '-').trim();
  for (const [pattern, replacement] of ocrCorrections) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

/** Removes all whitespace after normalizing */
export function compact(value: string): string {
  return normalize(value).replace(/\s+/g, '');
}

/** Standardized key generator for merchant matching */
function merchantKey(value: string): string {
  return compact(value).replace(/[・.\-_'’`]/g, '').toLocaleLowerCase('ja-JP');
}

/** Repairs digit character misreads in currency contexts (e.g. O->0, l->1, S->5) */
function repairDigitMisreads(text: string): string {
  return text
    .replace(/([¥￥]\s*)([0-9OolISsBZ,，.]+)/g, (_, prefix, digits) => {
      const fixed = digits
        .replace(/[Oo]/g, '0')
        .replace(/[lI]/g, '1')
        .replace(/[Ss]/g, '5')
        .replace(/B/g, '8')
        .replace(/Z/g, '2');
      return `${prefix}${fixed}`;
    })
    .replace(/([0-9OolISsBZ,，.]+)(\s*円)/g, (_, digits, suffix) => {
      const fixed = digits
        .replace(/[Oo]/g, '0')
        .replace(/[lI]/g, '1')
        .replace(/[Ss]/g, '5')
        .replace(/B/g, '8')
        .replace(/Z/g, '2');
      return `${fixed}${suffix}`;
    });
}

/** Extracts monetary values from normalized text */
export function amounts(value: string): Array<{ value: number; currency: boolean }> {
  const repaired = repairDigitMisreads(normalize(value));
  const matches = [...repaired.matchAll(/([¥￥]\s*)?(-?\s*\d{1,3}(?:(?:\s*[,，]\s*|\s+)\d{3})+|-?\s*\d+)(\s*円)?/g)];

  return matches
    .map((match) => {
      const numStr = match[2]!.replace(/[\s,，]/g, '');
      const numValue = Number(numStr);
      const hasCurrency = Boolean(match[1] || match[3]);
      return { value: numValue, currency: hasCurrency };
    })
    .filter((item) => item.value > 0 && item.value < 10_000_000);
}

/** Detects store/merchant name and infers category */
export function detectMerchant(lines: string[], rules: MerchantRule[]) {
  const topText = merchantKey(lines.slice(0, 14).join('\n'));

  // 1. Check against DB merchant rules & aliases
  for (const rule of rules) {
    if (rule.aliases.some((alias) => topText.includes(merchantKey(alias)))) {
      return {
        name: rule.name,
        category: rule.category,
        storeConfidence: 1.0,
        categoryConfidence: 0.85,
      };
    }
  }

  // 2. Prefer a canonical built-in merchant even when OCR splits its logo over lines.
  const merchantArea = lines.slice(0, 20).join('\n');
  const merchantAreaKey = merchantKey(merchantArea);
  const known = knownMerchants.find((merchant) =>
    merchant.aliases.some((alias) => merchantAreaKey.includes(merchantKey(alias))) || merchant.pattern?.test(merchantArea)
  );
  if (known) {
    return {
      name: known.name,
      category: known.category,
      storeConfidence: 0.98,
      categoryConfidence: 0.9,
    };
  }

  // 3. Explicit label match (e.g. 店舗名: XXX)
  const explicitLine = lines.find((line) => /^(?:店舗名|加盟店名?|利用店名)\s*[:：]?/u.test(line));
  const explicitName = explicitLine?.replace(/^(?:店舗名|加盟店名?|利用店名)\s*[:：]?/u, '').trim();

  // 4. Generic store suffix search
  const generic = lines.slice(0, 14).find((line) => {
    const value = compact(line);
    return value.length >= 2 && value.length <= 40 && !storeNoise.test(value) && /(?:店|屋|館|薬局|スーパー|マート)$/u.test(value);
  });

  // 5. Fallback line search near the top
  const fallback = lines.slice(0, 8).find((line) => {
    const clean = compact(line);
    return /[A-Za-z\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(line) &&
      !storeNoise.test(line) &&
      !totalLabels.some(({ re }) => re.test(clean));
  });

  const name = explicitName || generic || fallback || '';
  const hinted = categoryHints.find(([re]) => re.test(name));

  const storeConfidence = explicitName ? 0.95 : generic ? 0.75 : fallback ? 0.5 : 0;
  const categoryConfidence = hinted ? 0.65 : 0.25;

  return {
    name,
    category: hinted?.[1] ?? 'その他',
    storeConfidence,
    categoryConfidence,
  };
}

/** Validates if a given year, month, day forms a real date in valid range */
function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const check = new Date(year, month - 1, day);
  return check.getFullYear() === year && check.getMonth() === month - 1 && check.getDate() === day;
}

/** Detects purchase date from text including Western calendar, Wareki (Reiwa, Heisei), and 2-digit years */
export function detectDate(text: string): { value: string; count: number } {
  const norm = normalize(text);
  const foundDates: string[] = [];

  // Standard 4-digit Western year: 2026年09月10日, 2026/09/10, 2026-09-10, 2026.09.10
  const standardMatches = [...norm.matchAll(/(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})日?/g)];
  for (const match of standardMatches) {
    const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
    if (isValidDate(y, m, d)) {
      foundDates.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
  }

  // Japanese Wareki: Reiwa (令和 / R)
  const reiwaMatches = [...norm.matchAll(/(?:令和|R)\s*(\d{1,2}|元)\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})日?/g)];
  for (const match of reiwaMatches) {
    const yearNum = match[1] === '元' ? 1 : Number(match[1]);
    const y = 2018 + yearNum;
    const m = Number(match[2]), d = Number(match[3]);
    if (isValidDate(y, m, d)) {
      foundDates.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
  }

  // Japanese Wareki: Heisei (平成 / H)
  const heiseiMatches = [...norm.matchAll(/(?:平成|H)\s*(\d{1,2}|元)\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})日?/g)];
  for (const match of heiseiMatches) {
    const yearNum = match[1] === '元' ? 1 : Number(match[1]);
    const y = 1988 + yearNum;
    const m = Number(match[2]), d = Number(match[3]);
    if (isValidDate(y, m, d)) {
      foundDates.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
  }

  // Two-digit year: 26/09/10, 26.09.10, 26-09-10 (assuming 2000s)
  if (foundDates.length === 0) {
    const shortMatches = [...norm.matchAll(/(?<!\d)(2[0-9])\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})(?!\d)/g)];
    for (const match of shortMatches) {
      const y = 2000 + Number(match[1]);
      const m = Number(match[2]), d = Number(match[3]);
      if (isValidDate(y, m, d)) {
        foundDates.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    }
  }

  const uniqueDates = [...new Set(foundDates)];
  return {
    value: uniqueDates[0] ?? '',
    count: uniqueDates.length,
  };
}

/** Detects total amount from receipt lines using scoring heuristic */
export function detectTotal(lines: string[]): { value: string; confidence: number; candidates: string[] } {
  const scoredCandidates: Array<{ value: number; score: number; reason: string }> = [];

  // Scored label search
  lines.forEach((line, index) => {
    const windows = [
      line,
      lines.slice(index, index + 2).join(''),
      lines.slice(index, index + 3).join(''),
    ].map(compact);

    for (const window of windows) {
      const label = totalLabels.find(({ re }) => re.test(window));
      if (!label || excludedLabels.test(window)) continue;

      const labelMatch = window.match(label.re);
      const labelEnd = window.search(label.re) + (labelMatch?.[0].length ?? 0);
      const windowAmounts = amounts(window.slice(labelEnd));

      for (const amount of windowAmounts) {
        const positionBonus = (index / lines.length) * 8;
        const currencyBonus = amount.currency ? 12 : 0;
        scoredCandidates.push({
          value: amount.value,
          score: label.score + currencyBonus + positionBonus,
          reason: window,
        });
      }
    }
  });

  // Global currency-backed values map
  const safeGlobalMap = new Map<number, number>();
  lines.forEach((line, index) => {
    const context = compact(lines.slice(Math.max(0, index - 2), index + 1).join(''));
    if (excludedLabels.test(context)) return;
    for (const amount of amounts(line)) {
      if (amount.currency) {
        safeGlobalMap.set(amount.value, (safeGlobalMap.get(amount.value) ?? 0) + 1);
      }
    }
  });

  // Boost candidates repeated globally with currency symbol
  for (const candidate of scoredCandidates) {
    const repeatCount = safeGlobalMap.get(candidate.value) ?? 0;
    if (repeatCount > 1) {
      candidate.score += (repeatCount - 1) * 8;
    }
  }

  // Deduplicate candidates keeping highest score for each value
  const bestByValue = new Map<number, { value: number; score: number; reason: string }>();
  for (const candidate of scoredCandidates) {
    const existing = bestByValue.get(candidate.value);
    if (!existing || candidate.score > existing.score) {
      bestByValue.set(candidate.value, candidate);
    }
  }

  const ranked = [...bestByValue.values()].sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    const repeated = [...safeGlobalMap.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]);
    if (repeated.length === 1) {
      return {
        value: String(repeated[0]![0]),
        confidence: 0.6,
        candidates: [String(repeated[0]![0])],
      };
    }
    return {
      value: '',
      confidence: 0,
      candidates: repeated.map(([val]) => String(val)),
    };
  }

  const isAmbiguous = ranked[1] && (ranked[0]!.score - ranked[1].score < 18);
  return {
    // Keep the best candidate selected so confirmation needs correction only when it is wrong.
    value: String(ranked[0]!.value),
    confidence: isAmbiguous ? 0.45 : Math.min(ranked[0]!.score / 132, 1),
    candidates: ranked.slice(0, 3).map((c) => String(c.value)),
  };
}

/** Parses raw receipt text lines into an ExpenseDraft */
export function parseReceiptText(rawLines: string[], merchantRules: MerchantRule[] = []): ExpenseDraft {
  const lines = rawLines
    .flatMap((line) => normalize(line).split(/\r?\n/))
    .map(normalize)
    .filter(Boolean);

  const text = lines.join('\n');
  const merchant = detectMerchant(lines, merchantRules);
  const date = detectDate(text);
  const total = detectTotal(lines);
  const warnings: string[] = [];

  if (date.count > 1) {
    warnings.push('複数の日付が見つかりました。');
  }
  if (date.value) {
    const ageInYears = Math.abs(Date.now() - new Date(`${date.value}T12:00:00`).getTime()) / 31_556_952_000;
    if (ageInYears > 2) {
      warnings.push('日付が2年以上前です。確認してください。');
    }
  }
  if (total.candidates.length > 1 && total.confidence < 0.6) {
    warnings.push('最も可能性の高い金額を選びました。確認してください。');
  }
  if (!total.value) {
    warnings.push('合計金額を確認してください。');
  }

  const sourceType = /支払い完了|決済完了|取引履歴|利用履歴/u.test(text) ? 'payment_screenshot' : 'receipt';
  const fieldConfidence = {
    storeName: merchant.storeConfidence,
    date: date.value ? (date.count === 1 ? 0.95 : 0.7) : 0,
    amount: total.confidence,
    category: merchant.categoryConfidence,
  };

  const averageConfidence = Object.values(fieldConfidence).reduce((a, b) => a + b, 0) / 4;

  return {
    storeName: merchant.name,
    date: date.value,
    amount: total.value,
    category: merchant.category,
    paymentMethod: /PayPay/i.test(text) ? 'PayPay' : '未設定',
    note: '',
    sourceType,
    confidence: averageConfidence,
    rawText: text,
    fieldConfidence,
    warnings,
    amountCandidates: total.candidates,
  };
}

/** Calculates vertical overlap ratio between two positioned text elements */
function verticalOverlap(a: PositionedTextLine, b: PositionedTextLine): number {
  const top = Math.max(a.frame.y, b.frame.y);
  const bottom = Math.min(a.frame.y + a.frame.height, b.frame.y + b.frame.height);
  const overlapHeight = Math.max(0, bottom - top);
  const minHeight = Math.max(0.001, Math.min(a.frame.height, b.frame.height));
  return overlapHeight / minHeight;
}

/** Restores visual receipt rows that OCR APIs often return as separate columns */
export function reconstructReceiptRows(positionedLines: PositionedTextLine[]): string[] {
  const usableLines = positionedLines
    .filter((line) => line.text.trim() && Number.isFinite(line.frame.y))
    .sort((a, b) => a.frame.y - b.frame.y || a.frame.x - b.frame.x);

  const rowGroups: PositionedTextLine[][] = [];

  for (const line of usableLines) {
    const lineCenterY = line.frame.y + line.frame.height / 2;
    const matchingRow = rowGroups.find((row) => {
      const anchor = row[0]!;
      const anchorCenterY = anchor.frame.y + anchor.frame.height / 2;
      const heightTolerance = Math.max(anchor.frame.height, line.frame.height) * 0.55;
      return verticalOverlap(anchor, line) >= 0.35 || Math.abs(lineCenterY - anchorCenterY) <= heightTolerance;
    });

    if (matchingRow) {
      matchingRow.push(line);
    } else {
      rowGroups.push([line]);
    }
  }

  return rowGroups
    .sort((a, b) => Math.min(...a.map((item) => item.frame.y)) - Math.min(...b.map((item) => item.frame.y)))
    .map((row) =>
      row
        .sort((a, b) => a.frame.x - b.frame.x)
        .map((line) => normalize(line.text))
        .join(' ')
        .trim()
    )
    .filter(Boolean);
}

/** Parses structured receipt lines with arithmetic verification (cash deposit - change, etc.) */
export function parseStructuredReceipt(positionedLines: PositionedTextLine[], merchantRules: MerchantRule[] = []): ExpenseDraft {
  const rows = reconstructReceiptRows(positionedLines);
  const draft = parseReceiptText(rows, merchantRules);

  const extractLabelledValue = (labelPattern: RegExp, signed = false): number | undefined => {
    const foundValues = rows.flatMap((row) => {
      const compactRow = compact(row);
      const match = compactRow.match(labelPattern);
      if (!match) return [];

      const remainingText = compactRow.slice((match.index ?? 0) + match[0].length);
      const numMatches = [...remainingText.matchAll(/[¥￥]?(-?\d[\d,]*)円?/g)]
        .map((m) => Number(m[1]!.replace(/,/g, '')))
        .filter((n) => Number.isSafeInteger(n) && Math.abs(n) < 10_000_000);

      if (numMatches.length === 1) {
        return [signed ? Math.abs(numMatches[0]!) : numMatches[0]!];
      }
      return [];
    });

    const uniqueValues = [...new Set(foundValues)];
    return uniqueValues.length === 1 ? uniqueValues[0] : undefined;
  };

  const cashDeposit = extractLabelledValue(/お預(?:り|かり)?|預り金額/);
  const changeGiven = extractLabelledValue(/お釣り?|釣銭/);
  const merchandiseTotal = extractLabelledValue(/商品合計/);
  const discountTotal = extractLabelledValue(/値引(?:き)?合計|割引(?:き)?合計/, true);

  const arithmeticChecks: Array<{ value: number; label: string }> = [];

  if (cashDeposit !== undefined && changeGiven !== undefined && cashDeposit >= changeGiven) {
    arithmeticChecks.push({ value: cashDeposit - changeGiven, label: 'お預り－お釣り' });
  }
  if (merchandiseTotal !== undefined && discountTotal !== undefined && merchandiseTotal >= discountTotal) {
    arithmeticChecks.push({ value: merchandiseTotal - discountTotal, label: '商品合計－値引合計（税の扱いも確認）' });
  }

  for (const check of arithmeticChecks) {
    if (draft.amount && Number(draft.amount) !== check.value) {
      draft.warnings ??= [];
      draft.warnings.push(`${check.label}は${check.value}円です。合計との違いを確認してください。`);
      if (draft.fieldConfidence) {
        draft.fieldConfidence.amount = Math.min(draft.fieldConfidence.amount, 0.45);
      }
    }
    if (!draft.amount && check.value > 0) {
      draft.warnings ??= [];
      draft.warnings.push(`${check.label}は${check.value}円です。画像で合計を確認してください。`);
    }
  }

  if (draft.fieldConfidence) {
    draft.confidence = Object.values(draft.fieldConfidence).reduce((a, b) => a + b, 0) / 4;
  }

  return draft;
}

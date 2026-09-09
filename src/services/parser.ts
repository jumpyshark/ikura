import type { ExpenseDraft } from '../types/expense';

const totalWords = /総合計|合計|お買上(?:げ)?(?:金額|計)|現計|お支払(?:い)?(?:金額|額)?|ご利用金額|利用金額|決済金額|支払金額|TOTAL/i;
const excluded = /小計|お預[りか]|預かり|お釣|釣銭|残高|ポイント|電話|TEL|登録番号|取引番号/i;
const money = (s: string) => [...s.matchAll(/(?:[¥￥]\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\s*円)?/g)].map(m => Number(m[1]!.replace(/,/g,''))).filter(n=>n>0 && n<10000000);
export function parseReceiptText(lines: string[]): ExpenseDraft {
  const clean=lines.flatMap(l=>l.normalize('NFKC').split(/\r?\n/)).map(l=>l.trim()).filter(Boolean);
  const text=clean.join('\n');
  const dates=[...text.matchAll(/(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})日?/g)];
  const d=dates[0];
  let date='';
  if(d){const y=Number(d[1]),m=Number(d[2]),day=Number(d[3]);const check=new Date(y,m-1,day);if(check.getFullYear()===y&&check.getMonth()===m-1&&check.getDate()===day)date=`${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;}
  const candidates: number[]=[];
  clean.forEach((line,i)=>{
    if(excluded.test(line)||!totalWords.test(line))return;
    // Look after the label so dates, item counts and tax rates are not used as totals.
    const tail=line.split(totalWords).at(-1)!.replace(/\([^)]*\)/g,'');
    const values=money(tail);
    if(values.length===1)candidates.push(values[0]!);
    else if(!values.length){const next=clean[i+1]??'';if(/^[¥￥]?\s*[\d,]+\s*円?$/.test(next)){const n=money(next);if(n.length===1)candidates.push(n[0]!);}}
  });
  const distinct=[...new Set(candidates)];
  let amount=distinct.length===1?String(distinct[0]):'';
  if(!distinct.length){const explicit=clean.filter(l=>!excluded.test(l)&&!/(税|小計)/.test(l)&&/^[¥￥]?\s*[\d,]+\s*円?$/.test(l)&&/[¥￥円]/.test(l)).flatMap(money);if(explicit.length===1)amount=String(explicit[0]);}
  const label=clean.find(l=>/^(店舗名|加盟店名?|利用店名)\s*[:：]?/.test(l));
  const storeName=label?.replace(/^(店舗名|加盟店名?|利用店名)\s*[:：]?/,'') || clean.find(l=>/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/.test(l)&&!excluded.test(l)&&!totalWords.test(l)&&!/(領収|レシート|日時|担当|支払い完了|利用履歴|取引履歴|決済完了|住所|都道府県)/.test(l)&&!dates.some(d=>l.includes(d[0]))) || '';
  const sourceType=/支払い完了|決済完了|取引履歴|利用履歴/.test(text)?'payment_screenshot':'receipt';
  return {storeName,date,amount,category:'その他',paymentMethod:/PayPay/i.test(text)?'PayPay':'未設定',note:distinct.length>1?'複数の合計候補があります。画像と照合してください。':'',sourceType,confidence:[!!storeName,!!date,!!amount,distinct.length===1].filter(Boolean).length/4,rawText:text};
}

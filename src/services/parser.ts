import type { ExpenseDraft } from '../types/expense';

const totalWords = /(合計|総合計|お買上(?:げ)?計|現計|お支払(?:い)?額|ご利用金額|決済金額|TOTAL)/i;
const ignoredWords = /(お預り|預かり|お釣り|釣銭|残高|小計|税)/i;
const amountOf = (value: string) => Number(value.replace(/[￥¥円,，\s]/g, '').replace(/[Oo]/g, '0'));

export function parseReceiptText(lines: string[]): ExpenseDraft {
  const clean = lines.map((line) => line.trim()).filter(Boolean);
  const text = clean.join('\n');
  const full = text.match(/(20\d{2})[年\/\.\-]\s*(\d{1,2})[月\/\.\-]\s*(\d{1,2})日?/);
  const short = text.match(/(?<!\d)(\d{2})[\/\.\-](\d{1,2})[\/\.\-](\d{1,2})(?!\d)/);
  const date = full ? `${full[1]}-${full[2]!.padStart(2, '0')}-${full[3]!.padStart(2, '0')}` : short ? `20${short[1]}-${short[2]!.padStart(2, '0')}-${short[3]!.padStart(2, '0')}` : new Date().toISOString().slice(0, 10);
  let amount = 0;
  let matchedTotal = false;
  for (const line of clean) {
    if (ignoredWords.test(line)) continue;
    const values = [...line.matchAll(/[￥¥]?\s*([\dOo]{1,3}(?:[,，]\d{3})+|\d{2,7})\s*円?/g)].map((match) => amountOf(match[0])).filter((value) => value > 0 && value < 10000000);
    if (totalWords.test(line) && values.length) { amount = values[values.length - 1]!; matchedTotal = true; break; }
  }
  if (!amount) {
    const candidates = clean.filter((line) => !ignoredWords.test(line)).flatMap((line) => [...line.matchAll(/[￥¥]\s*([\dOo,，]{2,})|([\dOo,，]{2,})\s*円/g)].map((match) => amountOf(match[0]))).filter((value) => value > 0 && value < 10000000);
    amount = candidates.length ? Math.max(...candidates) : 0;
  }
  const storeName = clean.find((line) => /[A-Za-z\u3040-\u30ff\u3400-\u9fff]/.test(line) && !/領収|レシート|電話|TEL|日時|担当/.test(line)) ?? '';
  const confidence = [storeName.length > 1, Boolean(full || short), amount > 0, matchedTotal].filter(Boolean).length / 4;
  return { storeName, date, amount: amount ? String(amount) : '', category: 'その他', paymentMethod: '未設定', note: '', sourceType: 'receipt', confidence, rawText: text };
}

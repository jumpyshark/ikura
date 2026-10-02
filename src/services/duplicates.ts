import type { Expense, ExpenseDraft } from '../types/expense';
const key = (s:string) => s.normalize('NFKC').toLowerCase()
  .replace(/family\s*mart|ファミマ/g,'ファミリーマート').replace(/lawson/g,'ローソン').replace(/7[ -]?eleven|セブン[ -]?イレブン/g,'セブンイレブン')
  .replace(/株式会社|有限会社|[\s・._ー－-]/g,'');
const day = (s:string) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s+'T00:00:00Z') : NaN;
export function findDuplicates(draft:ExpenseDraft, saved:Expense[], editingId?:string) {
  if (!draft.amount || !Number.isFinite(day(draft.date))) return [];
  return saved.flatMap(item => {
    if(item.id === editingId || Number(item.amount) !== Number(draft.amount) || item.date !== draft.date) return [];
    const a=key(draft.storeName), b=key(item.storeName);
    const exact=Boolean(a && b && a===b);
    if(!exact) return [];
    return [{item, level:'strong', reason:'同じ日付・店舗・金額'}];
  });
}

import type { Expense, ExpenseDraft } from '../types/expense';
const key = (s:string) => s.normalize('NFKC').toLowerCase()
  .replace(/family\s*mart|ファミマ/g,'ファミリーマート').replace(/lawson/g,'ローソン').replace(/7[ -]?eleven|セブン[ -]?イレブン/g,'セブンイレブン')
  .replace(/株式会社|有限会社|[\s・._ー－-]/g,'');
const day = (s:string) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s+'T00:00:00Z') : NaN;
export function findDuplicates(draft:ExpenseDraft, saved:Expense[], editingId?:string) {
  if (!draft.amount || !Number.isFinite(day(draft.date))) return [];
  return saved.flatMap(item => {
    if(item.id === editingId || Number(item.amount) !== Number(draft.amount)) return [];
    const distance = Math.abs(day(item.date)-day(draft.date))/86400000;
    if (!Number.isFinite(distance) || distance > 3) return [];
    const a=key(draft.storeName), b=key(item.storeName);
    const exact=Boolean(a && b && a===b);
    const related=Boolean(a.length>=4 && b.length>=4 && (a.includes(b)||b.includes(a)));
    if(distance>0 && !exact && !related) return [];
    return [{item, level:distance===0 && exact ? 'strong' : 'possible', reason:distance===0 ? exact ? '同じ日付・店舗・金額' : '同じ日付・金額（店舗を確認）' : '同じ金額・似た店舗、日付が3日以内（計上日の差の可能性）'}];
  }).sort((a,b)=>Number(b.level==='strong')-Number(a.level==='strong'));
}

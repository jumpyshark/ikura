import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDatabase } from './database';
import type { AppSettings, Expense } from '../types/expense';

const LEGACY_KEY = 'receiptlog.expenses.v1';
const MIGRATION_KEY = 'receiptlog.sqlite.migrated.v2';
const SETTINGS_KEY = 'receiptlog.settings.v1';
export const defaultSettings: AppSettings = { monthlyBudget: 50000, categories: ['食費', '日用品', '交通費', '娯楽', '医療', 'その他'], aiFallbackEnabled: false };

type ExpenseRow = { id:string; store_name:string; purchase_date:string; amount:string; category:string; payment_method:string; note:string; source_type:Expense['sourceType']; confidence:number; raw_text:string; image_uri:string|null };
const fromRow = (r: ExpenseRow): Expense => ({ id:r.id, storeName:r.store_name, date:r.purchase_date, amount:r.amount, category:r.category, paymentMethod:r.payment_method, note:r.note, sourceType:r.source_type, confidence:r.confidence, rawText:r.raw_text, imageUri:r.image_uri ?? undefined });
const values = (e: Expense) => [e.id,e.storeName,e.date,e.amount,e.category,e.paymentMethod,e.note,e.sourceType,e.confidence,e.rawText,e.imageUri??null,Number(e.id)||Date.now()] as const;

async function migrateLegacyExpenses() {
  if (await AsyncStorage.getItem(MIGRATION_KEY)) return;
  const db=await getDatabase();
  const legacy=await AsyncStorage.getItem(LEGACY_KEY);
  if (legacy) {
    const items=JSON.parse(legacy) as Expense[];
    if (Array.isArray(items)) for (const e of items) await insertExpense(e, true);
  }
  await AsyncStorage.setItem(MIGRATION_KEY,'1');
}

export async function loadExpenses(): Promise<Expense[]> {
  await migrateLegacyExpenses();
  const db=await getDatabase();
  return (await db.getAllAsync<ExpenseRow>('SELECT * FROM expenses ORDER BY purchase_date DESC, created_at DESC')).map(fromRow);
}

export async function insertExpense(e: Expense, ignoreExisting=false): Promise<void> {
  const db=await getDatabase();
  await db.runAsync(`${ignoreExisting?'INSERT OR IGNORE':'INSERT'} INTO expenses (id,store_name,purchase_date,amount,category,payment_method,note,source_type,confidence,raw_text,image_uri,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,...values(e));
}

export async function updateExpense(e: Expense): Promise<void> {
  const db=await getDatabase();
  await db.runAsync('UPDATE expenses SET store_name=?,purchase_date=?,amount=?,category=?,payment_method=?,note=?,source_type=?,confidence=?,raw_text=?,image_uri=? WHERE id=?',e.storeName,e.date,e.amount,e.category,e.paymentMethod,e.note,e.sourceType,e.confidence,e.rawText,e.imageUri??null,e.id);
}

export async function deleteExpense(id: string): Promise<void> {
  const db=await getDatabase();
  await db.runAsync('DELETE FROM expenses WHERE id=?',id);
}

export async function loadSettings(): Promise<AppSettings> { const value=await AsyncStorage.getItem(SETTINGS_KEY); return value?{...defaultSettings,...JSON.parse(value) as AppSettings}:defaultSettings; }
export async function saveSettings(settings: AppSettings): Promise<void> { await AsyncStorage.setItem(SETTINGS_KEY,JSON.stringify(settings)); }

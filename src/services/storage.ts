import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import type { AppSettings, Expense } from '../types/expense';

const LEGACY_KEY = 'receiptlog.expenses.v1';
const MIGRATION_KEY = 'receiptlog.sqlite.migrated.v1';
const SETTINGS_KEY = 'receiptlog.settings.v1';
const dbPromise = SQLite.openDatabaseAsync('receiptlog.db');

export const defaultSettings: AppSettings = {
  monthlyBudget: 50000,
  categories: ['食費', '日用品', '交通費', '娯楽', '医療', 'その他'],
  aiFallbackEnabled: false,
};

type ExpenseRow = {
  id: string; store_name: string; purchase_date: string; amount: string;
  category: string; payment_method: string; note: string;
  source_type: Expense['sourceType']; confidence: number;
  raw_text: string; image_uri: string | null;
};

async function database() {
  const db = await dbPromise;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY NOT NULL,
      store_name TEXT NOT NULL,
      purchase_date TEXT NOT NULL,
      amount TEXT NOT NULL,
      category TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      note TEXT NOT NULL,
      source_type TEXT NOT NULL,
      confidence REAL NOT NULL,
      raw_text TEXT NOT NULL,
      image_uri TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS expenses_purchase_date_idx
      ON expenses(purchase_date DESC);
  `);
  return db;
}

const fromRow = (row: ExpenseRow): Expense => ({
  id: row.id, storeName: row.store_name, date: row.purchase_date,
  amount: row.amount, category: row.category,
  paymentMethod: row.payment_method, note: row.note,
  sourceType: row.source_type, confidence: row.confidence,
  rawText: row.raw_text, imageUri: row.image_uri ?? undefined,
});

async function replaceExpenses(expenses: Expense[]): Promise<void> {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM expenses');
    for (const expense of expenses) {
      await txn.runAsync(
        `INSERT INTO expenses
          (id, store_name, purchase_date, amount, category, payment_method,
           note, source_type, confidence, raw_text, image_uri, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        expense.id, expense.storeName, expense.date, expense.amount,
        expense.category, expense.paymentMethod, expense.note,
        expense.sourceType, expense.confidence, expense.rawText,
        expense.imageUri ?? null, Number(expense.id) || Date.now(),
      );
    }
  });
}

async function migrateLegacyExpenses(): Promise<void> {
  if (await AsyncStorage.getItem(MIGRATION_KEY)) return;
  const db = await database();
  const rows = await db.getAllAsync<{ count: number }>('SELECT COUNT(*) AS count FROM expenses');
  const legacyValue = await AsyncStorage.getItem(LEGACY_KEY);
  if ((rows[0]?.count ?? 0) === 0 && legacyValue) {
    const parsed = JSON.parse(legacyValue) as Expense[];
    if (Array.isArray(parsed)) await replaceExpenses(parsed);
  }
  await AsyncStorage.setItem(MIGRATION_KEY, '1');
}

export async function loadExpenses(): Promise<Expense[]> {
  await migrateLegacyExpenses();
  const db = await database();
  const rows = await db.getAllAsync<ExpenseRow>(
    'SELECT * FROM expenses ORDER BY purchase_date DESC, created_at DESC',
  );
  return rows.map(fromRow);
}

export async function saveExpenses(expenses: Expense[]): Promise<void> {
  await replaceExpenses(expenses);
}

export async function loadSettings(): Promise<AppSettings> {
  const value = await AsyncStorage.getItem(SETTINGS_KEY);
  return value ? { ...defaultSettings, ...(JSON.parse(value) as AppSettings) } : defaultSettings;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

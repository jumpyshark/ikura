import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppSettings, Expense } from '../types/expense';

const KEY = 'receiptlog.expenses.v1';
const SETTINGS_KEY = 'receiptlog.settings.v1';
export const defaultSettings: AppSettings = { monthlyBudget: 50000, categories: ['食費', '日用品', '交通費', '娯楽', '医療', 'その他'], aiFallbackEnabled: false };

export async function loadExpenses(): Promise<Expense[]> {
  const value = await AsyncStorage.getItem(KEY);
  return value ? (JSON.parse(value) as Expense[]) : [];
}

export async function saveExpenses(expenses: Expense[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(expenses));
}

export async function loadSettings(): Promise<AppSettings> {
  const value = await AsyncStorage.getItem(SETTINGS_KEY);
  return value ? { ...defaultSettings, ...(JSON.parse(value) as AppSettings) } : defaultSettings;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

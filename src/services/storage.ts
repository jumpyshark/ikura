import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Expense } from '../types/expense';

const KEY = 'receiptlog.expenses.v1';

export async function loadExpenses(): Promise<Expense[]> {
  const value = await AsyncStorage.getItem(KEY);
  return value ? (JSON.parse(value) as Expense[]) : [];
}

export async function saveExpenses(expenses: Expense[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(expenses));
}

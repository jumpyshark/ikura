import type { ExpenseDraft } from '../types/expense';

// Milestone 1 stub. Replace this adapter with on-device ML Kit OCR.
export async function extractExpense(_imageUri: string): Promise<ExpenseDraft> {
  await new Promise((resolve) => setTimeout(resolve, 650));
  return {
    storeName: 'OCR result (edit me)',
    date: new Date().toISOString().slice(0, 10),
    amount: '',
    category: 'その他',
    sourceType: 'receipt',
  };
}

export type ExpenseDraft = {
  storeName: string;
  date: string;
  amount: string;
  category: string;
  paymentMethod: string;
  note: string;
  sourceType: 'receipt' | 'payment_screenshot';
  confidence: number;
  rawText: string;
  fieldConfidence?: { storeName: number; date: number; amount: number; category: number };
  warnings?: string[];
  amountCandidates?: string[];
};

export type Expense = ExpenseDraft & { id: string; imageUri?: string };

export type AppSettings = { monthlyBudget: number; categories: string[]; aiFallbackEnabled: boolean };

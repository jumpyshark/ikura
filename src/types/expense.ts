export type ExpenseDraft = {
  storeName: string;
  date: string;
  amount: string;
  category: string;
  sourceType: 'receipt' | 'payment_screenshot';
};

export type Expense = ExpenseDraft & { id: string; imageUri?: string };

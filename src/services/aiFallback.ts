import type { ExpenseDraft } from '../types/expense';

// Keep provider API keys off-device. Point this at a small authenticated server/Edge Function.
const endpoint = process.env.EXPO_PUBLIC_AI_FALLBACK_URL;

export async function applyAiFallback(draft: ExpenseDraft): Promise<ExpenseDraft> {
  if (!endpoint || draft.confidence >= 0.75) return draft;
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawText: draft.rawText }) });
  if (!response.ok) return draft;
  const result = await response.json() as Partial<ExpenseDraft>;
  return { ...draft, ...result, rawText: draft.rawText, confidence: Math.max(draft.confidence, result.confidence ?? 0) };
}

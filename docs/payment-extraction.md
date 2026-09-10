# Payment screenshot extraction

This increment preserves OCR-first processing and mandatory confirmation. It adds a TypeScript semantic parser and duplicate review, with no new native dependencies.

## Implemented

- Normalize full-width text, restore positioned OCR rows, and retain the receipt parser for paper receipts.
- Split supported dated history layouts into separate review drafts. Save or skip each draft; never bulk-save an image automatically.
- Distinguish purchases, pending/failed payments, incoming money, top-ups, transfers, refunds, and unknown records. Non-purchase drafts require an additional confirmation before recording them as an expense.
- Prefer labelled payment amounts; exclude balances, points, taxes, identifiers and cash tender/change. Keep ambiguous amounts blank.
- Recognize explicit merchant fields and common provider names, without requiring the provider to be known.
- Leave missing/placeholder years blank. Foreign or uncertain currency requires manual yen entry; no exchange rate is assumed.
- Compare saved SQLite expenses by amount, normalized merchant (including selected aliases), and date. Exact matches are strong warnings; same-day equal amounts and nearby posting dates are weaker warnings. Editing excludes the current row. No automatic deletion or merge.

## Test evidence and limits

Tests use manually transcribed text from the supplied screenshots, not OCR obtained by running those screenshots on a phone. Passing them is not a measured OCR accuracy rate. Confidence values are heuristic ranking scores, not calibrated probabilities.

The current database is yen-only. It does not separately store original currency, merchant branch, transaction ID, purchase time, accounting date, or cash/points split. Tobu's total is the purchase total (4228 yen), not cash paid after points (4000 yen).

History splitting supports the included repeated-date layouts. Unknown layouts, shared date headers, wrapped records, mixed scripts, cropped text, positive unlabelled balances, and notifications containing several dates still need a broader benchmark. A screenshot's app identity must not be inferred solely from a logo that OCR cannot read. Category is always an editable suggestion.

## Device acceptance

1. Scan/import each original sample on iOS and Android; compare real OCR rows with the text fixtures.
2. Confirm PayPay history yields three drafts with purchase/pending/top-up types; save only the purchase and skip the others.
3. Confirm bank transfers stay separate and balances are not selected.
4. Save the same purchase from a receipt and screenshot; verify duplicate warning and cancel/explicit-save choices.
5. Save two legitimate equal-value purchases separately; verify neither is deleted.
6. Close/reopen the app and confirm saved records and totals persist.
7. Test cancellation, failed OCR, and replacing an image during review.

Before claiming high accuracy, collect a held-out, redacted set of unfamiliar layouts and report exact merchant/date/amount accuracy, missed transactions, false expense classifications, abstention rate, and duplicate false positives/negatives separately.

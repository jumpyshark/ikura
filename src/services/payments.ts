import type { ExpenseDraft } from '../types/expense';
import type { MerchantRule } from './database';
import { parseReceiptText, parseStructuredReceipt, reconstructReceiptRows, type PositionedTextLine } from './parser';

export type TransactionKind = 'expense' | 'income' | 'topup' | 'transfer' | 'refund' | 'pending' | 'unknown';

export const transactionLabels: Record<TransactionKind, string> = {
  expense: '購入・支払い',
  income: '入金',
  topup: 'チャージ',
  transfer: '送金・振替',
  refund: '返金',
  pending: '処理中・未完了',
  unknown: '種別不明',
};

export type PaymentCandidate = {
  draft: ExpenseDraft;
  kind: TransactionKind;
};

const datePattern = /(?:20\d{2}|令和\s*\d{1,2}|R\d{1,2})\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}日?/;
const moneyPattern = /(?:[¥￥]\s*(-?\d[\d,]*(?:\.\d{1,2})?)|(-?\d[\d,]*(?:\.\d{1,2})?)\s*円)/g;
const excludedNoisePattern = /残高|余额|餘額|balance|ポイント|point|伝票|番号|税|小計|お預|お釣|商品価格/i;

/** Detects payment method / provider from text */
export function detectPaymentProvider(text: string): string | undefined {
  const providers: Array<[RegExp, string]> = [
    [/PayPay/i, 'PayPay'],
    [/LINE\s*Pay/i, 'LINE Pay'],
    [/楽天ペイ|Rakuten\s*Pay|Rpay/i, '楽天ペイ'],
    [/d\s*払い/i, 'd払い'],
    [/Alipay|支付宝/i, 'Alipay'],
    [/au\s*PAY/i, 'au PAY'],
    [/メルペイ|Merpay/i, 'メルペイ'],
    [/Suica/i, 'Suica'],
    [/PASMO/i, 'PASMO'],
    [/ICOCA/i, 'ICOCA'],
    [/iD/i, 'iD'],
    [/QUICPay/i, 'QUICPay'],
    [/WAON/i, 'WAON'],
    [/nanaco/i, 'nanaco'],
    [/Edy/i, '楽天Edy'],
    [/VISA/i, 'Visa'],
    [/MasterCard/i, 'Mastercard'],
    [/JCB/i, 'JCB'],
    [/AMEX|American\s*Express/i, 'American Express'],
  ];

  for (const [pattern, name] of providers) {
    if (pattern.test(text)) {
      return name;
    }
  }
  return undefined;
}

/** Classifies transaction kind based on key terms */
export function classifyTransactionKind(text: string): TransactionKind {
  if (/キャンセル|取消|失敗|未完了|支払い受付|支払.*受付|処理中|保留|pending|failed/i.test(text)) {
    return 'pending';
  }
  if (/返金|退款|refund/i.test(text)) {
    return 'refund';
  }
  if (/チャージ|充值|top.?up/i.test(text)) {
    return 'topup';
  }
  if (/送金|振込|振替|转账|transfer/i.test(text)) {
    return 'transfer';
  }
  if (/受取|受け取|入金|收款|received/i.test(text)) {
    return 'income';
  }
  if (/支払|お会計|決済完了|利用金額|ご利用|利用通知|利用速報|ご利用店|購入|付款|支付成功|实付|paid|purchase|amount paid/i.test(text)) {
    return 'expense';
  }
  return 'unknown';
}

/** Parses a block of text lines from a digital payment screenshot */
function parseBlock(rows: string[], rules: MerchantRule[], defaultPaymentMethod?: string): PaymentCandidate {
  const text = rows.join('\n');
  const draft = parseReceiptText(rows, rules);
  const kind = classifyTransactionKind(text);

  draft.sourceType = 'payment_screenshot';
  draft.paymentMethod = defaultPaymentMethod ?? detectPaymentProvider(text) ?? '未設定';

  // Explicit merchant labels override app UI headers and navigation text
  const merchantLabel = /^(?:ご利用店(?:舗)?名?|利用店舗|利用先|利用サービス|加盟店名?|店舗名|商户(?:名称)?|收款方|merchant)\s*[:：]?\s*(.*)$/i;
  const labelledIndex = rows.findIndex((row) => merchantLabel.test(row));
  const explicitMerchant = labelledIndex >= 0
    ? rows[labelledIndex]!.match(merchantLabel)?.[1]?.trim() || rows[labelledIndex + 1]
    : undefined;

  const UI_NOISE = /支払|完了|確認|取引|履歴|レポート|すべて|通知|速報|利用日時|日時|残高|ポイント|合計|金額|伝票|番号|戻る|閉じる|GMT|\d{1,2}:\d{2}|20\d{2}[年./-]/i;

  const paymentTargetMatch = rows.find((row) => /に支払い/.test(row))?.replace(/に支払い.*$/, '');
  const genericStoreLine = rows.find(
    (row) => !UI_NOISE.test(row) &&
      !/[¥￥円]/.test(row) &&
      row.length >= 2 &&
      /[\p{L}]/u.test(row) &&
      row !== defaultPaymentMethod
  );

  const detectedStoreName = explicitMerchant || paymentTargetMatch || genericStoreLine || '';
  draft.storeName = detectedStoreName;

  if (detectedStoreName) {
    const inferred = parseReceiptText([detectedStoreName], rules);
    draft.category = inferred.category;
  }

  // Score candidate amounts
  const rankedAmountScores = new Map<string, number>();

  rows.forEach((row, rowIndex) => {
    if (excludedNoisePattern.test(row)) return;

    const labelPattern = /お支払い?合計|支払金額|利用金額|ご利用金額|決済金額|実支払|实付|amount paid|total/i;
    const matches: RegExpMatchArray[] = [...row.matchAll(moneyPattern)];
    const labelledValueMatch = row.match(/(?:お支払い?合計|支払金額|ご?利用金額|決済金額)\s*[:：]?\s*(\d[\d,]*)\s*$/);

    if (!matches.length && labelledValueMatch) {
      matches.push(labelledValueMatch);
    }

    const baseScore = labelPattern.test(row)
      ? 100
      : rowIndex > 0 && labelPattern.test(rows[rowIndex - 1]!)
      ? 90
      : 50;

    for (const match of matches) {
      const rawValueStr = (match[1] ?? match[2])!.replace(/,/g, '');
      const parsedVal = Number(rawValueStr);
      if (parsedVal > 0 && Number.isSafeInteger(parsedVal) && parsedVal < 10_000_000) {
        const valKey = String(parsedVal);
        rankedAmountScores.set(valKey, Math.max(rankedAmountScores.get(valKey) ?? 0, baseScore));
      }
    }
  });

  const sortedAmounts = [...rankedAmountScores.entries()].sort((a, b) => b[1] - a[1]);
  const isCertain = sortedAmounts.length === 1 ||
    (sortedAmounts.length > 1 && sortedAmounts[0]![1] - sortedAmounts[1]![1] >= 30);

  draft.amount = isCertain ? sortedAmounts[0]![0] : '';
  draft.amountCandidates = sortedAmounts.map(([val]) => val);
  draft.warnings = [];

  if (!draft.amount) {
    draft.warnings.push('支払金額を特定できません。残高・ポイントと区別して確認してください。');
  }

  if (!draft.date || /20XX/i.test(text)) {
    draft.date = '';
    draft.warnings.push('取引日を確認してください。年は推測していません。');
  }

  if (kind !== 'expense') {
    draft.warnings.push(
      `取引種別：${transactionLabels[kind]}。通常の購入とは限りません。支出として記録するか確認してください。`
    );
  }

  if (/Alipay|支付宝|CNY|RMB|元|USD|\$/i.test(text)) {
    draft.amount = '';
    draft.amountCandidates = [];
    draft.warnings.push('通貨を確認してください。このアプリの金額欄は日本円です。自動換算はしていません。');
  }

  draft.fieldConfidence = {
    storeName: detectedStoreName ? (explicitMerchant ? 0.9 : 0.6) : 0,
    date: draft.date ? 0.85 : 0,
    amount: draft.amount ? 0.8 : 0,
    category: 0.5,
  };

  draft.confidence = Object.values(draft.fieldConfidence).reduce((a, b) => a + b, 0) / 4;

  return { draft, kind };
}

/** Parses payment screenshot text, splitting history/statement screens into individual records */
export function parsePaymentText(input: string[], rules: MerchantRule[] = []): PaymentCandidate[] {
  const rows = input
    .flatMap((row) => row.normalize('NFKC').split(/\r?\n/))
    .map((row) => row.trim())
    .filter(Boolean);

  const text = rows.join('\n');
  const paymentMethod = detectPaymentProvider(text);

  const dateIndices = rows.flatMap((row, index) => (datePattern.test(row) ? [index] : []));
  const isHistoryView = dateIndices.length > 1 &&
    (/履歴|明細|history|statement/i.test(text) ||
      rows.filter((row) => /送金|振込|に支払い|チャージ/.test(row)).length > 1);

  if (!isHistoryView) {
    return [parseBlock(rows, rules, paymentMethod)];
  }

  const startsWithDate = rows.slice(0, dateIndices[0]).every((row) => !/[¥￥]|\d\s*円/.test(row));
  const boundaries = startsWithDate
    ? dateIndices
    : dateIndices.map((index) => {
        let start = index;
        while (
          start > 0 &&
          !datePattern.test(rows[start - 1]!) &&
          !/支払.*完了|チャージ完了|支払い受付/.test(rows[start - 1]!) &&
          !/履歴|レポート|すべて|20\d{2}年\d+月$/.test(rows[start - 1]!)
        ) {
          start--;
        }
        return start;
      });

  return boundaries.map((start, i) =>
    parseBlock(rows.slice(start, boundaries[i + 1] ?? rows.length), rules, paymentMethod)
  );
}

/** Document entry point routing paper receipts vs digital payment screenshots */
export function parseDocument(lines: PositionedTextLine[], rules: MerchantRule[] = []): PaymentCandidate[] {
  const rows = reconstructReceiptRows(lines);
  const text = rows.join('\n');
  const isPaperReceipt = /領収|レシート|小計|お釣|お預/.test(text) && /合\s*計/.test(text);

  if (isPaperReceipt) {
    return [{ draft: parseStructuredReceipt(lines, rules), kind: 'expense' }];
  }

  return parsePaymentText(rows, rules);
}

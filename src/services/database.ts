import * as SQLite from 'expo-sqlite';

export type MerchantRule = {
  name: string;
  category: string;
  aliases: string[];
};

const dbPromise = SQLite.openDatabaseAsync('receiptlog.db');

const merchantSeeds: MerchantRule[] = [
  { name: 'ファミリーマート', category: '食費', aliases: ['FamilyMart', 'ファミリーマート', 'ファミマ'] },
  { name: 'セブン-イレブン', category: '食費', aliases: ['7-ELEVEN', 'セブンイレブン', 'セブン-イレブン'] },
  { name: 'ローソン', category: '食費', aliases: ['LAWSON', 'ローソン', 'ナチュラルローソン'] },
  { name: 'ミニストップ', category: '食費', aliases: ['MINISTOP', 'ミニストップ'] },
  { name: 'イオン', category: '食費', aliases: ['AEON', 'イオン', 'まいばすけっと'] },
  { name: 'イトーヨーカドー', category: '食費', aliases: ['イトーヨーカドー', 'イトーヨーカ堂'] },
  { name: '西友', category: '食費', aliases: ['SEIYU', '西友'] },
  { name: 'ライフ', category: '食費', aliases: ['LIFE', 'ライフ'] },
  { name: '業務スーパー', category: '食費', aliases: ['業務スーパー'] },
  { name: 'オーケー', category: '食費', aliases: ['オーケー', 'OKストア', 'OK STORE'] },
  { name: 'マツモトキヨシ', category: '日用品', aliases: ['マツモトキヨシ', 'マツキヨ'] },
  { name: 'ウエルシア', category: '日用品', aliases: ['ウエルシア', 'welcia'] },
  { name: 'スギ薬局', category: '日用品', aliases: ['スギ薬局', 'SUGI'] },
  { name: 'ココカラファイン', category: '日用品', aliases: ['ココカラファイン'] },
  { name: 'マクドナルド', category: '食費', aliases: ["McDonald's", 'McDonalds', 'マクドナルド'] },
  { name: 'すき家', category: '食費', aliases: ['すき家'] },
  { name: '吉野家', category: '食費', aliases: ['吉野家'] },
  { name: 'ガスト', category: '食費', aliases: ['ガスト'] },
  { name: 'サイゼリヤ', category: '食費', aliases: ['サイゼリヤ'] },
  { name: 'スターバックス', category: '食費', aliases: ['STARBUCKS', 'スターバックス'] },
  { name: 'JR', category: '交通費', aliases: ['JR東日本', 'JR東海', 'JR西日本'] },
  { name: 'Amazon', category: 'その他', aliases: ['Amazon', 'アマゾン'] },
  { name: '楽天市場', category: 'その他', aliases: ['楽天市場', 'Rakuten'] },
  { name: 'ヨドバシカメラ', category: 'その他', aliases: ['ヨドバシカメラ', 'YODOBASHI'] },
  { name: 'ビックカメラ', category: 'その他', aliases: ['ビックカメラ', 'BIC CAMERA'] },
];

let initialized: Promise<SQLite.SQLiteDatabase> | undefined;

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  initialized ??= initialize();
  return initialized;
}

async function initialize() {
  const db = await dbPromise;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
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
    CREATE TABLE IF NOT EXISTS merchants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_name TEXT UNIQUE NOT NULL,
      default_category TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS merchant_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      alias TEXT UNIQUE NOT NULL
    );
  `);
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const merchant of merchantSeeds) {
      await txn.runAsync(
        'INSERT OR IGNORE INTO merchants (canonical_name, default_category) VALUES (?, ?)',
        merchant.name, merchant.category,
      );
      const row = await txn.getFirstAsync<{ id: number }>(
        'SELECT id FROM merchants WHERE canonical_name = ?', merchant.name,
      );
      if (!row) continue;
      for (const alias of merchant.aliases) {
        await txn.runAsync(
          'INSERT OR IGNORE INTO merchant_aliases (merchant_id, alias) VALUES (?, ?)',
          row.id, alias,
        );
      }
    }
  });
  return db;
}

export async function loadMerchantRules(): Promise<MerchantRule[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ name: string; category: string; alias: string }>(`
    SELECT m.canonical_name AS name, m.default_category AS category, a.alias
    FROM merchants m JOIN merchant_aliases a ON a.merchant_id = m.id
    ORDER BY m.id, a.id
  `);
  const rules = new Map<string, MerchantRule>();
  for (const row of rows) {
    const rule = rules.get(row.name) ?? { name: row.name, category: row.category, aliases: [] };
    rule.aliases.push(row.alias);
    rules.set(row.name, rule);
  }
  return [...rules.values()];
}

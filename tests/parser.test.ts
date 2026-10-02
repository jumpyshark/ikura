import assert from 'node:assert/strict';
import test from 'node:test';
import { amounts, detectDate, parseReceiptText, parseStructuredReceipt, reconstructReceiptRows } from '../src/services/parser';
import type { MerchantRule } from '../src/services/database';

const merchants: MerchantRule[] = [
  { name:'ファミリーマート', category:'食費', aliases:['FamilyMart','ファミリーマート'] },
  { name:'スギ薬局', category:'日用品', aliases:['スギ薬局'] },
];

test('FamilyMart fragmented receipt', () => {
  const result=parseReceiptText([
    'FamilyMart','一の橋店','東京都港区麻布十番1-2-10','電話:03-3560-3895',
    '領','収','証','2016年 9月29日 (木) 12:45','十六茶','¥151','値引き','-22',
    '吊るしベーコン','¥198','茶碗蒸し','¥133','(商品合計','¥482)','(値引合計','-22)',
    '小','計','¥460','合','計','¥460','(内消費税等','¥34)','お預','り','¥510','お','釣','¥50',
  ],merchants);
  assert.equal(result.storeName,'ファミリーマート');
  assert.equal(result.category,'食費');
  assert.equal(result.date,'2016-09-29');
  assert.equal(result.amount,'460');
});

test('does not choose deposit or change',()=>{
  const result=parseReceiptText(['山田商店','2026/09/09','合計 ¥1,284','お預り ¥2,000','お釣り ¥716'],merchants);
  assert.equal(result.storeName,'山田商店');
  assert.equal(result.amount,'1284');
});

test('uses a generic shop suffix',()=>{
  const result=parseReceiptText(['青空パン屋','2026-09-09','お会計','680円'],merchants);
  assert.equal(result.storeName,'青空パン屋');
  assert.equal(result.amount,'680');
});

test('detects known drugstore category',()=>{
  const result=parseReceiptText(['スギ薬局 横浜店','2026.09.09','お支払額 1,500円'],merchants);
  assert.equal(result.storeName,'スギ薬局');
  assert.equal(result.category,'日用品');
  assert.equal(result.amount,'1500');
});

test('leaves conflicting final totals for confirmation',()=>{
  const result=parseReceiptText(['テスト店','合計 ¥500','お会計 ¥800'],merchants);
  assert.equal(result.amount,'');
  assert.deepEqual(result.amountCandidates?.sort(),['500','800']);
});

test('reconstructs receipt columns before selecting the total',()=>{
  const positioned = [
    {text:'FamilyMart',frame:{x:0.10,y:0.05,width:0.42,height:0.04}},
    {text:'2016年9月29日',frame:{x:0.10,y:0.14,width:0.38,height:0.03}},
    {text:'商品合計',frame:{x:0.10,y:0.55,width:0.22,height:0.03}},
    {text:'¥482',frame:{x:0.76,y:0.55,width:0.14,height:0.03}},
    {text:'合',frame:{x:0.10,y:0.65,width:0.05,height:0.03}},
    {text:'計',frame:{x:0.18,y:0.65,width:0.05,height:0.03}},
    {text:'¥460',frame:{x:0.76,y:0.65,width:0.14,height:0.03}},
    {text:'お預り',frame:{x:0.10,y:0.72,width:0.18,height:0.03}},
    {text:'¥510',frame:{x:0.76,y:0.72,width:0.14,height:0.03}},
    {text:'お釣り',frame:{x:0.10,y:0.78,width:0.18,height:0.03}},
    {text:'¥50',frame:{x:0.78,y:0.78,width:0.12,height:0.03}},
  ];
  assert.ok(reconstructReceiptRows(positioned).includes('合 計 ¥460'));
  assert.equal(parseStructuredReceipt(positioned,merchants).amount,'460');
});

test('repairs common OCR label confusion',()=>{
  const result=parseReceiptText(['テスト店','2026/09/09','合言十 ¥980','お釣リ ¥20'],merchants);
  assert.equal(result.amount,'980');
});

const positionedRows = (rows: string[]) => rows.map((text,i) => ({text,frame:{x:0.1,y:i*0.06,width:0.8,height:0.03}}));

test('flags a total conflicting with cash arithmetic',()=>{
  const result=parseStructuredReceipt(positionedRows(['テスト店','合計 ¥480','お預り ¥510','お釣り ¥50']));
  assert.equal(result.amount,'480');
  assert.ok(result.warnings?.some(w=>w.includes('460円')));
  assert.ok(result.fieldConfidence!.amount <= 0.45);
});

test('does not invent a total from cash arithmetic',()=>{
  const result=parseStructuredReceipt(positionedRows(['テスト店','お預り ¥510','お釣り ¥50']));
  assert.equal(result.amount,'');
  assert.ok(result.warnings?.some(w=>w.includes('460円')));
});

test('handles zero change and ambiguous cash values',()=>{
  const zero=parseStructuredReceipt(positionedRows(['テスト店','合計 ¥500','お預り ¥500','お釣り ¥0']));
  assert.ok(!zero.warnings?.some(w=>w.includes('違い')));
  const ambiguous=parseStructuredReceipt(positionedRows(['テスト店','合計 ¥460','お預り ¥510','お預り ¥1000','お釣り ¥50']));
  assert.ok(!ambiguous.warnings?.some(w=>w.includes('違い')));
});

test('parses Japanese Wareki dates correctly',()=>{
  assert.equal(detectDate('令和6年9月10日').value, '2024-09-10');
  assert.equal(detectDate('R6.09.10').value, '2024-09-10');
  assert.equal(detectDate('平成30年5月15日').value, '2018-05-15');
});

test('repairs OCR digit misreads in currency context',()=>{
  const result=parseReceiptText(['テスト商店','2026-09-10','お買上金額 ¥1,O0O'],merchants);
  assert.equal(result.amount, '1000');
  assert.equal(result.storeName, 'テスト商店');
});

test('ignores tax registration numbers and invoice headers for store names',()=>{
  const result=parseReceiptText(['適格請求書','登録番号 T1234567890123','太陽カフェ','2026-09-10','請求額 850円'],merchants);
  assert.equal(result.storeName, '太陽カフェ');
  assert.equal(result.category, '食費');
  assert.equal(result.amount, '850');
});

test('prioritizes known merchants even when their names span OCR lines',()=>{
  const yodobashi=parseReceiptText(['領収書','株式会社ヨドバシ','カメラ 新宿西口店','2026/09/10','合計 6,700円']);
  assert.equal(yodobashi.storeName,'ヨドバシカメラ');
  assert.equal(yodobashi.category,'その他');

  const bic=parseReceiptText(['ビッグ','カメラ 有楽町店','2026/09/10','お会計 2,480円']);
  assert.equal(bic.storeName,'ビックカメラ');

  const seven=parseReceiptText(['7-11','港区一丁目店','2026/09/10','合計 780円']);
  assert.equal(seven.storeName,'セブン-イレブン');
  assert.equal(seven.category,'食費');
});

test('reads OCR spaces used in place of thousands separators',()=>{
  assert.deepEqual(amounts('お会計 ¥6 700'),[{value:6700,currency:true}]);
  assert.equal(parseReceiptText(['ヨドバシ カメラ','2026/09/10','合計 6 700 円']).amount,'6700');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReceiptText, parseStructuredReceipt, reconstructReceiptRows } from '../src/services/parser';
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

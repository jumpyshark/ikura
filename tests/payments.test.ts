import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePaymentText } from '../src/services/payments';
import { findDuplicates } from '../src/services/duplicates';

test('PayPay detail: single currency amount, not status clock',()=>{
 const [r]=parsePaymentText(['9:41 AM','PayPayレストラン','1号店','2020年5月1日 12時11分28秒','1,254円','支払い完了']);
 assert.equal(r!.draft.amount,'1254'); assert.equal(r!.draft.date,'2020-05-01'); assert.equal(r!.draft.storeName,'PayPayレストラン');
});
test('LINE Pay: repeated price, points and balance payment method',()=>{
 const [r]=parsePaymentText(['100円','2019.04.12 14:27:33 (GMT+09:00)','利用サービス 株式会社ローソン','お支払い方法 LINE Pay残高','商品価格 100円','お支払い合計 100円','付与予定ポイント +3']);
 assert.equal(r!.draft.amount,'100'); assert.equal(r!.draft.storeName,'株式会社ローソン'); assert.equal(r!.draft.paymentMethod,'LINE Pay');
});
test('Rakuten sample: unknown year, points and slip number excluded',()=>{
 const [r]=parsePaymentText(['お支払い完了','R dining 二子玉川店','20XX/12/25(日) 14:38','¥8,400','ポイント利用 0','獲得予定ポイント 84','伝票番号 8768']);
 assert.equal(r!.draft.amount,'8400'); assert.equal(r!.draft.date,''); assert.equal(r!.draft.storeName,'R dining 二子玉川店');
});
test('PayPay history: three separate kinds and amounts',()=>{
 const r=parsePaymentText(['取引履歴','2024年11月','〇〇〇に支払い 500円','△△店','2024年11月23日18時32分','残高','支払い完了','〇〇〇へ支払いを受付 10,000円','△△店','2024年11月23日17時31分','PayPayカード','支払い受付','〇〇銀行からチャージ 20,000円','2024年11月18日10時14分','チャージ完了']);
 assert.equal(r.length,3); assert.deepEqual(r.map(x=>x.kind),['expense','pending','topup']); assert.deepEqual(r.map(x=>x.draft.amount),['500','10000','20000']);
});
test('bank: repeated transfers stay separate, negative balances excluded',()=>{
 const r=parsePaymentText(['2020年12月','2020.12.30','送金 平成 太郎 ¥1,821','¥-2,996,529','2020.12.30','送金 平成 太郎 ¥50','¥-2,998,350','2020.12.30','送金 平成 太郎 ¥1,500','¥-2,998,400']);
 assert.equal(r.length,3); assert.deepEqual(r.map(x=>x.draft.amount),['1821','50','1500']); assert.ok(r.every(x=>x.kind==='transfer'));
});
test('card notification: labelled amount and merchant',()=>{
 const [r]=parsePaymentText(['カードご利用通知','ご利用日 2026/09/10','ご利用店名 ローソン横浜店','ご利用金額 780円','ご利用可能残高 200,000円']);
 assert.equal(r!.draft.amount,'780'); assert.equal(r!.draft.storeName,'ローソン横浜店');
});
test('unknown conflicting amounts abstain; foreign currencies not saved as yen',()=>{
 assert.equal(parsePaymentText(['謎の店舗','2026/09/10','500円','800円'])[0]!.draft.amount,'');
 assert.equal(parsePaymentText(['Alipay','支付成功','商户名称 ABC','2026/09/10','¥88.00'])[0]!.draft.amount,'');
});
test('d払い explicit amount without currency symbol',()=>{
 const [r]=parsePaymentText(['d払い','お支払い完了','店舗名 テスト商店','2026/09/10','支払金額 1,280']);
 assert.equal(r!.draft.amount,'1280'); assert.equal(r!.draft.paymentMethod,'d払い');
});
test('duplicate review: exact, nearby posting date, different amount, edit exclusion',()=>{
 const draft=parsePaymentText(['ご利用店名 ローソン横浜店','2026/09/10','ご利用金額 780円'])[0]!.draft;
 const saved=[{...draft,id:'1'},{...draft,id:'2',date:'2026-09-12'},{...draft,id:'3',amount:'781'}];
 assert.equal(findDuplicates(draft,saved)[0]!.level,'strong'); assert.equal(findDuplicates(draft,saved).length,2); assert.equal(findDuplicates(draft,saved,'1').length,1);
});

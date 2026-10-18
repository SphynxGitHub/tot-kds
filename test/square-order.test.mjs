import { mapSquareOrder, allocate } from '../supabase/functions/_shared/squareOrder.mjs';
let fail = 0; const ok = (n, c) => { console.log(c ? 'OK  ' : 'FAIL', n); if (!c) fail++; };
ok('allocate sums exactly', allocate(100, [1, 1, 1]).reduce((a, b) => a + b) === 100);
ok('allocate zero weights', allocate(5, [0, 0]).join() === '5,0');
const o = mapSquareOrder({
  id: 'O1', location_id: 'L1', created_at: '2026-10-17T16:00:00Z', state: 'COMPLETED',
  fulfillments: [{ pickup_details: { recipient: { display_name: 'Ayşe Yılmaz', phone_number: '+12395550100' } } }],
  line_items: [
    { uid: 'a', name: '** Chicken', variation_name: 'Regular', quantity: '2', gross_sales_money: { amount: 2400 }, modifiers: [{ name: 'No onion' }, { name: 'Extra sauce' }] },
    { uid: 'b', name: 'Lemonade', variation_name: 'Large', quantity: '1', gross_sales_money: { amount: 500 } },
  ],
  total_tip_money: { amount: 333 }, total_tax_money: { amount: 175 },
  discounts: [{ applied_money: { amount: 100 } }],
  tenders: [{ processing_fee_money: { amount: 101 } }],
  total_money: { amount: 3308 },
});
ok('name split', o.order.first_name === 'Ayşe' && o.order.last_name === 'Yılmaz');
ok('cleans names/variation', o.items[0].item_name === 'Chicken' && o.items[0].variation_name === null && o.items[1].variation_name === 'Large');
ok('modifiers joined', o.items[0].modifiers === 'No onion, Extra sauce');
ok('line sums equal order totals', ['tip', 'tax', 'discount', 'fee'].every((k) => o.items.reduce((s, i) => s + i[k + '_cents'], 0) === o.order[k + '_cents']));
ok('total matches Square', o.order.total_cents === o.order.square_total_cents);
process.exit(fail ? 1 : 0);

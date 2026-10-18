import { freshDb } from './db.mjs';
import { saveSquareOrder } from '../supabase/functions/_shared/saveOrder.mjs';
import { verifySignature } from '../supabase/functions/_shared/square.mjs';
import crypto from 'node:crypto';
const db = await freshDb();
let fail = 0; const ok = (n, c) => { console.log(c ? 'OK  ' : 'FAIL', n); if (!c) fail++; };
await db.exec(`insert into locations(name, square_location_id) values ('Test','SQL1')`);
const base = {
  id: 'O1', location_id: 'SQL1', created_at: new Date().toISOString(), state: 'OPEN',
  line_items: [{ uid: 'a', name: 'Chicken', variation_name: 'Regular', quantity: '1', gross_sales_money: { amount: 1200 } }],
  total_tax_money: { amount: 72 }, total_tip_money: { amount: 0 }, tenders: [],
};
await saveSquareOrder(db, base);
await db.query(`update orders set status='cooking', phone='+12395550111' where square_order_id='O1'`);
await saveSquareOrder(db, { ...base, total_tip_money: { amount: 200 }, tenders: [{ processing_fee_money: { amount: 45 } }] });
const r = (await db.query(`select * from orders`)).rows;
ok('one order, no duplicate', r.length === 1);
ok('kitchen status/phone not overwritten', r[0].status === 'cooking' && r[0].phone === '+12395550111');
ok('fee + tip updated later', r[0].fee_cents === 45 && r[0].tip_cents === 200 && r[0].total_cents === 1472);
ok('linked to location', !!r[0].location_id);
ok('one line, one log row', (await db.query(`select 1 from order_items`)).rows.length === 1 && (await db.query(`select 1 from order_status_log`)).rows.length === 1);
const key = 'k', url = 'https://x/y', body = '{"a":1}';
const sig = crypto.createHmac('sha256', key).update(url + body).digest('base64');
ok('signature verifies', verifySignature({ rawBody: body, signature: sig, signatureKey: key, notificationUrl: url }));
ok('bad signature rejected', !verifySignature({ rawBody: body + ' ', signature: sig, signatureKey: key, notificationUrl: url }));
process.exit(fail ? 1 : 0);

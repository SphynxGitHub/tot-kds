// @ts-nocheck  (Deno / Supabase Edge Function)
import pg from 'npm:pg@8';
import { verifySignature, squareRequest } from '../_shared/square.mjs';
import { saveSquareOrder } from '../_shared/saveOrder.mjs';

const pool = new pg.Pool({ connectionString: Deno.env.get('SUPABASE_DB_URL'), max: 2 });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  const rawBody = await req.text();
  const ok = verifySignature({
    rawBody,
    signature: req.headers.get('x-square-hmacsha256-signature'),
    signatureKey: Deno.env.get('SQUARE_WEBHOOK_SIGNATURE_KEY'),
    notificationUrl: Deno.env.get('SQUARE_WEBHOOK_URL'),
  });
  if (!ok) return new Response(null, { status: 401 });

  const evt = JSON.parse(rawBody);
  const ins = await pool.query(
    `insert into webhook_events (provider, event_id, event_type, payload) values ('square',$1,$2,$3)
     on conflict (provider, event_id) do nothing returning id`, [evt.event_id, evt.type, evt]);
  if (!ins.rowCount) return Response.json({ duplicate: true });

  try {
    const obj = evt.data?.object || {};
    const orderId = obj.order_updated?.order_id || obj.order_created?.order_id || obj.payment?.order_id;
    if (orderId) {
      const { order } = await squareRequest('GET', '/v2/orders/' + orderId, null, Deno.env.get('SQUARE_ACCESS_TOKEN'));
      // Fees are zero until settlement; later payment.updated events re-save the order with the real fee.
      if (order?.line_items) await saveSquareOrder(pool, order);
    }
    await pool.query(`update webhook_events set processed_at = now() where id = $1`, [ins.rows[0].id]);
  } catch (e) {
    await pool.query(`update webhook_events set error = $2 where id = $1`, [ins.rows[0].id, String(e.message).slice(0, 500)]);
    return new Response(null, { status: 500 }); // Square retries
  }
  return Response.json({ ok: true });
});

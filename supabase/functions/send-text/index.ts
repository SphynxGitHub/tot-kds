// @ts-nocheck  (Deno / Supabase Edge Function) Sends an SMS through Quo (OpenPhone) for a signed-in staff user.
import pg from 'npm:pg@8';
import { createClient } from 'npm:@supabase/supabase-js@2';

const pool = new pg.Pool({ connectionString: Deno.env.get('SUPABASE_DB_URL'), max: 2 });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
const json = (b, status = 200) => Response.json(b, { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'));
  const { data } = await sb.auth.getUser(jwt);
  if (!data?.user) return json({ error: 'unauthorized' }, 401);
  const role = (await pool.query(`select role from app_users where id = $1 and active`, [data.user.id])).rows[0]?.role;
  if (!role) return json({ error: 'forbidden' }, 403);

  const { orderId, message } = await req.json();
  const o = (await pool.query(`select id, phone from orders where id = $1`, [orderId])).rows[0];
  if (!o?.phone || !message?.trim()) return json({ error: 'order has no phone number or message is empty' }, 400);

  const r = await fetch('https://api.openphone.com/v1/messages', {
    method: 'POST',
    headers: { Authorization: Deno.env.get('QUO_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message, from: Deno.env.get('QUO_PHONE_NUMBER_ID'), to: [o.phone] }),
  });
  const body = await r.json().catch(() => ({}));
  await pool.query(
    `insert into messages (channel, direction, to_address, body, order_id, provider, provider_message_id, status, error)
     values ('sms','outbound',$1,$2,$3,'quo',$4,$5,$6)`,
    [o.phone, message, o.id, body?.data?.id ?? null, r.ok ? 'sent' : 'failed', r.ok ? null : JSON.stringify(body).slice(0, 400)]);
  return r.ok ? json({ ok: true }) : json({ error: 'Text failed' }, 502);
});

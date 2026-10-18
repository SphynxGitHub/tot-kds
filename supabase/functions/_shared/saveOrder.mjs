import { mapSquareOrder } from './squareOrder.mjs';

// Upserts an order (and its lines) from a Square Order object. Safe to call repeatedly: Square sends several
// updates per order, and processing fees only appear after settlement. Kitchen progress is never overwritten.
export async function saveSquareOrder(db, squareOrder) {
  const { order, items } = mapSquareOrder(squareOrder);
  const loc = (await db.query(
    `select id from locations where square_location_id = $1 limit 1`, [order.square_location_id])).rows[0];
  const local = order.received_at ? new Date(order.received_at) : new Date();
  const ev = loc && (await db.query(
    `select id from events where location_id = $1 and event_date = ($2::timestamptz at time zone 'America/New_York')::date
     order by start_time nulls last limit 1`, [loc.id, local.toISOString()])).rows[0];

  const cancelled = ['CANCELED'].includes(order.square_state);
  const o = (await db.query(
    `insert into orders (square_order_id, source, location_id, event_id, first_name, last_name, phone, notes, received_at,
        scheduled_pickup_at, subtotal_cents, discount_cents, tax_cents, tip_cents, fee_cents, total_cents, status)
     values ($1,'square_webhook',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     on conflict (square_order_id) do update set
        subtotal_cents = excluded.subtotal_cents, discount_cents = excluded.discount_cents, tax_cents = excluded.tax_cents,
        tip_cents = excluded.tip_cents, fee_cents = excluded.fee_cents, total_cents = excluded.total_cents,
        first_name = coalesce(nullif(orders.first_name,''), excluded.first_name),
        last_name  = coalesce(nullif(orders.last_name,''),  excluded.last_name),
        phone = coalesce(orders.phone, excluded.phone),
        status = case when excluded.status = 'cancelled' then 'cancelled' else orders.status end
     returning id, (xmax = 0) as created`,
    [order.square_order_id, loc?.id ?? null, ev?.id ?? null, order.first_name, order.last_name, order.phone, order.note,
     order.received_at, order.scheduled_pickup_at, order.subtotal_cents, order.discount_cents, order.tax_cents,
     order.tip_cents, order.fee_cents, order.total_cents, cancelled ? 'cancelled' : 'new'])).rows[0];

  for (const it of items) {
    await db.query(
      `insert into order_items (order_id, line_no, item_name, variation_name, modifiers, quantity, price_cents,
          discount_cents, tax_cents, tip_cents, fee_cents, square_line_uid, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (order_id, line_no) do update set item_name = excluded.item_name, variation_name = excluded.variation_name,
          modifiers = excluded.modifiers, quantity = excluded.quantity, price_cents = excluded.price_cents,
          discount_cents = excluded.discount_cents, tax_cents = excluded.tax_cents, tip_cents = excluded.tip_cents,
          fee_cents = excluded.fee_cents`,
      [o.id, it.line_no, it.item_name, it.variation_name, it.modifiers, it.quantity, it.price_cents, it.discount_cents,
       it.tax_cents, it.tip_cents, it.fee_cents, it.square_line_uid, it.note]);
  }
  if (o.created) await db.query(`insert into order_status_log (order_id, kind) values ($1, 'new')`, [o.id]);
  return o;
}

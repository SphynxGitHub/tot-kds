// Pure mapping from a Square Order object to our orders/order_items rows.
// Mirrors the old Zapier code (ticket-name fallbacks, "regular" variation hidden, leading "*" stripped,
// tip/tax/discount/fee spread across lines by gross share) but works in exact integer cents.

// Split `total` cents across weights so the parts always add up to `total` (largest remainder).
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length) return [];
  if (!sum) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length][1]]++;
  return out;
}

export function ticketName(order) {
  if (order.ticket_name) return order.ticket_name;
  const n = order.fulfillments?.[0]?.pickup_details?.recipient?.display_name;
  if (n) return n;
  if (order.metadata?.name) return order.metadata.name;
  return '';
}

export function splitName(full) {
  const s = (full || '').trim().replace(/\s+/g, ' ');
  if (!s) return { first: '', last: '' };
  const i = s.indexOf(' ');
  return i < 0 ? { first: s, last: '' } : { first: s.slice(0, i), last: s.slice(i + 1) };
}

export function mapSquareOrder(order) {
  const amt = (m) => m?.amount || 0;
  const tip = amt(order.total_tip_money);
  const tax = amt(order.total_tax_money);
  const discount = (order.discounts || []).reduce((s, d) => s + amt(d.applied_money), 0);
  const fee = (order.tenders || []).reduce((s, t) => s + amt(t.processing_fee_money), 0);
  const lines = order.line_items || [];
  const gross = lines.map((l) => amt(l.gross_sales_money));
  const subtotal = gross.reduce((a, b) => a + b, 0);

  const tipA = allocate(tip, gross), taxA = allocate(tax, gross), discA = allocate(discount, gross), feeA = allocate(fee, gross);
  const name = ticketName(order);
  const { first, last } = splitName(name);
  const pickup = order.fulfillments?.[0]?.pickup_details;

  return {
    order: {
      square_order_id: order.id,
      square_location_id: order.location_id,
      first_name: first,
      last_name: last,
      phone: pickup?.recipient?.phone_number || null,
      note: pickup?.note || null,
      scheduled_pickup_at: pickup?.pickup_at || null,
      received_at: order.created_at,
      subtotal_cents: subtotal,
      discount_cents: discount,
      tax_cents: tax,
      tip_cents: tip,
      fee_cents: fee,
      total_cents: subtotal - discount + tax + tip,
      square_total_cents: amt(order.total_money),
      square_state: order.state,
    },
    items: lines.map((l, i) => {
      const variation = (l.variation_name || '').toLowerCase() === 'regular' ? '' : (l.variation_name || '');
      return {
        line_no: i + 1,
        item_name: (l.name || '').replace(/^\*+\s*/, ''),
        variation_name: variation || null,
        modifiers: (l.modifiers || []).map((m) => m.name || '').filter(Boolean).join(', ') || null,
        quantity: parseInt(l.quantity || '1', 10) || 1,
        price_cents: gross[i],
        discount_cents: discA[i], tax_cents: taxA[i], tip_cents: tipA[i], fee_cents: feeA[i],
        square_line_uid: l.uid || null,
        note: l.note || null,
      };
    }),
  };
}

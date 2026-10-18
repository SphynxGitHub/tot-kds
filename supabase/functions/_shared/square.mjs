import { createHmac, timingSafeEqual } from 'node:crypto';

export const SQUARE_VERSION = '2025-03-19';

// Square signs: base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody))
export function verifySignature({ rawBody, signature, signatureKey, notificationUrl }) {
  if (!signature || !signatureKey) return false;
  const expected = createHmac('sha256', signatureKey).update(notificationUrl + rawBody).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function squareRequest(method, path, body, token) {
  const r = await fetch('https://connect.squareup.com' + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Square-Version': SQUARE_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  if (!r.ok || json.errors) throw new Error(`Square ${method} ${path}: ${JSON.stringify(json.errors || r.status)}`);
  return json;
}

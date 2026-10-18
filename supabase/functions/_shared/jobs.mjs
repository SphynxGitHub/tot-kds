// Background job runner: opens/closes Square ordering and sends organizer calendar invites and reminders.
// Square preorders work off a location's business hours, so "open" sets hours for the event's weekday and
// "close" clears them.
import { randomUUID } from 'node:crypto';
import { buildIcs, render } from './ics.mjs';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export async function runDueJobs(db, square, { limit = 20, mailer = null, fromEmail = null } = {}) {
  const kinds = ['open_ordering', 'close_ordering', ...(mailer ? ['organizer_invite', 'organizer_update', 'organizer_cancel', 'organizer_reminder'] : [])];
  const claimed = (await db.query(
    `update scheduled_jobs set status = 'running', attempts = attempts + 1, updated_at = now()
      where id in (select id from scheduled_jobs
                    where status = 'pending' and run_at <= now() and kind = any($2::text[])
                    order by run_at limit $1 for update skip locked)
      returning id, kind, event_id, payload`, [limit, kinds])).rows;
  const results = [];
  for (const j of claimed) {
    try {
      if (j.kind.startsWith('organizer_')) { await sendOrganizerEmail(db, mailer, fromEmail, j); await finish(db, j.id, 'done'); results.push({ id: j.id, kind: j.kind, ok: true }); continue; }
      const ev = (await db.query(
        `select e.id, e.event_date, e.start_time, e.end_time, e.status, e.ordering_closes_at, l.id lid, l.square_location_id,
                to_char(e.event_date, 'FMDay') dow
           from events e join locations l on l.id = e.location_id where e.id = $1`, [j.event_id])).rows[0];
      if (!ev) throw new Error('event no longer exists');
      if (!ev.square_location_id) throw new Error('location has no Square location ID');

      if (j.kind === 'open_ordering') {
        if (ev.status !== 'scheduled') { await finish(db, j.id, 'cancelled'); continue; }
        const day = DAYS[new Date(ev.event_date + 'T12:00:00Z').getUTCDay()];
        await square('PUT', `/v2/locations/${ev.square_location_id}`, { location: { business_hours: { periods: [{
          day_of_week: day, start_local_time: ev.start_time || '09:00:00', end_local_time: ev.end_time || '23:59:00' }] } } });
      } else {
        // Don't switch off a location that another event has already reopened.
        const other = (await db.query(
          `select 1 from events where location_id = $1 and id <> $2 and status = 'scheduled'
              and ordering_opens_at <= now() and ordering_closes_at > now()`, [ev.lid, ev.id])).rows.length;
        if (!other) await square('PUT', `/v2/locations/${ev.square_location_id}`, { location: { business_hours: null } });
      }
      await finish(db, j.id, 'done');
      results.push({ id: j.id, kind: j.kind, ok: true });
    } catch (e) {
      await db.query(`update scheduled_jobs set status = case when attempts >= 5 then 'failed' else 'pending' end,
                        run_at = now() + interval '5 minutes', last_error = $2, updated_at = now() where id = $1`,
                     [j.id, String(e.message).slice(0, 400)]);
      results.push({ id: j.id, kind: j.kind, ok: false, error: e.message });
    }
  }
  return results;
}

const finish = (db, id, status) =>
  db.query(`update scheduled_jobs set status = $2, done_at = now(), updated_at = now() where id = $1`, [id, status]);

const utc = (col) => `to_char(((${col})::timestamp at time zone 'America/New_York') at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"')`;

async function sendOrganizerEmail(db, mailer, fromEmail, j) {
  const ev = (await db.query(
    `select e.id, e.status, e.invite_uid, e.invite_sequence, e.event_date, e.start_time, e.end_time,
            l.name location, l.organizer_name, l.organizer_email, l.street, l.city,
            to_char(e.event_date, 'FMDay, FMMonth FMDD') date_text,
            to_char(coalesce(e.start_time, time '09:00'), 'FMHH12:MI AM') start_text,
            to_char(coalesce(e.end_time, time '13:00'), 'FMHH12:MI AM') end_text,
            ${utc("e.event_date + coalesce(e.start_time, time '09:00')")} start_utc,
            ${utc("e.event_date + coalesce(e.end_time, coalesce(e.start_time, time '09:00') + interval '4 hours')")} end_utc
       from events e join locations l on l.id = e.location_id where e.id = $1`, [j.event_id])).rows[0];
  if (!ev) throw new Error('event no longer exists');
  if (!ev.organizer_email) throw new Error('location has no organizer email');
  if (j.kind !== 'organizer_cancel' && ev.status !== 'scheduled') return;   // cancelled meanwhile

  const key = j.kind === 'organizer_reminder' ? 'organizer_reminder_' + j.payload.days_before : j.kind;
  const tpl = (await db.query(`select subject, body from message_templates where key = $1`, [key])).rows[0];
  if (!tpl) throw new Error('no message template ' + key);
  const vars = { date: ev.date_text, start: ev.start_text, end: ev.end_text, location: ev.location, organizer: ev.organizer_name || '' };
  const subject = render(tpl.subject, vars), text = render(tpl.body, vars);

  let ics = null, uid = ev.invite_uid, seq = ev.invite_sequence;
  if (j.kind !== 'organizer_reminder') {
    uid = uid || randomUUID() + '@tasteofturkiye';
    if (j.kind !== 'organizer_invite') seq += 1;
    ics = { method: j.kind === 'organizer_cancel' ? 'CANCEL' : 'REQUEST',
      content: buildIcs({ uid, sequence: seq, method: j.kind === 'organizer_cancel' ? 'CANCEL' : 'REQUEST',
        startUtc: ev.start_utc, endUtc: ev.end_utc, summary: 'Taste of Turkiye food truck at ' + ev.location,
        location: [ev.location, ev.street, ev.city].filter(Boolean).join(', '), description: text,
        organizerEmail: fromEmail, attendeeEmail: ev.organizer_email }) };
  }
  const info = await mailer.send({ to: ev.organizer_email, subject, text, ics });
  await db.query(`update events set invite_uid = $2, invite_sequence = $3, organizer_notified_at = now() where id = $1`, [ev.id, uid, seq]);
  await db.query(
    `insert into messages (channel, direction, to_address, from_address, subject, body, event_id, provider, provider_message_id, status)
     values ('email','outbound',$1,$2,$3,$4,$5,'gmail',$6,'sent')`,
    [ev.organizer_email, fromEmail, subject, text, ev.id, info?.messageId ?? null]);
}

// @ts-nocheck  (Deno / Supabase Edge Function) Called every minute by the database scheduler (see supabase/setup/cron.sql).
import pg from 'npm:pg@8';
import nodemailer from 'npm:nodemailer@6.9.16';
import { squareRequest } from '../_shared/square.mjs';
import { runDueJobs } from '../_shared/jobs.mjs';

const pool = new pg.Pool({ connectionString: Deno.env.get('SUPABASE_DB_URL'), max: 2 });

Deno.serve(async (req) => {
  if (req.headers.get('authorization') !== 'Bearer ' + Deno.env.get('CRON_SECRET')) return new Response(null, { status: 401 });
  const token = Deno.env.get('SQUARE_ACCESS_TOKEN');
  const user = Deno.env.get('GMAIL_USER'), from = Deno.env.get('GMAIL_FROM') || user, pass = Deno.env.get('GMAIL_APP_PASSWORD');
  const transport = user && pass ? nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } }) : null;
  const mailer = transport && {
    send: ({ to, subject, text, ics }) => transport.sendMail({
      from: `Taste of Türkiye <${from}>`, to, subject, text,
      ...(ics ? { icalEvent: { method: ics.method, content: ics.content } } : {}) }),
  };
  const results = await runDueJobs(pool, (m, p, b) => squareRequest(m, p, b, token), { mailer, fromEmail: from });
  return Response.json({ ran: results.length, results });
});

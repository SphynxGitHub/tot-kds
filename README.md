# Taste of Türkiye – business system

Hosted on GitHub (Pages) + Supabase only.

- `supabase/migrations/` – database, run in order in the SQL editor (0001–0010).
- `supabase/functions/` – Edge Functions: `square-webhook`, `send-text`, `run-jobs` (+ `_shared` code).
- `supabase/setup/cron.sql` – one-time scheduler setup (every minute runs `run-jobs`).
- `public/` – static site deployed by GitHub Pages (`public/kds/` is the kitchen display).
- `import/` – one-time spreadsheet importer. `test/` – local tests (`node test/<name>.test.mjs`).

## Setup
1. Supabase: create project, run migrations, create your user and a kitchen user, then
   `insert into app_users(id,email,role) select id,email,'owner' from auth.users where email='you@example.com';`
2. Functions secrets (Dashboard > Edge Functions > Secrets, or `supabase secrets set`):
   SQUARE_ACCESS_TOKEN, SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL, QUO_API_KEY, QUO_PHONE_NUMBER_ID, CRON_SECRET.
   (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_DB_URL are provided automatically.)
3. Deploy: `supabase functions deploy square-webhook send-text run-jobs`
4. Run `supabase/setup/cron.sql` (fill in the placeholders; enable pg_cron and pg_net first).
5. Square webhook URL: `https://<ref>.supabase.co/functions/v1/square-webhook` (events: order.created, order.updated, payment.updated).
6. Edit `public/kds/config.js` (URL + anon key), push to `main`; enable Pages (Settings > Pages > Source: GitHub Actions).
7. Import: `DATABASE_URL=... node import/cli.mjs --sales ... --hospitality ... --schedule ... --dry-run`, then without `--dry-run`.

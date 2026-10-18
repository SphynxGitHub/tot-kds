-- Run once in the Supabase SQL editor AFTER deploying the run-jobs function.
-- 1) Enable Database > Extensions: pg_cron and pg_net.
-- 2) Replace the two placeholders below. CRON_SECRET must match the secret set on the functions.
select vault.create_secret('REPLACE_WITH_CRON_SECRET', 'cron_secret');

select cron.schedule('run-jobs', '* * * * *', $$
  select net.http_post(
    url     := 'https://REPLACE_PROJECT_REF.supabase.co/functions/v1/run-jobs',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body    := '{}'::jsonb
  );
$$);

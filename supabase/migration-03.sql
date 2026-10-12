-- LAST SIGNAL — Erweiterung 03: Akkustand und Funkstille-Alarm.
-- Einmal im Supabase SQL Editor ausfuehren. Vorher unten <DEIN-PROJEKT> durch die
-- Vercel-Adresse ersetzen (z.B. last-signal.vercel.app).

alter table public.locations add column if not exists battery smallint;
alter table public.locations add column if not exists charging boolean;

-- Funkstille-Pruefung alle 5 Minuten (Supabase: Database -> Extensions -> pg_cron und pg_net)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('ls-silence') where exists (select 1 from cron.job where jobname = 'ls-silence');
select cron.schedule('ls-silence', '*/5 * * * *', $$
  select net.http_get(url := 'https://<DEIN-PROJEKT>/api/silence');
$$);

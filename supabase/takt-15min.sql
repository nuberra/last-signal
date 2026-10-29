-- LAST SIGNAL: Freigabe der Positionen alle 15 Minuten (:00, :15, :30, :45).
-- Ersetzt den 20-Minuten-Takt. Im Supabase SQL Editor einmal ausfuehren.
select cron.unschedule('ls-reveal') where exists (select 1 from cron.job where jobname = 'ls-reveal');
select cron.schedule('ls-reveal', '0,15,30,45 * * * *', $$
  select net.http_get(url := 'https://last-signal-delta.vercel.app/api/reveal');
$$);

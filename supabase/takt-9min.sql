-- LAST SIGNAL: Freigabe der Positionen alle 9 Minuten ab 09:00 (09:00, 09:09 ... 21:54).
-- Supabase ruft /api/reveal jede Minute auf; die Funktion arbeitet nur an Taktpunkten.
-- Ersetzt den 15-Minuten-Takt. Im Supabase SQL Editor einmal ausfuehren.
select cron.unschedule('ls-reveal') where exists (select 1 from cron.job where jobname = 'ls-reveal');
select cron.schedule('ls-reveal', '* * * * *', $$
  select net.http_get(url := 'https://last-signal-delta.vercel.app/api/reveal');
$$);

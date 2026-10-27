-- LAST SIGNAL — Freigabe im 20-Minuten-Takt: Push "Neues Signal" / "Alarm" um :00, :20, :40.
select cron.unschedule('ls-reveal') where exists (select 1 from cron.job where jobname = 'ls-reveal');
select cron.schedule('ls-reveal', '0,20,40 * * * *', $$
  select net.http_get(url := 'https://last-signal-delta.vercel.app/api/reveal');
$$);

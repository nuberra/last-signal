-- LAST SIGNAL — alles Ausstehende in einem Schritt (Erweiterung 02 + 03).
-- Kann gefahrlos mehrfach ausgefuehrt werden. Vercel-Adresse ist eingetragen.


create table if not exists public.hunter_items (
  id bigint generated always as identity primary key,
  kind text not null,                 -- 'note' | 'drawing'
  data jsonb not null default '{}'::jsonb,
  lat double precision,
  lng double precision,
  author text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hunter_items enable row level security;
drop policy if exists "anon all" on public.hunter_items;
create policy "anon all" on public.hunter_items for all to anon using (true) with check (true);

alter table public.proofs add column if not exists lat double precision;
alter table public.proofs add column if not exists lng double precision;
alter table public.proofs add column if not exists geo_source text;   -- 'exif' | 'device'

do $$
begin
  begin alter publication supabase_realtime add table public.hunter_items; exception when duplicate_object then null; end;
end $$;


alter table public.locations add column if not exists battery smallint;
alter table public.locations add column if not exists charging boolean;

-- Funkstille-Pruefung alle 5 Minuten (Supabase: Database -> Extensions -> pg_cron und pg_net)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('ls-silence') where exists (select 1 from cron.job where jobname = 'ls-silence');
select cron.schedule('ls-silence', '*/5 * * * *', $$
  select net.http_get(url := 'https://last-signal-delta.vercel.app/api/silence');
$$);

-- LAST SIGNAL — Datenbank. Einmal komplett im Supabase SQL Editor ausfuehren.

create table if not exists public.players (
  id text primary key,
  name text not null,
  role text not null default 'bandit',
  updated_at timestamptz not null default now()
);

create table if not exists public.locations (
  id bigint generated always as identity primary key,
  player_id text not null,
  lat double precision not null,
  lng double precision not null,
  accuracy integer,
  source text,
  created_at timestamptz not null default now()
);
create index if not exists locations_created_at_idx on public.locations (created_at);
create index if not exists locations_player_idx on public.locations (player_id, created_at);

create table if not exists public.completions (
  task_id text primary key,
  done boolean not null default false,
  done_by text,
  done_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.proofs (
  id bigint generated always as identity primary key,
  task_id text not null,
  url text not null,
  path text,
  kind text,
  uploaded_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  subscription jsonb not null,
  role text not null default 'detective',
  created_at timestamptz not null default now()
);

-- Kein Login: der anon-Schluessel darf lesen und schreiben. Push-Abos sind nur
-- schreibbar, gelesen werden sie ausschliesslich von der Server-Funktion.
alter table public.players enable row level security;
alter table public.locations enable row level security;
alter table public.completions enable row level security;
alter table public.proofs enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "anon all" on public.players;
create policy "anon all" on public.players for all to anon using (true) with check (true);
drop policy if exists "anon all" on public.locations;
create policy "anon all" on public.locations for all to anon using (true) with check (true);
drop policy if exists "anon all" on public.completions;
create policy "anon all" on public.completions for all to anon using (true) with check (true);
drop policy if exists "anon all" on public.proofs;
create policy "anon all" on public.proofs for all to anon using (true) with check (true);
drop policy if exists "anon insert" on public.push_subscriptions;
create policy "anon insert" on public.push_subscriptions for insert to anon with check (true);
drop policy if exists "anon update" on public.push_subscriptions;
create policy "anon update" on public.push_subscriptions for update to anon using (true) with check (true);
-- upsert braucht select auf die eigene Zeile; die Abos enthalten nur Browser-Endpunkte.
drop policy if exists "anon select" on public.push_subscriptions;
create policy "anon select" on public.push_subscriptions for select to anon using (true);

-- Echtzeit
do $$
begin
  begin alter publication supabase_realtime add table public.players; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.locations; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.completions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.proofs; exception when duplicate_object then null; end;
end $$;

-- Speicher fuer Foto- und Videobeweise, oeffentlich lesbar, 50 MB pro Datei
insert into storage.buckets (id, name, public, file_size_limit)
values ('proofs', 'proofs', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

drop policy if exists "proofs read" on storage.objects;
create policy "proofs read" on storage.objects for select to anon using (bucket_id = 'proofs');
drop policy if exists "proofs upload" on storage.objects;
create policy "proofs upload" on storage.objects for insert to anon with check (bucket_id = 'proofs');
drop policy if exists "proofs delete" on storage.objects;
create policy "proofs delete" on storage.objects for delete to anon using (bucket_id = 'proofs');

-- Erweiterung 02 (identisch mit migration-02.sql)

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

-- Nach dem Spiel alles zuruecksetzen (nur bei Bedarf einzeln ausfuehren):
-- truncate public.locations, public.completions, public.proofs, public.players, public.hunter_items restart identity;

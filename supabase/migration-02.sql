-- LAST SIGNAL — Erweiterung 02: Notizen, Zeichnungen und Jaeger-Positionen,
-- Foto-Standorte bei den Beweisen. Einmal im Supabase SQL Editor ausfuehren.

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

-- Дороги: адрес партнёра и кэш координат (чтобы не тратить лимит TomTom на повторный поиск)
alter table public.partners add column if not exists address text;

create table public.geo_cache (
  query       text primary key,
  lat         double precision,
  lon         double precision,
  label       text,
  updated_at  timestamptz not null default now()
);
alter table public.geo_cache enable row level security; -- доступ только у серверной функции
revoke all on public.geo_cache from anon, authenticated;

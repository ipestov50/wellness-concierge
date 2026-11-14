-- Откуда и куда едет гость по запросу (если указано — важнее отеля из поездки и адреса партнёра)
alter table public.requests add column if not exists road_from text;
alter table public.requests add column if not exists road_to text;

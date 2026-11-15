-- Какая задержка уже учтена (события сдвинуты или консьерж решил не сдвигать) — чтобы предупреждение не висело повторно.
alter table public.trips add column if not exists flight_in_delay_done integer;
alter table public.trips add column if not exists flight_out_delay_done integer;

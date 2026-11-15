-- Путеводитель для гостя: черновик Jarvis + правки консьержа, хранится с поездкой.
alter table public.trips add column if not exists guide jsonb;

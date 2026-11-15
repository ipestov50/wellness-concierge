-- Задержка рейса (минуты): консьерж отмечает её одним касанием; детектор конфликтов сдвигает зависимые события.
alter table public.trips add column if not exists flight_in_delay integer;
alter table public.trips add column if not exists flight_out_delay integer;

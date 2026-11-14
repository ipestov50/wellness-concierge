-- Часовые пояса и «Перед вылетом»
alter table public.clients add column if not exists home_tz text;       -- например, Europe/Moscow
alter table public.clients add column if not exists citizenship text;   -- RU, KZ, UZ, AZ, AM, GE, BY, KG, TJ, TM, MD, UA…
alter table public.trips add column if not exists tz text;              -- часовой пояс места поездки
alter table public.trips add column if not exists country_code text;    -- FR, AE, IT…
alter table public.trips add column if not exists lat double precision;
alter table public.trips add column if not exists lon double precision;
alter table public.trips add column if not exists brief jsonb;          -- брифинг Jarvis (въезд, платежи, советы) с источниками

-- День рождения гостя. Если год неизвестен, хранится 1900 год.
alter table public.clients add column if not exists birthday date;

-- Контакты гостя: телефон и почта
alter table public.clients add column if not exists phone text;
alter table public.clients add column if not exists email text;

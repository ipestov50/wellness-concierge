-- Права для залогиненного пользователя. Какие строки видны, решают правила RLS (только свои).
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.clients, public.partners, public.requests to authenticated;

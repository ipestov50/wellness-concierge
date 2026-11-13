-- Чек-лист запроса: { template, items: [{ id, t, hint, phase, done, src }] }
alter table public.requests add column if not exists checklist jsonb;

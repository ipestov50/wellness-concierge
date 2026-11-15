-- Место брони запроса: «наш партнёр» или «другое место» (гость нашёл сам / подобрал Jarvis).
alter table public.requests add column if not exists venue jsonb;

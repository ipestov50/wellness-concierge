-- Кэш поиска «Варианты для гостя»: тот же запрос для того же гостя в течение суток не тратит лимит Gemini.
create table if not exists public.search_cache (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid default auth.uid() references auth.users(id) on delete cascade,
  key         text not null,
  result      jsonb not null,
  created_at  timestamptz not null default now(),
  unique (owner_id, key)
);
alter table public.search_cache enable row level security;
create policy "owner_all" on public.search_cache for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.search_cache to authenticated;

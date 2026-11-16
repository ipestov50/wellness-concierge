-- «🚫 Не предлагать»: ваш чёрный список мест и сайтов для поиска и «Вариантов для гостя».
create table if not exists public.search_blocks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('domain','venue')),
  value       text not null,
  label       text,
  created_at  timestamptz not null default now(),
  unique (owner_id, kind, value)
);
alter table public.search_blocks enable row level security;
create policy "owner_all" on public.search_blocks for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.search_blocks from anon;
grant select, insert, update, delete on public.search_blocks to authenticated;

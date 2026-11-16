-- Дневник смены: итоги смены, чему научился, что улучшить, текст передачи дел коллеге.
create table public.shift_logs (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid default auth.uid() references auth.users(id) on delete cascade,
  day         date not null,
  shift       text not null default 'day' check (shift in ('am', 'pm', 'day')),
  learned     text,
  improve     text,
  handover    text,
  stats       jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner_id, day, shift)
);
create trigger shift_logs_updated_at before update on public.shift_logs for each row execute function public.set_updated_at();
alter table public.shift_logs enable row level security;
create policy "owner_all" on public.shift_logs for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.shift_logs from anon;
grant select, insert, update, delete on public.shift_logs to authenticated;
alter publication supabase_realtime add table public.shift_logs;

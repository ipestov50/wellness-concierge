-- «Jarvis предлагает»: поводы, которые Jarvis заметил сам, и черновики планов
create table public.suggestions (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid default auth.uid() references auth.users(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete cascade,
  trip_id       uuid references public.trips(id) on delete cascade,
  kind          text not null check (kind in ('pre_arrival','transfer','close_date','reconnect')),
  key           text not null,
  title         text not null,
  reason        text,
  due_at        timestamptz,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'new' check (status in ('new','accepted','dismissed','snoozed')),
  snooze_until  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (owner_id, key)
);
create index suggestions_owner_status_idx on public.suggestions(owner_id, status);
create trigger suggestions_updated_at before update on public.suggestions for each row execute function public.set_updated_at();
alter table public.suggestions enable row level security;
create policy "owner_all" on public.suggestions for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.suggestions from anon;
grant select, insert, update, delete on public.suggestions to authenticated;
alter publication supabase_realtime add table public.suggestions;

-- Уведомления Jarvis в Telegram

-- настройки владельца (одна строка на владельца)
create table public.app_settings (
  owner_id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  notify_on        boolean not null default true,
  brief_hour       smallint not null default 8 check (brief_hour between 5 and 12),
  quiet_from       smallint not null default 23,
  quiet_to         smallint not null default 7,
  tg_chat_id       bigint,
  tg_link_code     text,
  tg_link_expires  timestamptz,
  updated_at       timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create policy "owner_all" on public.app_settings
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.app_settings from anon;
grant select, insert, update on public.app_settings to authenticated;
create trigger app_settings_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

-- журнал отправленного: каждое напоминание уходит ровно один раз
create table public.notifications_log (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  key         text not null,
  request_id  uuid references public.requests(id) on delete cascade,
  sent_at     timestamptz not null default now(),
  unique (owner_id, key)
);
alter table public.notifications_log enable row level security;
create policy "owner_read" on public.notifications_log for select to authenticated using (owner_id = auth.uid());
revoke all on public.notifications_log from anon;
grant select on public.notifications_log to authenticated;

-- расписание и HTTP-вызовы из базы
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- «Мой день»: рабочие часы владельца и отметки блоков плана
alter table public.app_settings add column if not exists work_from smallint not null default 8;
alter table public.app_settings add column if not exists work_to smallint not null default 20;
alter table public.app_settings add column if not exists lunch_from smallint not null default 13;
alter table public.app_settings add column if not exists lunch_to smallint not null default 14;
alter table public.app_settings add column if not exists guest_from smallint not null default 10;
alter table public.app_settings add column if not exists guest_to smallint not null default 21;
alter table public.app_settings add column if not exists day_remind boolean not null default true;

create table public.day_items (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid default auth.uid() references auth.users(id) on delete cascade,
  day         date not null,
  key         text not null,
  status      text not null check (status in ('done','snoozed','pinned','tomorrow')),
  at          timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner_id, day, key)
);
create trigger day_items_updated_at before update on public.day_items for each row execute function public.set_updated_at();
alter table public.day_items enable row level security;
create policy "owner_all" on public.day_items for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.day_items from anon;
grant select, insert, update, delete on public.day_items to authenticated;
alter publication supabase_realtime add table public.day_items;

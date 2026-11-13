-- Колонки доски теперь настраиваются владельцем
create table public.statuses (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid default auth.uid() references auth.users(id) on delete cascade,
  key         text not null,
  label       text not null,
  kind        text not null default 'active' check (kind in ('active','done','archive')),
  position    double precision not null default extract(epoch from now()),
  created_at  timestamptz not null default now(),
  unique (owner_id, key)
);
alter table public.statuses enable row level security;
create policy "owner_all" on public.statuses
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.statuses from anon;
grant select, insert, update, delete on public.statuses to authenticated;
alter publication supabase_realtime add table public.statuses;

-- статус запроса больше не ограничен фиксированным списком
alter table public.requests drop constraint if exists requests_status_check;

-- стандартные колонки для уже существующих пользователей
insert into public.statuses (owner_id, key, label, kind, position)
select u.id, s.key, s.label, s.kind, s.pos
from auth.users u
cross join (values
  ('new','Новый','active',1), ('clarifying','Уточняем','active',2), ('sourcing','Подбор вариантов','active',3),
  ('awaiting_approval','Ждёт одобрения гостя','active',4), ('booking','Бронируем','active',5),
  ('confirmed','Подтверждено','active',6), ('done','Выполнено','done',7),
  ('postponed','Отложен','archive',8), ('cancelled','Отменён','archive',9)
) as s(key, label, kind, pos)
on conflict (owner_id, key) do nothing;

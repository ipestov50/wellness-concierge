-- Wellness Concierge: схема базы
-- Три таблицы: clients, partners, requests. Доступ только владельцу (RLS).

create extension if not exists pg_trgm;

-- Общая функция: обновлять updated_at при каждом изменении
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- Клиенты ----------
create table public.clients (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid default auth.uid() references auth.users(id) on delete cascade,
  name             text not null,
  language         text not null default 'RU' check (language in ('RU','EN','FR')),
  telegram         text,
  city             text,
  vip              boolean not null default false,
  -- предпочтения
  pref_food        text,
  pref_spa         text,
  pref_transport   text,
  pref_hotels      text,
  -- ограничения (списки, без дублей)
  allergies        text[] not null default '{}',
  diet             text[] not null default '{}',
  health           text[] not null default '{}',
  -- истории путешествий: строки «место | когда | заметка»
  travel_history   text[] not null default '{}',
  concierge_notes  text,
  last_contact     date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index clients_owner_idx on public.clients(owner_id);
create index clients_name_trgm_idx on public.clients using gin (lower(name) gin_trgm_ops);
create trigger clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

-- ---------- Партнёры ----------
create table public.partners (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  type        text not null default 'other'
              check (type in ('spa','restaurant','transfer','hotel','activities','clinic','gifts','other')),
  contact     text,
  city        text,
  terms       text,
  commission  text,
  rating      smallint check (rating between 1 and 5),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index partners_owner_idx on public.partners(owner_id);
create trigger partners_updated_at before update on public.partners
  for each row execute function public.set_updated_at();

-- ---------- Запросы ----------
create table public.requests (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid default auth.uid() references auth.users(id) on delete cascade,
  client_id             uuid references public.clients(id) on delete set null,
  summary               text not null,
  original_message      text,
  category              text not null default 'Other'
                        check (category in ('Spa & Wellness','Dining','Transport','Accommodation',
                                            'Activities','Health & Fitness','Gifts & Events','Other')),
  urgency               text not null default 'normal'
                        check (urgency in ('critical','high','normal','low')),
  status                text not null default 'new'
                        check (status in ('new','clarifying','sourcing','awaiting_approval','booking',
                                          'confirmed','done','postponed','cancelled')),
  deadline              timestamptz,
  budget_amount         numeric(12,2),
  currency              text check (currency in ('EUR','USD','GBP','RUB','AED')),
  partner_id            uuid references public.partners(id) on delete set null,
  clarifying_questions  text,
  needs_approval        boolean not null default false,
  needs_review          boolean not null default false,
  position              double precision not null default extract(epoch from now()),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index requests_owner_idx  on public.requests(owner_id);
create index requests_client_idx on public.requests(client_id);
create index requests_status_idx on public.requests(status);
create trigger requests_updated_at before update on public.requests
  for each row execute function public.set_updated_at();

-- «Нужна проверка» ставится автоматически, если бюджет больше 500
create or replace function public.requests_auto_review()
returns trigger language plpgsql as $$
begin
  if new.budget_amount is not null and new.budget_amount > 500 then
    new.needs_review = true;
  end if;
  return new;
end $$;
create trigger requests_auto_review before insert or update on public.requests
  for each row execute function public.requests_auto_review();

-- ---------- Доступ: только владелец ----------
alter table public.clients  enable row level security;
alter table public.partners enable row level security;
alter table public.requests enable row level security;

create policy "owner_all" on public.clients
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner_all" on public.partners
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner_all" on public.requests
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Анонимным посетителям — ничего
revoke all on public.clients, public.partners, public.requests from anon;

-- ---------- Обновления в реальном времени ----------
alter publication supabase_realtime add table public.clients, public.partners, public.requests;

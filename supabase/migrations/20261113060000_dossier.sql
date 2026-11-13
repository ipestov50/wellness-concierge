-- Досье гостя: поездки, окружение, важные даты, «любит / избегает», привычки в пути

alter table public.clients add column if not exists likes text[] not null default '{}';
alter table public.clients add column if not exists dislikes text[] not null default '{}';
alter table public.clients add column if not exists travel_habits text;
alter table public.clients add column if not exists loyalty text[] not null default '{}';

create table public.trips (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid default auth.uid() references auth.users(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  city           text not null,
  country        text,
  hotel          text,
  start_date     date,
  end_date       date,
  flight_in      text,
  flight_in_at   timestamptz,
  flight_out     text,
  flight_out_at  timestamptz,
  companions     text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index trips_client_idx on public.trips(client_id);
create trigger trips_updated_at before update on public.trips for each row execute function public.set_updated_at();

create table public.people (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid default auth.uid() references auth.users(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  name        text not null,
  role        text,
  phone       text,
  birthday    date,
  allergies   text[] not null default '{}',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index people_client_idx on public.people(client_id);
create trigger people_updated_at before update on public.people for each row execute function public.set_updated_at();

create table public.client_dates (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid default auth.uid() references auth.users(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  title       text not null,
  date        date not null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index client_dates_client_idx on public.client_dates(client_id);
create trigger client_dates_updated_at before update on public.client_dates for each row execute function public.set_updated_at();

do $$ declare t text; begin
  foreach t in array array['trips','people','client_dates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "owner_all" on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end $$;

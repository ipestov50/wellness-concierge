-- Адрес отеля поездки и структурированные детали трансфера (для путеводителя гостя).
alter table public.trips add column if not exists hotel_address text;
alter table public.requests add column if not exists transfer jsonb;

create or replace function public.trip_portal(p_token text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  t public.trips%rowtype;
  z text;
  d0 timestamptz; d1 timestamptz;
  fname text; wa text; days jsonb; umax timestamptz;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{20,64}$' then return null; end if;
  select * into t from public.trips where share_token = p_token;
  if not found then
    select tr.* into t from public.trips tr join public.clients cl on cl.id = tr.client_id
     where cl.portal_token = p_token and cl.owner_id = tr.owner_id
     order by case when current_date between tr.start_date and coalesce(tr.end_date, tr.start_date) then 0
                   when tr.start_date >= current_date then 1 else 2 end,
              case when tr.start_date >= current_date then tr.start_date end asc nulls last,
              tr.start_date desc nulls last
     limit 1;
    if not found then return null; end if;
  end if;
  z := coalesce(t.tz, 'Europe/Paris');
  if t.start_date is not null then
    d0 := t.start_date::timestamp at time zone z;
    d1 := (coalesce(t.end_date, t.start_date) + 1)::timestamp at time zone z;
  end if;

  select nullif(split_part(btrim(regexp_replace(coalesce(c.name, ''), '[()]', '', 'g')), ' ', 1), '') into fname
    from public.clients c where c.id = t.client_id;
  select nullif(regexp_replace(coalesce(s.portal_whatsapp, ''), '\D', '', 'g'), '') into wa
    from public.app_settings s where s.owner_id = t.owner_id;

  with items as (
    -- запросы гостя, помеченные «показать»
    select (coalesce(r.deadline, r.updated_at) at time zone z)::date as d, to_char(r.deadline at time zone z, 'HH24:MI') as tm,
           r.summary as title, r.category, 'request'::text as kind,
           coalesce(nullif(r.venue->>'name', ''), p.name) as venue_name,
           case when nullif(r.venue->>'name', '') is not null then nullif(r.venue->>'address', '') else p.address end as address,
           r.booking_ref as booking_reference, r.dress_code, r.guest_note as guest_notes,
           r.updated_at as upd,
           case when jsonb_typeof(r.transfer) = 'object' and r.transfer <> '{}'::jsonb then jsonb_build_object(
             'pickup', nullif(left(btrim(coalesce(r.transfer->>'pickup', '')), 200), ''),
             'dropoff', nullif(left(btrim(coalesce(r.transfer->>'dropoff', '')), 200), ''),
             'passengers', case when btrim(coalesce(r.transfer->>'passengers', '')) ~ '^[0-9]{1,3}$' then btrim(r.transfer->>'passengers')::int end,
             'luggage', case when btrim(coalesce(r.transfer->>'luggage', '')) ~ '^[0-9]{1,3}$' then btrim(r.transfer->>'luggage')::int end,
             'driver', nullif(left(btrim(coalesce(r.transfer->>'driver', '')), 200), '')
           ) end as tr
      from public.requests r
      left join public.partners p on p.id = r.partner_id
      left join public.statuses st on st.owner_id = r.owner_id and st.key = r.status
     where r.client_id = t.client_id and r.owner_id = t.owner_id
       -- автоматически: выполненные и подтверждённые; guest_visible true/false переопределяет умолчание категории
       and (coalesce(st.kind, 'active') = 'done' or r.status = 'confirmed')
       and coalesce(r.guest_visible, r.category in ('Dining', 'Spa & Wellness', 'Transport', 'Accommodation', 'Activities', 'Health & Fitness'))
       and coalesce(st.kind, 'active') <> 'archive' and r.status <> 'cancelled'
       and d0 is not null and coalesce(r.deadline, r.updated_at) >= d0 and coalesce(r.deadline, r.updated_at) < d1
    union all
    select (t.flight_in_at at time zone z)::date, to_char(t.flight_in_at at time zone z, 'HH24:MI'),
           'Прилёт · ' || coalesce(nullif(btrim(t.flight_in), ''), 'рейс'), 'Flight', 'flight', null, null, nullif(btrim(t.flight_in), ''), null, null, t.updated_at, null::jsonb
     where t.flight_in_at is not null
    union all
    select (t.flight_out_at at time zone z)::date, to_char(t.flight_out_at at time zone z, 'HH24:MI'),
           'Вылет · ' || coalesce(nullif(btrim(t.flight_out), ''), 'рейс'), 'Flight', 'flight', null, null, nullif(btrim(t.flight_out), ''), null, null, t.updated_at, null::jsonb
     where t.flight_out_at is not null
    union all
    select t.start_date, null, 'Заселение · ' || btrim(t.hotel), 'Accommodation', 'hotel', btrim(t.hotel), nullif(btrim(t.hotel_address), ''), null, null, null, t.updated_at, null::jsonb
     where nullif(btrim(coalesce(t.hotel, '')), '') is not null and t.start_date is not null
    union all
    select coalesce(t.end_date, t.start_date), null, 'Выезд · ' || btrim(t.hotel), 'Accommodation', 'hotel', btrim(t.hotel), nullif(btrim(t.hotel_address), ''), null, null, null, t.updated_at, null::jsonb
     where nullif(btrim(coalesce(t.hotel, '')), '') is not null and coalesce(t.end_date, t.start_date) is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('date', to_char(g.d, 'YYYY-MM-DD'), 'items', g.arr) order by g.d), '[]'::jsonb), max(g.mx) into days, umax
    from (
      select i.d, jsonb_agg(jsonb_build_object(
               'time', i.tm, 'title', i.title, 'category', i.category, 'kind', i.kind,
               'venueName', i.venue_name, 'address', i.address, 'bookingReference', i.booking_reference,
               'dressCode', i.dress_code, 'guestNotes', i.guest_notes, 'transfer', i.tr,
               'updatedAt', to_char(i.upd at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
             ) order by i.tm nulls first, i.title) as arr, max(i.upd) as mx
        from items i where i.d is not null group by i.d
    ) g;

  return jsonb_build_object(
    'guest', jsonb_build_object('firstName', fname),
    'trip', jsonb_build_object('title', t.city, 'city', t.city, 'country', t.country,
             'start', t.start_date, 'end', t.end_date, 'tz', z, 'hotel', t.hotel, 'hotelAddress', nullif(btrim(t.hotel_address), ''), 'lat', t.lat, 'lon', t.lon),
    'days', days,
    'concierge', jsonb_build_object('whatsapp', wa),
    'updatedAt', to_char(greatest(t.updated_at, umax) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
end $$;
revoke all on function public.trip_portal(text) from public;
grant execute on function public.trip_portal(text) to anon, authenticated;

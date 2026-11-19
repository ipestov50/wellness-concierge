-- trip_portal: запрос без явной поездки (trip_id is null) относится только к ОДНОЙ поездке клиента —
-- той, чьи даты его накрывают (при пересечении побеждает начавшаяся позже). Раньше такой запрос
-- попадал в путеводитель каждой поездки с подходящим окном дат.
do $m$
declare d text;
begin
  select pg_get_functiondef('public.trip_portal(text)'::regprocedure) into d;
  if position('and (r.trip_id = t.id or r.trip_id is null)' in d) = 0 then
    raise exception 'trip_portal: ожидаемое условие не найдено';
  end if;
  d := replace(d, 'and (r.trip_id = t.id or r.trip_id is null)',
    'and (r.trip_id = t.id or (r.trip_id is null and t.id = (
            select t2.id from public.trips t2
             where t2.client_id = t.client_id and t2.owner_id = t.owner_id
               and (coalesce(r.deadline, r.updated_at) at time zone z)::date between t2.start_date and coalesce(t2.end_date, t2.start_date)
             order by t2.start_date desc, t2.id limit 1)))');
  execute d;
end
$m$;

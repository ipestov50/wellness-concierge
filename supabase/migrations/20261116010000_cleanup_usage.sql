-- Путеводитель PDF удалён из сервиса — поле больше не нужно (занимало 40% загружаемых данных).
alter table public.trips drop column if exists guide;

-- Счётчик обращений к Jarvis за день (строка usage|ДАТА в search_cache, видит только владелец).
create or replace function public.bump_usage(day text, field text) returns void
language sql security invoker set search_path = public as $$
  insert into public.search_cache (key, result) values ('usage|' || day, jsonb_build_object(field, 1))
  on conflict (owner_id, key) do update
    set result = jsonb_set(search_cache.result, array[field], to_jsonb(coalesce((search_cache.result ->> field)::int, 0) + 1)),
        created_at = now();
$$;
revoke all on function public.bump_usage(text, text) from public, anon;
grant execute on function public.bump_usage(text, text) to authenticated;

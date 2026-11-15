-- как у остальных таблиц: аноним не имеет доступа даже до проверки RLS
revoke all on public.search_cache from anon;

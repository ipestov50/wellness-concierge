-- «Варианты для гостя»: 3 проверенных места, что отправлено и что выбрал гость.
alter table public.requests add column if not exists options jsonb;

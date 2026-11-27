-- Гостевой портал /t/<token> целиком на английском: подписи перелётов в trip_portal ('Arrival · …', 'Departure · …').
-- Идемпотентно: берём действующее определение функции из базы (после 20261123 и 20261124) и подменяем только русские литералы.
do $$
declare
  def text;
begin
  select pg_get_functiondef('public.trip_portal(text)'::regprocedure) into def;
  if def like '%Прилёт · %' or def like '%Вылет · %' or def like '%''рейс''%' then
    def := replace(def, '''Прилёт · ''', '''Arrival · ''');
    def := replace(def, '''Вылет · ''', '''Departure · ''');
    def := replace(def, '''рейс''', '''Flight''');
    execute def;
  end if;
end $$;

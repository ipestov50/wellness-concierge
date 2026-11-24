-- «План Б» (запасной вариант) и тихое подтверждение партнёра за 24 ч / 3 ч до события.
-- Только для владельца (RLS таблицы requests); в публичный путеводитель /t/<token> эти поля не попадают:
-- функция trip_portal отдаёт гостю только явный белый список полей.
alter table public.requests
  add column if not exists backup_venue      text,
  add column if not exists backup_address    text,
  add column if not exists backup_contact    text,
  add column if not exists backup_notes      text,
  add column if not exists precheck24h_done  boolean not null default false,
  add column if not exists precheck3h_done   boolean not null default false,
  add column if not exists last_precheck_at  timestamptz;

-- Архив выполненных запросов: убираются с доски, но остаются историей гостя (брони, партнёры, предпочтения).
alter table public.requests add column if not exists archived_at timestamptz;
create index if not exists requests_archived_idx on public.requests (owner_id, archived_at);

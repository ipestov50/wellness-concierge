-- «Не то» в «Идеях для гостя»: Jarvis помнит отклонённые идеи по каждому гостю и не повторяет похожие
create table public.idea_feedback (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid default auth.uid() references auth.users(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  title       text not null,
  category    text,
  created_at  timestamptz not null default now()
);
create index idea_feedback_client_idx on public.idea_feedback(owner_id, client_id, created_at desc);
alter table public.idea_feedback enable row level security;
create policy "owner_all" on public.idea_feedback for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.idea_feedback from anon;
grant select, insert, update, delete on public.idea_feedback to authenticated;

-- «Музыка и атмосфера»: отдельное поле досье (раньше смешивалось с «любит»), чтобы водитель, площадка и Jarvis брали его напрямую
alter table public.clients add column if not exists pref_music text;

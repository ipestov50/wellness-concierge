-- Тестовые примеры из Concierge Desk (вымышленные гости).
-- Запуск повторно ничего не задвоит: записи с пометкой «пример/exemple/example» сначала удаляются.
-- :owner — id владельца в auth.users.
begin;

delete from public.requests where owner_id = :'owner' and client_id in (
  select id from public.clients where owner_id = :'owner' and name ~* '\((пример|example|exemple)\)$');
delete from public.clients  where owner_id = :'owner' and name ~* '\((пример|example|exemple)\)$';
delete from public.partners where owner_id = :'owner' and (name ~* '\((пример|example|exemple)\)$' or name = 'Тестовый партнёр');

with c as (
  insert into public.clients (owner_id, name, language, telegram, city, vip,
    pref_food, pref_spa, pref_transport, pref_hotels, allergies, diet, health, travel_history, concierge_notes, created_at)
  values
    (:'owner', 'Мария Иванова (пример)', 'RU', '@maria_i', null, true,
     'Чай вместо кофе', 'Утренние спа-сеансы', null, null,
     '{орехи}', '{без глютена}', '{}',
     '{"Мальдивы | март 2025 | Вилла над водой, ужин на пляже","Париж | октябрь 2025 | Отель на левом берегу, массаж в номере"}',
     'Любит тихие места и живую музыку. Пример для обучения: вымышленный клиент.', '2026-11-13T12:00:00Z'),
    (:'owner', 'James Smith (example)', 'EN', '@jsmith', null, false,
     'Steakhouses', null, 'Early flights, black cars', null,
     '{}', '{}', '{}',
     '{"Dubai | January 2026 | Business trip, needed late checkout"}',
     'Golf. Training example: fictional guest.', '2026-11-13T12:05:00Z'),
    (:'owner', 'Claire Dubois (exemple)', 'FR', null, null, false,
     null, 'Yoga', null, 'Boutique hotels, escapades de week-end',
     '{}', '{végétarienne}', '{}', '{}',
     'Exemple d''entraînement: cliente fictive.', '2026-11-13T12:10:00Z')
  returning id, name
), p as (
  insert into public.partners (owner_id, name, type, contact, city, terms, commission, notes)
  values
    (:'owner', 'Spa Lumière (пример)', 'spa', 'Менеджер: Sophie, +33 0 00 00 00 00', 'Париж',
     'Бронь минимум за 24 часа', '10%', 'Есть безглютеновое меню чая.'),
    (:'owner', 'Le Jardin (пример)', 'restaurant', 'Reservations: через почту', 'Париж',
     null, null, 'Хорошо работают с аллергиками, предупреждать заранее.'),
    (:'owner', 'Paris Black Cars (пример)', 'transfer', 'Диспетчер 24/7', 'Париж',
     'Фикс-цена в аэропорт', null, 'Детские кресла по запросу.')
  returning id, name
)
insert into public.requests (owner_id, client_id, partner_id, summary, category, urgency, status,
  deadline, budget_amount, currency, clarifying_questions, position, created_at)
select :'owner', (select id from c where name = x.client), (select id from p where name = x.partner),
       x.summary, x.category, x.urgency, x.status,
       (x.deadline || ' 00:00')::timestamp at time zone 'Europe/Paris', x.budget, 'EUR', x.questions, x.pos, x.created::timestamptz
from (values
  ('Мария Иванова (пример)', 'Spa Lumière (пример)', 'Массаж на двоих в пятницу вечером', 'Spa & Wellness', 'high', 'sourcing',
   '2026-11-20', 200::numeric, 'Уточнить время и пожелания по массажу. Аллергия на орехи: масло без орехов.', 1, '2026-11-13T12:20:00Z'),
  ('James Smith (example)', 'Paris Black Cars (пример)', 'Трансфер из CDG в отель, рейс в 07:40', 'Transport', 'normal', 'confirmed',
   '2026-11-18', null, 'Встреча с табличкой.', 1, '2026-11-13T12:25:00Z'),
  ('Claire Dubois (exemple)', 'Le Jardin (пример)', 'Ужин на двоих, вегетарианское меню', 'Dining', 'normal', 'new',
   '2026-11-22', 150::numeric, 'Уточнить дату и количество гостей.', 1, '2026-11-13T12:30:00Z')
) as x(client, partner, summary, category, urgency, status, deadline, budget, questions, pos, created);

commit;

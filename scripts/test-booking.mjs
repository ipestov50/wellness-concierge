// Цикл брони в «Моём дне»: бронируем → ждём подтверждения → напомнить гостю накануне → готово. node scripts/test-booking.mjs
import { planDay, zoned, dayIn, OWNER_TZ } from '../js/planner.js';
const today = '2026-11-16';
const now = zoned(OWNER_TZ, today, 9);                                   // 9:00 по Парижу
const tomorrow8pm = new Date(zoned(OWNER_TZ, '2026-11-17', 20)).toISOString();
const statuses = ['new', 'clarifying', 'sourcing', 'awaiting_approval', 'booking', 'confirmed'].map((key, i) => ({ key, kind: 'active', position: i }))
  .concat([{ key: 'done', kind: 'done', position: 9 }]);
const base = { clients: [{ id: 'c1', name: 'Мария Иванова' }], partners: [], trips: [], people: [], client_dates: [], suggestions: [], statuses };
const opts = { items: [{ name: 'Le Chantecler', address: '37 Promenade des Anglais' }], chosen: 0, sent_at: '2026-11-15T10:00:00Z' };
const req = (o) => ({ id: 'r1', client_id: 'c1', summary: 'Ужин на 4 персоны', category: 'Dining', urgency: 'normal', deadline: tomorrow8pm, ...o });
const keys = (r) => planDay({ now, data: { ...base, requests: [r] }, settings: { work_from: 8, work_to: 20, guest_from: 10, guest_to: 21 }, marks: [] }).blocks.concat([]).map((b) => `${b.key}|${b.title}`);
let ok = true;
const check = (name, cond, got) => { console.log((cond ? '✓ ' : '✗ ') + name + (cond ? '' : '  → ' + JSON.stringify(got))); ok &&= cond; };
let k = keys(req({ status: 'booking', options: opts }));
check('гость выбрал → «Забронировать · Le Chantecler»', k.some((x) => x.startsWith('b:r1:book|Забронировать · Le Chantecler')), k);
k = keys(req({ status: 'booking', options: { ...opts, booking: { sent_at: 'x' } } }));
check('отправили партнёру → «Ждём подтверждение»', k.some((x) => x.startsWith('b:r1:wait|Ждём подтверждение · Le Chantecler')), k);
k = keys(req({ status: 'confirmed', options: { ...opts, booking: { sent_at: 'x', confirmed_at: 'y' } } }));
check('подтверждено, визит завтра → «Напомнить гостю»', k.some((x) => x.startsWith('f:r1:remind|Напомнить гостю · Le Chantecler')), k);
k = keys(req({ status: 'confirmed', options: { ...opts, booking: { sent_at: 'x', confirmed_at: 'y' }, reminded_at: 'z' } }));
check('напомнили → шаг пропал', !k.some((x) => x.startsWith('f:r1:remind')), k);
k = keys(req({ status: 'confirmed', deadline: new Date(zoned(OWNER_TZ, '2026-11-20', 20)).toISOString(), options: { ...opts, booking: { confirmed_at: 'y' } } }));
check('визит через 4 дня → напоминать ещё рано', !k.some((x) => x.startsWith('f:r1:remind')), k);
process.exit(ok ? 0 : 1);

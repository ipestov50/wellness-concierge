// Перенос в «Неделе» «Моего дня» живёт, только пока жив запрос: node scripts/test-week.mjs
import { weekAgenda, dayIn, OWNER_TZ } from '../js/planner.js';
const now = Date.parse('2026-11-15T09:00:00Z');
const today = dayIn(OWNER_TZ, now);
const statuses = [{ key: 'new', kind: 'active' }, { key: 'done', kind: 'done' }];
const base = { clients: [{ id: 'c1', name: 'Мария Иванова' }], trips: [], people: [], client_dates: [], suggestions: [], statuses };
const req = (o = {}) => ({ id: 'r1', client_id: 'c1', summary: 'Ужин в Le Cinq', status: 'new', deadline: null, ...o });
const marks = [{ key: 'g:r1:new', status: 'tomorrow', day: today }]; // «Позже → Завтра»
const movedTomorrow = (requests, m = marks) => weekAgenda({ now, data: { ...base, requests }, marks: m })[1].items.filter((x) => x.kind === 'moved').length;
let ok = true;
const check = (name, cond) => { console.log((cond ? '✓ ' : '✗ ') + name); ok &&= cond; };
check('перенесли на завтра → завтра видно', movedTomorrow([req()]) === 1);
check('выполнили → пропало', movedTomorrow([req({ status: 'done' })]) === 0);
check('удалили → пропало', movedTomorrow([]) === 0);
check('в архиве → пропало', movedTomorrow([req({ status: 'done', archived_at: '2026-11-15T10:00:00Z' })]) === 0);
check('шаг отмечен «сделано» → пропало', movedTomorrow([req()], [...marks, { key: 'g:r1:new', status: 'done', day: today }]) === 0);
check('вернули в работу → снова видно', movedTomorrow([req({ status: 'new' })]) === 1);
process.exit(ok ? 0 : 1);

// Проверка детектора конфликтов: node scripts/test-conflicts.mjs
import { detectScheduleConflicts } from '../js/conflicts.js';
const MIN = 60e3, now = Date.parse('2026-11-20T10:00:00Z');
const at = (h, m = 0) => Date.parse(`2026-11-20T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
const events = [
  { id: 'transfer', client_id: 'c1', start: at(14), category: 'Transport' },
  { id: 'spa', client_id: 'c1', start: at(17), category: 'Spa & Wellness' },
  { id: 'gift', client_id: 'c1', start: at(23, 30), category: 'Gifts & Events' },   // позже 8 ч — не трогаем
  { id: 'other', client_id: 'c2', start: at(15), category: 'Dining' },              // другой гость
  { id: 'dinner', client_id: 'c2', start: at(10, 40), category: 'Dining' },
];
let ok = true;
const check = (name, cond) => { console.log((cond ? '✓ ' : '✗ ') + name); ok &&= cond; };
const flight = (delayMin, doneMin) => [{ trip_id: 't1', client_id: 'c1', flight: 'AF1145', dir: 'in', scheduled: at(13, 30), delayMin, doneMin }];

let r = detectScheduleConflicts(events, flight(50), [], { now });
check('задержка 50 мин → конфликт', r.length === 1 && r[0].type === 'flight');
check('затронуты трансфер и спа этого гостя', JSON.stringify(r[0].affected) === '["transfer","spa"]');
check('сдвиг округлён до +60 мин', r[0].shiftMin === 60);
check('задержка 25 мин → без тревоги', detectScheduleConflicts(events, flight(25), [], { now }).length === 0);
check('уже учтённая задержка → без тревоги', detectScheduleConflicts(events, flight(50, 50), [], { now }).length === 0);
check('задержка выросла после учёта → снова тревога', detectScheduleConflicts(events, flight(90, 50), [], { now })[0]?.severity === 'high');
r = detectScheduleConflicts(events, [], [{ request_id: 'dinner', minutes: 45, delay: 20, leaveBy: now - 12 * MIN }], { now });
check('пробки: выезжать надо было 12 мин назад → сдвиг +15', r[0]?.type === 'traffic' && r[0].shiftMin === 15 && r[0].affected[0] === 'dinner');
check('пробки: время ещё есть → без тревоги', detectScheduleConflicts(events, [], [{ request_id: 'dinner', minutes: 30, leaveBy: now + 5 * MIN }], { now }).length === 0);
// часовые пояса: результат не зависит от пояса устройства
check(`пояс процесса ${process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone} не влияет`, detectScheduleConflicts(events, flight(50), [], { now })[0].eta === at(14, 20));
process.exit(ok ? 0 : 1);

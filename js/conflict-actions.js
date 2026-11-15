// Конфликты расписания в интерфейсе: плашка в «Моём дне» и календаре, сдвиг зависимых событий одним нажатием,
// отметка «рейс задерживается», фоновая проверка пробок для ближайших выездов.
import { state, byId, save } from './data.js';
import { isClosed } from './statuses.js';
import { esc, toast, openModal } from './ui.js';
import { TZ } from './const.js';
import { detectScheduleConflicts, scheduleInputs } from './conflicts.js';
import { fetchRoad, ROAD_CATS } from './road.js';
import { render } from './router.js';

const MIN = 60e3, HOUR = 60 * MIN;
const hm = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const first = (c) => (c?.name || '').replace(/\s*\(.*?\)/g, '').split(/\s+/)[0] || '';

// результаты проверки дороги для ближайших выездов (из кэша TomTom, 4 мин)
const traffic = new Map();
export function currentConflicts() {
  const { events, flights } = scheduleInputs(state, isClosed);
  const roads = [...traffic.values()].filter((x) => x.value && !x.value.error && x.value.leaveBy).map((x) => ({ request_id: x.id, ...x.value }));
  return detectScheduleConflicts(events, flights, roads);
}
export const affectedIds = () => new Set(currentConflicts().flatMap((c) => c.affected));

// раз в несколько минут, пока «Мой день» открыт: дорога для выездов в ближайшие 3 часа (не больше трёх — бережём лимит)
export function watchTraffic() {
  if (document.hidden || !navigator.onLine || state.offline) return;
  const now = Date.now();
  const soon = state.requests
    .filter((r) => r.deadline && !isClosed(r.status) && ROAD_CATS.includes(r.category))
    .filter((r) => { const s = Date.parse(r.deadline); return s > now && s - now <= 3 * HOUR; })
    .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline)).slice(0, 3);
  for (const r of soon) {
    fetchRoad(r.id).then((res) => {
      if (traffic.get(r.id)?.at === res.at) return; // из кэша, ничего нового — не перерисовываем
      traffic.set(r.id, { id: r.id, ...res });
      render();
    }).catch(() => {});
  }
}

export function conflictsBlock(list = currentConflicts()) {
  if (!list.length) return '';
  return `<section class="cf-list" aria-label="Конфликты расписания">${list.map((c) => {
    const g = byId('clients', c.client_id);
    const evs = c.affected.map((id) => byId('requests', id)).filter(Boolean);
    const head = c.type === 'flight'
      ? `✈️ Рейс${c.flight ? ' ' + esc(c.flight) : ''}${g ? ` · ${esc(first(g))}` : ''} ${c.dir === 'in' ? 'прилетает' : 'вылетает'} на <b>${c.delayMin} мин</b> позже — ${c.dir === 'in' ? 'посадка' : 'вылет'} в ${hm(c.eta)}`
      : `🚦 ${esc(evs[0]?.summary || 'Выезд')}${g ? ` · ${esc(first(g))}` : ''}: дорога ${c.minutes} мин${c.traffic ? ` (+${c.traffic} пробки)` : ''} — выезжать нужно было <b>${c.delayMin} мин назад</b>`;
    return `<article class="cf ${c.severity}">
      <p class="cf-h">${head}</p>
      ${evs.length ? `<ul class="cf-ev">${evs.map((r) => `<li><span class="cf-old">${hm(Date.parse(r.deadline))}</span> → <b>${hm(Date.parse(r.deadline) + c.shiftMin * MIN)}</b> · ${esc(r.summary)}</li>`).join('')}</ul>`
        : '<p class="cf-none">Зависимых событий нет — просто учтите новое время.</p>'}
      <div class="cf-act">
        ${evs.length ? `<button type="button" class="btn small primary" data-cf-shift="${esc(c.id)}">Сдвинуть ${evs.length > 1 ? `все (${evs.length}) ` : ''}на +${c.shiftMin} мин</button>` : ''}
        ${c.type === 'flight' ? `<button type="button" class="btn small ghostish" data-cf-skip="${esc(c.id)}">${evs.length ? 'Не сдвигать' : 'Понятно'}</button>` : ''}
      </div>
    </article>`;
  }).join('')}</section>`;
}

// сдвиг одним нажатием, с «Отменить»
async function applyShift(c) {
  const evs = c.affected.map((id) => byId('requests', id)).filter(Boolean);
  const before = evs.map((r) => [r.id, r.deadline]);
  const trip = c.trip_id && byId('trips', c.trip_id);
  const doneKey = c.dir === 'out' ? 'flight_out_delay_done' : 'flight_in_delay_done';
  const prevDone = trip?.[doneKey] ?? null;
  try {
    await Promise.all(evs.map((r) => save('requests', r.id, { deadline: new Date(Date.parse(r.deadline) + c.shiftMin * MIN).toISOString() })));
    if (trip) await save('trips', trip.id, { [doneKey]: c.delayMin });
    traffic.delete(evs[0]?.id);
    toast(`Сдвинуто на +${c.shiftMin} мин: ${evs.length}`, '', { label: 'Отменить', fn: async () => {
      await Promise.all(before.map(([id, d]) => save('requests', id, { deadline: d })));
      if (trip) await save('trips', trip.id, { [doneKey]: prevDone });
    } });
  } catch (e) { toast('Не удалось сдвинуть: ' + (e.message || e), 'err'); render(); } // кнопка снова активна
}
async function skip(c) {
  const doneKey = c.dir === 'out' ? 'flight_out_delay_done' : 'flight_in_delay_done';
  try { await save('trips', c.trip_id, { [doneKey]: c.delayMin }); } catch (e) { toast('Не сохранилось: ' + (e.message || e), 'err'); render(); }
}

// «Рейс задерживается»: одно касание — +30, +45, +60…
export function openFlightDelay(tripId, dir = 'in') {
  const t = byId('trips', tripId);
  if (!t) return;
  const key = dir === 'out' ? 'flight_out_delay' : 'flight_in_delay';
  const cur = t[key] || 0;
  const m = openModal({
    title: dir === 'out' ? 'Вылет задерживается' : 'Прилёт задерживается',
    saveLabel: 'Сохранить',
    body: `<p class="muted">${esc(dir === 'out' ? t.flight_out || 'Рейс обратно' : t.flight_in || 'Рейс туда')} · по расписанию ${hm(Date.parse(dir === 'out' ? t.flight_out_at : t.flight_in_at))}</p>
      <div class="fd-quick">${[0, 30, 45, 60, 90, 120, 180].map((n) => `<button type="button" class="btn${n === cur ? ' primary' : ''}" data-fd="${n}">${n ? '+' + n + ' мин' : 'По расписанию'}</button>`).join('')}</div>
      <label class="f"><span>Или точно, минут</span><input type="number" inputmode="numeric" min="0" max="1440" step="5" name="delay" value="${cur || ''}"></label>`,
    onSave: async (v) => commit(+v.delay || 0),
  });
  const commit = async (n) => {
    await save('trips', tripId, { [key]: n || null });
    m.close();
    const cf = currentConflicts().find((c) => c.trip_id === tripId && c.dir === dir);
    toast(n > 30 && cf?.affected.length ? `Задержка +${n} мин · затронуто событий: ${cf.affected.length} — сдвинуть можно в «Моём дне»` : n ? `Задержка +${n} мин учтена${n > 30 ? ' — зависимых событий нет' : ''}` : 'Рейс по расписанию');
  };
  m.form.querySelectorAll('[data-fd]').forEach((b) => b.addEventListener('click', () => commit(+b.dataset.fd).catch((e) => toast('Не сохранилось: ' + e.message, 'err'))));
}

document.addEventListener('click', (e) => {
  const s = e.target.closest('[data-cf-shift]'), k = e.target.closest('[data-cf-skip]'), f = e.target.closest('[data-flight-delay]');
  if (!s && !k && !f) return;
  e.stopPropagation();
  if (f) return openFlightDelay(f.dataset.flightDelay, f.dataset.dir || 'in');
  const c = currentConflicts().find((x) => x.id === (s || k).dataset[s ? 'cfShift' : 'cfSkip']);
  if (!c) return;
  (s || k).disabled = true;
  (s ? applyShift(c) : skip(c));
});

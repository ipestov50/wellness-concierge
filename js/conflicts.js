// Детектор конфликтов расписания: задержка рейса и пробки → какие события гостя под угрозой и на сколько их сдвинуть.
// Чистая функция без обращений к сети и DOM — её можно проверить отдельно (node scripts/test-conflicts.mjs).
const MIN = 60e3, HOUR = 60 * MIN;
// что зависит от прилёта гостя
const AFTER_ARRIVAL = new Set(['Transport', 'Spa & Wellness', 'Dining', 'Activities', 'Health & Fitness', 'Gifts & Events', 'Accommodation']);
const ceilTo = (m, step) => Math.ceil(m / step) * step;

/**
 * @param events          [{ id, client_id, start(ms), category, title }] — открытые запросы со временем
 * @param flightStatuses  [{ trip_id, client_id, flight, dir:'in'|'out', scheduled(ms), delayMin, doneMin }]
 * @param trafficDelays   [{ request_id, minutes, delay, leaveBy(ms), level }] — ответ TomTom через Jarvis
 * @returns [{ id, type:'flight'|'traffic', severity:'med'|'high', delayMin, shiftMin, client_id, affected:[eventId], ... }]
 */
export function detectScheduleConflicts(events, flightStatuses = [], trafficDelays = [], { now = Date.now() } = {}) {
  const out = [];
  for (const f of flightStatuses) {
    if (!(f.delayMin > 30) || f.delayMin === f.doneMin) continue; // меньше 30 мин — не тревожим; уже учтено — тоже
    const eta = f.scheduled + f.delayMin * MIN;
    if (eta < now - HOUR) continue; // рейс давно сел/улетел
    // прилёт задержан → всё, что у гостя запланировано от «за час до посадки» до 8 часов после, сдвигается
    // вылет задержан → трансфер в аэропорт за 5 часов до вылета можно сдвинуть позже
    const [from, to, cats] = f.dir === 'in'
      ? [f.scheduled - HOUR, f.scheduled + 8 * HOUR, AFTER_ARRIVAL]
      : [f.scheduled - 5 * HOUR, f.scheduled, new Set(['Transport'])];
    const affected = events.filter((e) => e.client_id === f.client_id && e.start >= from && e.start <= to && e.start > now && cats.has(e.category));
    out.push({
      id: `flight:${f.trip_id}:${f.dir}`, type: 'flight', dir: f.dir, trip_id: f.trip_id, flight: f.flight || '',
      severity: f.delayMin >= 90 ? 'high' : 'med', delayMin: f.delayMin, shiftMin: ceilTo(f.delayMin, 15),
      client_id: f.client_id, eta, affected: affected.map((e) => e.id),
    });
  }
  for (const t of trafficDelays) {
    const e = events.find((x) => x.id === t.request_id);
    if (!e || e.start <= now || !t.leaveBy) continue;
    const late = (now - t.leaveBy) / MIN; // на сколько минут уже опаздываем с выездом
    if (late <= 0) continue;
    out.push({
      id: `traffic:${e.id}`, type: 'traffic', severity: late > 15 ? 'high' : 'med',
      delayMin: Math.round(late), shiftMin: Math.max(5, ceilTo(late, 5)), minutes: t.minutes, traffic: t.delay || 0,
      client_id: e.client_id, affected: [e.id],
    });
  }
  return out.sort((a, b) => (b.severity === 'high') - (a.severity === 'high'));
}

// события и рейсы из общего хранилища
export function scheduleInputs(state, isClosed) {
  const events = state.requests.filter((r) => r.deadline && !isClosed(r.status))
    .map((r) => ({ id: r.id, client_id: r.client_id, start: Date.parse(r.deadline), category: r.category, title: r.summary }));
  const flights = [];
  for (const t of state.trips) {
    if (t.flight_in_at && t.flight_in_delay) flights.push({ trip_id: t.id, client_id: t.client_id, flight: t.flight_in, dir: 'in', scheduled: Date.parse(t.flight_in_at), delayMin: t.flight_in_delay, doneMin: t.flight_in_delay_done });
    if (t.flight_out_at && t.flight_out_delay) flights.push({ trip_id: t.id, client_id: t.client_id, flight: t.flight_out, dir: 'out', scheduled: Date.parse(t.flight_out_at), delayMin: t.flight_out_delay, doneMin: t.flight_out_delay_done });
  }
  return { events, flights };
}

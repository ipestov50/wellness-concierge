// «Мой день»: раскладка действий консьержа по часам с учётом трёх часов — ваших, гостя и партнёра.
// Чистая логика без браузера и базы: этот же файл копируется в supabase/functions/jarvis/planner.js
// для напоминаний в Telegram. Меняете здесь — скопируйте туда (deploy-скрипт делает это сам).

export const OWNER_TZ = 'Europe/Paris';
const MIN = 60e3, HOUR = 36e5, STEP = 5 * MIN;

// ---------- время ----------
const partsIn = (tz, ms) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
  .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
export const dayIn = (tz, ms) => { const p = partsIn(tz, ms); return `${p.year}-${p.month}-${p.day}`; };
export const hmIn = (tz, ms) => { const p = partsIn(tz, ms); return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`; };
const offsetMin = (tz, ms) => { const p = partsIn(tz, ms); return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(ms / MIN) * MIN) / MIN; };
// «в поясе tz в день ymd в hh:mm» → метка времени
export function zoned(tz, ymd, hh, mm = 0) {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMin(tz, guess) * MIN;
  t = guess - offsetMin(tz, t) * MIN;
  return t;
}
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (ymd) => new Date(ymd + 'T12:00:00Z').getUTCDay(); // 0 — воскресенье
const ceilTo = (ms, step) => Math.ceil(ms / step) * step;

// окно «с h1 до h2 по местному времени tz», пересекающее отрезок [from, to]
function localWindows(tz, h1, h2, from, to) {
  const out = [];
  for (let d = addDays(dayIn(tz, from), -1); d <= dayIn(tz, to); d = addDays(d, 1)) {
    const s = zoned(tz, d, h1), e = h2 >= 24 ? zoned(tz, addDays(d, 1), 0) : zoned(tz, d, h2);
    const a = Math.max(s, from), b = Math.min(e, to);
    if (b > a) out.push([a, b]);
  }
  return out;
}
const intersect = (A, B) => { const out = []; for (const [a1, a2] of A) for (const [b1, b2] of B) { const s = Math.max(a1, b1), e = Math.min(a2, b2); if (e > s) out.push([s, e]); } return out.sort((x, y) => x[0] - y[0]); };

// ---------- где гость и где партнёр ----------
const KIDS = /сын|доч|реб/i;
export function guestTz(c, trips, ms) {
  if (!c) return null;
  const d = dayIn(OWNER_TZ, ms);
  const t = trips.find((x) => x.client_id === c.id && x.tz && x.start_date && x.start_date <= d && d <= (x.end_date || x.start_date));
  return t ? { tz: t.tz, place: t.city, trip: t } : c.home_tz ? { tz: c.home_tz, place: null, trip: null } : null;
}
// в самолёте: за 3 часа до прилёта (точного вылета не знаем) и 3 часа после вылета обратно
function inFlight(c, trips) {
  const out = [];
  for (const t of trips.filter((x) => x.client_id === c?.id)) {
    if (t.flight_in_at) { const a = Date.parse(t.flight_in_at); out.push([a - 3 * HOUR, a + 30 * MIN]); }
    if (t.flight_out_at) { const a = Date.parse(t.flight_out_at); out.push([a, a + 3 * HOUR]); }
  }
  return out;
}
const PARTNER_HOURS = {
  restaurant: [[10, 12], [15, 18]], spa: [[10, 19]], hotel: [[0, 24]], transfer: [[8, 21]], clinic: [[9, 18]], gifts: [[10, 19]], activities: [[9, 18]], other: [[9, 18]],
};
const CAT_TO_TYPE = { Dining: 'restaurant', 'Spa & Wellness': 'spa', Accommodation: 'hotel', Transport: 'transfer', 'Health & Fitness': 'clinic', 'Gifts & Events': 'gifts', Activities: 'activities' };
const CLOSED_SUNDAY = new Set(['clinic', 'gifts', 'other', 'activities']);

// ---------- действия ----------
const URG = { critical: 100, high: 70, normal: 40, low: 20 };
const firstName = (c) => (c?.name || '').replace(/\s*\(.*?\)/g, '').trim();

function buildActions(now, D, settings) {
  const acts = [];
  const statuses = [...(D.statuses || [])].sort((a, b) => a.position - b.position);
  const active = statuses.filter((s) => s.kind === 'active').map((s) => s.key);
  const closed = new Set(statuses.filter((s) => s.kind !== 'active').map((s) => s.key));
  const bookIdx = Math.max(0, active.indexOf('booking') >= 0 ? active.indexOf('booking') : active.length - 2);
  const cMap = new Map(D.clients.map((c) => [c.id, c])), pMap = new Map(D.partners.map((p) => [p.id, p]));
  const client = (id) => cMap.get(id);
  const partner = (id) => pMap.get(id);
  const today = dayIn(OWNER_TZ, now);

  const push = (a) => acts.push({ dur: 10, fixed: null, earliest: now, latest: null, score: 30, ...a });

  for (const r of D.requests) {
    if (closed.has(r.status)) continue;
    const c = client(r.client_id);
    const p = partner(r.partner_id);
    const dl = r.deadline ? Date.parse(r.deadline) : null;
    const hoursLeft = dl ? (dl - now) / HOUR : null;
    if (dl && hoursLeft > 24 * 4 && !['new', 'awaiting_approval'].includes(r.status)) continue; // далеко и без общения — не сегодня
    let score = URG[r.urgency] ?? 40;
    if (hoursLeft != null) score += hoursLeft < 0 ? 80 : hoursLeft < 3 ? 60 : hoursLeft < 24 ? 40 : hoursLeft < 48 ? 20 : 0;
    if (c?.vip) score += 15;
    const idx = active.indexOf(r.status);
    const early = idx >= 0 ? idx < bookIdx : true;
    if (early && hoursLeft != null && hoursLeft < 24) score += 40; // риск: не забронировано, а времени мало
    const who = firstName(c) || '';
    const base = { request_id: r.id, client_id: r.client_id, summary: r.summary, latest: dl ? dl - (r.category === 'Transport' ? 6 : 4) * HOUR : null, score, overdue: hoursLeft != null && hoursLeft < 0 };
    const pType = p?.type || CAT_TO_TYPE[r.category] || 'other';
    // место, которое выбрал гость (из «Вариантов для гостя»), иначе партнёр запроса
    const venue = (r.options?.chosen != null && r.options.items?.[r.options.chosen]?.name) || p?.name || '';
    const bk = r.options?.booking;
    switch (r.status) {
      case 'new':
        push({ ...base, key: `g:${r.id}:new`, kind: 'guest', icon: '💬', title: 'Уточнить детали', who, detail: r.clarifying_questions || r.summary, next: active[idx + 1] || null, dur: 10 }); break;
      case 'clarifying':
        push({ ...base, key: `g:${r.id}:cl`, kind: 'guest', icon: '💬', title: 'Получить ответ гостя', who, detail: r.clarifying_questions || r.summary, dur: 5, score: score - 5 }); break;
      case 'sourcing':
        push({ ...base, key: `p:${r.id}:src`, kind: 'prep', icon: '🔎', title: 'Подобрать варианты', who, detail: r.summary, dur: 25 });
        push({ ...base, key: `g:${r.id}:send`, kind: 'guest', icon: '💬', title: 'Отправить варианты гостю', who, detail: r.summary, after: `p:${r.id}:src`, next: active[idx + 1] || null, dur: 5, score: score - 1 }); break;
      case 'awaiting_approval':
        push({ ...base, key: `g:${r.id}:appr`, kind: 'guest', icon: '💬', title: 'Напомнить об одобрении', who, detail: r.summary, dur: 5 }); break;
      case 'booking':
        if (bk?.sent_at && !bk.confirmed_at) push({ ...base, key: `b:${r.id}:wait`, kind: 'partner', icon: '⏳', title: `Ждём подтверждение${venue ? ' · ' + venue : ''}`, who, detail: r.summary, pType, partner_id: r.partner_id, dur: 5, score: score - 10 });
        else push({ ...base, key: `b:${r.id}:book`, kind: 'partner', icon: '📞', title: `Забронировать${venue ? ' · ' + venue : ''}`, who, detail: r.summary, pType, partner_id: r.partner_id, next: active[idx + 1] || null, dur: 15 }); break;
      default:
        if (early) push({ ...base, key: `g:${r.id}:${r.status}`, kind: 'guest', icon: '💬', title: 'Продвинуть запрос', who, detail: r.summary, dur: 10 });
        else if (r.status !== 'confirmed') push({ ...base, key: `b:${r.id}:${r.status}`, kind: 'partner', icon: '📞', title: `Связаться с партнёром${p ? ' · ' + p.name : ''}`, who, detail: r.summary, pType, partner_id: r.partner_id, dur: 10 });
    }
    // подтверждено: накануне (или утром в тот же день, если бронь «на сегодня») — напомнить гостю: время, адрес, карта
    if (r.status === 'confirmed' && dl && dl > now && !r.options?.reminded_at) {
      const dDay = dayIn(OWNER_TZ, dl);
      if (today === addDays(dDay, -1) || today === dDay) push({ ...base, key: `f:${r.id}:remind`, kind: 'guest', icon: '🔔', title: `Напомнить гостю${venue ? ' · ' + venue : ''}`, who, detail: `${today === dDay ? 'сегодня' : 'завтра'} в ${hmIn(OWNER_TZ, dl)} · ${r.summary}`, dur: 5, score: score + 15 });
    }
    // в день визита: переподтвердить бронь за 3 часа и напомнить гостю о выезде за час
    if (dl && dayIn(OWNER_TZ, dl) === today && dl > now && !early && ['Dining', 'Spa & Wellness', 'Activities', 'Health & Fitness'].includes(r.category)) {
      push({ ...base, key: `f:${r.id}:reconf`, kind: 'partner', icon: '✓', title: `Переподтвердить бронь${p ? ' · ' + p.name : ''}`, who, detail: r.summary, fixed: dl - 3 * HOUR, dur: 5, score: score + 10 });
      push({ ...base, key: `f:${r.id}:leave`, kind: 'guest', icon: '🚗', title: 'Напомнить о выезде', who, detail: `${r.summary} в ${hmIn(OWNER_TZ, dl)}`, fixed: dl - 60 * MIN, dur: 5, score: score + 10, urgentGuest: true });
    }
    // срочные пункты чек-листа по запросам на ближайшие 2 дня
    const urgent = (r.checklist?.items || []).filter((i) => !i.done && (i.section === 'urgent' || i.prio === 'high'));
    if (urgent.length && hoursLeft != null && hoursLeft < 48) {
      push({ ...base, key: `c:${r.id}`, kind: 'check', icon: '☑︎', title: `Чек-лист: ${urgent.length} срочн.`, who, detail: urgent.slice(0, 3).map((i) => i.t).join(' · '), dur: Math.min(20, 4 * urgent.length), score: score - 3 });
    }
  }

  // рейсы сегодня: проверить рейс, приветствие после посадки, выезд в аэропорт
  for (const t of D.trips) {
    const c = client(t.client_id);
    const who = firstName(c) || '';
    if (t.flight_in_at && dayIn(OWNER_TZ, Date.parse(t.flight_in_at)) === today) {
      const a = Date.parse(t.flight_in_at);
      if (a - 2 * HOUR > now - 30 * MIN) push({ key: `t:${t.id}:chk`, kind: 'check', icon: '🛬', client_id: t.client_id, title: `Проверить рейс${t.flight_in ? ' ' + t.flight_in : ''}`, who, detail: `прилёт в ${hmIn(OWNER_TZ, a)} · ${t.city}`, fixed: a - 2 * HOUR, dur: 5, score: 90 });
      if (a + 45 * MIN > now) push({ key: `t:${t.id}:hi`, kind: 'guest', icon: '👋', client_id: t.client_id, title: 'Приветствие после посадки', who, detail: `${t.city}${t.hotel ? ' · ' + t.hotel : ''}`, fixed: a + 45 * MIN, dur: 5, score: 80, urgentGuest: true });
    }
    if (t.flight_out_at && dayIn(OWNER_TZ, Date.parse(t.flight_out_at)) === today) {
      const a = Date.parse(t.flight_out_at);
      if (a - 4 * HOUR > now - 30 * MIN) push({ key: `t:${t.id}:out`, kind: 'check', icon: '🛫', client_id: t.client_id, title: 'Вылет: рейс, трансфер, счёт в отеле', who, detail: `вылет в ${hmIn(OWNER_TZ, a)}`, fixed: a - 4 * HOUR, dur: 10, score: 85 });
    }
  }

  // дни рождения и важные даты сегодня
  const md = today.slice(5);
  for (const c of D.clients) if (c.birthday?.slice(5) === md) push({ key: `d:${c.id}:bday`, kind: 'guest', icon: '🎂', client_id: c.id, title: 'Поздравить с днём рождения', who: firstName(c), detail: 'лично, тёплыми словами', dur: 5, score: 95 });
  for (const p of D.people || []) if (p.birthday?.slice(5) === md) { const c = client(p.client_id); if (c) push({ key: `d:${p.id}:pbday`, kind: 'guest', icon: '🎂', client_id: c.id, title: `Поздравить: ДР у ${(p.role || p.name).toLowerCase()}`, who: firstName(c), detail: p.name, dur: 5, score: 75 }); }
  for (const x of D.client_dates || []) if (x.date?.slice(5) === md) { const c = client(x.client_id); if (c) push({ key: `d:${x.id}:date`, kind: 'guest', icon: '📅', client_id: c.id, title: `${x.title} сегодня`, who: firstName(c), detail: x.notes || '', dur: 5, score: 75 }); }

  // предложения Jarvis — когда есть время
  for (const s of (D.suggestions || []).filter((x) => x.status === 'new' || (x.status === 'snoozed' && x.snooze_until && Date.parse(x.snooze_until) <= now)).slice(0, 4)) {
    push({ key: `s:${s.id}`, kind: 'prep', icon: '✦', client_id: s.client_id, title: s.title.replace(/^\S+\s/, ''), who: firstName(client(s.client_id)) || '', detail: 'Jarvis предлагает — план готов', dur: 10, score: 25, suggestion_id: s.id });
  }
  return acts;
}

// ---------- раскладка ----------
export function planDay({ now = Date.now(), data, settings = {}, marks = [] }) {
  const S = { work_from: 8, work_to: 20, lunch_from: 13, lunch_to: 14, guest_from: 10, guest_to: 21, ...settings };
  let day = dayIn(OWNER_TZ, now);
  let dayStart = zoned(OWNER_TZ, day, S.work_from), dayEnd = zoned(OWNER_TZ, day, S.work_to);
  let tomorrow = false;
  if (now >= dayEnd) { tomorrow = true; day = addDays(day, 1); dayStart = zoned(OWNER_TZ, day, S.work_from); dayEnd = zoned(OWNER_TZ, day, S.work_to); }
  const t0 = Math.max(dayStart, ceilTo(now, STEP));
  const mk = Object.fromEntries(marks.filter((m) => m.day === day).map((m) => [m.key, m]));
  const cMap = new Map(data.clients.map((c) => [c.id, c]));
  const client = (id) => cMap.get(id);
  // поездки по гостям — один раз, а не на каждое действие
  const tripsBy = new Map();
  for (const t of data.trips) { if (!tripsBy.has(t.client_id)) tripsBy.set(t.client_id, []); tripsBy.get(t.client_id).push(t); }
  const lunch = [zoned(OWNER_TZ, day, S.lunch_from), zoned(OWNER_TZ, day, S.lunch_to)];

  let acts = buildActions(tomorrow ? dayStart : now, data, S);
  const done = acts.filter((a) => mk[a.key]?.status === 'done');
  const moved = acts.filter((a) => mk[a.key]?.status === 'tomorrow');
  acts = acts.filter((a) => !['done', 'tomorrow'].includes(mk[a.key]?.status));
  // «позже» и закреплённые вами — становятся действиями с точным временем
  for (const a of acts) { const m = mk[a.key]; if (m?.at && (m.status === 'snoozed' || m.status === 'pinned')) { a.fixed = Date.parse(m.at); a.pinned = m.status === 'pinned'; } }

  // окна для каждого действия
  const work = [[t0, dayEnd]];
  for (const a of acts) {
    const c = client(a.client_id);
    const ct = tripsBy.get(a.client_id) || [];
    const g = guestTz(c, ct, a.fixed || t0);
    a.guestTz = g?.tz || null; a.guestPlace = g?.place || null;
    let win = work;
    if (a.kind === 'guest' && g && !a.urgentGuest && !a.overdue) {
      win = intersect(win, localWindows(g.tz, S.guest_from, S.guest_to, t0, dayEnd));
      // в самолёте не пишем
      for (const [f1, f2] of inFlight(c, ct)) win = win.flatMap(([s, e]) => (f2 <= s || f1 >= e ? [[s, e]] : [[s, f1], [f2, e]].filter(([x, y]) => y - x >= STEP)));
    }
    if (a.kind === 'partner' && !a.fixed) {
      const ptz = g?.trip?.tz || OWNER_TZ;
      const hours = PARTNER_HOURS[a.pType] || PARTNER_HOURS.other;
      if (weekday(dayIn(ptz, t0)) === 0 && CLOSED_SUNDAY.has(a.pType)) win = [];
      else win = intersect(win, hours.flatMap(([h1, h2]) => localWindows(ptz, h1, h2, t0, dayEnd)));
      a.partnerTz = ptz;
    }
    a.windows = win;
  }

  const busy = [lunch];
  const free = (s, e) => !busy.some(([b1, b2]) => s < b2 && e > b1);
  const placed = [], overflow = [];
  const put = (a, s) => { const e = s + a.dur * MIN; busy.push([s, e]); placed.push({ ...a, start: s, end: e }); };

  // 1) точное время — как есть (даже если вне рабочих часов: это важно)
  for (const a of acts.filter((x) => x.fixed).sort((x, y) => x.fixed - y.fixed)) {
    if (a.fixed < now - 15 * MIN && !tomorrow) { a.missed = true; }
    const s = Math.max(ceilTo(a.fixed, STEP), a.missed ? t0 : 0);
    put({ ...a, outside: s < dayStart || s >= dayEnd }, s);
  }
  // 2) гибкие — по важности, сообщения гостям одного пояса подряд
  const flex = acts.filter((x) => !x.fixed).sort((x, y) => y.score - x.score || (x.latest ?? Infinity) - (y.latest ?? Infinity));
  const findSlot = (a, from) => {
    for (const [ws, we] of a.windows) {
      for (let s = Math.max(ceilTo(ws, STEP), from); s + a.dur * MIN <= we; s += STEP) if (free(s, s + a.dur * MIN)) return s;
    }
    return null;
  };
  const doneKeys = new Set();
  for (const a of flex) {
    if (doneKeys.has(a.key)) continue;
    const after = a.after ? placed.find((p) => p.key === a.after) : null;
    let from = after ? after.end : t0;
    let s = findSlot(a, from);
    if (s == null) { overflow.push({ ...a, why: a.windows.length ? 'день занят' : a.kind === 'guest' ? 'у гостя сегодня нет удобного окна' : a.kind === 'partner' ? 'партнёр сегодня не на связи' : 'нет времени' }); continue; }
    put({ ...a, late: a.latest != null && s > a.latest }, s);
    doneKeys.add(a.key);
    // рядом — другие сообщения гостям того же пояса
    if (a.kind === 'guest' && a.guestTz) {
      for (const b of flex) {
        if (doneKeys.has(b.key) || b.kind !== 'guest' || b.guestTz !== a.guestTz || b.after) continue;
        const end = placed[placed.length - 1].end;
        if (b.windows.some(([ws, we]) => end >= ws && end + b.dur * MIN <= we) && free(end, end + b.dur * MIN)) { put({ ...b, batch: a.guestTz }, end); doneKeys.add(b.key); }
      }
    }
  }
  placed.sort((x, y) => x.start - y.start);
  // время у гостя для каждого блока
  for (const b of placed) {
    if (b.kind === 'guest' && b.guestTz && b.guestTz !== OWNER_TZ) b.guestLocal = hmIn(b.guestTz, b.start);
    if (b.kind === 'partner' && b.partnerTz && b.partnerTz !== OWNER_TZ) b.partnerLocal = hmIn(b.partnerTz, b.start);
  }
  // свободные окна от 30 минут
  const gaps = [];
  let cur = t0;
  for (const [s, e] of [...busy].sort((x, y) => x[0] - y[0])) { if (s - cur >= 30 * MIN && s <= dayEnd) gaps.push([cur, Math.min(s, dayEnd)]); cur = Math.max(cur, e); }
  if (dayEnd - cur >= 30 * MIN) gaps.push([cur, dayEnd]);
  return { day, tomorrow, dayStart, dayEnd, now, lunch, blocks: placed, overflow, done, moved, gaps: gaps.filter(([s, e]) => !(s >= lunch[0] && e <= lunch[1])) };
}

// почему этот блок именно сейчас — одна человеческая строка
export function why(b) {
  const out = [];
  if (b.guestLocal) out.push(`у гостя ${b.guestLocal}${b.guestPlace ? ' · ' + b.guestPlace : ''}`);
  if (b.partnerLocal) out.push(`у партнёра ${b.partnerLocal}`);
  if (b.kind === 'partner' && b.pType === 'restaurant') out.push('ресторан отвечает до сервиса');
  if (b.pinned) out.push('вы поставили это время');
  if (b.overdue) out.push('просрочено');
  else if (b.late) out.push('позже, чем хотелось бы — раньше не было окна');
  if (b.missed) out.push('время уже прошло — сделать сейчас');
  if (b.outside) out.push('вне рабочих часов, но важно');
  if (b.batch) out.push('вместе с другими гостями из этого пояса');
  return out.join(' · ');
}

// ---------- неделя: что ждёт по дням (для планирования вперёд) ----------
export function weekAgenda({ now = Date.now(), data, marks = [], days = 7 }) {
  const today = dayIn(OWNER_TZ, now);
  const statuses = data.statuses || [];
  const closed = new Set(statuses.filter((s) => s.kind !== 'active').map((s) => s.key));
  const doneKeys = new Set(statuses.filter((s) => s.kind === 'done').map((s) => s.key));
  const cMap = new Map(data.clients.map((c) => [c.id, c]));
  const rMap = new Map(data.requests.map((r) => [r.id, r]));
  const out = [];
  // действия, перенесённые «на потом»: последний день отметки + 1 = день, когда они вернутся
  const lastMoved = new Map();
  for (const m of marks) if (m.status === 'tomorrow' && m.day >= today) lastMoved.set(m.key, m.day > (lastMoved.get(m.key) || '') ? m.day : lastMoved.get(m.key));
  // перенос показываем, только пока источник жив: запрос открыт и не в архиве, поездка/повод существуют,
  // и шаг не отмечен «сделано» позже переноса. Иначе отметка — просто след, её не видно нигде.
  const tMap = new Map((data.trips || []).map((t) => [t.id, t]));
  const sMap = new Map((data.suggestions || []).map((s) => [s.id, s]));
  const doneAfter = (key, day) => marks.some((m) => m.key === key && m.status === 'done' && m.day >= day);
  const alive = (key, day) => {
    const [kind, id] = key.split(':');
    if (doneAfter(key, day)) return null;
    if ('gpbfc'.includes(kind)) { const r = rMap.get(id); return r && !closed.has(r.status) && !r.archived_at ? { r } : null; }
    if (kind === 't') { const t = tMap.get(id); return t ? { t } : null; }
    if (kind === 's') { const s = sMap.get(id); return s && s.status !== 'dismissed' && s.status !== 'accepted' ? { s } : null; }
    return {};
  };
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    const items = [];
    for (const r of data.requests) {
      if (closed.has(r.status) || r.archived_at || !r.deadline) continue;
      const ms = Date.parse(r.deadline);
      if (dayIn(OWNER_TZ, ms) !== d) continue;
      const c = cMap.get(r.client_id);
      items.push({ kind: 'deadline', t: ms, time: hmIn(OWNER_TZ, ms) === '00:00' ? '' : hmIn(OWNER_TZ, ms), title: r.summary, who: firstName(c), request_id: r.id, urgency: r.urgency, category: r.category });
    }
    for (const t of data.trips) {
      const c = cMap.get(t.client_id);
      if (t.flight_in_at && dayIn(OWNER_TZ, Date.parse(t.flight_in_at)) === d) items.push({ kind: 'arrive', t: Date.parse(t.flight_in_at), time: hmIn(OWNER_TZ, Date.parse(t.flight_in_at)), title: `Прилёт${t.flight_in ? ' ' + t.flight_in : ''} · ${t.city}`, who: firstName(c), trip_id: t.id });
      else if (!t.flight_in_at && t.start_date === d) items.push({ kind: 'arrive', t: zoned(OWNER_TZ, d, 9), time: '', title: `Заезд · ${t.city}`, who: firstName(c), trip_id: t.id });
      if (t.flight_out_at && dayIn(OWNER_TZ, Date.parse(t.flight_out_at)) === d) items.push({ kind: 'depart', t: Date.parse(t.flight_out_at), time: hmIn(OWNER_TZ, Date.parse(t.flight_out_at)), title: `Вылет${t.flight_out ? ' ' + t.flight_out : ''} · ${t.city}`, who: firstName(c), trip_id: t.id });
    }
    const md = d.slice(5);
    for (const c of data.clients) if (c.birthday?.slice(5) === md) items.push({ kind: 'date', t: zoned(OWNER_TZ, d, 8), time: '', title: 'День рождения', who: firstName(c), client_id: c.id });
    for (const p of data.people || []) if (p.birthday?.slice(5) === md) items.push({ kind: 'date', t: zoned(OWNER_TZ, d, 8), time: '', title: `ДР · ${p.name}`, who: firstName(cMap.get(p.client_id)), client_id: p.client_id });
    for (const x of data.client_dates || []) if (x.date?.slice(5) === md) items.push({ kind: 'date', t: zoned(OWNER_TZ, d, 8), time: '', title: x.title, who: firstName(cMap.get(x.client_id)), client_id: x.client_id });
    // вернутся в этот день после переноса
    for (const [key, last] of lastMoved) if (addDays(last, 1) === d) {
      const src = alive(key, last);
      if (!src) continue;
      const r = src.r;
      if (r && items.some((x) => x.kind === 'deadline' && x.request_id === r.id)) continue; // срок и так в этот день
      const title = r ? r.summary : src.t ? `Поездка · ${src.t.city}` : src.s ? src.s.title : 'Перенесённое действие';
      const cid = r?.client_id || src.t?.client_id || src.s?.client_id;
      items.push({ kind: 'moved', t: zoned(OWNER_TZ, d, 8, 30), time: '', title, who: firstName(cMap.get(cid)), request_id: r?.id, key });
    }
    // выполненные заранее — тоже дела этого дня (видно, что всё под контролем)
    for (const r of data.requests) {
      if (!r.deadline || !doneKeys.has(r.status)) continue; // и архивные — это тоже дела этого дня
      const ms = Date.parse(r.deadline);
      if (dayIn(OWNER_TZ, ms) !== d) continue;
      items.push({ kind: 'done', t: ms, time: hmIn(OWNER_TZ, ms) === '00:00' ? '' : hmIn(OWNER_TZ, ms), title: r.summary, who: firstName(cMap.get(r.client_id)), request_id: r.id });
    }
    items.sort((a, b) => a.t - b.t);
    const open = items.filter((x) => x.kind === 'deadline' || x.kind === 'moved').length;
    out.push({ day: d, items, load: open, open, done: items.filter((x) => x.kind === 'done').length });
  }
  return out;
}

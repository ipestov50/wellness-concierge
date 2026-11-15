// Календарь: запросы, рейсы, поездки, дни рождения и даты — день, неделя, месяц
import { CATEGORIES, URGENCY_LABEL, TZ } from '../const.js';
import { esc, avatar, toast, fromParisInput } from '../ui.js';
import { state, byId, save } from '../data.js';
import { ui, render } from '../router.js';
import { isClosed, statusLabel, effectiveStatus, statusOf } from '../statuses.js';
import { birthdayInfo } from '../birthday.js';
import { editRequest } from '../forms.js';
import { editTrip, editPerson, editDate } from '../dossier.js';

const H0 = 6, H1 = 24; // сетка с 06:00 до 24:00
// масштаб: высота одного часа в пикселях
const ZOOMS = [36, 48, 64, 84, 112, 144];
let zoom = (() => { try { const z = +localStorage.getItem('cal.zoom'); return ZOOMS.includes(z) ? z : 64; } catch { return 64; } })();
let HOUR_PX = zoom;
let keepMinute = null; // какое время держать в центре после смены масштаба
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_LONG = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DUR = { Dining: 90, 'Spa & Wellness': 60, Transport: 60, Accommodation: 60, Activities: 90, 'Health & Fitness': 60, 'Gifts & Events': 45, Other: 45 };
const COLOR = { 'Spa & Wellness': 'spa', Dining: 'dining', Transport: 'transport', Accommodation: 'hotel', Activities: 'activity', 'Health & Fitness': 'health', 'Gifts & Events': 'gift', Other: 'other' };

// ---------- даты по Парижу ----------
const pad = (n) => String(n).padStart(2, '0');
const P = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  .formatToParts(d).map((x) => [x.type, x.value]));
const dayOf = (iso) => { const p = P(new Date(iso)); return `${p.year}-${p.month}-${p.day}`; };
const minOf = (iso) => { const p = P(new Date(iso)); return (+p.hour % 24) * 60 + +p.minute; };
export const todayParis = () => dayOf(new Date().toISOString());
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const wdIdx = (ymd) => (new Date(ymd + 'T12:00:00Z').getUTCDay() + 6) % 7;
const weekStart = (ymd) => addDays(ymd, -wdIdx(ymd));
const hhmm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

// v2: выполненные видны по умолчанию — отмечены ✓ и зачёркнуты
const LS = 'cal.filters.v2';
const loadFilters = () => { try { return { req: true, trips: true, dates: true, done: true, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { req: true, trips: true, dates: true, done: true }; } };
let F = loadFilters();
const mobile = () => matchMedia('(max-width: 760px)').matches;

// ---------- события ----------
function collect(fromDay, toDay, list, compactTrips = false) {
  const ev = [];
  const inRange = (d) => d >= fromDay && d <= toDay;
  if (F.req) for (const r of list) {
    if (!r.deadline) continue;
    if (!F.done && isClosed(r.status)) continue;
    const d = dayOf(r.deadline);
    if (!inRange(d)) continue;
    const c = byId('clients', r.client_id);
    const m = minOf(r.deadline);
    const allDay = m === 0;
    const kind = statusOf(r.status)?.kind;
    ev.push({
      id: 'r:' + r.id, kind: 'req', ref: r.id, day: d, start: allDay ? null : m, dur: DUR[r.category] || 60,
      color: COLOR[r.category] || 'other', icon: kind === 'done' ? '✓' : CATEGORIES[r.category] || '📌', title: r.summary, who: c?.name || '',
      client: c, vip: c?.vip, warn: c && (c.allergies?.length || c.diet?.length || c.health?.length || c.dislikes?.length),
      urgent: r.urgency === 'critical' || r.urgency === 'high', critical: r.urgency === 'critical',
      late: !isClosed(r.status) && new Date(r.deadline) < new Date(), done: kind === 'done', cancelled: kind === 'archive',
      sub: statusLabel(effectiveStatus(r.status)), urgency: r.urgency,
    });
  }
  if (F.trips) for (const t of state.trips) {
    const c = byId('clients', t.client_id);
    const who = c?.name || '';
    for (const [at, num, dir] of [[t.flight_in_at, t.flight_in, 'in'], [t.flight_out_at, t.flight_out, 'out']]) {
      if (!at || !inRange(dayOf(at))) continue;
      ev.push({ id: `f:${t.id}:${dir}`, kind: 'trip', ref: t.id, day: dayOf(at), start: minOf(at), dur: 40, color: 'flight',
        icon: dir === 'in' ? '🛬' : '🛫', title: `${dir === 'in' ? 'Прилёт' : 'Вылет'}${num ? ' ' + num : ''} · ${t.city}`, who, client: c, vip: c?.vip });
    }
    if (t.start_date) {
      const e = t.end_date || t.start_date;
      for (let d = t.start_date; d <= e; d = addDays(d, 1)) {
        if (!inRange(d)) continue;
        if (compactTrips && d !== t.start_date && d !== e) continue; // в месяце — только заезд и выезд
        ev.push({ id: `t:${t.id}:${d}`, kind: 'trip', ref: t.id, day: d, start: null, color: 'trip', icon: d === t.start_date ? '✈️' : d === e ? '🏁' : '📍',
          title: `${t.city}${d === t.start_date ? ' · заезд' : d === e ? ' · выезд' : ''}`, who, client: c, vip: c?.vip, bar: true });
      }
    }
  }
  if (F.dates) {
    const add = (date, title, who, kind, ref, icon) => {
      if (!date) return;
      const [, m, dd] = date.split('-');
      for (const y of new Set([fromDay.slice(0, 4), toDay.slice(0, 4)])) {
        const d = `${y}-${m}-${dd}`;
        if (inRange(d)) ev.push({ id: `d:${kind}:${ref}:${d}`, kind, ref, day: d, start: null, color: 'date', icon, title, who });
      }
    };
    for (const c of state.clients) add(c.birthday, 'День рождения', c.name, 'bday', c.id, '🎂');
    for (const p of state.people) add(p.birthday, `ДР · ${p.name}`, byId('clients', p.client_id)?.name || '', 'person', p.id, '🎂');
    for (const x of state.client_dates) add(x.date, x.title, byId('clients', x.client_id)?.name || '', 'date', x.id, '📅');
  }
  return ev;
}

// раскладка пересекающихся событий по колонкам
function lanes(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.dur - a.dur);
  let group = [], end = -1;
  const flush = () => { const cols = []; for (const e of group) { let i = cols.findIndex((last) => last <= e.start); if (i < 0) { i = cols.length; cols.push(0); } cols[i] = e.start + e.dur; e.lane = i; } group.forEach((e) => (e.lanes = cols.length)); };
  for (const e of sorted) { if (e.start >= end && group.length) { flush(); group = []; } group.push(e); end = Math.max(end, e.start + e.dur); }
  if (group.length) flush();
  return sorted;
}

const evClass = (e) => `ev c-${e.color}${e.late ? ' late' : ''}${e.done ? ' done' : ''}${e.cancelled ? ' cancelled' : ''}${e.critical ? ' crit' : ''}`;
const evAttrs = (e) => `data-ev="${esc(e.id)}" data-kind="${e.kind}" data-ref="${esc(e.ref)}"`;

function timedEvent(e) {
  const top = ((e.start - H0 * 60) / 60) * HOUR_PX;
  const h = Math.max(26, (e.dur / 60) * HOUR_PX - 4);
  const w = 100 / (e.lanes || 1);
  const compact = h < 50;
  return `<button type="button" class="${evClass(e)}${compact ? ' compact' : ''}" ${evAttrs(e)}
    style="top:${top}px;height:${h}px;left:calc(${w * (e.lane || 0)}% + 2px);width:calc(${w}% - 4px)">
    <span class="ev-t">${e.icon} ${esc(e.title)}</span>
    ${e.who ? `<span class="ev-who">${e.client ? avatar(e.client, 'av-xs') : ''}${esc(e.who)}${e.vip ? ' <span class="vip">★</span>' : ''}${e.warn ? ' <span class="warn-dot">⚠</span>' : ''}</span>` : ''}
    ${!compact ? `<span class="ev-time">🕗 ${hhmm(e.start)}${e.kind === 'req' ? ` · ${esc(e.sub)}` : ''}</span>` : ''}
  </button>`;
}
const chip = (e) => `<button type="button" class="${evClass(e)} chipev${e.bar ? ' bar' : ''}" ${evAttrs(e)} title="${esc(e.title)}${e.who ? ' — ' + esc(e.who) : ''}">
  <span>${e.icon}</span><span class="chip-t">${e.who ? `<b>${esc(e.who.replace(/\s*\(.*?\)/g, ''))}</b> · ` : ''}${esc(e.title)}</span></button>`;

// ---------- неделя / день ----------
function timeGrid(days, ev) {
  const today = todayParis();
  const nowMin = minOf(new Date().toISOString());
  const hours = []; for (let h = H0; h < H1; h++) hours.push(h);
  const allDay = days.map((d) => ev.filter((e) => e.day === d && e.start == null));
  const hasAllDay = allDay.some((x) => x.length);
  return `<div class="tg" style="--cols:${days.length};--hpx:${HOUR_PX}px">
    <div class="tg-head"><div class="tg-gutter">${'GMT+1'}</div>${days.map((d) => {
      const [, m, dd] = d.split('-');
      return `<button type="button" class="tg-day${d === today ? ' today' : ''}" data-goday="${d}"><small>${WD[wdIdx(d)]}</small><b>${+dd}</b>${days.length === 1 ? `<small>${MONTHS_GEN[+m - 1]}</small>` : ''}</button>`;
    }).join('')}</div>
    ${hasAllDay ? `<div class="tg-allday"><div class="tg-gutter">весь день</div>${allDay.map((list) => `<div class="tg-adcell">${list.map(chip).join('')}</div>`).join('')}</div>` : ''}
    <div class="tg-scroll" id="tgScroll">
      <div class="tg-body" style="height:${(H1 - H0) * HOUR_PX}px">
        <div class="tg-gutter">${hours.map((h) => `<span style="top:${(h - H0) * HOUR_PX}px">${pad(h)}:00</span>`).join('')}</div>
        ${days.map((d) => `<div class="tg-col${d === today ? ' today' : ''}" data-day="${d}">
          ${hours.map((h) => `<div class="tg-slot" style="top:${(h - H0) * HOUR_PX}px"></div>`).join('')}
          ${d === today && nowMin >= H0 * 60 ? `<div class="now-line" style="top:${((nowMin - H0 * 60) / 60) * HOUR_PX}px"></div>` : ''}
          ${lanes(ev.filter((e) => e.day === d && e.start != null).map((e) => ({ ...e, start: Math.max(e.start, H0 * 60) }))).map(timedEvent).join('')}
        </div>`).join('')}
      </div>
    </div>
  </div>`;
}

// ---------- месяц ----------
function monthGrid(anchor, ev) {
  const first = anchor.slice(0, 8) + '01';
  const start = weekStart(first);
  const today = todayParis();
  const cells = []; for (let i = 0; i < 42; i++) cells.push(addDays(start, i));
  const [fy, fm] = first.split('-').map(Number);
  const last = new Date(Date.UTC(fy, fm, 0)).toISOString().slice(0, 10);
  const rows = Math.ceil((cells.indexOf(last) + 1) / 7);
  return `<div class="mg"><div class="mg-wd">${WD.map((w) => `<span>${w}</span>`).join('')}</div>
    <div class="mg-grid">${cells.slice(0, rows * 7).map((d) => {
      const prio = { req: 0, trip: 1, bday: 2, person: 2, date: 2 };
      const list = ev.filter((e) => e.day === d).sort((a, b) => prio[a.kind] - prio[b.kind] || (a.bar ? 1 : 0) - (b.bar ? 1 : 0) || (a.start ?? -1) - (b.start ?? -1));
      const other = d.slice(0, 7) !== first.slice(0, 7);
      return `<div class="mg-cell${other ? ' other' : ''}${d === today ? ' today' : ''}" data-day="${d}">
        <button type="button" class="mg-num" data-goday="${d}">${+d.slice(8)}</button>
        <div class="mg-evs">${list.slice(0, 3).map((e) => chip(e)).join('')}${list.length > 3 ? `<button type="button" class="mg-more" data-goday="${d}">ещё ${list.length - 3}</button>` : ''}</div>
        ${list.length ? `<span class="mg-dots">${list.slice(0, 5).map((e) => `<i class="c-${e.color}"></i>`).join('')}</span>` : ''}
      </div>`;
    }).join('')}</div></div>`;
}

// ---------- повестка (неделя на телефоне) ----------
function agenda(days, ev) {
  const today = todayParis();
  return `<div class="agenda">${days.map((d) => {
    const list = ev.filter((e) => e.day === d).sort((a, b) => (a.start ?? -1) - (b.start ?? -1));
    return `<section class="ag-day${d === today ? ' today' : ''}"><button type="button" class="ag-head" data-goday="${d}"><b>${+d.slice(8)}</b><span>${WD_LONG[wdIdx(d)]}</span></button>
      <div class="ag-list">${list.length ? list.map((e) => `<button type="button" class="${evClass(e)} ag-ev" ${evAttrs(e)}>
        <span class="ag-time">${e.start == null ? 'весь день' : hhmm(e.start)}</span>
        <span class="ag-main"><b>${e.icon} ${esc(e.title)}</b>${e.who ? `<small>${esc(e.who)}${e.vip ? ' ★' : ''}${e.warn ? ' · ⚠' : ''}</small>` : ''}</span></button>`).join('')
        : `<button type="button" class="ag-empty" data-newat="${d}T10:00">Свободно · ＋ запрос</button>`}</div></section>`;
  }).join('')}</div>`;
}

// ---------- общий вид ----------
export function calendarView(list) {
  const mode = ui.calMode || (mobile() ? 'day' : 'week');
  const anchor = ui.calDate || todayParis();
  let from, to, days = [];
  if (mode === 'day') { from = to = anchor; days = [anchor]; }
  else if (mode === 'week') { from = weekStart(anchor); to = addDays(from, 6); for (let i = 0; i < 7; i++) days.push(addDays(from, i)); }
  else { from = weekStart(anchor.slice(0, 8) + '01'); to = addDays(from, 41); }
  const ev = collect(from, to, list, mode === 'month');
  const [y, m, d] = anchor.split('-').map(Number);
  const title = mode === 'month' ? `${MONTHS[m - 1]} ${y}`
    : mode === 'day' ? `${d} ${MONTHS_GEN[m - 1]}, ${WD_LONG[wdIdx(anchor)]}`
    : (() => { const [, m1, d1] = from.split('-').map(Number); const [, m2, d2] = to.split('-').map(Number); return m1 === m2 ? `${d1}–${d2} ${MONTHS_GEN[m1 - 1]}` : `${d1} ${MONTHS_GEN[m1 - 1]} – ${d2} ${MONTHS_GEN[m2 - 1]}`; })();
  const strip = mode === 'day' ? (() => { const ws = weekStart(anchor); const t = todayParis(); return `<div class="daystrip">${[0, 1, 2, 3, 4, 5, 6].map((i) => {
    const dd = addDays(ws, i); const n = collect(dd, dd, list).length;
    return `<button type="button" class="ds${dd === anchor ? ' on' : ''}${dd === t ? ' today' : ''}" data-goday="${dd}"><small>${WD[i]}</small><b>${+dd.slice(8)}</b><i>${n ? '•'.repeat(Math.min(n, 3)) : ''}</i></button>`;
  }).join('')}</div>`; })() : '';
  const body = mode === 'month' ? monthGrid(anchor, ev) : mode === 'week' && mobile() ? agenda(days, ev) : timeGrid(days, ev);
  const count = ev.filter((e) => e.kind === 'req').length;
  return `<section class="cal">
    <header class="cal-top">
      <div class="cal-nav">
        <button type="button" class="icon-btn" data-calnav="-1" aria-label="Назад">‹</button>
        <h2 class="cal-title">${esc(title)}</h2>
        <button type="button" class="icon-btn" data-calnav="1" aria-label="Вперёд">›</button>
        <button type="button" class="btn small" data-caltoday>Сегодня</button>
      </div>
      <div class="cal-right">
      ${mode !== 'month' && !(mode === 'week' && mobile()) ? `<div class="zoom" role="group" aria-label="Масштаб сетки">
        <button type="button" class="icon-btn" data-zoom="-1" aria-label="Отдалить"${ZOOMS.indexOf(zoom) === 0 ? ' disabled' : ''}>−</button>
        <span class="zoom-v">${Math.round((zoom / 64) * 100)}%</span>
        <button type="button" class="icon-btn" data-zoom="1" aria-label="Приблизить"${ZOOMS.indexOf(zoom) === ZOOMS.length - 1 ? ' disabled' : ''}>+</button>
      </div>` : ''}
      <div class="seg cal-modes" role="tablist" aria-label="Режим календаря">
        ${[['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц']].map(([k, l]) => `<button type="button" data-calmode="${k}" aria-selected="${k === mode}">${l}</button>`).join('')}
      </div>
      </div>
    </header>
    <div class="cal-filters">
      ${[['req', 'Запросы', 'dining'], ['trips', 'Поездки и рейсы', 'flight'], ['dates', 'Дни рождения и даты', 'date'], ['done', 'Выполненные', 'other']].map(([k, l, c]) =>
        `<button type="button" class="cf${F[k] ? ' on' : ''}" data-calf="${k}"><i class="c-${c}"></i>${l}</button>`).join('')}
      <span class="cal-count">${count ? `запросов: ${count}` : ''}</span>
    </div>
    ${strip}
    ${body}
    <p class="hint cal-hint">${mode === 'month' ? 'Нажмите на число — откроется день.' : 'Нажмите на пустое время — новый запрос на это время. Запрос можно перетащить на другой день или час.'}</p>
  </section>`;
}

// ---------- действия ----------
export function bindCalendar(app) {
  const cal = app.querySelector('.cal');
  if (!cal) return;
  const go = (patch) => { Object.assign(ui, patch); render(); };
  cal.querySelectorAll('[data-calmode]').forEach((b) => b.onclick = () => go({ calMode: b.dataset.calmode }));
  cal.querySelector('[data-caltoday]').onclick = () => go({ calDate: todayParis() });
  cal.querySelectorAll('[data-calnav]').forEach((b) => b.onclick = () => {
    const mode = ui.calMode || (mobile() ? 'day' : 'week');
    const a = ui.calDate || todayParis(); const k = +b.dataset.calnav;
    if (mode === 'day') go({ calDate: addDays(a, k) });
    else if (mode === 'week') go({ calDate: addDays(a, 7 * k) });
    else { const [y, m] = a.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1 + k, 1)); go({ calDate: dt.toISOString().slice(0, 10) }); }
  });
  cal.querySelectorAll('[data-calf]').forEach((b) => b.onclick = () => {
    F[b.dataset.calf] = !F[b.dataset.calf];
    try { localStorage.setItem(LS, JSON.stringify(F)); } catch {}
    render();
  });
  cal.querySelectorAll('[data-goday]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); go({ calDate: b.dataset.goday, calMode: 'day' }); });
  cal.querySelectorAll('.mg-cell').forEach((c) => c.addEventListener('click', (e) => { if (!e.target.closest('[data-ev],[data-goday]')) go({ calDate: c.dataset.day, calMode: 'day' }); }));
  cal.querySelectorAll('[data-newat]').forEach((b) => b.onclick = () => editRequest(null, null, { deadline: fromParisInput(b.dataset.newat) }));
  // открыть событие
  cal.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ev]');
    if (!b || justDragged) return;
    const { kind, ref } = b.dataset;
    if (kind === 'req') editRequest(ref);
    else if (kind === 'trip') editTrip(ref);
    else if (kind === 'person') editPerson(ref);
    else if (kind === 'date') editDate(ref);
    else if (kind === 'bday') { ui.tab = 'clients'; ui.client = ref; ui.ctab = 'dates'; render(); scrollTo(0, 0); }
  });
  // клик по пустому времени — новый запрос
  cal.querySelectorAll('.tg-col').forEach((col) => col.addEventListener('click', (e) => {
    if (e.target.closest('[data-ev]') || justDragged) return;
    const r = col.getBoundingClientRect();
    const min = Math.round(((e.clientY - r.top) / HOUR_PX * 60 + H0 * 60) / 30) * 30;
    editRequest(null, null, { deadline: fromParisInput(`${col.dataset.day}T${hhmm(Math.min(min, 23 * 60 + 30))}`) });
  }));
  // масштаб: держим в центре то же время
  const setZoom = (dir) => {
    const i = Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + dir));
    if (ZOOMS[i] === zoom) return;
    const box = cal.querySelector('#tgScroll');
    if (box) keepMinute = H0 * 60 + ((box.scrollTop + box.clientHeight / 2) / HOUR_PX) * 60;
    zoom = HOUR_PX = ZOOMS[i];
    try { localStorage.setItem('cal.zoom', String(zoom)); } catch {}
    render();
  };
  cal.querySelectorAll('[data-zoom]').forEach((b) => b.onclick = () => setZoom(+b.dataset.zoom));
  // Ctrl/⌘ + колесо или щипок на тачпаде тоже меняют масштаб
  const scBox = cal.querySelector('#tgScroll');
  let wheelLock = 0;
  scBox?.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (Date.now() - wheelLock < 180) return;
    wheelLock = Date.now();
    setZoom(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  // прокрутка к 8:00 или к текущему времени
  const sc = cal.querySelector('#tgScroll');
  if (sc && keepMinute != null) {
    sc.scrollTop = ((keepMinute - H0 * 60) / 60) * HOUR_PX - sc.clientHeight / 2;
    sc.dataset.scrolled = '1';
    keepMinute = null;
  }
  if (sc && !sc.dataset.scrolled) {
    const nowMin = minOf(new Date().toISOString());
    const target = (ui.calDate || todayParis()) === todayParis() && nowMin > 9 * 60 ? nowMin - 90 : 8 * 60;
    sc.scrollTop = ((target - H0 * 60) / 60) * HOUR_PX;
    sc.dataset.scrolled = '1';
  }
  enableEventDrag(cal);
}

// перетаскивание запроса на другое время или день (шаг 15 минут)
let justDragged = false, calDragging = false;
document.addEventListener('touchmove', (e) => { if (calDragging) e.preventDefault(); }, { passive: false });
function enableEventDrag(cal) {
  cal.querySelectorAll('.tg-col .ev[data-kind="req"]').forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const touch = e.pointerType !== 'mouse';
      const sx = e.clientX, sy = e.clientY;
      const startTop = parseFloat(el.style.top);
      let active = false, timer = null, targetCol = el.closest('.tg-col'), newMin = null;
      const begin = () => { active = true; calDragging = true; el.classList.add('dragging'); el.setPointerCapture?.(e.pointerId); if (navigator.vibrate) navigator.vibrate(10); };
      const move = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!active) { if (touch) { if (Math.hypot(dx, dy) > 8) cleanup(); return; } if (Math.hypot(dx, dy) > 5) begin(); else return; }
        ev.preventDefault();
        const snapped = Math.round(((startTop + dy) / HOUR_PX * 60) / 15) * 15;
        newMin = Math.max(0, Math.min((H1 - H0) * 60 - 15, snapped)) + H0 * 60;
        el.style.top = ((newMin - H0 * 60) / 60) * HOUR_PX + 'px';
        el.querySelector('.ev-time') && (el.querySelector('.ev-time').textContent = '🕗 ' + hhmm(newMin));
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tg-col');
        if (over && over !== targetCol) { targetCol = over; over.append(el); }
      };
      const cleanup = () => { calDragging = false; clearTimeout(timer); removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', cleanup); };
      const up = async () => {
        cleanup();
        if (!active) return;
        el.classList.remove('dragging');
        justDragged = true; setTimeout(() => { justDragged = false; }, 80);
        if (newMin == null) return;
        const id = el.dataset.ref;
        const r = byId('requests', id);
        const iso = fromParisInput(`${targetCol.dataset.day}T${hhmm(newMin)}`);
        if (!r || iso === r.deadline) return render();
        const before = r.deadline;
        try {
          await save('requests', id, { deadline: iso });
          toast(`Перенесено: ${r.summary} → ${hhmm(newMin)}`, '', { label: 'Отменить', fn: () => save('requests', id, { deadline: before }) });
        } catch (err) { toast('Не удалось перенести: ' + (err.message || err), 'err'); render(); }
      };
      addEventListener('pointermove', move, { passive: false });
      addEventListener('pointerup', up);
      addEventListener('pointercancel', cleanup);
      if (touch) timer = setTimeout(begin, 380);
    });
  });
}

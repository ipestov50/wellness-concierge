// Public guest trip page. Standalone: no app imports.
// All NEW user-facing strings live here so they are easy to polish.
const COPY = {
  wa: 'Добрый день. Есть вопрос по вашему путешествию ({city}, {range}), день {day}{event}.',
  waEvent: ' — «{event}»',
  careRain: 'Ожидается дождь — пригодится зонт. Если понадобится сухой трансфер, скажите нам заранее.',
  careSnow: 'Ожидается снег — тёплая одежда не помешает. Если нужен трансфер, напишите нам заранее.',
  careStorm: 'Возможна гроза — следим за прогнозом и, если понадобится, предложим гибкую замену.',
  inDays: 'Через {n} дн.', tomorrow: 'Завтра', today: 'Сегодня',
  dayOf: 'Сегодня · День {x} из {y}', ended: 'Поездка завершена',
  events: '{n} {word}',
  copyPnr: 'Копировать PNR', copyRef: 'Скопировать номер брони', copied: 'Скопировано',
  copiedLive: 'Номер брони скопирован', copyFail: 'Не удалось скопировать. Номер можно выделить вручную',
  anchorTag: 'Перелёт',
  clockAria: 'Местное время', clockLocal: 'местное время · {city}', clockLocalBare: 'местное время',
  liveOn: 'Обновляется в реальном времени', liveOff: 'Нет связи · показаны последние данные',
  updated: 'Обновлено консьержем', dayUpdated: 'есть обновления', updatedLive: 'Маршрут обновлён консьержем',
  noteLabel: '✦ Заметка консьержа',
  arrive: 'Прилёт · {city}', depart: 'Вылет · {city}', checkInFrom: 'Заезд с {t}', bookingN: 'Бронь {ref}',
  hotelLabel: 'Ваше проживание', copyAddr: 'Скопировать адрес', copiedAddr: 'Адрес скопирован',
  copyAddrFail: 'Не удалось скопировать. Адрес можно выделить вручную', openMap: 'Открыть на карте ↗',
  routeMap: 'Маршрут на карте ↗', routeFrom: 'Откуда', routeTo: 'Куда', driver: 'Ваш водитель: {name}',
  guestsN: '{n} {w}', luggageN: '{n} {w} багажа', routeDesc: 'Маршрут: {a} → {b}',
};
const GUEST_W = ['гость', 'гостя', 'гостей'], BAG_W = ['место', 'места', 'мест'];
const REFRESH_MS = 15000, BADGE_MS = 30000, FRESH_MS = 24 * 36e5;
const plural = (n, [a, b, c]) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; };
const fill = (t, o) => t.replace(/\{(\w+)\}/g, (_, k) => o[k] ?? '');

const $ = (s) => document.querySelector(s);
const app = $('#app'), dock = $('#dock'), live = $('#live');
const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1', LIVE = DEMO && params.get('live') === '1';
const token = (location.pathname.match(/\/t\/([^/?#]+)/) || [])[1] || '';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const P = {
  key: '<path d="M8 12.5a4.5 4.5 0 1 1 3.9-2.3L21 19.5V22h-3v-2h-2v-2h-2l-2.7-2.7A4.5 4.5 0 0 1 8 12.5Zm-1-5.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"/>',
  Flight: '<path d="M2 14.5 21 5l-2.5 14-5-3-3 4v-5L2 14.5Z"/>',
  Hotel: '<path d="M3 20V7m0 8h18v5M21 15v-3a3 3 0 0 0-3-3h-8v6"/><circle cx="6.5" cy="11" r="1.5"/>',
  Dining: '<path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 21V3c-2 1-3 4-3 8h3"/>',
  Spa: '<path d="M12 21c-4 0-8-3-8-8 4 0 7 2 8 5 1-3 4-5 8-5 0 5-4 8-8 8ZM12 3c2 2 3 4 3 6s-1 4-3 6c-2-2-3-4-3-6s1-4 3-6Z"/>',
  Transport: '<path d="M4 16V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8H4Zm0 0v2m16-2v2M4 11h16"/><circle cx="8" cy="14" r=".6"/><circle cx="16" cy="14" r=".6"/>',
  Activities: '<path d="m12 3 2.7 5.8 6.3.8-4.6 4.3 1.2 6.3L12 17.1 6.4 20.2l1.2-6.3L3 9.6l6.3-.8L12 3Z"/>',
  Gift: '<path d="M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9c-3 0-4.5-4-2-5s4 3 2 5Zm0 0c3 0 4.5-4 2-5s-4 3-2 5Z"/>',
  Other: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5m0 3v.01"/>',
  pin: '<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  wa: '<path d="M4 20l1.3-4.2A8 8 0 1 1 8.300 18.800L4 20Z"/><path d="M9 9c0 3 3 6 6 6l1.200-1.500-2-1-.8.8c-1-.4-2-1.400-2.400-2.400l.8-.8-1-2L9 9Z"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  rain: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2M16 14v6M8 14v6M12 16v6"/>',
  snow: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01"/>',
  fog: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2M16 17H7M17 21H9"/>',
  storm: '<path d="M6 16.3A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 .5 8.97M13 12l-3 5h4l-3 5"/>',
  cal: '<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 10h18M12 13.5v4.5M9.750 15.750h4.500"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.500 1.500M17.500 17.500 19 19M5 19l1.500-1.500M17.500 6.500 19 5"/>',
};
const CAT_ICON = { 'Flight': 'Flight', 'Hotel': 'Hotel', 'Accommodation': 'Hotel', 'Dining': 'Dining', 'Spa & Wellness': 'Spa', 'Health & Fitness': 'Spa', 'Transport': 'Transport', 'Activities': 'Activities', 'Gifts & Events': 'Gift' };
const CAT_RU = { 'Flight': 'Перелёт', 'Hotel': 'Проживание', 'Accommodation': 'Проживание', 'Dining': 'Ресторан', 'Spa & Wellness': 'Спа и велнес', 'Health & Fitness': 'Здоровье и спорт', 'Transport': 'Трансфер', 'Activities': 'Впечатления', 'Gifts & Events': 'Подарки и события', 'Other': 'Прочее' };
const svg = (k, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[k] || P.Other}</svg>`;

let data = null, activeDate = null, clockTimer = null, copyTimer = null, userPicked = false, lastSig = '';
// live sync state
let lastOk = true, inflight = false, pollTimer = null, lastFetch = 0, prevMap = null, tripKey = '', entering = new Set(), dayDots = new Set();
const badgeSet = new Set(), badgeTimers = new Map();
const sigOf = (date, it) => `${date}|${it.time || ''}|${it.title || ''}`;
const dkey = (sig, it) => sig + '#' + (it.updatedAt || '');
const dismissed = (() => { try { return new Set(JSON.parse(sessionStorage.getItem('portalSeen') || '[]')); } catch { return new Set(); } })();
const saveDismissed = () => { try { sessionStorage.setItem('portalSeen', JSON.stringify([...dismissed].slice(-200))); } catch {} };
const isFresh = (t) => { const ms = Date.parse(t); return Number.isFinite(ms) && Date.now() - ms <= FRESH_MS && ms - Date.now() < 3e5; };
function collect(j) {
  const m = new Map();
  (j.days || []).forEach((d) => (d.items || []).forEach((it) => {
    if (!it) return;
    const sig = sigOf(d.date, it);
    m.set(sig, { fp: it.updatedAt || JSON.stringify(it), date: d.date, dk: dkey(sig, it), fresh: isFresh(it.updatedAt) });
  }));
  return m;
}
function dropBadge(sig, remember) {
  badgeSet.delete(sig); clearTimeout(badgeTimers.get(sig)); badgeTimers.delete(sig);
  document.querySelectorAll('.card').forEach((c) => { if (c.dataset.sig === sig) { const b = c.querySelector('.upd'); if (b) b.remove(); } });
  if (remember) { dismissed.add(remember); saveDismissed(); }
}
function markUpdated(sig, e) {
  if (dismissed.has(e.dk)) return;
  badgeSet.add(sig); clearTimeout(badgeTimers.get(sig));
  badgeTimers.set(sig, setTimeout(() => dropBadge(sig, e.dk), BADGE_MS));
  if (e.date !== activeDate) dayDots.add(e.date);
}
function setLive(ok) {
  const el = $('#lv'); if (!el) return;
  el.classList.toggle('off', !ok);
  el.querySelector('span').textContent = ok ? COPY.liveOn : COPY.liveOff;
}

/* ---------- dates ---------- */
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const parts = (d) => String(d || '').split('-').map(Number);
const shortDate = (d) => { const [, m, day] = parts(d); return m ? `${day} ${MONTHS[m - 1]}` : ''; };
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const dayNum = (d) => { const [y, m, x] = parts(d); return Math.round(Date.UTC(y, m - 1, x) / 864e5); };
const weekday = (d) => { const [y, m, x] = parts(d); return WD[new Date(Date.UTC(y, m - 1, x)).getUTCDay()]; };
const addDays = (d, n) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0, 10);
function weatherKind(w) {
  if (!w) return '';
  if (['clear', 'cloud', 'rain', 'snow', 'fog', 'storm'].includes(w.kind)) return w.kind;
  const c = Number(w.code), t = String(w.text || '').toLowerCase();
  if (Number.isFinite(c) && w.code !== null && w.code !== '') {
    if (c >= 95) return 'storm';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
    if (c === 45 || c === 48) return 'fog';
    if (c === 2 || c === 3) return 'cloud';
    if (c <= 1) return 'clear';
  }
  if (/гроз/.test(t)) return 'storm';
  if (/снег|снеж/.test(t)) return 'snow';
  if (/дожд|ливн|морос|ливень/.test(t)) return 'rain';
  if (/туман|дымк/.test(t)) return 'fog';
  if (/облач|пасмур/.test(t)) return 'cloud';
  return /ясно|солнеч/.test(t) ? 'clear' : 'cloud';
}
const KIND_ICON = { clear: 'sun', cloud: 'cloud', rain: 'rain', snow: 'snow', fog: 'fog', storm: 'storm' };
function careNote() {
  const w = data.weather;
  if (!w) return '';
  const today = todayIn(data.trip.tz), daily = Array.isArray(w.daily) ? w.daily : [];
  const e = daily.find((x) => x && x.date === activeDate);
  const ks = [];
  if (e) ks.push(weatherKind(e));
  if (activeDate === today || !daily.length) ks.push(weatherKind(w));
  const k = ['storm', 'snow', 'rain'].find((x) => ks.includes(x));
  return k ? COPY[{ storm: 'careStorm', snow: 'careSnow', rain: 'careRain' }[k]] : '';
}
function itemDates() {
  const ds = data.days.filter((d) => (d.items || []).length).map((d) => d.date).filter(Boolean).sort();
  return ds.length ? ds : data.days.map((d) => d.date).filter(Boolean).sort();
}
function rangeText() {
  const ds = itemDates();
  if (!ds.length) return '';
  const a = shortDate(ds[0]), b = shortDate(ds[ds.length - 1]);
  return a === b ? a : `${a} – ${b}`;
}
function statusText(today) {
  const ds = data.days.map((d) => d.date).filter(Boolean).sort();
  if (!ds.length) return '';
  let t;
  if (today < ds[0]) {
    const n = dayNum(ds[0]) - dayNum(today);
    t = n <= 0 ? COPY.today : n === 1 ? COPY.tomorrow : fill(COPY.inDays, { n });
  } else if (today > ds[ds.length - 1]) return COPY.ended;
  else t = fill(COPY.dayOf, { x: ds.filter((d) => d <= today).length, y: ds.length });
  const ev = data.days.reduce((n, d) => n + (d.items || []).filter((i) => i.kind === 'request').length, 0);
  return ev ? `${t} · ${fill(COPY.events, { n: ev, word: plural(ev, ['событие', 'события', 'событий']) })}`: t;
}
function todayIn(tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}
function greetingIn(tz) {
  let h;
  try { h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, hour: '2-digit', hour12: false }).format(new Date())) % 24; }
  catch { h = new Date().getHours(); }
  return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
}

/* ---------- views ---------- */
function stateView(title, text, retry) {
  clearTimeout(clockTimer);
  dock.hidden = true;
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `<div class="state"><svg class="key" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${P.key}</svg><h1>${esc(title)}</h1><p>${esc(text)}</p>${retry ? '<button class="btn" id="retry" type="button">Попробовать снова</button>' : ''}</div>`;
  if (retry) $('#retry').onclick = load;
}

function render() {
  const { guest, trip, weather, days } = data;
  const name = guest && guest.firstName ? esc(guest.firstName) : '';
  const country = trip.country && !String(trip.title || '').toLowerCase().includes(String(trip.country).toLowerCase()) ? esc(trip.country) : '';
  const range = rangeText();
  const status = statusText(todayIn(trip.tz));
  const wk = weather ? weatherKind(weather) : '';
  const today = todayIn(trip.tz);
  if (!activeDate || !days.some((d) => d.date === activeDate)) {
    activeDate = days.some((d) => d.date === today) ? today : (days[0] && days[0].date) || null;
  }
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `
    <header class="hero">
      <div class="brand"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${P.key}</svg>Les Clefs d’Or <span>· Personal Concierge</span></div>
      <div style="height:28px"></div>
      ${name ? `<p class="greet">${greetingIn(trip.tz)}, ${name}</p>` : ''}
      <h1>${esc(trip.title || 'Ваше путешествие')}</h1>
      <div class="meta">
        ${status ? `<span class="pill badge" id="status">${esc(status)}</span>` : ''}
        ${range ? `<span class="pill tnum">${esc(range)}</span>` : ''}
        ${weather && Number.isFinite(Number(weather.tempC)) ? `<span class="pill">${svg(KIND_ICON[wk] || 'cloud')}<span class="tnum">${esc(Math.round(weather.tempC))}°</span> ${esc(weather.text || '')}</span>` : ''}
        ${country ? `<span class="muted small">${country}</span>` : ''}
      </div>
      <p class="care" id="care" hidden></p>
      <div class="clock"><b id="clk" role="img" aria-label="${COPY.clockAria}"><span class="hh">--</span><span class="colon">:</span><span class="mm">--</span></b><small>${esc(String(trip.city || '').trim() ? fill(COPY.clockLocal, { city: String(trip.city).trim() }) : COPY.clockLocalBare)}</small></div>
      <div class="livebar" id="lv"><i class="dot" aria-hidden="true"></i><span>${COPY.liveOn}</span></div>
    </header>
    <div class="tabsbar"><div class="tabs" role="tablist" aria-label="Дни путешествия" id="tabs"><span class="ind" id="ind"></span>
      ${days.map((d, i) => `<button class="tab${d.date === today ? ' today' : ''}${dayDots.has(d.date) && d.date !== activeDate ? ' upd' : ''}" role="tab" id="t-${esc(d.date)}" data-date="${esc(d.date)}" aria-selected="${d.date === activeDate}" tabindex="${d.date === activeDate ? 0 : -1}" aria-controls="panel">${esc(tabLabel(d, i))}${dayDots.has(d.date) && d.date !== activeDate ? ` <span class="sr">· ${COPY.dayUpdated}</span>` : ''}</button>`).join('')}
    </div></div>
    <section id="panel" role="tabpanel" class="list" aria-live="polite"></section>`;
  bindTabs();
  document.querySelectorAll('.stay [data-copy]').forEach((b) => (b.onclick = () => copyRef(b)));
  renderDay();
  setCare();
  startClock(trip.tz);
  placeIndicator(false);
  setDock();
  setLive(navigator.onLine !== false && lastOk);
}

function tabLabel(d, i) {
  const ds = data.days.map((x) => x.date);
  const consecutive = ds.every((x, j) => j === 0 || dayNum(x) - dayNum(ds[j - 1]) === 1);
  return consecutive ? `День ${i + 1} · ${shortDate(d.date)}` : `${weekday(d.date)} · ${shortDate(d.date)}`;
}
function setCare() {
  const el = $('#care'); if (!el) return;
  const t = careNote();
  el.textContent = t; el.hidden = !t;
}
function waText() {
  const day = data.days.find((d) => d.date === activeDate);
  const first = day && (day.items || []).find((i) => i && i.title);
  return fill(COPY.wa, {
    city: data.trip.city || data.trip.title || '',
    range: rangeText(),
    day: activeDate ? `${weekday(activeDate)}, ${shortDate(activeDate)}` : '',
    event: first ? fill(COPY.waEvent, { event: first.title }) : '',
  }).replace(/\s+/g, ' ').replace(' .', '.');
}
function setDock() {
  const wa = data.concierge && String(data.concierge.whatsapp || '').replace(/\D/g, '');
  if (!wa) { dock.hidden = true; return; }
  dock.hidden = false;
  dock.innerHTML = `<a class="cta" href="https://wa.me/${wa}?text=${encodeURIComponent(waText())}" target="_blank" rel="noopener noreferrer">${svg('wa')}Написать консьержу</a>`;
}

function hotelCard() {
  const st = data.stay;
  if (!st) return '';
  const { name, address: addr } = st;
  const acts = [];
  if (addr) acts.push(`<button class="btn" type="button" data-copy="${esc(addr)}" data-label="${esc(COPY.copyAddr)}" data-live="${esc(COPY.copiedAddr)}" data-fail="${esc(COPY.copyAddrFail)}">${svg('copy')}<span>${esc(COPY.copyAddr)}</span></button>`);
  acts.push(`<a class="btn" href="https://maps.google.com/?q=${encodeURIComponent((name + ' ' + addr).trim())}" target="_blank" rel="noopener noreferrer">${svg('pin')}<span>${esc(COPY.openMap)}</span></a>`);
  const pills = [];
  if (st.guests > 0) pills.push(fill(COPY.guestsN, { n: st.guests, w: plural(st.guests, GUEST_W) }));
  if (st.checkInTime) pills.push(fill(COPY.checkInFrom, { t: st.checkInTime }));
  if (st.bookingReference) pills.push(fill(COPY.bookingN, { ref: st.bookingReference }));
  if (st.roomType) pills.push(st.roomType);
  if (st.checkIn && st.checkOut) pills.push(`${shortDate(st.checkIn)} – ${shortDate(st.checkOut)}`);
  else if (st.checkIn || st.checkOut) pills.push(shortDate(st.checkIn || st.checkOut));
  const note = st.note ? `<div class="note"><span class="nl">${esc(COPY.noteLabel)}</span><p>${esc(st.note)}</p></div>` : '';
  return `<section class="card stay" aria-label="${esc(COPY.hotelLabel)}">
    <div class="top"><div class="ico">${svg('Hotel')}</div><div class="cat stay-l">${esc(COPY.hotelLabel)}</div>
    <h2 class="title">${esc(name)}</h2>${addr ? `<p class="venue">${esc(addr)}</p>` : ''}
    ${pills.length ? `<div class="meta stay-meta">${pills.map((x) => `<span class="pill tnum">${esc(x)}</span>`).join('')}</div>` : ''}</div>
    <div class="perf"></div><div class="bot">${note}<div class="acts">${acts.join('')}</div></div></section>`;
}
const noteHtml = (it) => it.guestNotes ? `<div class="note"><span class="nl">${esc(COPY.noteLabel)}</span><p>${esc(it.guestNotes)}</p></div>` : '';
function transferOf(it) {
  const t = it && it.transfer;
  if (!t || typeof t !== 'object') return null;
  const pickup = String(t.pickup || '').trim(), dropoff = String(t.dropoff || '').trim();
  if (!pickup && !dropoff) return null;
  return { pickup, dropoff, pax: Math.max(0, parseInt(t.passengers, 10) || 0), bags: Math.max(0, parseInt(t.luggage, 10) || 0), driver: t.driver ? String(t.driver).trim() : '' };
}
function routeHtml(tr) {
  const stop = (cls, label, v) => v ? `<li class="stop ${cls}"><span class="sl">${esc(label)}</span><span class="sv">${esc(v)}</span></li>` : '';
  const badges = [];
  if (tr.pax) badges.push(fill(COPY.guestsN, { n: tr.pax, w: plural(tr.pax, GUEST_W) }));
  if (tr.bags) badges.push(fill(COPY.luggageN, { n: tr.bags, w: plural(tr.bags, BAG_W) }));
  const chips = badges.map((b) => `<span class="chip tnum">${esc(b)}</span>`).concat(tr.driver ? [`<span class="chip drv">${esc(fill(COPY.driver, { name: tr.driver }))}</span>`] : []);
  return `<ol class="route">${stop('from', COPY.routeFrom, tr.pickup)}${stop('to', COPY.routeTo, tr.dropoff)}</ol>${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}`;
}

const timeMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : Infinity; };
// прилёт и вылет — якорь дня: всегда первыми, дальше по времени
const isAnchor = (it) => it && it.kind === 'flight' && /^\s*(прил[её]т|вылет|arriv|depart)/i.test(String(it.title || ''));
const anchorRank = (it) => (isAnchor(it) ? 0 : 1);
function normDays(j) {
  (j.days || []).forEach((d) => { if (Array.isArray(d.items)) d.items = d.items.filter(Boolean).sort((a, b) => { const r = anchorRank(a) - anchorRank(b); if (r) return r; const x = timeMin(a.time), y = timeMin(b.time); return x === y ? 0 : x < y ? -1 : 1; }); });
  return j;
}
const shortPlace = (t) => { const v = String(t || '').split(',')[0].trim(); return v.length > 28 ? v.slice(0, 27).trimEnd() + '…' : v; };
function flightTitle(t) {
  const city = String((data && data.trip && data.trip.city) || '').trim(), k = t.toLowerCase();
  if (!city) return t;
  return k === 'прилёт' || k === 'прилет' ? fill(COPY.arrive, { city }) : k === 'вылет' ? fill(COPY.depart, { city }) : t;
}
function displayTitle(it) {
  const title = String(it.title || ''), ref = String(it.bookingReference || '').trim();
  if (it.kind === 'flight' && ref) {
    const m = /^(.*?)[\s·•—–-]+([^\s·•—–-]+)\s*$/.exec(title);
    if (m && m[2].toLowerCase() === ref.toLowerCase() && m[1].trim()) return flightTitle(m[1].trim());
  }
  if (it.kind === 'flight') return flightTitle(title.trim());
  const tr = transferOf(it);
  if (tr && tr.pickup && tr.dropoff && /^\s*(трансфер|transfer)\s*[.!:…]*\s*$/i.test(title)) return `${shortPlace(tr.pickup)} → ${shortPlace(tr.dropoff)}`;
  return title;
}
function card(it, idx, date) {
  const sig = sigOf(date, it);
  const cat = CAT_ICON[it.category] || 'Other';
  const tr = transferOf(it);
  const addr = it.address || '';
  const vName = it.venueName || '';
  const showVenue = true;
  const place = [vName, addr].filter(Boolean).join(', ');
  const rows = [];
  if (it.dressCode) rows.push(['Дресс-код', esc(it.dressCode)]);
  if (it.bookingReference) rows.push(['Бронь', `<span class="ref">${esc(it.bookingReference)}</span>`]);
  const acts = [];
  if (it.bookingReference) {
    const label = it.kind === 'flight' ? COPY.copyPnr : COPY.copyRef;
    acts.push(`<button class="btn" type="button" data-copy="${esc(it.bookingReference)}" data-label="${esc(label)}">${svg('copy')}<span>${esc(label)}</span></button>`);
  }
  if (tr && tr.pickup && tr.dropoff) acts.push(`<a class="btn" href="https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(tr.pickup)}&destination=${encodeURIComponent(tr.dropoff)}" target="_blank" rel="noopener noreferrer">${svg('pin')}<span>${esc(COPY.routeMap)}</span></a>`);
  else if (tr || place) { const q = tr ? (tr.pickup || tr.dropoff) : place; acts.push(`<a class="btn" href="https://maps.google.com/?q=${encodeURIComponent(q)}" target="_blank" rel="noopener noreferrer">${svg('pin')}<span>${tr ? esc(COPY.openMap) : 'Показать на карте ↗'}</span></a>`); }
  const upd = badgeSet.has(sig) && !dismissed.has(dkey(sig, it));
  return `<article class="card kind-${esc(it.kind || 'request')}${isAnchor(it) ? ' anchor' : ''}${tr ? ' transfer' : ''}${entering.has(sig) ? ' enter' : ''}" data-sig="${esc(sig)}">
    <div class="top">
      <div class="ico">${svg(cat)}</div>
      <div class="time tnum${it.time ? '' : ' none'}">${it.time ? esc(it.time) : 'В течение дня'}</div>
      <div class="cat">${esc(isAnchor(it) ? COPY.anchorTag : (CAT_RU[it.category] || CAT_RU.Other))}</div>
      ${upd ? `<span class="upd">✦ ${esc(COPY.updated)}</span>` : ''}
      <h2 class="title">${esc(displayTitle(it))}</h2>
      ${tr ? `<div class="routewrap">${routeHtml(tr)}</div>` : place && showVenue ? `<p class="venue">${vName ? `<b>${esc(vName)}</b>` : ''}${vName && addr ? ' · ' : ''}${esc(addr)}</p>` : ''}
    </div>
    <div class="perf"></div><div class="bot">${noteHtml(it)}${rows.length ? `<dl style="margin:0;display:grid;gap:8px">${rows.map(([k, v]) => `<div class="row"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}<div class="acts">${acts.join('')}</div></div>
  </article>`;
}

function renderDay() {
  const day = data.days.find((d) => d.date === activeDate);
  const panel = $('#panel');
  panel.setAttribute('aria-labelledby', 't-' + activeDate);
  const items = day ? day.items || [] : [];
  // перелёты — якорь дня и идут первыми; карточка проживания — сразу после них
  const nA = items.filter(isAnchor).length, cards = items.map((it, i) => card(it, i, activeDate));
  panel.innerHTML = items.length ? cards.slice(0, nA).join('') + hotelCard() + cards.slice(nA).join('') : hotelCard() + `<div class="empty"><h2>День в вашем распоряжении</h2><p>На этот день пока ничего не запланировано. Мы рядом, если захотите что-то добавить.</p></div>`;
  panel.onclick = (e) => { const c = e.target.closest('.card'); if (c && c.dataset.sig && badgeSet.has(c.dataset.sig)) { const it = items.find((x) => sigOf(activeDate, x) === c.dataset.sig); dropBadge(c.dataset.sig, it && dkey(c.dataset.sig, it)); } };
  panel.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copyRef(b)));
}

/* ---------- tabs ---------- */
// подсказка «есть ещё дни»: затухание на краю, пока вкладки можно прокрутить
function tabsFade() {
  const tb = $('#tabs');
  if (!tb) return;
  const upd = () => {
    tb.classList.toggle('fade-r', tb.scrollWidth - tb.clientWidth - tb.scrollLeft > 4);
    tb.classList.toggle('fade-l', tb.scrollLeft > 4);
  };
  upd();
  if (!tb.dataset.fade) { tb.dataset.fade = '1'; tb.addEventListener('scroll', upd, { passive: true }); }
}
function placeIndicator(animate) {
  const tabs = $('#tabs'), ind = $('#ind'), t = tabs && tabs.querySelector('[aria-selected=true]');
  if (!t) return;
  if (!animate) ind.style.transition = 'none';
  ind.style.width = t.offsetWidth + 'px';
  ind.style.transform = `translateX(${t.offsetLeft}px)`;
  if (!animate) { void ind.offsetWidth; ind.style.transition = ''; }
  t.scrollIntoView({ inline: 'center', block: 'nearest', behavior: animate && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
  tabsFade();
}
function select(date, focus) {
  activeDate = date; dayDots.delete(date);
  document.querySelectorAll('.tab').forEach((b) => {
    const on = b.dataset.date === date;
    b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1;
    if (on) { b.classList.remove('upd'); const h = b.querySelector('.sr'); if (h) h.remove(); }
    if (on && focus) b.focus();
  });
  renderDay();
  setCare();
  setDock();
  placeIndicator(true);
}
function bindTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  tabs.forEach((b, i) => {
    b.onclick = () => { userPicked = true; select(b.dataset.date); };
    b.onkeydown = (e) => {
      const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (k === undefined) return;
      e.preventDefault(); userPicked = true;
      select(tabs[(k + tabs.length) % tabs.length].dataset.date, true);
    };
  });
}

/* ---------- clock ---------- */
function startClock(tz) {
  clearTimeout(clockTimer);
  const opt = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  let f;
  try { f = new Intl.DateTimeFormat('ru-RU', { timeZone: tz || undefined, ...opt }); } catch { f = new Intl.DateTimeFormat('ru-RU', opt); }
  const tick = () => {
    const el = $('#clk');
    if (el) {
      const [hh, mm] = f.format(new Date()).split(':');
      el.querySelector('.hh').textContent = hh; el.querySelector('.mm').textContent = mm;
      el.setAttribute('aria-label', `${COPY.clockAria} ${hh}:${mm}`);
    }
    clockTimer = setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
  };
  tick();
}

/* ---------- copy ---------- */
async function copyRef(btn) {
  const text = btn.dataset.copy;
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch {} ta.remove();
  }
  if (!ok) {
    clearTimeout(copyTimer);
    live.textContent = btn.dataset.fail || COPY.copyFail;
    copyTimer = setTimeout(() => { live.textContent = ''; }, 4000);
    return;
  }
  clearTimeout(copyTimer);
  const old = document.querySelector('.btn.copied');
  if (old) resetCopy(old);
  btn.classList.add('copied');
  btn.firstElementChild.outerHTML = svg('check');
  btn.lastElementChild.textContent = COPY.copied;
  live.textContent = btn.dataset.live || COPY.copiedLive;
  copyTimer = setTimeout(() => { resetCopy(btn); live.textContent = ''; }, 1500);
}
function resetCopy(btn) {
  btn.classList.remove('copied');
  btn.firstElementChild.outerHTML = svg('copy');
  btn.lastElementChild.textContent = btn.dataset.label || COPY.copyRef;
}

/* ---------- data ---------- */
let demoState = null;
function demoData() {
  if (demoState) return structuredClone(demoState);
  const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const old = new Date(Date.now() - 5 * 864e5).toISOString(), recent = new Date(Date.now() - 2 * 36e5).toISOString();
  const e = { venueName: '', address: '', bookingReference: '', dressCode: '', guestNotes: '', updatedAt: old };
  demoState = {
    guest: { firstName: 'Анна' },
    trip: { title: 'Берлин', city: 'Берлин', country: 'Германия', start: d(2), end: d(8), tz: 'Europe/Berlin', lat: 52.52, lon: 13.4 },
    stay: { name: 'Hotel Adlon Kempinski', address: 'Unter den Linden 77, 10117 Berlin, Германия', guests: 2, checkInTime: '15:00', roomType: 'Deluxe Suite', bookingReference: 'AD-448120', note: 'Номер с видом на Бранденбургские ворота.\nРанний заезд согласован.', checkIn: d(2), checkOut: d(8) },
    weather: { tempC: 4, code: 61, text: 'Дождь', kind: 'rain', windKmh: 18, daily: [
      { date: d(2), kind: 'rain', text: 'Дождь', tMax: 5, tMin: 2 }, { date: d(3), kind: 'cloud', text: 'Облачно', tMax: 6, tMin: 1 }, { date: d(6), kind: 'clear', text: 'Ясно', tMax: 8, tMin: 0 } ] },
    days: [
      { date: d(2), items: [
        { ...e, time: '09:15', title: 'Прилёт · B43CSZ', category: 'Flight', kind: 'flight', venueName: 'Шереметьево, терминал B', bookingReference: 'B43CSZ', guestNotes: 'Приоритетная регистрация' },
        { ...e, time: '20:30', title: 'Ужин, ресторан', category: 'Dining', kind: 'request', venueName: 'Rutz', address: 'Chausseestraße 8, Berlin', bookingReference: 'RZ-5521', dressCode: 'Smart elegant', guestNotes: 'Столик у окна, без морепродуктов' } ] },
      { date: d(3), items: [
        { ...e, time: '11:00', title: 'Спа-программа «Восстановление»', category: 'Spa & Wellness', kind: 'request', venueName: 'Adlon Spa' } ] },
      { date: d(6), items: [
        { ...e, time: '18:40', title: 'Вылет · K7QD2P', category: 'Flight', kind: 'flight', venueName: 'BER, терминал 1', bookingReference: 'K7QD2P' },
        { ...e, time: '14:15', title: 'Трансфер', category: 'Transport', kind: 'request', guestNotes: 'Водитель встретит у входа', updatedAt: recent, bookingReference: 'TR-1042',
          transfer: { pickup: 'Hotel Adlon Kempinski, Unter den Linden 77, 10117 Berlin', dropoff: 'Аэропорт Берлин Бранденбург (BER), Terminal 1, Melli-Beese-Ring 1, 12529 Schönefeld', passengers: 2, luggage: 5, driver: 'Markus' } } ] },
    ],
    concierge: { whatsapp: '+49 30 1234 5678' },
    updatedAt: new Date().toISOString(),
  };
  return structuredClone(demoState);
}
function mutateDemo() {
  const now = new Date().toISOString();
  demoData();
  demoState.days[1].items.push({ time: '16:30', title: 'Прогулка по Музейному острову', category: 'Activities', kind: 'request', venueName: '', address: '', bookingReference: '', dressCode: '', guestNotes: 'Гид встретит у входа.\nВозьмите паспорт.', updatedAt: now });
  const din = demoState.days[0].items[1];
  din.guestNotes = 'Столик у окна, без морепродуктов. Шеф подготовит безглютеновое меню.'; din.updatedAt = now;
  demoState.updatedAt = now;
}

function focusDesc() {
  const a = document.activeElement;
  if (!a || a === document.body) return null;
  if (a.classList && a.classList.contains('tab')) return '#' + CSS.escape(a.id);
  if (a.dataset && a.dataset.copy !== undefined) return `[data-copy="${CSS.escape(a.dataset.copy)}"]`;
  return null;
}
function normStay(j) {
  const t = j.trip || {};
  let st = j.stay && typeof j.stay === 'object' ? j.stay : null;
  const hasHotelKind = (j.days || []).some((d) => (d.items || []).some((i) => i && i.kind === 'hotel'));
  if (!st && (t.hotel || t.hotelAddress)) st = { name: t.hotel, address: t.hotelAddress };
  if (st || hasHotelKind) (j.days || []).forEach((d) => { if (Array.isArray(d.items)) d.items = d.items.filter((i) => i && i.kind !== 'hotel'); });
  const name = st ? String(st.name || '').trim() : '';
  j.stay = st && name ? { name, address: String(st.address || '').trim(), guests: parseInt(st.guests, 10) || 0, checkInTime: /^\d{1,2}:\d{2}/.test(st.checkInTime || '') ? String(st.checkInTime).slice(0, 5) : '', roomType: String(st.roomType || '').trim(), bookingReference: String(st.bookingReference || '').trim(), note: String(st.note || '').trim(), checkIn: st.checkIn || '', checkOut: st.checkOut || '' } : null;
  return j;
}
function applyData(j, sig) {
  normStay(j);
  const key = [j.trip.start, j.trip.end, j.trip.title].join('|');
  const first = !data, changedWindow = !first && key !== tripKey;
  const cur = collect(j), y = scrollY, fd = first ? null : focusDesc();
  entering = new Set();
  let news = 0;
  if (first || changedWindow) {
    if (changedWindow) { activeDate = null; userPicked = false; dayDots.clear(); [...badgeSet].forEach((s) => dropBadge(s)); }
    cur.forEach((e, s) => { if (e.fresh && !dismissed.has(e.dk)) badgeSet.add(s); });
  } else {
    cur.forEach((e, s) => {
      const p = prevMap.get(s);
      if (!p) { entering.add(s); markUpdated(s, e); news++; } else if (p.fp !== e.fp) { markUpdated(s, e); news++; }
    });
  }
  prevMap = cur; tripKey = key; lastSig = sig;
  app.classList.toggle('norise', !first);
  data = normDays(j); render();
  entering = new Set();
  if (!first) {
    scrollTo(0, y);
    if (fd) { const el = $(fd); if (el) el.focus({ preventScroll: true }); }
    if (news && !changedWindow) { live.textContent = COPY.updatedLive; setTimeout(() => { live.textContent = ''; }, 3000); }
  }
}

async function load() {
  if (inflight) return;
  inflight = true; lastFetch = Date.now();
  try {
    let j;
    if (DEMO) j = demoData();
    else {
      if (!token) return stateView('Эта ссылка неактивна', 'Ваш консьерж с радостью пришлёт новую.');
      const r = await fetch('/api/trip-portal?token=' + encodeURIComponent(token), { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (r.status === 400 || r.status === 404) { data = null; return stateView('Эта ссылка неактивна', 'Похоже, срок её действия истёк. Ваш консьерж с радостью пришлёт новую.'); }
      if (!r.ok) throw new Error('http');
      j = await r.json();
    }
    if (!j || !j.trip || !Array.isArray(j.days)) throw new Error('shape');
    lastOk = true;
    const sig = JSON.stringify(j, function (k, v) { return this === j && k === 'updatedAt' ? undefined : v; });
    if (data && sig === lastSig) return setLive(navigator.onLine !== false);
    applyData(j, sig);
  } catch {
    lastOk = false;
    if (data) return setLive(false); // keep the last good data on a silent refresh failure
    stateView('Минуту терпения', 'Маршрут пока не открывается. Проверьте соединение и попробуйте ещё раз.', true);
  } finally { inflight = false; }
}

/* ---------- live polling ---------- */
const canPoll = () => !document.hidden && (DEMO ? LIVE : !!token);
function startPoll() { stopPoll(); if (canPoll()) pollTimer = setInterval(() => { if (canPoll()) load(); }, REFRESH_MS); }
function stopPoll() { clearInterval(pollTimer); pollTimer = null; }
function refreshNow() { if (canPoll() && Date.now() - lastFetch > 1500) load(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) stopPoll(); else { refreshNow(); startPoll(); } });
addEventListener('focus', refreshNow);
addEventListener('online', () => { lastFetch = 0; refreshNow(); });
addEventListener('offline', () => setLive(false));
addEventListener('resize', () => placeIndicator(false));
load().then(() => { startPoll(); });
if (LIVE) setTimeout(() => { mutateDemo(); load(); }, 8000);

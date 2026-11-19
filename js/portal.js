// Public guest trip page. Standalone: no app imports.
const WA_TEXT = 'Здравствуйте. Пишу по поводу моего маршрута, есть небольшой вопрос.';
const REFRESH_MS = 60000;

const $ = (s) => document.querySelector(s);
const app = $('#app'), dock = $('#dock'), live = $('#live');
const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';
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
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.500 1.500M17.500 17.500 19 19M5 19l1.500-1.500M17.500 6.500 19 5"/>',
};
const CAT_ICON = { 'Flight': 'Flight', 'Hotel': 'Hotel', 'Accommodation': 'Hotel', 'Dining': 'Dining', 'Spa & Wellness': 'Spa', 'Health & Fitness': 'Spa', 'Transport': 'Transport', 'Activities': 'Activities', 'Gifts & Events': 'Gift' };
const CAT_RU = { 'Flight': 'Перелёт', 'Hotel': 'Проживание', 'Accommodation': 'Проживание', 'Dining': 'Ресторан', 'Spa & Wellness': 'Спа и велнес', 'Health & Fitness': 'Здоровье и спорт', 'Transport': 'Трансфер', 'Activities': 'Впечатления', 'Gifts & Events': 'Подарки и события', 'Other': 'Прочее' };
const svg = (k, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[k] || P.Other}</svg>`;

let data = null, activeDate = null, clockTimer = null, copyTimer = null, userPicked = false, lastSig = '';

/* ---------- dates ---------- */
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const parts = (d) => String(d || '').split('-').map(Number);
const shortDate = (d) => { const [, m, day] = parts(d); return m ? `${day} ${MONTHS[m - 1]}` : ''; };
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
  clearInterval(clockTimer);
  dock.hidden = true;
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `<div class="state"><svg class="key" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${P.key}</svg><h1>${esc(title)}</h1><p>${esc(text)}</p>${retry ? '<button class="btn" id="retry" type="button">Попробовать снова</button>' : ''}</div>`;
  if (retry) $('#retry').onclick = load;
}

function render() {
  const { guest, trip, weather, days } = data;
  const name = guest && guest.firstName ? esc(guest.firstName) : '';
  const place = [trip.city, trip.country].filter(Boolean).map(esc).join(', ');
  const range = trip.start ? `${shortDate(trip.start)}${trip.end ? ' – ' + shortDate(trip.end) : ''}` : '';
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
        ${place ? `<span class="pill badge">${svg('pin')}${place}</span>` : ''}
        ${range ? `<span class="pill">${esc(range)}</span>` : ''}
        ${weather ? `<span class="pill">${svg('sun')}<span class="tnum">${esc(Math.round(weather.tempC))}°</span> ${esc(weather.text || '')}</span>` : ''}
      </div>
      <div class="clock"><b id="clk" aria-label="Местное время">--:--:--</b><small>местное время${trip.hotel ? ' · ' + esc(trip.hotel) : ''}</small></div>
    </header>
    <div class="tabsbar"><div class="tabs" role="tablist" aria-label="Дни путешествия" id="tabs"><span class="ind" id="ind"></span>
      ${days.map((d, i) => `<button class="tab${d.date === today ? ' today' : ''}" role="tab" id="t-${esc(d.date)}" data-date="${esc(d.date)}" aria-selected="${d.date === activeDate}" tabindex="${d.date === activeDate ? 0 : -1}" aria-controls="panel">День ${i + 1} · ${esc(shortDate(d.date))}</button>`).join('')}
    </div></div>
    <section id="panel" role="tabpanel" class="list" aria-live="polite"></section>`;
  bindTabs();
  renderDay();
  startClock(trip.tz);
  placeIndicator(false);
  setDock();
}

function setDock() {
  const wa = data.concierge && String(data.concierge.whatsapp || '').replace(/\D/g, '');
  if (!wa) { dock.hidden = true; return; }
  dock.hidden = false;
  dock.innerHTML = `<a class="cta" href="https://wa.me/${wa}?text=${encodeURIComponent(WA_TEXT)}" target="_blank" rel="noopener noreferrer">${svg('wa')}Написать консьержу</a>`;
}

function card(it) {
  const cat = CAT_ICON[it.category] || 'Other';
  const place = [it.venueName, it.address].filter(Boolean).join(', ');
  const rows = [];
  if (it.dressCode) rows.push(['Дресс-код', esc(it.dressCode)]);
  if (it.guestNotes) rows.push(['Заметка', esc(it.guestNotes)]);
  if (it.bookingReference) rows.push(['Бронь', `<span class="ref">${esc(it.bookingReference)}</span>`]);
  const acts = [];
  if (it.bookingReference) acts.push(`<button class="btn" type="button" data-copy="${esc(it.bookingReference)}">${svg('copy')}<span>Скопировать номер брони</span></button>`);
  if (place) acts.push(`<a class="btn" href="https://maps.google.com/?q=${encodeURIComponent(place)}" target="_blank" rel="noopener noreferrer">Показать на карте ↗</a>`);
  const hasBottom = rows.length || acts.length;
  return `<article class="card kind-${esc(it.kind || 'request')}">
    <div class="top">
      <div class="ico">${svg(cat)}</div>
      <div class="time tnum${it.time ? '' : ' none'}">${it.time ? esc(it.time) : 'В течение дня'}</div>
      <div class="cat">${esc(CAT_RU[it.category] || CAT_RU.Other)}</div>
      <h2 class="title">${esc(it.title)}</h2>
      ${place ? `<p class="venue">${it.venueName ? `<b>${esc(it.venueName)}</b>` : ''}${it.venueName && it.address ? ' · ' : ''}${esc(it.address || '')}</p>` : ''}
    </div>
    ${hasBottom ? `<div class="perf"></div><div class="bot">${rows.length ? `<dl style="margin:0;display:grid;gap:8px">${rows.map(([k, v]) => `<div class="row"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}${acts.length ? `<div class="acts">${acts.join('')}</div>` : ''}</div>` : ''}
  </article>`;
}

function renderDay() {
  const day = data.days.find((d) => d.date === activeDate);
  const panel = $('#panel');
  panel.setAttribute('aria-labelledby', 't-' + activeDate);
  const items = day ? day.items || [] : [];
  panel.innerHTML = items.length ? items.map(card).join('') : `<div class="empty"><h2>День в вашем распоряжении</h2><p>На этот день пока ничего не запланировано. Мы рядом, если захотите что-то добавить.</p></div>`;
  panel.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copyRef(b)));
}

/* ---------- tabs ---------- */
function placeIndicator(animate) {
  const tabs = $('#tabs'), ind = $('#ind'), t = tabs && tabs.querySelector('[aria-selected=true]');
  if (!t) return;
  if (!animate) ind.style.transition = 'none';
  ind.style.width = t.offsetWidth + 'px';
  ind.style.transform = `translateX(${t.offsetLeft}px)`;
  if (!animate) { void ind.offsetWidth; ind.style.transition = ''; }
  t.scrollIntoView({ inline: 'center', block: 'nearest', behavior: animate && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
}
function select(date, focus) {
  activeDate = date;
  document.querySelectorAll('.tab').forEach((b) => {
    const on = b.dataset.date === date;
    b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  renderDay();
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
  clearInterval(clockTimer);
  let f;
  try { f = new Intl.DateTimeFormat('ru-RU', { timeZone: tz || undefined, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
  catch { f = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
  const tick = () => { const el = $('#clk'); if (el) el.textContent = f.format(new Date()); };
  tick(); clockTimer = setInterval(tick, 1000);
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
    live.textContent = 'Не получилось скопировать — номер можно выделить вручную';
    copyTimer = setTimeout(() => { live.textContent = ''; }, 4000);
    return;
  }
  clearTimeout(copyTimer);
  const old = document.querySelector('.btn.copied');
  if (old) resetCopy(old);
  btn.classList.add('copied');
  btn.firstElementChild.outerHTML = svg('check');
  btn.lastElementChild.textContent = 'Скопировано';
  live.textContent = 'Номер брони скопирован';
  copyTimer = setTimeout(() => { resetCopy(btn); live.textContent = ''; }, 1500);
}
function resetCopy(btn) {
  btn.classList.remove('copied');
  btn.firstElementChild.outerHTML = svg('copy');
  btn.lastElementChild.textContent = 'Скопировать номер брони';
}

/* ---------- data ---------- */
function demo() {
  const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  return {
    guest: { firstName: 'Анна' },
    trip: { title: 'Рождество в Париже', city: 'Париж', country: 'Франция', start: d(0), end: d(2), tz: 'Europe/Paris', hotel: 'Le Bristol', lat: 48.87, lon: 2.31 },
    weather: { tempC: 6, code: 3, text: 'Облачно', windKmh: 12 },
    days: [
      { date: d(0), items: [
        { time: '09:30', title: 'Рейс SU 261 Москва — Париж', category: 'Flight', kind: 'flight', venueName: 'Шереметьево, терминал B', address: '', bookingReference: 'QX7K2P', dressCode: '', guestNotes: 'Приоритетная регистрация' },
        { time: '15:00', title: 'Заселение', category: 'Hotel', kind: 'hotel', venueName: 'Le Bristol', address: '112 Rue du Faubourg Saint-Honoré, Paris', bookingReference: 'LB-448120', dressCode: '', guestNotes: 'Номер с видом на сад' },
        { time: '20:30', title: 'Ужин', category: 'Dining', kind: 'request', venueName: 'Le Cinq', address: '31 Avenue George V, Paris', bookingReference: '', dressCode: 'Smart elegant', guestNotes: 'Столик у окна, без морепродуктов' } ] },
      { date: d(1), items: [
        { time: '11:00', title: 'Спа-программа «Восстановление»', category: 'Spa & Wellness', kind: 'request', venueName: 'Dior Spa', address: '', bookingReference: '', dressCode: '', guestNotes: '' },
        { time: null, title: 'Подарок от консьержа', category: 'Gifts & Events', kind: 'request', venueName: '', address: '', bookingReference: '', dressCode: '', guestNotes: 'Ждёт вас в номере' } ] },
      { date: d(2), items: [] },
    ],
    concierge: { whatsapp: '33123456789' },
    updatedAt: new Date().toISOString(),
  };
}

async function load() {
  if (DEMO) { data = demo(); return render(); }
  if (!token) return stateView('Эта ссылка неактивна', 'Ваш консьерж с радостью пришлёт новую.');
  try {
    const r = await fetch('/api/trip-portal?token=' + encodeURIComponent(token), { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (r.status === 400 || r.status === 404) return stateView('Эта ссылка неактивна', 'Похоже, срок её действия истёк. Ваш консьерж с радостью пришлёт новую.');
    if (!r.ok) throw new Error('http');
    const j = await r.json();
    if (!j || !j.trip || !Array.isArray(j.days)) throw new Error('shape');
    const sig = JSON.stringify(j, (k, v) => (k === 'updatedAt' ? undefined : v));
    if (data && sig === lastSig) return;
    app.classList.toggle('norise', !!data);
    lastSig = sig; data = j; render();
  } catch {
    if (data) return; // keep showing the last good data on a silent refresh failure
    stateView('Минуту терпения', 'Маршрут пока не открывается. Проверьте соединение и попробуйте ещё раз.', true);
  }
}

function refresh() {
  if (document.hidden || DEMO || !token) return;
  const y = scrollY; const sel = activeDate;
  load().then(() => { activeDate = userPicked ? sel : activeDate; scrollTo(0, y); });
}
setInterval(refresh, REFRESH_MS);
document.addEventListener('visibilitychange', refresh);
addEventListener('resize', () => placeIndicator(false));
load();

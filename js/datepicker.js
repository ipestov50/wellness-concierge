// Выбор срока: быстрые варианты, календарь и время (всё в часовом поясе Парижа)
import { esc, toParisInput } from './ui.js';
import { TZ } from './const.js';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const HOURS = Array.from({ length: 17 }, (_, i) => i + 7); // 07–23
const MINUTES = [0, 15, 30, 45];
const pad = (n) => String(n).padStart(2, '0');

const parisToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (ymd) => (new Date(ymd + 'T12:00:00Z').getUTCDay() + 6) % 7; // 0 = пн

function label(st, empty = 'Без срока') {
  if (!st.date) return empty;
  const today = parisToday();
  const rel = st.date === today ? 'Сегодня' : st.date === addDays(today, 1) ? 'Завтра' : null;
  const d = new Date(st.date + 'T12:00:00Z').toLocaleDateString('ru-RU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'long' });
  const time = st.hour == null ? '' : ` · ${pad(st.hour)}:${pad(st.minute)}`;
  return (rel ? `${rel}, ${d.replace(/^[^,]+,\s*/, '')}` : d) + time;
}

export function deadlinePicker(iso, name = 'deadline', opt = {}) {
  const v = toParisInput(iso); // 'YYYY-MM-DDTHH:MM' или ''
  const [date, time] = v ? v.split('T') : [null, null];
  const hasTime = time && time !== '00:00';
  const st = { date, hour: hasTime && !opt.dateOnly ? +time.slice(0, 2) : null, minute: hasTime && !opt.dateOnly ? +time.slice(3, 5) : 0 };
  const empty = opt.empty || 'Без срока';
  return `<div class="dp${opt.dateOnly ? ' date-only' : ''}" data-dp data-date="${esc(st.date || '')}" data-hour="${st.hour ?? ''}" data-minute="${st.minute}" data-empty="${esc(empty)}"${opt.dateOnly ? ' data-dateonly="1"' : ''}${opt.quick === false ? ' data-noquick="1"' : ''}>
    <input type="hidden" name="${esc(name)}" id="f-${esc(name)}" value="${esc(v)}">
    <button type="button" class="dp-display" aria-expanded="false"><span class="dp-ico">🗓</span><span class="dp-text">${esc(label(st, empty))}</span><span class="dp-chev">▾</span></button>
    <div class="dp-quick"></div>
    <div class="dp-panel" hidden>
      <div class="dp-cal"></div>
      <div class="dp-time"></div>
    </div>
  </div>`;
}

export function bindDeadlinePicker(root) {
  root.querySelectorAll('[data-dp]:not([data-bound])').forEach(bindOne);
}

// раскрытие панели по высоте — без рывка
function slide(p, open, done) {
  if (!p.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { done?.(); return; }
  const h = p.scrollHeight;
  const shut = { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 };
  const full = { height: h + 'px', opacity: 1 };
  p.style.overflow = 'hidden';
  p.getAnimations().forEach((a) => a.cancel());
  const a = p.animate(open ? [shut, full] : [full, shut], { duration: open ? 460 : 260, easing: open ? 'cubic-bezier(.22, 1, .36, 1)' : 'cubic-bezier(.4, 0, .2, 1)' });
  a.onfinish = () => { p.style.overflow = ''; done?.(); };
}

function bindOne(el) {
  el.dataset.bound = '1';
  const st = { date: el.dataset.date || null, hour: el.dataset.hour === '' ? null : +el.dataset.hour, minute: +el.dataset.minute || 0 };
  let view = (st.date || parisToday()).slice(0, 7); // 'YYYY-MM'
  let lastDay = st.date;
  const input = el.querySelector('input[type=hidden]');
  const panel = el.querySelector('.dp-panel');
  const disp = el.querySelector('.dp-display');

  const commit = () => {
    input.value = st.date ? `${st.date}T${st.hour == null ? '00:00' : pad(st.hour) + ':' + pad(st.minute)}` : '';
    el.querySelector('.dp-text').textContent = label(st, el.dataset.empty);
    el.classList.toggle('empty', !st.date);
    draw();
  };

  function quick() {
    const t = parisToday();
    const toFri = (4 - weekday(t) + 7) % 7 || 7;
    const toSat = (5 - weekday(t) + 7) % 7 || 7;
    const opts = [['Сегодня', t], ['Завтра', addDays(t, 1)], [weekday(t) === 4 ? 'След. пятница' : 'Пятница', addDays(t, toFri)],
      ['Выходные', addDays(t, toSat)], ['Через неделю', addDays(t, 7)], [el.dataset.empty || 'Без срока', '']];
    if (el.dataset.noquick) { el.querySelector('.dp-quick').innerHTML = ''; return; }
    el.querySelector('.dp-quick').innerHTML = opts.map(([l, d]) =>
      `<button type="button" class="chip-btn${(st.date || '') === d ? ' on' : ''}" data-q="${d}">${l}</button>`).join('');
  }

  function cal() {
    const [y, m] = view.split('-').map(Number);
    const first = `${view}-01`;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = weekday(first);
    const today = parisToday();
    const pop = st.date !== lastDay; lastDay = st.date;
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let d = 1; d <= days; d++) {
      const ymd = `${view}-${pad(d)}`;
      const cls = [ymd === st.date && 'on', ymd === st.date && pop && 'pop', ymd === today && 'today', ymd < today && 'past', weekday(ymd) > 4 && 'we'].filter(Boolean).join(' ');
      cells += `<button type="button" class="day ${cls}" data-day="${ymd}">${d}</button>`;
    }
    el.querySelector('.dp-cal').innerHTML = `
      <div class="dp-head"><button type="button" class="dp-nav" data-nav="-1" aria-label="Предыдущий месяц">‹</button>
        <b>${MONTHS[m - 1]} ${y}</b><button type="button" class="dp-nav" data-nav="1" aria-label="Следующий месяц">›</button></div>
      <div class="dp-wd">${WD.map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="dp-grid">${cells}</div>`;
  }

  function time() {
    el.querySelector('.dp-time').innerHTML = `
      <div class="dp-tlabel">Время <span>${st.hour == null ? 'не указано' : pad(st.hour) + ':' + pad(st.minute)}</span></div>
      <div class="dp-hours">
        <button type="button" class="chip-btn${st.hour == null ? ' on' : ''}" data-h="">Без времени</button>
        ${HOURS.map((h) => `<button type="button" class="chip-btn hour${st.hour === h ? ' on' : ''}" data-h="${h}">${pad(h)}</button>`).join('')}
      </div>
      <div class="dp-mins${st.hour == null ? ' off' : ''}">${MINUTES.map((mm) =>
        `<button type="button" class="chip-btn${st.hour != null && st.minute === mm ? ' on' : ''}" data-m="${mm}">:${pad(mm)}</button>`).join('')}</div>
      <button type="button" class="btn small primary dp-done">Готово</button>`;
    // прокручиваем только ленту часов (scrollIntoView двигал всё окно — календарь «уезжал» в другое место)
    const hrs = el.querySelector('.dp-hours'), on = hrs?.querySelector('.on');
    if (hrs && on) hrs.scrollLeft = on.offsetLeft - hrs.offsetLeft - (hrs.clientWidth - on.offsetWidth) / 2;
  }

  function draw() { quick(); if (!panel.hidden) { cal(); if (el.dataset.dateonly) el.querySelector('.dp-time').innerHTML = '<button type="button" class="btn small primary dp-done">Готово</button>'; else time(); } }
  const toggle = (open = !el.classList.contains('open')) => {
    if (open === el.classList.contains('open')) return;
    disp.setAttribute('aria-expanded', String(open)); el.classList.toggle('open', open);
    if (open) { panel.hidden = false; view = (st.date || parisToday()).slice(0, 7); draw(); slide(panel, true); }
    else slide(panel, false, () => { if (!el.classList.contains('open')) panel.hidden = true; });
  };

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !el.contains(b)) return;
    if (b === disp) return toggle();
    if (b.dataset.q != null) {
      st.date = b.dataset.q || null;
      if (!st.date) { st.hour = null; toggle(false); }
      else if (!el.classList.contains('open')) toggle(true);
      return commit();
    }
    if (b.dataset.nav) {
      const [y, m] = view.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + +b.dataset.nav, 1));
      view = d.toISOString().slice(0, 7); return cal();
    }
    if (b.dataset.day) { st.date = b.dataset.day; commit(); if (el.dataset.dateonly) toggle(false); return; }
    if (b.dataset.h != null) {
      if (!st.date) st.date = parisToday();
      st.hour = b.dataset.h === '' ? null : +b.dataset.h;
      if (st.hour == null) st.minute = 0;
      return commit();
    }
    if (b.dataset.m != null) { if (st.hour == null) st.hour = 10; st.minute = +b.dataset.m; return commit(); }
    if (b.classList.contains('dp-done')) toggle(false);
  });
  // программная установка значения (например, авто-подстановка даты перелёта из дат поездки)
  el.dpSet = (v) => {
    const [d, tm] = v ? String(v).split('T') : [null, null];
    st.date = d || null;
    if (tm && tm !== '00:00' && !el.dataset.dateonly) { st.hour = +tm.slice(0, 2); st.minute = +tm.slice(3, 5); } else { st.hour = null; st.minute = 0; }
    commit();
  };
  el.classList.toggle('empty', !st.date);
  quick();
}

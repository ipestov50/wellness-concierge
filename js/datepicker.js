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

function label(st) {
  if (!st.date) return 'Без срока';
  const today = parisToday();
  const rel = st.date === today ? 'Сегодня' : st.date === addDays(today, 1) ? 'Завтра' : null;
  const d = new Date(st.date + 'T12:00:00Z').toLocaleDateString('ru-RU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'long' });
  const time = st.hour == null ? '' : ` · ${pad(st.hour)}:${pad(st.minute)}`;
  return (rel ? `${rel}, ${d.replace(/^[^,]+,\s*/, '')}` : d) + time;
}

export function deadlinePicker(iso) {
  const v = toParisInput(iso); // 'YYYY-MM-DDTHH:MM' или ''
  const [date, time] = v ? v.split('T') : [null, null];
  const hasTime = time && time !== '00:00';
  const st = { date, hour: hasTime ? +time.slice(0, 2) : null, minute: hasTime ? +time.slice(3, 5) : 0 };
  return `<div class="dp" data-dp data-date="${esc(st.date || '')}" data-hour="${st.hour ?? ''}" data-minute="${st.minute}">
    <input type="hidden" name="deadline" id="f-deadline" value="${esc(v)}">
    <button type="button" class="dp-display" aria-expanded="false"><span class="dp-ico">🗓</span><span class="dp-text">${esc(label(st))}</span><span class="dp-chev">▾</span></button>
    <div class="dp-quick"></div>
    <div class="dp-panel" hidden>
      <div class="dp-cal"></div>
      <div class="dp-time"></div>
    </div>
  </div>`;
}

export function bindDeadlinePicker(root) {
  const el = root.querySelector('[data-dp]');
  if (!el) return;
  const st = { date: el.dataset.date || null, hour: el.dataset.hour === '' ? null : +el.dataset.hour, minute: +el.dataset.minute || 0 };
  let view = (st.date || parisToday()).slice(0, 7); // 'YYYY-MM'
  const input = el.querySelector('input[type=hidden]');
  const panel = el.querySelector('.dp-panel');
  const disp = el.querySelector('.dp-display');

  const commit = () => {
    input.value = st.date ? `${st.date}T${st.hour == null ? '00:00' : pad(st.hour) + ':' + pad(st.minute)}` : '';
    el.querySelector('.dp-text').textContent = label(st);
    el.classList.toggle('empty', !st.date);
    draw();
  };

  function quick() {
    const t = parisToday();
    const toFri = (4 - weekday(t) + 7) % 7 || 7;
    const toSat = (5 - weekday(t) + 7) % 7 || 7;
    const opts = [['Сегодня', t], ['Завтра', addDays(t, 1)], [weekday(t) === 4 ? 'След. пятница' : 'Пятница', addDays(t, toFri)],
      ['Выходные', addDays(t, toSat)], ['Через неделю', addDays(t, 7)], ['Без срока', '']];
    el.querySelector('.dp-quick').innerHTML = opts.map(([l, d]) =>
      `<button type="button" class="chip-btn${(st.date || '') === d ? ' on' : ''}" data-q="${d}">${l}</button>`).join('');
  }

  function cal() {
    const [y, m] = view.split('-').map(Number);
    const first = `${view}-01`;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = weekday(first);
    const today = parisToday();
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let d = 1; d <= days; d++) {
      const ymd = `${view}-${pad(d)}`;
      const cls = [ymd === st.date && 'on', ymd === today && 'today', ymd < today && 'past', weekday(ymd) > 4 && 'we'].filter(Boolean).join(' ');
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
    el.querySelector('.dp-hours .on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function draw() { quick(); if (!panel.hidden) { cal(); time(); } }
  const toggle = (open = panel.hidden) => {
    panel.hidden = !open; disp.setAttribute('aria-expanded', String(open)); el.classList.toggle('open', open);
    if (open) { view = (st.date || parisToday()).slice(0, 7); draw(); }
  };

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !el.contains(b)) return;
    if (b === disp) return toggle();
    if (b.dataset.q != null) {
      st.date = b.dataset.q || null;
      if (!st.date) { st.hour = null; toggle(false); }
      else if (panel.hidden) toggle(true);
      return commit();
    }
    if (b.dataset.nav) {
      const [y, m] = view.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + +b.dataset.nav, 1));
      view = d.toISOString().slice(0, 7); return cal();
    }
    if (b.dataset.day) { st.date = b.dataset.day; return commit(); }
    if (b.dataset.h != null) {
      if (!st.date) st.date = parisToday();
      st.hour = b.dataset.h === '' ? null : +b.dataset.h;
      if (st.hour == null) st.minute = 0;
      return commit();
    }
    if (b.dataset.m != null) { if (st.hour == null) st.hour = 10; st.minute = +b.dataset.m; return commit(); }
    if (b.classList.contains('dp-done')) toggle(false);
  });
  el.classList.toggle('empty', !st.date);
  quick();
}

// День рождения: год 1900 означает «год неизвестен»
import { TZ } from './const.js';
import { esc, options } from './ui.js';

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const todayParis = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c; };

export function birthdayInfo(bd) {
  if (!bd) return null;
  const [y, m, d] = bd.split('-').map(Number);
  const t = todayParis();
  const [ty, tm, td] = t.split('-').map(Number);
  const today = Date.UTC(ty, tm - 1, td);
  let next = Date.UTC(ty, m - 1, d);
  if (next < today) next = Date.UTC(ty + 1, m - 1, d);
  const days = Math.round((next - today) / 864e5);
  const known = y > 1900;
  const turning = known ? new Date(next).getUTCFullYear() - y : null;
  const age = known ? turning - (days === 0 ? 0 : 1) : null;
  return { day: d, month: m, year: known ? y : null, days, turning, age, text: `${d} ${MONTHS_GEN[m - 1]}${known ? ' ' + y : ''}` };
}

export function birthdayLine(bd) {
  const b = birthdayInfo(bd);
  if (!b) return '';
  const when = b.days === 0 ? 'сегодня!' : b.days === 1 ? 'завтра' : `через ${b.days} ${plural(b.days, 'день', 'дня', 'дней')}`;
  const soon = b.days <= 14;
  const age = b.age != null ? ` · ${b.age} ${plural(b.age, 'год', 'года', 'лет')}` : '';
  return `<div class="bday${soon ? ' soon' : ''}${b.days === 0 ? ' today' : ''}"><span class="bday-ico">🎂</span>
    <span><b>${esc(b.text)}</b>${age}${soon ? ` · <em>${b.turning ? `исполнится ${b.turning} ` : ''}${when}</em>` : ''}</span></div>`;
}

// поле формы: день, месяц и необязательный год
export function birthdayField(bd, prefix = 'bd', yearLabel = 'Год (не знаю)') {
  const [y, m, d] = bd ? bd.split('-').map(Number) : [null, null, null];
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 100 }, (_, i) => thisYear - i);
  return `<div class="bd-pick">
    <select name="${prefix}_day" id="f-${prefix}_day" aria-label="День">${options(days, d, 'День')}</select>
    <select name="${prefix}_month" id="f-${prefix}_month" aria-label="Месяц">${options(MONTHS.map((n, i) => [i + 1, n]), m, 'Месяц')}</select>
    <select name="${prefix}_year" id="f-${prefix}_year" aria-label="Год">${options(years, y && y > 1900 ? y : '', yearLabel)}</select>
  </div>`;
}
export function birthdayValue(v, prefix = 'bd') {
  const day = v[prefix + '_day'], month = v[prefix + '_month'];
  if (!day || !month) return null;
  const y = v[prefix + '_year'] || '1900';
  const pad = (n) => String(n).padStart(2, '0');
  const dd = Math.min(+day, new Date(Date.UTC(+y === 1900 ? 2000 : +y, +month, 0)).getUTCDate());
  return `${y}-${pad(month)}-${pad(dd)}`;
}

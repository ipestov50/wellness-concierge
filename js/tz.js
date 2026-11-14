// Время гостя: домашний пояс, текущее место (из поездки), «не беспокоить», разница с Парижем
import { state, save } from './data.js';
import { esc } from './ui.js';

// пояса, с которыми чаще всего работает консьерж гостей из СНГ (+ направления поездок)
export const ZONES = [
  ['Europe/Moscow', 'Москва, Санкт-Петербург'], ['Europe/Minsk', 'Минск'], ['Europe/Kaliningrad', 'Калининград'], ['Europe/Samara', 'Самара'],
  ['Asia/Yekaterinburg', 'Екатеринбург'], ['Asia/Novosibirsk', 'Новосибирск'], ['Asia/Krasnoyarsk', 'Красноярск'], ['Asia/Vladivostok', 'Владивосток'],
  ['Asia/Almaty', 'Алматы, Астана'], ['Asia/Tashkent', 'Ташкент'], ['Asia/Baku', 'Баку'], ['Asia/Yerevan', 'Ереван'], ['Asia/Tbilisi', 'Тбилиси'],
  ['Asia/Bishkek', 'Бишкек'], ['Asia/Dushanbe', 'Душанбе'], ['Asia/Ashgabat', 'Ашхабад'], ['Europe/Chisinau', 'Кишинёв'], ['Europe/Kyiv', 'Киев'],
  ['Asia/Dubai', 'Дубай, Абу-Даби'], ['Europe/Istanbul', 'Стамбул'], ['Asia/Nicosia', 'Кипр'], ['Europe/Belgrade', 'Белград'],
  ['Europe/Paris', 'Париж, Ницца, Монако'], ['Europe/London', 'Лондон'], ['Europe/Zurich', 'Цюрих, Женева'], ['Europe/Rome', 'Рим, Милан'],
  ['Europe/Madrid', 'Мадрид, Марбелья'], ['Asia/Bangkok', 'Бангкок, Пхукет'], ['Indian/Maldives', 'Мальдивы'], ['America/New_York', 'Нью-Йорк, Майами'],
];
export const CITIZENSHIPS = [
  ['RU', '🇷🇺 Россия'], ['KZ', '🇰🇿 Казахстан'], ['UZ', '🇺🇿 Узбекистан'], ['AZ', '🇦🇿 Азербайджан'], ['AM', '🇦🇲 Армения'], ['GE', '🇬🇪 Грузия'],
  ['BY', '🇧🇾 Беларусь'], ['KG', '🇰🇬 Киргизия'], ['TJ', '🇹🇯 Таджикистан'], ['TM', '🇹🇲 Туркменистан'], ['MD', '🇲🇩 Молдова'], ['UA', '🇺🇦 Украина'],
  ['AE', '🇦🇪 ОАЭ'], ['IL', '🇮🇱 Израиль'], ['CY', '🇨🇾 Кипр'], ['GB', '🇬🇧 Великобритания'], ['FR', '🇫🇷 Франция'], ['US', '🇺🇸 США'],
];
export const CURRENCY_OF = { RU: 'RUB', KZ: 'KZT', UZ: 'UZS', AZ: 'AZN', AM: 'AMD', GE: 'GEL', BY: 'BYN', KG: 'KGS', TJ: 'TJS', TM: 'TMT', MD: 'MDL', UA: 'UAH', AE: 'AED', IL: 'ILS', GB: 'GBP', US: 'USD' };

export const flag = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '');
const zoneLabel = (tz) => ZONES.find(([z]) => z === tz)?.[1]?.split(',')[0] || (tz || '').split('/').pop().replace(/_/g, ' ');
export const timeIn = (tz, d = new Date()) => d.toLocaleTimeString('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
const hourIn = (tz, d = new Date()) => +new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(d) % 24;
// разница в часах между поясами (с учётом летнего времени на дату)
export function diffHours(tzA, tzB, d = new Date()) {
  const off = (tz) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - d.getTime()) / 36e5; };
  return Math.round((off(tzB) - off(tzA)) * 2) / 2;
}
export const fmtDiff = (h) => (h === 0 ? 'то же время' : `${h > 0 ? '+' : '−'}${Math.abs(h)} ч`);
export const isQuiet = (tz, d = new Date()) => { const h = hourIn(tz, d); return h >= 22 || h < 9; };

// где гость сейчас: активная поездка с поясом, иначе дом
export function guestWhere(c, at = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  const trip = state.trips.find((t) => t.client_id === c.id && t.tz && t.start_date && t.start_date <= day && day <= (t.end_date || t.start_date));
  if (trip) return { tz: trip.tz, place: trip.city, away: true, trip };
  if (c.home_tz) return { tz: c.home_tz, place: zoneLabel(c.home_tz), away: false };
  return null;
}

// чип в шапке профиля: «🕐 23:40 у гостя · Москва · 🌙 ночь»
export function guestClock(c) {
  const w = guestWhere(c);
  if (!w) return c.home_tz === undefined ? '' : `<button type="button" class="gclock add" data-editcl="${c.id}">🕐 Указать часовой пояс гостя</button>`;
  const quiet = isQuiet(w.tz);
  const d = diffHours('Europe/Paris', w.tz);
  return `<div class="gclock${quiet ? ' quiet' : ''}" title="${esc(w.tz)}">
    <span class="gclock-time">${quiet ? '🌙' : '🕐'} <b data-tz-clock="${esc(w.tz)}">${timeIn(w.tz)}</b></span>
    <span>${w.away ? `📍 ${esc(w.place)} · в поездке${c.home_tz && c.home_tz !== w.tz ? ` · дома ${timeIn(c.home_tz)}` : ''}` : esc(w.place)}${d ? ` · ${fmtDiff(d)} к Парижу` : ''}</span>
    ${quiet ? '<span class="gclock-q">ночь у гостя — лучше написать утром</span>' : ''}
  </div>`;
}

// строка в форме запроса: «для гостя — 22:00 по Москве»
export function guestTimeLine(c, iso) {
  if (!c || !iso) return '';
  const w = guestWhere(c, new Date(iso)) || (c.home_tz ? { tz: c.home_tz, place: zoneLabel(c.home_tz) } : null);
  if (!w || diffHours('Europe/Paris', w.tz, new Date(iso)) === 0) return '';
  return `для гостя — <b>${timeIn(w.tz, new Date(iso))}</b> (${esc(w.place)})`;
}

// часы в чипах тикают раз в минуту
setInterval(() => document.querySelectorAll('[data-tz-clock]').forEach((el) => { el.textContent = timeIn(el.dataset.tzClock); }), 30e3);

// город → пояс и страна (Open-Meteo, бесплатно, без ключа)
export async function lookupPlace(name) {
  if (!name?.trim()) return null;
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name.trim())}&count=1&language=ru`);
    const j = await r.json();
    const x = j.results?.[0];
    return x ? { tz: x.timezone, cc: x.country_code, country: x.country, lat: x.latitude, lon: x.longitude, name: x.name } : null;
  } catch { return null; }
}

// у старых поездок нет пояса — определяем по городу один раз, тихо
let backfilled = false;
export async function backfillTrips() {
  if (backfilled) return; backfilled = true;
  for (const t of state.trips.filter((x) => !x.tz && x.city).slice(0, 15)) {
    const p = await lookupPlace(`${t.city}${t.country ? ' ' + t.country : ''}`) || await lookupPlace(t.city);
    if (p) await save('trips', t.id, { tz: p.tz, country_code: p.cc, lat: p.lat, lon: p.lon, ...(t.country ? {} : { country: p.country }) }).catch(() => {});
  }
}

// предупреждение рядом с кнопкой «написать гостю»
export function quietNote(c) {
  const w = c && guestWhere(c);
  return w && isQuiet(w.tz) ? `<span class="quiet-note">🌙 у гостя ${timeIn(w.tz)} — лучше отправить утром</span>` : '';
}

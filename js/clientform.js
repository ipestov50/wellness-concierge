// Окно «Клиент»: закреплённая шапка личности, четыре полки досье с живыми счётчиками, поля-метки.
// Все поля всегда в форме — «Сохранить» сохраняет всё сразу. Обработчики — на форме (делегирование), не на каждом поле.
import { esc, options } from './ui.js';
import { chipField, bindChips } from './chips.js';
import { birthdayField } from './birthday.js';
import { LANGUAGES } from './const.js';
import { ZONES, CITIZENSHIPS } from './tz.js';

const lines = (l) => (l || []).join('\n');
const inp = (n, v, a = '') => `<input id="f-${n}" name="${n}" value="${esc(v)}" ${a}>`;
const area = (n, v, a = '') => `<textarea id="f-${n}" name="${n}" rows="2" ${a}>${esc(v)}</textarea>`;
const fld = (id, label, control, hint = '', cls = '') => `<div class="f ${cls}"><label for="${id}">${esc(label)}</label>${control}${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;
const SHELVES = [
  ['safe', '🛡️', 'Ограничения', 'Ограничения'],
  ['taste', '✦', 'Вкусы', 'Вкусы и атмосфера'],
  ['road', '✈️', 'В пути', 'Транспорт и привычки'],
  ['reach', '📞', 'Связь', 'Контакты и связь'],
];
const todayYmd = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function clientBody(c) {
  const zones = ZONES.some(([z]) => z === c.home_tz) || !c.home_tz ? ZONES : [[c.home_tz, c.home_tz], ...ZONES];
  const top = `<div class="cl-top">
    <div class="cl-row r1">
      ${fld('f-name', 'Имя', inp('name', c.name, 'type="text" required autocomplete="off" placeholder="Имя и фамилия"'), '', 'c-name')}
      <label class="vip-pill"><input type="checkbox" id="f-vip" name="vip"${c.vip ? ' checked' : ''}><span><i aria-hidden="true">★</i> VIP-клиент</span></label>
      ${fld('f-language', 'Язык общения', `<select id="f-language" name="language">${options(LANGUAGES, c.language)}</select>`)}
      ${fld('f-city', 'Город', inp('city', c.city, 'type="text" autocomplete="off" placeholder="Где живёт"'))}
    </div>
    <div class="cl-row r2">
      ${fld('f-home_tz', 'Часовой пояс дома', `<select id="f-home_tz" name="home_tz">${options(zones, c.home_tz, '— по городу —')}</select><small class="tz-live" aria-live="off"></small>`)}
      ${fld('f-bd_day', 'День рождения', birthdayField(c.birthday), 'Год можно не указывать')}
      ${fld('f-citizenship', 'Гражданство', `<select id="f-citizenship" name="citizenship">${options(CITIZENSHIPS, c.citizenship, '— не указано —')}</select>`, 'Для визы и платежей перед поездкой')}
    </div>
    <div class="cseg" role="tablist" aria-label="Разделы досье" style="--i:0">
      <i class="cseg-ind" aria-hidden="true"></i>
      ${SHELVES.map(([k, ico, short], i) => `<button type="button" role="tab" id="ct-${k}" aria-controls="cp-${k}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-i="${i}"><span class="cseg-ico" aria-hidden="true">${ico}</span><span class="cseg-t">${short}</span><b class="cseg-n tnum" hidden></b></button>`).join('')}
    </div></div>`;
  const panel = (k, ttl, inner, hidden) => `<section class="cl-panel" role="tabpanel" id="cp-${k}" aria-labelledby="ct-${k}"${hidden ? ' hidden' : ''}><h3 class="cl-h">${esc(ttl)}</h3><div class="cl-grid">${inner}</div></section>`;
  const safe = panel('safe', SHELVES[0][3],
    fld('f-allergies-in', 'Аллергии · стоп-лист', chipField('allergies', c.allergies, { tone: 'risk', placeholder: 'Орехи, моллюски… Enter — добавить', label: 'Аллергии' }), 'Видят Jarvis, запросы и черновики для WhatsApp', 'risk') +
    fld('f-dislikes-in', '🚫 Чего избегает', chipField('dislikes', c.dislikes, { tone: 'soft', placeholder: 'Лилии, шумные номера, ковёр…', label: 'Чего избегает' })) +
    fld('f-diet', 'Диета и питание', area('diet', lines(c.diet), 'placeholder="Без глютена, не пьёт кофе после 16:00"'), 'По одной на строку или через запятую') +
    fld('f-health', 'Здоровье и самочувствие', area('health', lines(c.health), 'placeholder="Не переносит жару, мягкий матрас"'), 'Противопоказания, климат, подвижность'), false);
  const taste = panel('taste', SHELVES[1][3],
    fld('f-pref_food', 'Еда и напитки', area('pref_food', c.pref_food, 'placeholder="Любимые блюда, вина, привычки за столом"')) +
    fld('f-pref_music', 'Музыка и атмосфера', area('pref_music', c.pref_music, 'placeholder="Тихий джаз в машине, без радио, мягкий свет"')) +
    fld('f-pref_spa', 'Спа и велнес', area('pref_spa', c.pref_spa, 'placeholder="Процедуры, мастер, сила давления, сауна"')) +
    fld('f-likes-in', '❤️ Любит', chipField('likes', c.likes, { tone: 'soft', placeholder: 'Пионы, столик у окна…', label: 'Любит' })), true);
  const road = panel('road', SHELVES[2][3],
    fld('f-pref_transport', 'Транспорт и авто', area('pref_transport', c.pref_transport, 'placeholder="Класс авто, водитель, температура и аромат в салоне"')) +
    fld('f-pref_hotels', 'Отели и размещение', area('pref_hotels', c.pref_hotels, 'placeholder="Бренды, категория номера, этаж, подушки"')) +
    fld('f-travel_habits', 'Привычки в пути', area('travel_habits', c.travel_habits, 'placeholder="Место у окна, фаст-трек, залы ожидания"')) +
    fld('f-loyalty', 'Программы лояльности', area('loyalty', lines(c.loyalty), 'placeholder="Air France · Platinum"'), 'По одной на строку') +
    fld('f-travel_history', 'Прошлые поездки', area('travel_history', lines(c.travel_history)), 'Новые поездки лучше добавлять во вкладке «Поездки»', 'wide-f'), true);
  const reach = panel('reach', SHELVES[3][3],
    fld('f-phone', 'Телефон', inp('phone', c.phone, 'type="tel" placeholder="+33 6 00 00 00 00" autocomplete="off"')) +
    fld('f-email', 'Почта', inp('email', c.email, 'type="email" placeholder="name@mail.com" autocapitalize="off" autocomplete="off"')) +
    fld('f-telegram', 'Telegram', inp('telegram', c.telegram, 'type="text" placeholder="@username" autocapitalize="off"')) +
    fld('f-last_contact', 'Последний контакт', `<div class="lc"><input id="f-last_contact" name="last_contact" type="date" value="${esc(c.last_contact)}"><button type="button" class="lc-today" data-today>Сегодня</button></div>`) +
    fld('f-concierge_notes', 'Заметки консьержа', area('concierge_notes', c.concierge_notes, 'placeholder="Личное для вас: не видно гостю"'), '', 'wide-f'), true);
  return top + `<div class="cl-scroll">${safe}${taste}${road}${reach}</div>`;
}

export function bindClientForm(form) {
  const tabs = [...form.querySelectorAll('.cseg [role=tab]')], seg = form.querySelector('.cseg');
  const show = (t, focus) => {
    tabs.forEach((b) => { const on = b === t; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; form.querySelector('#' + b.getAttribute('aria-controls')).hidden = !on; });
    seg.style.setProperty('--i', t.dataset.i); if (focus) t.focus();
    form.querySelector('.cl-scroll').scrollTop = 0;
  };
  const count = () => tabs.forEach((b) => {
    const p = form.querySelector('#' + b.getAttribute('aria-controls'));
    const n = [...p.querySelectorAll('input[name],textarea[name],select[name]')].filter((e) => String(e.value).trim() !== '').length;
    const bdg = b.querySelector('.cseg-n'); bdg.textContent = n; bdg.hidden = !n;
  });
  const tz = () => {
    const out = form.querySelector('.tz-live'), z = form.home_tz.value;
    if (!z) { out.textContent = ''; return; }
    try { out.textContent = 'Сейчас у гостя ' + new Intl.DateTimeFormat('ru-RU', { timeZone: z, hour: '2-digit', minute: '2-digit', weekday: 'short' }).format(new Date()); } catch { out.textContent = ''; }
  };
  form.addEventListener('click', (e) => {
    const t = e.target.closest('.cseg [role=tab]'); if (t) return show(t);
    if (e.target.closest('[data-today]')) { form.last_contact.value = todayYmd(); count(); }
  });
  form.addEventListener('keydown', (e) => {
    const t = e.target.closest('.cseg [role=tab]'); if (!t) return;
    const i = +t.dataset.i, k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (k) { e.preventDefault(); show(tabs[(i + k + tabs.length) % tabs.length], true); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); show(tabs[e.key === 'Home' ? 0 : tabs.length - 1], true); }
  });
  form.addEventListener('input', count);
  form.addEventListener('change', (e) => { count(); if (e.target.name === 'home_tz') tz(); });
  bindChips(form);
  count(); tz();
  const timer = setInterval(() => { if (!form.isConnected) clearInterval(timer); else tz(); }, 30000);
  return { tz, count };
}

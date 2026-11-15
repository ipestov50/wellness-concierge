// Вёрстка лукбука-путеводителя: одна функция для превью в конструкторе и для PDF (A4, страница = лист).
// В режиме правки тексты редактируются прямо на странице (data-k = путь в данных), фото меняются кликом (data-img).
import { esc } from './ui.js';

const LABEL = { cover: 'Обложка', intro: 'Вступление', welcome: 'Письмо гостю', days: 'План по дням', map: 'Карта', hotels: 'Отель и велнес', recs: 'Рекомендации', back: 'Задняя обложка' };
export const PAGE_KEYS = Object.keys(LABEL);
export const pageLabel = (k) => LABEL[k];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const dayLabel = (ymd) => { if (!ymd) return ''; const d = new Date(ymd + 'T12:00:00Z'); return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

export const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
export function set(o, path, v) { const ks = path.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => a[k], o); t[last] = v; }

export function renderBook(g, ctx, { editable = false } = {}) {
  const fill = (s) => String(s || '').replace(/\{имя\}/g, ctx.first || 'дорогой гость');
  // редактируемый текст: показываем с подставленным именем; правки сохраняются как есть
  const T = (path, tag = 'span', cls = '', ph = '') => {
    const v = get(g, path);
    if (!editable && !v) return '';
    return `<${tag} class="${cls}"${editable ? ` contenteditable="plaintext-only" spellcheck="false" data-k="${path}" data-ph="${esc(ph)}"` : ''}>${esc(fill(v))}</${tag}>`;
  };
  const IMG = (path, cls = '') => {
    const u = get(g, path);
    return `<div class="lb-img ${cls}${u ? '' : ' empty'}"${editable ? ` data-img="${path}" title="Нажмите, чтобы заменить фото"` : ''}>${u ? `<img src="${esc(u)}" alt="" loading="eager" referrerpolicy="no-referrer">` : '<span>фото</span>'}${editable ? '<i class="lb-img-edit">⟳ фото</i>' : ''}</div>`;
  };
  const DEL = (path) => (editable ? `<button type="button" class="lb-del" data-del="${path}" title="Убрать">✕</button>` : '');
  const on = new Set(g.pages || PAGE_KEYS);
  let n = 0;
  const foot = (section) => `<footer class="lb-foot"><span>${String(++n).padStart(2, '0')} · ${esc(section)}</span><span>${esc(ctx.city)}</span></footer>`;
  const out = [];

  if (on.has('cover')) { n++; out.push(`<section class="lb-page lb-cover">
    ${IMG('cover.photo', 'lb-cover-img')}
    <div class="lb-cover-t">${T('cover.title', 'h1', 'lb-cover-h', 'Город')}${T('cover.subtitle', 'p', 'lb-script', 'подзаголовок')}</div>
    <div class="lb-cover-foot"><div><b>Персональный путеводитель</b><span>Подготовлено для ${esc(ctx.guest)}</span><span>${esc(ctx.dates)}</span></div><div class="lb-brand">Wellness<br>Concierge</div></div>
  </section>`); }

  if (on.has('intro')) out.push(`<section class="lb-page lb-intro">
    <div class="lb-intro-top"><p class="lb-script lb-light">${esc(ctx.city)}</p>${T('intro.heading', 'h2', 'lb-h2 lb-light', 'Заголовок')}${T('intro.lead', 'p', 'lb-lead lb-light', 'Короткая строка')}${T('intro.text', 'p', 'lb-text lb-light', 'Текст вступления')}</div>
    ${IMG('intro.photo', 'lb-intro-img')}${foot('Вступление')}</section>`);

  if (on.has('welcome')) out.push(`<section class="lb-page lb-welcome">
    ${IMG('welcome.photo', 'lb-welcome-img')}
    ${T('welcome.title', 'h2', 'lb-h2', 'Заголовок письма')}${T('welcome.text', 'p', 'lb-text lb-letter', 'Письмо гостю')}
    <div class="lb-sign"><span class="lb-avatar">${esc(ctx.initials)}</span><div>${T('contact.name', 'span', 'lb-script lb-sig', 'Ваше имя')}<small>${T('contact.role', 'span', '', 'Личный консьерж')}</small></div></div>
    ${foot('Письмо')}</section>`);

  if (on.has('days')) (g.days || []).forEach((d, i) => out.push(`<section class="lb-page lb-day">
    <div class="lb-day-strip">${['morning', 'afternoon', 'evening'].map((k) => IMG(`days.${i}.${k}.photo`, 'lb-day-img')).join('')}</div>
    <div class="lb-day-main">
      <span class="lb-badge">День ${i + 1} · ${esc(dayLabel(d.date))}</span>
      ${T(`days.${i}.title`, 'h2', 'lb-h2', 'Тема дня')}
      ${[['morning', 'Утро', '☀'], ['afternoon', 'День', '◐'], ['evening', 'Вечер', '☾']].map(([k, l, ic]) => `<div class="lb-slot">
        <div class="lb-slot-h"><span class="lb-slot-ic">${ic}</span><b>${l}</b>${T(`days.${i}.${k}.time`, 'span', 'lb-time', '00:00')}</div>
        ${T(`days.${i}.${k}.title`, 'h3', 'lb-h3', 'Что делаем')}${T(`days.${i}.${k}.text`, 'p', 'lb-text', 'Описание')}</div>`).join('')}
    </div>${editable ? `<button type="button" class="lb-del lb-del-page" data-del="days.${i}" title="Убрать этот день">✕ день</button>` : ''}${foot('План по дням')}</section>`));

  if (on.has('map')) out.push(`<section class="lb-page lb-map">
    <p class="lb-script">${esc(ctx.city)}</p>${T('map.title', 'h2', 'lb-h2', 'Карта')}${T('map.text', 'p', 'lb-text lb-narrow', 'Пара слов о городе')}
    <div class="lb-map-grid">${mapHtml(g.map, MAP_W, MAP_H, ctx.map)}
      <ol class="lb-legend">${(g.map?.points || []).map((p, i) => `<li><span class="lb-num">${i + 1}</span><div>${T(`map.points.${i}.name`, 'b', '', 'Место')}${T(`map.points.${i}.text`, 'p', 'lb-text', 'Описание')}</div>${DEL(`map.points.${i}`)}</li>`).join('')}</ol></div>
    ${(g.tips || []).length ? `<div class="lb-tips"><b>Полезно знать</b><ul>${g.tips.map((x, i) => `<li>${T(`tips.${i}`, 'span')}${DEL(`tips.${i}`)}</li>`).join('')}</ul></div>` : ''}
    ${foot('Карта')}</section>`);

  if (on.has('hotels')) (g.hotels || []).forEach((h, i) => out.push(`<section class="lb-page lb-hotel${i % 2 ? ' alt' : ''}">
    ${T(`hotels.${i}.name`, 'h2', 'lb-h1', 'Отель')}
    <div class="lb-hotel-grid">${IMG(`hotels.${i}.photos.0`, 'lb-h-big')}${IMG(`hotels.${i}.photos.1`, 'lb-h-s1')}${IMG(`hotels.${i}.photos.2`, 'lb-h-s2')}</div>
    <p class="lb-addr"><b>Адрес</b>${T(`hotels.${i}.address`, 'span', '', 'Адрес')}</p>
    <div class="lb-hotel-body">${T(`hotels.${i}.text`, 'p', 'lb-text', 'Описание')}
      <div><b class="lb-perks-h">${h.kind === 'wellness' ? 'Велнес и привилегии' : 'Привилегии'}</b><ul class="lb-perks">${(h.perks || []).map((x, k) => `<li>${T(`hotels.${i}.perks.${k}`, 'span')}${DEL(`hotels.${i}.perks.${k}`)}</li>`).join('')}</ul></div></div>
    <div class="lb-price"><div><small>Стоимость</small>${T(`hotels.${i}.price`, 'b', '', 'по запросу')}</div><div><small>Бронирование</small><b>через вашего консьержа</b></div></div>
    ${editable ? `<button type="button" class="lb-del lb-del-page" data-del="hotels.${i}" title="Убрать страницу">✕ страница</button>` : ''}${foot(h.kind === 'wellness' ? 'Велнес' : 'Отель')}</section>`));

  if (on.has('recs')) out.push(`<section class="lb-page lb-recs">
    <p class="lb-kicker">Отобрано для вас</p>${T('recs.title', 'h2', 'lb-h2 lb-center', 'Рекомендации')}
    ${IMG('recs.photo', 'lb-recs-img')}
    <div class="lb-recs-grid">${(g.recs?.items || []).map((x, i) => `<div class="lb-rec">${T(`recs.items.${i}.badge`, 'span', 'lb-badge sm', 'Категория')}
      <div class="lb-rec-n">${T(`recs.items.${i}.name`, 'b', '', 'Название')}${x.partner ? '<i class="lb-star">★</i>' : ''}</div>${T(`recs.items.${i}.address`, 'small', '', 'Адрес')}${T(`recs.items.${i}.text`, 'p', 'lb-text', '')}${DEL(`recs.items.${i}`)}</div>`).join('')}</div>
    ${foot('Рекомендации')}</section>`);

  if (on.has('back')) out.push(`<section class="lb-page lb-back">
    <div class="lb-back-top"><div class="lb-mark">W</div><h2 class="lb-thanks">Спасибо</h2><p class="lb-script lb-light">хорошего путешествия, ${esc(ctx.first)}</p>
      <div class="lb-contacts">${T('contact.name', 'b', '', 'Ваше имя')}${T('contact.phone', 'span', '', 'Телефон')}${T('contact.telegram', 'span', '', 'Telegram')}${T('contact.email', 'span', '', 'Почта')}</div></div>
    ${IMG('back.photo', 'lb-back-img')}</section>`);

  return out.join('');
}

// ---------- карта: картинка OpenFreeMap (js/mapshot.js) + пронумерованные пины ----------
export function mapHtml(m = {}, W, H, shot) {
  const has = (m.points || []).some((p) => p.lat != null) || m.center;
  if (!shot) return `<div class="lb-mapbox empty" style="width:${W}px;height:${H}px"><span>${has ? 'Рисую карту…' : 'Карта появится, когда Jarvis найдёт места'}</span></div>`;
  return `<div class="lb-mapbox" style="width:${W}px;height:${H}px"><img class="lb-map-img" src="${shot.url}" alt="">${shot.pins.map((p) => `<span class="lb-pin" style="left:${p.x}px;top:${p.y}px">${p.n}</span>`).join('')}<small class="lb-attr">© OpenStreetMap · OpenFreeMap</small></div>`;
}
export const MAP_W = 360, MAP_H = 620;

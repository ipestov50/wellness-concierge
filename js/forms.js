import { CATEGORIES, URGENCY, CURRENCIES, LANGUAGES, PARTNER_TYPES, PARTNER_TYPE_LABEL } from './const.js';
import { esc, options, field, openModal, toParisInput, fromParisInput, toList, toast, avatar } from './ui.js';
import { state, byId, save, remove } from './data.js';
import { requestOptionsBar } from './options.js';
import { ui, render } from './router.js';
import { statusOptions, firstKey, statusOf } from './statuses.js';
import { deadlinePicker, bindDeadlinePicker } from './datepicker.js';
import { restrictionsBlock } from './restrictions.js';
export { restrictionsBlock };
import { birthdayField, birthdayValue } from './birthday.js';
import { checklistSection, bindChecklist, buildChecklist } from './checklist.js';
import { roadSlot, bindRoad } from './road.js';
import { ZONES, CITIZENSHIPS, lookupPlace, guestTimeLine, timeIn, guestWhere, diffHours, fmtDiff, isQuiet } from './tz.js';

const input = (name, value, attrs = '') => `<input id="f-${name}" name="${name}" value="${esc(value)}" ${attrs}>`;
const area = (name, value, attrs = '') => `<textarea id="f-${name}" name="${name}" ${attrs}>${esc(value)}</textarea>`;
const select = (name, html, attrs = '') => `<select id="f-${name}" name="${name}" ${attrs}>${html}</select>`;
const check = (name, label, on) => `<label class="check"><input type="checkbox" id="f-${name}" name="${name}"${on ? ' checked' : ''}> ${esc(label)}</label>`;
const nul = (v) => (v === '' || v == null ? null : v);

// срочность — четыре цветные кнопки вместо списка
const urgencyPicker = (val) => `<div class="seg-pick" role="radiogroup">${URGENCY.map(([k, l]) =>
  `<label class="u-opt u-${k}"><input type="radio" name="urgency" value="${k}"${k === (val || 'normal') ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>`;

// ячейка «Место (не партнёр)»: выбор гостя из вариантов или место, указанное вручную
const mapsLink = (v) => v.maps || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([v.name, v.address].filter(Boolean).join(', '))}`;
function venueCell(v) {
  const json = esc(v?.name ? JSON.stringify(v) : '');
  if (!v?.name) return `<div class="vcell empty" id="f-venue_json"><span>Не выбрано</span><button type="button" class="vo-btn" data-venue-edit>+ Указать</button><input type="hidden" name="venue_json" value=""></div>`;
  const tel = (v.phone || '').replace(/[^\d+]/g, '');
  const links = [`<a class="vo-btn sm" href="${esc(mapsLink(v))}" target="_blank" rel="noopener">Карта</a>`,
    tel && `<a class="vo-btn sm" href="tel:${esc(tel)}">Позвонить</a>`,
    v.website && `<a class="vo-btn sm" href="${esc(v.website)}" target="_blank" rel="noopener">Сайт</a>`,
    v.email && `<a class="vo-btn sm" href="mailto:${esc(v.email)}">Почта</a>`].filter(Boolean).join('');
  return `<div class="vcell" id="f-venue_json">
    <div class="vcell-top"><b class="vcell-name">${esc(v.name)}</b>
      <span class="vcell-tools"><button type="button" class="vo-btn icon sm" data-venue-edit title="Изменить" aria-label="Изменить место">✎</button><button type="button" class="vo-btn icon sm" data-venue-clear title="Убрать" aria-label="Убрать место">✕</button></span></div>
    ${v.address ? `<small class="vcell-addr">${esc(v.address)}</small>` : ''}
    <div class="vcell-links">${links}</div>
    <input type="hidden" name="venue_json" value="${json}"></div>`;
}
// окошко ввода места — прямо в карточке, чтобы не терять остальные поля формы
const venuePop = () => `<div class="vpop" id="vpop" hidden>
  <div class="vpop-h"><b>Место</b><small>не из ваших партнёров</small></div>
  <label class="vpop-f full"><span>Название</span><input id="vp-name" type="text" autocomplete="off" placeholder="Le Comptoir du Marché"></label>
  <label class="vpop-f full"><span>Адрес</span><input id="vp-address" type="text" autocomplete="off" placeholder="8 Rue du Marché, 06300 Nice"></label>
  <label class="vpop-f"><span>Телефон</span><input id="vp-phone" type="tel" autocomplete="off" placeholder="+33 4 93 00 00 00"></label>
  <label class="vpop-f"><span>Сайт</span><input id="vp-website" type="text" autocomplete="off" placeholder="example.com"></label>
  <label class="vpop-f full"><span>Почта <em>необязательно</em></span><input id="vp-email" type="email" autocomplete="off" placeholder="booking@example.com"></label>
  <div class="vpop-act"><button type="button" class="btn small" data-vp-cancel>Отмена</button><button type="button" class="btn small primary" data-vp-ok>Готово</button></div>
</div>`;
function bindVenue(form) {
  const cellBox = () => form.querySelector('#f-venue_json');
  const pop = form.querySelector('#vpop');
  const cur = () => { try { return JSON.parse(cellBox().querySelector('[name="venue_json"]').value || 'null'); } catch { return null; } };
  const setCell = (v) => { cellBox().outerHTML = venueCell(v); };
  const f = (k) => pop.querySelector('#vp-' + k);
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-venue-edit]')) {
      const v = cur() || {};
      ['name', 'address', 'phone', 'website', 'email'].forEach((k) => { f(k).value = v[k] || ''; });
      pop.hidden = false; f('name').focus();
      pop.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (e.target.closest('[data-venue-clear]')) setCell(null);
    else if (e.target.closest('[data-vp-cancel]')) pop.hidden = true;
    else if (e.target.closest('[data-vp-ok]')) {
      const name = f('name').value.trim();
      if (!name) { f('name').focus(); return toast('Впишите название места', 'err'); }
      let website = f('website').value.trim();
      if (website && !/^https?:\/\//i.test(website)) website = 'https://' + website;
      const email = f('email').value.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { f('email').focus(); return toast('Проверьте почту', 'err'); }
      const prev = cur() || {};
      const v = { ...prev, kind: 'place', name, address: f('address').value.trim(), phone: f('phone').value.trim(), website, email, from: prev.name === name ? prev.from || 'manual' : 'manual' };
      v.maps = prev.name === name && prev.address === v.address && prev.maps ? prev.maps : mapsLink({ name, address: v.address });
      setCell(v);
      pop.hidden = true;
    }
  });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pop.querySelector('[data-vp-ok]').click(); } });
}

// ---------- форма запроса: выбор гостя, стоп-лист, срочность, место, раскрытие полей ----------
const SPRING = typeof CSS !== 'undefined' && CSS.supports?.('animation-timing-function', 'linear(0, 1)')
  ? 'linear(0, .06 2%, .23 5%, .5 9.5%, .77 15%, .93 21%, 1.01 28%, 1.03 34%, 1.015 44%, 1 60%, 1)' : 'cubic-bezier(.22, 1, .36, 1)';
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const QUICK = [['Столик в ресторане', 'Dining'], ['Трансфер', 'Transport'], ['Спа на двоих', 'Spa & Wellness'], ['Бронь отеля', 'Accommodation'], ['Подарок', 'Gifts & Events']];

// капсула гостя: имя, живое время, стоп-лист — раскрывается при выборе
function gpFace(id) {
  const chev = '<span class="gp-chev" aria-hidden="true">▾</span>';
  if (id === '__new') return `<span class="gp-row"><span class="av gp-av av-none">＋</span><span class="gp-txt"><b>Новый гость</b><small>впишите имя ниже</small></span>${chev}</span>`;
  const c = byId('clients', id);
  if (!c) return `<span class="gp-row"><span class="av gp-av av-none">?</span><span class="gp-txt"><b class="gp-ph">Выберите гостя</b><small>поиск по имени и городу</small></span>${chev}</span>`;
  const w = guestWhere(c);
  const d = w ? diffHours('Europe/Paris', w.tz) : 0;
  const clock = w ? `<span class="gp-clock${isQuiet(w.tz) ? ' quiet' : ''}"><i aria-hidden="true"></i><b data-tz-clock="${esc(w.tz)}">${timeIn(w.tz)}</b> ${esc(w.place)}${d ? ` · ${fmtDiff(d)} к Парижу` : ''}${isQuiet(w.tz) ? ' · ночь' : ''}</span>` : '';
  const risk = ['allergies', 'diet', 'health'].flatMap((k) => c[k] || []);
  const avoid = c.dislikes || [];
  const pills = risk.slice(0, 4).map((x) => `<span class="gp-pill">⚠ ${esc(x)}</span>`).join('') + (risk.length > 4 ? `<span class="gp-pill">+${risk.length - 4}</span>` : '')
    + avoid.slice(0, 2).map((x) => `<span class="gp-pill soft">✕ ${esc(x)}</span>`).join('');
  return `<span class="gp-row">${avatar(c, 'gp-av')}<span class="gp-txt"><b>${esc(c.name)}${c.vip ? ' <span class="gp-star">★</span>' : ''}</b><small>${esc([c.city, c.language].filter(Boolean).join(' · ') || 'город не указан')}</small></span>${chev}</span>
    ${clock || pills ? `<span class="gp-extra">${clock}${pills}</span>` : ''}`;
}
const hasRisk = (c) => ['allergies', 'diet', 'health'].some((k) => (c[k] || []).length);

function bindGuest(form) {
  const sel = form.client_id, box = form.querySelector('#gp');
  const btn = box.querySelector('.gp-btn'), pop = box.querySelector('.gp-pop'), q = box.querySelector('.gp-q'), list = box.querySelector('.gp-list');
  const clients = [...state.clients].sort((a, b) => (b.vip - a.vip) || a.name.localeCompare(b.name, 'ru'));
  let items = [], idx = 0;
  const row = (c, i) => c.id === '__new'
    ? `<button type="button" role="option" class="gp-opt new${i === idx ? ' act' : ''}" data-id="__new"><span class="av gp-av av-none">＋</span><span class="gp-txt"><b>Новый гость…</b><small>добавить в клиенты</small></span></button>`
    : `<button type="button" role="option" aria-selected="${c.id === sel.value}" class="gp-opt${i === idx ? ' act' : ''}" data-id="${c.id}">${avatar(c, 'gp-av')}<span class="gp-txt"><b>${esc(c.name)}${c.vip ? ' <span class="gp-star">★</span>' : ''}</b><small>${esc(c.city || c.language || '')}</small></span>${hasRisk(c) ? '<i class="gp-risk" title="Есть стоп-лист"></i>' : ''}</button>`;
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    items = clients.filter((c) => !t || [c.name, c.city, c.telegram].join(' ').toLowerCase().includes(t));
    items = t ? [...items, { id: '__new' }] : [{ id: '__new' }, ...items];
    idx = Math.min(idx, items.length - 1);
    list.innerHTML = items.map(row).join('');
    list.querySelector('.act')?.scrollIntoView({ block: 'nearest' });
  };
  const open = (on) => {
    if (on === !pop.hidden) return;
    pop.hidden = !on; btn.setAttribute('aria-expanded', String(on)); box.classList.toggle('open', on);
    if (!on) return;
    q.value = ''; idx = Math.max(0, clients.findIndex((c) => c.id === sel.value) + 1); draw(); q.focus();
    if (!calm()) pop.animate([{ opacity: 0, transform: 'translateY(-6px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: SPRING });
  };
  const pick = (id) => {
    const h0 = btn.offsetHeight;
    sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true }));
    btn.innerHTML = gpFace(id); open(false); btn.focus();
    if (calm()) return;
    const h1 = btn.offsetHeight;
    btn.animate([{ height: h0 + 'px', transform: 'scale(.985)' }, { height: h1 + 'px', transform: 'none' }], { duration: 560, easing: SPRING });
    btn.querySelectorAll('.gp-extra > *').forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(6px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 460, delay: 90 + i * 45, easing: SPRING, fill: 'backwards' }));
  };
  btn.addEventListener('click', () => open(pop.hidden));
  list.addEventListener('click', (e) => { const o = e.target.closest('[data-id]'); if (o) pick(o.dataset.id); });
  q.addEventListener('input', () => { idx = 0; draw(); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[idx]) pick(items[idx].id); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); open(false); btn.focus(); }
  });
  form.addEventListener('click', (e) => { if (!box.contains(e.target)) open(false); });
}

// подложка, которая пружиной переезжает к выбранному варианту
function slidePill(track, ink, target, color) {
  if (!target) { ink.style.opacity = 0; return; }
  const to = { x: target.offsetLeft, y: target.offsetTop, w: target.offsetWidth, h: target.offsetHeight };
  const frame = (p) => ({ transform: `translate(${p.x}px, ${p.y}px)`, width: p.w + 'px', height: p.h + 'px' });
  const from = ink._at;
  ink._at = to;
  if (color) ink.dataset.u = color;
  Object.assign(ink.style, frame(to), { opacity: 1 });
  if (from && (from.x !== to.x || from.w !== to.w) && !calm()) ink.animate([frame(from), frame(to)], { duration: 560, easing: SPRING });
}

function bindRequestForm(form) {
  // срочность
  const urg = form.querySelector('.seg-pick');
  if (urg) {
    const ink = document.createElement('span'); ink.className = 'u-ink'; ink.setAttribute('aria-hidden', 'true'); urg.prepend(ink);
    const place = () => { const r = urg.querySelector('input:checked'); slidePill(urg, ink, r?.parentElement, r?.value); };
    urg.addEventListener('change', place);
    requestAnimationFrame(place);
    addEventListener('resize', () => { ink._at = null; place(); });
  }
  // быстрые варианты «Что нужно»
  const sum = form.summary, chips = form.querySelector('#rq-quick');
  const syncChips = () => chips?.classList.toggle('gone', !!sum.value.trim());
  sum.addEventListener('input', syncChips);
  chips?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-qf]'); if (!b) return;
    sum.value = b.dataset.qf + ' '; form.category.value = b.dataset.cat; syncChips();
    sum.focus(); sum.setSelectionRange(sum.value.length, sum.value.length);
  });
  // бюджет > 500 → «Нужна проверка» (то же правило есть в базе)
  const amt = form.budget_amount, auto = form.querySelector('#rq-auto');
  let over = Number(amt.value) > 500;
  const budget = () => {
    const now = amt.value !== '' && Number(amt.value) > 500;
    auto.classList.toggle('on', now);
    if (now && !over && !form.needs_review.checked) {
      form.needs_review.checked = true;
      if (!calm()) form.needs_review.closest('.check').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'none' }], { duration: 420, easing: SPRING });
    }
    over = now;
  };
  amt.addEventListener('input', budget); budget();
  // партнёр или своё место
  const vt = form.querySelector('.rq-vtabs');
  if (vt) {
    const ink = document.createElement('span'); ink.className = 'v-ink'; ink.setAttribute('aria-hidden', 'true'); vt.prepend(ink);
    const dots = () => {
      vt.querySelector('[data-vt="partner"]').classList.toggle('has', !!form.partner_id.value);
      vt.querySelector('[data-vt="place"]').classList.toggle('has', !!form.querySelector('[name="venue_json"]')?.value);
    };
    const show = (k, anim) => {
      vt.querySelectorAll('[data-vt]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.vt === k)));
      form.querySelectorAll('[data-vpane]').forEach((p) => {
        p.hidden = p.dataset.vpane !== k;
        if (!p.hidden && anim && !calm()) p.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: SPRING });
      });
      slidePill(vt, ink, vt.querySelector(`[data-vt="${k}"]`));
      if (k === 'partner') form.querySelector('#vpop').hidden = true;
    };
    vt.addEventListener('click', (e) => { const b = e.target.closest('[data-vt]'); if (b) show(b.dataset.vt, true); });
    form.partner_id.addEventListener('change', dots);
    form.addEventListener('click', () => setTimeout(dots, 0));
    requestAnimationFrame(() => show(vt.dataset.start, false));
    dots();
    addEventListener('resize', () => { ink._at = null; slidePill(vt, ink, vt.querySelector('[aria-selected="true"]')); });
  }
  // «+ Уточнить у гостя», «+ Исходное сообщение» — поля раскрываются по нажатию
  const grow = (t) => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; };
  form.querySelectorAll('.rq-fold textarea').forEach((t) => { t.addEventListener('input', () => grow(t)); if (t.value) requestAnimationFrame(() => grow(t)); });
  form.querySelectorAll('[data-unfold]').forEach((b) => b.addEventListener('click', () => {
    const fold = form.querySelector(`[data-fold="${b.dataset.unfold}"]`);
    fold.classList.add('open'); b.classList.add('gone');
    setTimeout(() => fold.querySelector('textarea')?.focus({ preventScroll: true }), 120);
    setTimeout(() => fold.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' }), 200);
  }));
  // «Сохранить» чуть тянется за курсором
  const ok = form.querySelector('#ok');
  ok?.classList.add('rq-shine');
  if (ok && matchMedia('(pointer: fine)').matches && !calm()) {
    ok.addEventListener('pointermove', (e) => { const r = ok.getBoundingClientRect(); ok.style.translate = `${(e.clientX - r.left - r.width / 2) * .15}px ${(e.clientY - r.top - r.height / 2) * .25}px`; });
    ok.addEventListener('pointerleave', () => { ok.style.translate = ''; });
  }
}

export function editRequest(id, presetClient, preset = {}) {
  const ex = id ? byId('requests', id) : null;
  if (ex && !ex.checklist) {
    // запрос создан до появления чек-листов — собираем его сейчас
    ex.checklist = buildChecklist(ex);
    save('requests', id, { checklist: ex.checklist }).catch(() => {});
  }
  const r = id ? byId('requests', id) : { client_id: presetClient || '', status: firstKey(), urgency: 'normal', category: 'Other', currency: 'EUR', ...preset };
  if (!r) return;
  const clients = [...state.clients].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((c) => [c.id, (c.vip ? '★ ' : '') + c.name]);
  const partners = [...state.partners].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((p) => [p.id, `${p.name} · ${PARTNER_TYPE_LABEL[p.type] || ''}${p.city ? ' · ' + p.city : ''}`]);
  const body =
    (id ? requestOptionsBar(r) : '') +
    roadSlot(r) +
    checklistSection(r) +
    `<div class="f rq-guest"><label for="f-client_pick">Гость</label>${select('client_id', options([['__new', '+ Новый гость…'], ...clients], r.client_id, '— выберите —'), 'class="gp-native" tabindex="-1" aria-hidden="true"')}
      <div class="gp" id="gp"><button type="button" class="gp-btn" id="f-client_pick" aria-haspopup="listbox" aria-expanded="false">${gpFace(r.client_id)}</button>
        <div class="gp-pop" hidden><input type="search" class="gp-q" placeholder="Найти гостя…" autocomplete="off" aria-label="Найти гостя"><div class="gp-list" role="listbox"></div></div></div></div>` +
    `<div class="newguest" id="newguest" hidden><div class="f2">${field('new_name', 'Имя нового гостя', input('new_name', '', 'type="text" autocomplete="off" placeholder="Как записать гостя"'))}` +
    field('new_language', 'Язык', select('new_language', options(LANGUAGES, 'RU'))) + '</div>' +
    field('new_allergies', 'Аллергии и ограничения (если знаете)', input('new_allergies', '', 'type="text" placeholder="через запятую"')) + '</div>' +
    `<div class="f rq-what"><label for="f-summary">Что нужно</label><div class="rq-cmd"><span class="rq-cmd-ico" aria-hidden="true">✦</span>${input('summary', r.summary, 'type="text" required class="rq-hero" placeholder="Массаж на двоих в пятницу вечером"')}</div>
      <div class="rq-quick${r.summary ? ' gone' : ''}" id="rq-quick">${QUICK.map(([t, c]) => `<button type="button" class="rq-chip" data-qf="${esc(t)}" data-cat="${esc(c)}">${CATEGORIES[c] || ''} ${esc(t)}</button>`).join('')}</div></div>` +
    `<div class="f2">${field('category', 'Категория', select('category', options(Object.entries(CATEGORIES).map(([k, i]) => [k, i + ' ' + k]), r.category)))}` +
    field('status', 'Статус', select('status', options(statusOptions(), statusOf(r.status) ? r.status : firstKey()))) + '</div>' +
    field('urgency', 'Срочность', urgencyPicker(r.urgency)) +
    field('deadline', 'Срок · время Парижа', deadlinePicker(r.deadline) + '<small class="gtime" id="req-gtime"></small>') +
    `<div class="f rq-budget"><label for="f-budget_amount">Бюджет</label>
      <div class="rq-money">${input('budget_amount', r.budget_amount, 'type="number" min="0" step="any" inputmode="decimal" placeholder="0"')}${select('currency', options(CURRENCIES, r.currency || 'EUR'), 'aria-label="Валюта"')}</div>
      <span class="rq-auto" id="rq-auto">✦ Авто-проверка &gt; 500</span></div>` +
    `<div class="f rq-venue"><label>Где</label>
      <div class="rq-vtabs" role="tablist" data-start="${!r.partner_id && r.venue?.name ? 'place' : 'partner'}"><button type="button" role="tab" data-vt="partner" aria-selected="true">★ Партнёр<i aria-hidden="true"></i></button><button type="button" role="tab" data-vt="place" aria-selected="false">📍 Место (не партнёр)<i aria-hidden="true"></i></button></div>
      <div data-vpane="partner">${select('partner_id', options(partners, r.partner_id, '— не выбран —'), 'aria-label="Партнёр"')}</div>
      <div data-vpane="place" hidden>${venueCell(r.venue)}</div></div>` + venuePop() +
    `<div class="rq-more">
      <button type="button" class="rq-pill${r.clarifying_questions ? ' gone' : ''}" data-unfold="clarifying_questions">＋ Уточнить у гостя</button>
      <button type="button" class="rq-pill${r.original_message ? ' gone' : ''}" data-unfold="original_message">＋ Исходное сообщение</button></div>` +
    `<div class="rq-fold${r.clarifying_questions ? ' open' : ''}" data-fold="clarifying_questions"><div>${field('clarifying_questions', 'Что уточнить у гостя', area('clarifying_questions', r.clarifying_questions, 'rows="2"'))}</div></div>` +
    `<div class="rq-fold${r.original_message ? ' open' : ''}" data-fold="original_message"><div>${field('original_message', 'Исходное сообщение гостя', area('original_message', r.original_message, 'rows="2"'))}</div></div>` +
    `<div class="checks">${check('needs_approval', 'Нужно одобрение гостя', r.needs_approval)}` +
    `${check('needs_review', 'Нужна проверка', r.needs_review)}</div><small class="hint">«Нужна проверка» ставится сама, если бюджет больше 500.</small>`;
  const m = openModal({
    title: id ? 'Запрос' : 'Новый запрос',
    body,
    cls: 'rq',
    onSave: async (v) => {
      let clientId = nul(v.client_id);
      if (clientId === '__new') {
        const name = v.new_name.trim();
        const same = state.clients.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
        if (same) clientId = same.id;
        else {
          const created = await save('clients', null, { name, language: v.new_language, allergies: toList(v.new_allergies) });
          clientId = created.id;
          toast(`Гость «${name}» добавлен в клиенты`);
        }
      }
      await save('requests', id, {
        client_id: clientId, summary: v.summary.trim(), category: v.category, status: v.status, urgency: v.urgency,
        deadline: fromParisInput(v.deadline), budget_amount: v.budget_amount === '' ? null : Number(v.budget_amount),
        currency: v.budget_amount === '' ? nul(v.currency) : v.currency, partner_id: nul(v.partner_id),
        venue: (() => { try { return v.venue_json ? JSON.parse(v.venue_json) : null; } catch { return r.venue || null; } })(),
        clarifying_questions: nul(v.clarifying_questions.trim()), original_message: nul(v.original_message.trim()),
        needs_approval: v.needs_approval, needs_review: v.needs_review,
      });
      toast(id ? 'Запрос сохранён' : 'Запрос создан');
    },
    onDelete: id ? async () => { await remove('requests', id); toast('Запрос удалён'); } : null,
  });
  if (id) m.form.dataset.reqId = id; // окна, открытые отсюда, по «Закрыть» вернутся в карточку
  bindVenue(m.form);
  bindGuest(m.form);
  bindRequestForm(m.form);
  bindDeadlinePicker(m.form);
  bindChecklist(m.form);
  bindRoad(m.form);
  // «для гостя — 22:00 по Москве»: обновляем при смене срока или гостя
  const gtime = () => {
    const el = m.form.querySelector('#req-gtime');
    const c = byId('clients', m.form.client_id.value);
    const v = m.form.querySelector('[name="deadline"]')?.value;
    el.innerHTML = c && v ? guestTimeLine(c, fromParisInput(v)) : '';
  };
  gtime();
  m.form.addEventListener('click', () => setTimeout(gtime, 0));
  m.form.client_id.addEventListener('change', gtime);
  if (matchMedia('(pointer:fine)').matches) (r.client_id ? m.form.summary : m.form.querySelector('#f-client_pick')).focus();
  m.form.client_id.addEventListener('change', (e) => {
    const isNew = e.target.value === '__new';
    m.form.querySelector('#newguest').hidden = !isNew;
    m.form.new_name.required = isNew;
    if (isNew) m.form.new_name.focus();
  });
}

export function editClient(id) {
  const c = id ? byId('clients', id) : { language: 'RU', vip: false };
  if (!c) return;
  const lines = (l) => (l || []).join('\n');
  const body =
    field('name', 'Имя', input('name', c.name, 'type="text" required autocomplete="off"')) +
    `<div class="f2">${field('language', 'Язык общения', select('language', options(LANGUAGES, c.language)))}` +
    field('city', 'Город', input('city', c.city, 'type="text"')) + '</div>' +
    `<div class="f2">${field('citizenship', 'Гражданство', select('citizenship', options(CITIZENSHIPS, c.citizenship, '— не указано —')), 'Нужно для брифинга «Перед вылетом»: визы, платежи')}` +
    field('home_tz', 'Часовой пояс дома', select('home_tz', options(ZONES.some(([z]) => z === c.home_tz) || !c.home_tz ? ZONES : [[c.home_tz, c.home_tz], ...ZONES], c.home_tz, '— определить по городу —')), 'Jarvis покажет время гостя и не даст написать ночью') + '</div>' +
    `<div class="f2">${field('phone', 'Телефон', input('phone', c.phone, 'type="tel" placeholder="+33 6 00 00 00 00" autocomplete="off"'))}` +
    field('email', 'Почта', input('email', c.email, 'type="email" placeholder="name@mail.com" autocapitalize="off" autocomplete="off"')) + '</div>' +
    `<div class="f2">${field('telegram', 'Telegram', input('telegram', c.telegram, 'type="text" placeholder="@username" autocapitalize="off"'))}` +
    field('last_contact', 'Последний контакт', input('last_contact', c.last_contact, 'type="date"')) + '</div>' +
    field('bd_day', 'День рождения', birthdayField(c.birthday), 'Год можно не указывать') +
    `<div class="checks">${check('vip', '★ VIP-клиент', c.vip)}</div>` +
    '<h3 class="form-sec warn">Аллергии и ограничения</h3>' +
    field('allergies', 'Аллергии', area('allergies', lines(c.allergies), 'rows="2"'), 'По одной на строку или через запятую') +
    `<div class="f2">${field('diet', 'Диета', area('diet', lines(c.diet), 'rows="2"'))}` +
    field('health', 'Здоровье', area('health', lines(c.health), 'rows="2"')) + '</div>' +
    '<h3 class="form-sec">Предпочтения</h3>' +
    `<div class="f2">${field('pref_food', 'Еда', area('pref_food', c.pref_food, 'rows="2"'))}` +
    field('pref_spa', 'Спа', area('pref_spa', c.pref_spa, 'rows="2"')) + '</div>' +
    `<div class="f2">${field('pref_transport', 'Транспорт', area('pref_transport', c.pref_transport, 'rows="2"'))}` +
    field('pref_hotels', 'Отели', area('pref_hotels', c.pref_hotels, 'rows="2"')) + '</div>' +
    '<h3 class="form-sec">Любит и избегает</h3>' +
    `<div class="f2">${field('likes', '❤️ Любит', area('likes', lines(c.likes), 'rows="2" placeholder="пионы, столик у окна"'))}` +
    field('dislikes', '🚫 Избегает', area('dislikes', lines(c.dislikes), 'rows="2" placeholder="лилии, шумные места"')) + '</div>' +
    '<h3 class="form-sec">В пути</h3>' +
    field('travel_habits', 'Привычки', area('travel_habits', c.travel_habits, 'rows="2" placeholder="Место у окна, 20° в номере, перьевые подушки"')) +
    field('loyalty', 'Программы лояльности', area('loyalty', lines(c.loyalty), 'rows="2" placeholder="Air France · Platinum"'), 'По одной на строку') +
    field('travel_history', 'Заметки о прошлых поездках', area('travel_history', lines(c.travel_history)), 'Новые поездки лучше добавлять во вкладке «Поездки»') +
    field('concierge_notes', 'Заметки консьержа', area('concierge_notes', c.concierge_notes));
  const mc = openModal({
    title: id ? 'Клиент' : 'Новый клиент',
    body,
    onSave: async (v) => {
      const row = await save('clients', id, {
        name: v.name.trim(), language: v.language, city: nul(v.city.trim()), citizenship: nul(v.citizenship), home_tz: nul(v.home_tz) || (await lookupPlace(v.city))?.tz || null, telegram: nul(v.telegram.trim()), phone: nul(v.phone.trim()), email: nul(v.email.trim()), birthday: birthdayValue(v), vip: v.vip,
        last_contact: nul(v.last_contact), allergies: toList(v.allergies), diet: toList(v.diet), health: toList(v.health),
        pref_food: nul(v.pref_food.trim()), pref_spa: nul(v.pref_spa.trim()), pref_transport: nul(v.pref_transport.trim()), pref_hotels: nul(v.pref_hotels.trim()),
        travel_history: v.travel_history.split('\n').map((s) => s.trim()).filter(Boolean),
        likes: toList(v.likes), dislikes: toList(v.dislikes), travel_habits: nul(v.travel_habits.trim()),
        loyalty: v.loyalty.split('\n').map((s) => s.trim()).filter(Boolean),
        concierge_notes: nul(v.concierge_notes.trim()),
      });
      ui.client = row.id;
      render();
      toast(id ? 'Клиент сохранён' : 'Клиент добавлен');
    },
    onDelete: id ? async () => {
      await remove('clients', id);
      ui.client = null; render();
      toast('Клиент удалён. Его запросы остались на доске без клиента.');
    } : null,
  });
  mc.form.city.addEventListener('change', async (e) => {
    if (mc.form.home_tz.value) return;
    const p = await lookupPlace(e.target.value);
    if (!p?.tz) return;
    if (![...mc.form.home_tz.options].some((o) => o.value === p.tz)) mc.form.home_tz.add(new Option(p.tz, p.tz));
    mc.form.home_tz.value = p.tz;
    mc.form.home_tz.classList.add('flash');
  });
}

export function editPartner(id) {
  const p = id ? byId('partners', id) : { type: 'spa' };
  if (!p) return;
  const body =
    field('name', 'Название', input('name', p.name, 'type="text" required')) +
    `<div class="f2">${field('type', 'Тип', select('type', options(PARTNER_TYPES, p.type)))}` +
    field('city', 'Город', input('city', p.city, 'type="text"')) + '</div>' +
    field('address', 'Адрес', input('address', p.address, 'type="text" placeholder="12 Rue de Rivoli, Paris"'), 'Нужен Jarvis, чтобы следить за пробками по пути к партнёру') +
    field('contact', 'Контакт', area('contact', p.contact, 'rows="2"'), 'Имя менеджера, телефон, почта, сайт') +
    `<div class="f2">${field('commission', 'Комиссия', input('commission', p.commission, 'type="text" placeholder="10%"'))}` +
    field('rating', 'Моя оценка', select('rating', options([[5, '★★★★★'], [4, '★★★★'], [3, '★★★'], [2, '★★'], [1, '★']], p.rating, '— без оценки —'))) + '</div>' +
    field('terms', 'Условия', area('terms', p.terms, 'rows="2"'), 'Как бронировать, сроки, отмена') +
    field('notes', 'Заметки', area('notes', p.notes));
  openModal({
    title: id ? 'Партнёр' : 'Новый партнёр',
    body,
    onSave: async (v) => {
      await save('partners', id, {
        name: v.name.trim(), type: v.type, city: nul(v.city.trim()), address: nul(v.address.trim()), contact: nul(v.contact.trim()),
        commission: nul(v.commission.trim()), rating: v.rating ? Number(v.rating) : null, terms: nul(v.terms.trim()), notes: nul(v.notes.trim()),
      });
      toast(id ? 'Партнёр сохранён' : 'Партнёр добавлен');
    },
    onDelete: id ? async () => { await remove('partners', id); toast('Партнёр удалён'); } : null,
  });
}

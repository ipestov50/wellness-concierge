// Досье гостя: поездки, окружение, важные даты, «любит / избегает»
import { TZ } from './const.js';
import { esc, options, field, openModal, toast, toList, fromParisInput, toParisInput, initials } from './ui.js';
import { state, byId, save, remove, patchLocal } from './data.js';
import { getSupabase } from './supabase.js';
import { deadlinePicker, bindDeadlinePicker } from './datepicker.js';
import { birthdayField, birthdayValue, birthdayInfo } from './birthday.js';
import { render } from './router.js';
import { timeField, bindTimeFields } from './timefield.js';
import { lookupPlace, flag as flagOf } from './tz.js';

// ---------- поездки ----------
export const parisToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dayDiff = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 864e5);
const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c; };

export function tripState(t, today = parisToday()) {
  const s = t.start_date, e = t.end_date || t.start_date;
  if (!s) return { kind: 'unknown', label: 'даты не указаны' };
  if (s <= today && today <= e) {
    const left = dayDiff(e, today);
    return { kind: 'now', label: left === 0 ? 'уезжает сегодня' : `сейчас там · ещё ${left} ${plural(left, 'день', 'дня', 'дней')}` };
  }
  if (s > today) {
    const n = dayDiff(s, today);
    return { kind: 'soon', days: n, label: n === 0 ? 'прилетает сегодня' : n === 1 ? 'прилетает завтра' : `через ${n} ${plural(n, 'день', 'дня', 'дней')}` };
  }
  return { kind: 'past', label: 'прошла' };
}

const D = (v, o) => new Date(v + 'T12:00:00Z').toLocaleDateString('ru-RU', { timeZone: 'UTC', ...o });
export function fmtRange(t) {
  if (!t.start_date) return '';
  const e = t.end_date || t.start_date;
  const sameYear = t.start_date.slice(0, 4) === e.slice(0, 4);
  const sameMonth = sameYear && t.start_date.slice(5, 7) === e.slice(5, 7);
  const year = e.slice(0, 4) !== parisToday().slice(0, 4) ? ' ' + e.slice(0, 4) : '';
  if (t.start_date === e) return D(e, { day: 'numeric', month: 'short' }) + year;
  if (sameMonth) return `${+t.start_date.slice(8)}–${D(e, { day: 'numeric', month: 'short' })}${year}`;
  return `${D(t.start_date, { day: 'numeric', month: 'short' })} – ${D(e, { day: 'numeric', month: 'short' })}${year}`;
}
export const fmtFlight = (iso) => (iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

// ---------- ссылка для гостя ----------
const waDigits = (v) => String(v || '').replace(/\D/g, '');
async function ensureWhatsapp(sb) {
  let { data: s } = await sb.from('app_settings').select('owner_id,portal_whatsapp').maybeSingle();
  if (!s) ({ data: s } = await sb.from('app_settings').insert({}).select('owner_id,portal_whatsapp').single());
  if (s?.portal_whatsapp || localStorage.getItem('portalWaAsked')) return;
  await new Promise((done) => {
    let saved = false;
    const m = openModal({
      title: 'WhatsApp консьержа',
      body: field('portal_whatsapp', 'Номер для кнопки «Написать» у гостя', inp('portal_whatsapp', '', 'type="tel" inputmode="tel" placeholder="33612345678" autocomplete="off"'), 'Только цифры с кодом страны, 8–15 цифр. Можно оставить пустым.'),
      saveLabel: 'Сохранить',
      onSave: async (v) => {
        const d = waDigits(v.portal_whatsapp);
        if (d && (d.length < 8 || d.length > 15)) throw new Error('номер: от 8 до 15 цифр');
        if (d) { const { error } = await sb.from('app_settings').update({ portal_whatsapp: d }).eq('owner_id', s.owner_id); if (error) throw error; }
        saved = true;
      },
      onClose: () => { if (!saved) localStorage.setItem('portalWaAsked', '1'); done(); },
    });
    void m;
  });
}
const portalUrl = (tok) => `${location.origin}/t/${tok}`;
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
export async function shareClient(clientId, mode = 'on', quiet = false) {
  if (!clientId) { toast('У запроса нет гостя'); return null; }
  try {
    const sb = await getSupabase();
    const had = byId('clients', clientId)?.portal_token;
    if (mode === 'on' && !had) await ensureWhatsapp(sb);
    const { data, error } = await sb.rpc('client_portal_share', { p_client: clientId, p_mode: mode });
    if (error) throw error;
    patchLocal('clients', clientId, { portal_token: data || null });
    if (mode === 'off') { toast('Доступ по ссылке закрыт'); return null; }
    if (!data) throw new Error('нет ссылки');
    if (!quiet || mode === 'rotate') toast((await copyText(portalUrl(data))) ? (mode === 'rotate' ? 'Новая ссылка скопирована' : 'Ссылка для гостя скопирована') : portalUrl(data));
    return data;
  } catch (e) { toast('Не удалось обновить ссылку: ' + (e.message || e)); return null; }
}
export async function shareTrip(id) {
  const t = state.trips.find((x) => x.id === id);
  if (t) await shareClient(t.client_id, 'on');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-trip-share]');
  if (b) { e.preventDefault(); shareTrip(b.dataset.tripShare); }
});

export function tripCard(t, { showGuest = false } = {}) {
  const st = tripState(t);
  const c = byId('clients', t.client_id);
  const showBrief = st.kind === 'now' || st.kind === 'soon';
  return `<div class="trip-wrap"><button type="button" class="trip trip-${st.kind}" data-trip="${t.id}">
    <span class="trip-date"><b>${esc(fmtRange(t) || '—')}</b><small class="ts-${st.kind}">${esc(st.label)}</small></span>
    <span class="trip-main">
      ${showGuest && c ? `<span class="trip-guest">${esc(c.name)}${c.vip ? ' <span class="vip">★</span>' : ''}</span>` : ''}
      <b class="trip-city">${t.country_code ? flagOf(t.country_code) + ' ' : ''}${esc(t.city)}${t.country ? `<span>, ${esc(t.country)}</span>` : ''}</b>
      ${(t.accommodation?.hotelName || t.hotel) ? `<span class="trip-line">🏨 ${esc(t.accommodation?.hotelName || t.hotel)}</span>` : ''}
      ${(t.accommodation?.hotelAddress || t.hotel_address) ? `<span class="trip-line trip-addr">${esc(t.accommodation?.hotelAddress || t.hotel_address)}</span>` : ''}
      ${t.flight_in || t.flight_in_at ? `<span class="trip-line">🛬 ${esc(t.flight_in || '')}${t.flight_in_at ? ' · ' + esc(fmtFlight(t.flight_in_at)) : ''}${t.flight_in_delay ? ` <b class="delay">+${t.flight_in_delay} мин</b>` : ''}</span>` : ''}
      ${t.flight_out || t.flight_out_at ? `<span class="trip-line">🛫 ${esc(t.flight_out || '')}${t.flight_out_at ? ' · ' + esc(fmtFlight(t.flight_out_at)) : ''}${t.flight_out_delay ? ` <b class="delay">+${t.flight_out_delay} мин</b>` : ''}</span>` : ''}
      ${t.companions ? `<span class="trip-line">👥 ${esc(t.companions)}</span>` : ''}
    </span>
  </button>${st.kind !== 'past' ? `<div class="trip-delays"><button type="button" class="trip-delay" data-trip-share="${t.id}">🔗 Ссылка для гостя</button></div>` : ''}${st.kind !== 'past' && (t.flight_in_at || t.flight_out_at) ? `<div class="trip-delays">${[['in', t.flight_in_at, '🛬'], ['out', t.flight_out_at, '🛫']].filter(([, a]) => a && Date.parse(a) > Date.now() - 6 * 36e5).map(([d, , ic]) => `<button type="button" class="trip-delay" data-flight-delay="${t.id}" data-dir="${d}">${ic} ⏱ ${t[`flight_${d}_delay`] ? `задержка +${t[`flight_${d}_delay`]} мин` : 'Задержка?'}</button>`).join('')}</div>` : ''}${showBrief ? `<button type="button" class="trip-brief" data-brief="${t.id}" title="Перед вылетом: погода, праздники, визы, оплата">✈️ Перед вылетом${t.brief ? '' : ' <i>✦</i>'}</button>` : ''}</div>`;
}

const guestOptions = () => [...state.clients].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((c) => [c.id, (c.vip ? '★ ' : '') + c.name]);
const nul = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const inp = (n, v, a = '') => `<input id="f-${n}" name="${n}" value="${esc(v)}" ${a}>`;
// Тексты блока «Проживание» (для правки голосом)
const AC = { sec: 'Проживание', hint: 'Гость увидит эти данные в блоке «Ваше проживание»', name: 'Название отеля', namePh: 'Cheval Blanc', addr: 'Адрес отеля', addrPh: 'Unter den Linden 77, Berlin', guests: 'Гости в номере', room: 'Тип номера', roomPh: 'Сьют с видом на сад', checkin: 'Время заезда', ref: 'Код брони', refPh: 'Необязательно', note: 'Заметка для гостя', notePh: 'Например: номер подготовлен к вашему приезду, ранний заезд согласован', minus: 'Меньше', plus: 'Больше' };
const acStepper = (name, label, val) => `<div class="tr-step" data-step="${name}" data-min="1"><span class="tr-lbl" id="trl-${name}">${esc(label)}</span><div class="tr-pill" role="group" aria-labelledby="trl-${name}"><button type="button" data-d="-1" aria-label="${esc(AC.minus)}: ${esc(label)}">−</button><output class="tr-val" aria-live="polite">${esc(val)}</output><button type="button" data-d="1" aria-label="${esc(AC.plus)}: ${esc(label)}">+</button></div><input type="hidden" name="${name}" value="${esc(val)}"></div>`;

const TT = { tabs: 'Разделы поездки', stay: 'Проживание', fl: 'Перелёты', nt: 'Заметки', ntTitle: 'Заметки консьержа', ntHint: 'Только для вас: гость этого не увидит.', linked: 'Связанные запросы', linkedNone: 'Пока нет', who: 'С кем', whoPh: 'муж, двое детей, няня', outb: 'Туда', back: 'Обратно', fn: 'Рейс / PNR', arr: 'Прилёт · время Парижа', dep: 'Вылет · время Парижа', link: 'Ссылка для гостя', copied: 'Скопировано', copyFail: 'Не удалось скопировать', more: 'Ещё действия', rot: 'Заменить ссылку на новую', off: 'Закрыть доступ' };
const segBtn = (key, label, sel) => `<button type="button" role="tab" id="tt-${key}" aria-controls="tp-${key}" aria-selected="${sel}" tabindex="${sel ? 0 : -1}">${esc(label)}<i class="seg-dot" hidden></i></button>`;

export function editTrip(id, clientId) {
  const t = id ? state.trips.find((x) => x.id === id) : { client_id: clientId || '' };
  if (!t) return;
  const ac = t.accommodation || {};
  const linked = id ? state.requests.filter((r) => r.trip_id === id) : [];
  const dp = (iso, n, e) => deadlinePicker(iso, n, { empty: e, quick: false });
  const body =
    `<div class="f2 tm-grid">${field('client_id', 'Гость', `<select id="f-client_id" name="client_id" required>${options(guestOptions(), t.client_id, '— выберите —')}</select>`)}${field('companions', TT.who, inp('companions', t.companions, `type="text" autocomplete="off" placeholder="${esc(TT.whoPh)}"`))}</div>` +
    `<div class="f2 tm-grid">${field('city', 'Город', inp('city', t.city, 'type="text" required placeholder="Куршевель"'))}${field('country', 'Страна', inp('country', t.country, 'type="text" placeholder="Франция"'))}</div>` +
    `<div class="f2 tm-dates">${field('start', 'Заезд', deadlinePicker(t.start_date ? t.start_date + 'T12:00:00Z' : null, 'start', { dateOnly: true, empty: 'Не указан', quick: false }))}` +
    field('end', 'Выезд', deadlinePicker(t.end_date ? t.end_date + 'T12:00:00Z' : null, 'end', { dateOnly: true, empty: 'Не указан', quick: false })) + '</div>' +
    `<div class="tseg" role="tablist" aria-label="${esc(TT.tabs)}">${segBtn('stay', TT.stay, true)}${segBtn('fl', TT.fl, false)}${segBtn('nt', TT.nt, false)}</div>` +
    `<section class="seg-panel" role="tabpanel" id="tp-stay" aria-labelledby="tt-stay"><small class="hint">${esc(AC.hint)}</small>` +
    field('ac_name', AC.name, inp('ac_name', ac.hotelName || t.hotel, `type="text" autocomplete="off" placeholder="${esc(AC.namePh)}"`)) +
    field('ac_addr', AC.addr, inp('ac_addr', ac.hotelAddress || t.hotel_address, `type="text" autocomplete="street-address" placeholder="${esc(AC.addrPh)}"`)) +
    `<div class="tr-steps ac-pair">${acStepper('ac_guests', AC.guests, Math.max(1, parseInt(ac.guestsCount, 10) || 1))}${field('ac_room', AC.room, inp('ac_room', ac.roomType, `type="text" autocomplete="off" placeholder="${esc(AC.roomPh)}"`))}</div>` +
    field('ac_checkin', AC.checkin, timeField('ac_checkin', ac.checkInTime)) +
    field('ac_ref', AC.ref, inp('ac_ref', ac.bookingReference, `type="text" autocomplete="off" autocapitalize="characters" placeholder="${esc(AC.refPh)}"`)) +
    field('ac_note', AC.note, `<textarea id="f-ac_note" name="ac_note" rows="2" class="autogrow" placeholder="${esc(AC.notePh)}">${esc(ac.conciergeGuestNote)}</textarea>`) + '</section>' +
    `<section class="seg-panel" role="tabpanel" id="tp-fl" aria-labelledby="tt-fl" hidden><div class="seg-sub">${esc(TT.outb)}</div>` +
    `<div class="f2 tm-fl">${field('flight_in', TT.fn, inp('flight_in', t.flight_in, 'type="text" placeholder="AF 1145" autocapitalize="characters" autocomplete="off"'))}${field('flight_in_at', TT.arr, dp(t.flight_in_at, 'flight_in_at', 'Не указано'))}</div>` +
    `<div class="seg-sub">${esc(TT.back)}</div><div class="f2 tm-fl">${field('flight_out', TT.fn, inp('flight_out', t.flight_out, 'type="text" placeholder="AF 1146" autocapitalize="characters" autocomplete="off"'))}${field('flight_out_at', TT.dep, dp(t.flight_out_at, 'flight_out_at', 'Не указано'))}</div></section>` +
    `<section class="seg-panel" role="tabpanel" id="tp-nt" aria-labelledby="tt-nt" hidden><div class="seg-sub">${esc(TT.ntTitle)}</div><small class="hint">${esc(TT.ntHint)}</small>` +
    field('notes', TT.ntTitle, `<textarea id="f-notes" name="notes" rows="4" class="autogrow">${esc(t.notes)}</textarea>`) +
    (id ? `<div class="seg-linked"><span>${esc(TT.linked)}</span><b class="tnum">${linked.length || esc(TT.linkedNone)}</b></div>` : '') + '</section>';
  const m = openModal({
    title: id ? 'Поездка' : 'Новая поездка',
    cls: 'tp',
    body,
    onSave: async (v) => {
      const start = v.start ? v.start.slice(0, 10) : null;
      let end = v.end ? v.end.slice(0, 10) : null;
      if (start && end && end < start) end = start;
      const place = (v.city.trim() !== (t.city || '') || v.country.trim() !== (t.country || '') || !t.tz) ? await lookupPlace(`${v.city.trim()}${v.country.trim() ? ' ' + v.country.trim() : ''}`) || await lookupPlace(v.city.trim()) : null;
      const geo = place ? { tz: place.tz, country_code: place.cc, lat: place.lat, lon: place.lon, country: nul(v.country) || place.country } : {};
      const A = { hotelName: nul(v.ac_name), hotelAddress: nul(v.ac_addr), guestsCount: Math.max(1, parseInt(v.ac_guests, 10) || 1), roomType: nul(v.ac_room), checkInTime: /^\d{2}:\d{2}/.test(v.ac_checkin || '') ? v.ac_checkin.slice(0, 5) : null, bookingReference: nul(v.ac_ref), conciergeGuestNote: nul(v.ac_note) };
      const accom = A.hotelName || A.hotelAddress || A.roomType || A.checkInTime || A.bookingReference || A.conciergeGuestNote || A.guestsCount > 1 ? A : null;
      await save('trips', id, {
        ...geo,
        client_id: v.client_id, city: v.city.trim(), country: nul(v.country), hotel: accom?.hotelName || null, hotel_address: accom?.hotelAddress || null, accommodation: accom, start_date: start, end_date: end,
        flight_in: nul(v.flight_in), flight_in_at: v.flight_in_at ? fromParisInput(v.flight_in_at) : null,
        flight_out: nul(v.flight_out), flight_out_at: v.flight_out_at ? fromParisInput(v.flight_out_at) : null,
        companions: nul(v.companions), notes: nul(v.notes), ...(geo.country ? { country: geo.country } : {}),
      });
      toast(id ? 'Поездка сохранена' : 'Поездка добавлена');
    },
    onDelete: id ? async () => { await remove('trips', id); toast('Поездка удалена'); } : null,
  });
  bindDeadlinePicker(m.form);
  bindTimeFields(m.form);
  m.form.querySelectorAll('.tr-step').forEach((st) => {
    const out = st.querySelector('output'), hid = st.querySelector('input'), min = +st.dataset.min;
    const paint = () => { out.textContent = hid.value; st.querySelector('[data-d="-1"]').disabled = +hid.value <= min; };
    st.addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (!b) return; hid.value = Math.min(99, Math.max(min, +hid.value + +b.dataset.d)); paint(); });
    paint();
  });
  const cid = state.trips.find((x) => x.id === id)?.client_id || clientId;
  wireTripTabs(m.form);
  wireTripDates(m.form, !id);
  if (id) wireTripShare(m.form, cid);
}

// вкладки: все поля остаются в форме, «Сохранить» сохраняет всё сразу
const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = Math.min(Math.max(ta.scrollHeight + 2, 56), 260) + 'px'; };
function wireTripTabs(form) {
  const tabs = [...form.querySelectorAll('.tseg [role=tab]')];
  const show = (tab, focus) => { tabs.forEach((b) => {
    const on = b === tab;
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    form.querySelector('#' + b.getAttribute('aria-controls')).hidden = !on;
    if (on && focus) b.focus();
  });
  requestAnimationFrame(() => form.querySelectorAll('textarea.autogrow').forEach((ta) => ta.offsetParent && grow(ta))); };
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => show(b));
    b.addEventListener('keydown', (e) => {
      const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (k) { e.preventDefault(); show(tabs[(i + k + tabs.length) % tabs.length], true); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); show(tabs[e.key === 'Home' ? 0 : tabs.length - 1], true); }
    });
  });
  const flDot = tabs[1].querySelector('.seg-dot');
  const paint = () => { flDot.hidden = !(form.flight_in.value.trim() || form.flight_out.value.trim() || form.flight_in_at.value || form.flight_out_at.value); };
  form.addEventListener('input', paint); form.addEventListener('click', () => setTimeout(paint));
  paint();
  form.querySelectorAll('textarea.autogrow').forEach((ta) => { ta.addEventListener('input', () => grow(ta)); setTimeout(() => ta.offsetParent && grow(ta), 0); });
}

// Заезд/Выезд → Прилёт/Вылет, пока даты перелётов пусты или остались авто-подставленными
function wireTripDates(form, isNew) {
  void isNew;
  const val = (n) => form[n].value.slice(0, 10);
  let seen = { start: val('start'), end: val('end') };
  const auto = { flight_in_at: '', flight_out_at: '' };
  const fill = (name, date) => {
    const cur = form[name].value;
    if (!date || (cur && cur !== auto[name])) return;
    const v = `${date}T00:00`;
    form[name].closest('[data-dp]').dpSet(v);
    auto[name] = v;
  };
  const upd = () => {
    const now = { start: val('start'), end: val('end') };
    if (now.start !== seen.start) fill('flight_in_at', now.start);
    if (now.end !== seen.end) fill('flight_out_at', now.end);
    seen = now;
  };
  form.addEventListener('click', () => setTimeout(upd));
}

// шапка: ссылка для гостя в один тап + меню «•••»
function wireTripShare(form, cid) {
  const head = form.querySelector('.dlg-head'), x = head.querySelector('#x');
  const has = () => !!byId('clients', cid)?.portal_token;
  const box = document.createElement('div');
  box.className = 'trip-hd';
  box.innerHTML = `<button type="button" class="tr-link" id="tripShare"><span class="tr-link-t">🔗 ${esc(TT.link)}</span></button>
    <div class="tr-more"><button type="button" class="tr-dots" id="tripMore" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(TT.more)}">•••</button>
    <div class="tr-menu" role="menu" hidden><button type="button" role="menuitem" id="tripRotate">${esc(TT.rot)}</button><button type="button" role="menuitem" id="tripRevoke" class="danger">${esc(TT.off)}</button></div></div>`;
  head.insertBefore(box, x);
  const share = box.querySelector('#tripShare'), dots = box.querySelector('#tripMore'), menu = box.querySelector('.tr-menu');
  const items = [...menu.querySelectorAll('button')];
  const paint = () => items.forEach((b) => (b.disabled = !has()));
  const setMenu = (open) => { menu.hidden = !open; dots.setAttribute('aria-expanded', String(open)); if (open) { paint(); items.find((b) => !b.disabled)?.focus(); } };
  let tm;
  share.onclick = async () => {
    share.disabled = true;
    const tok = await shareClient(cid, 'on', true);
    share.disabled = false; paint();
    if (!tok) return;
    const ok = await copyText(portalUrl(tok));
    const t = share.querySelector('.tr-link-t'); clearTimeout(tm);
    t.textContent = ok ? `${TT.copied} ✓` : TT.copyFail; share.classList.add('done');
    tm = setTimeout(() => { t.textContent = `🔗 ${TT.link}`; share.classList.remove('done'); }, 2200);
  };
  dots.onclick = () => setMenu(menu.hidden);
  menu.addEventListener('keydown', (e) => {
    const k = { ArrowDown: 1, ArrowUp: -1 }[e.key]; if (!k) return;
    e.preventDefault(); const on = items.filter((b) => !b.disabled); const i = on.indexOf(document.activeElement);
    on[(i + k + on.length) % on.length]?.focus();
  });
  box.addEventListener('focusout', (e) => { if (!menu.hidden && !box.contains(e.relatedTarget)) setMenu(false); });
  box.querySelector('#tripRotate').onclick = async () => { setMenu(false); if (confirm('Старая ссылка перестанет открываться. Выдать новую?')) await shareClient(cid, 'rotate'); paint(); };
  box.querySelector('#tripRevoke').onclick = async () => { setMenu(false); if (confirm('Гость больше не сможет открыть путеводитель по этой ссылке. Закрыть доступ?')) { await shareClient(cid, 'off'); paint(); } };
  const away = (e) => { if (!form.isConnected) { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc2, true); return; } if (!menu.hidden && !box.contains(e.target)) setMenu(false); };
  const esc2 = (e) => { if (e.key === 'Escape' && !menu.hidden) { e.stopImmediatePropagation(); e.preventDefault(); setMenu(false); dots.focus(); } };
  document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', esc2, true);
}

// ---------- окружение ----------
const ROLES = ['Супруг', 'Супруга', 'Сын', 'Дочь', 'Ассистент', 'Водитель', 'Няня', 'Охрана', 'Партнёр', 'Друг', 'Родитель'];
export function editPerson(id, clientId) {
  const p = id ? state.people.find((x) => x.id === id) : { client_id: clientId };
  if (!p) return;
  const body =
    `<div class="f2">${field('name', 'Имя', inp('name', p.name, 'type="text" required autocomplete="off"'))}` +
    field('role', 'Кто это', inp('role', p.role, 'type="text" list="roles" placeholder="Супруга, ассистент…"') + `<datalist id="roles">${ROLES.map((r) => `<option value="${r}">`).join('')}</datalist>`) + '</div>' +
    field('phone', 'Телефон', inp('phone', p.phone, 'type="tel" autocomplete="off"')) +
    field('pb_day', 'День рождения', birthdayField(p.birthday, 'pb')) +
    field('allergies', 'Аллергии и ограничения', inp('allergies', (p.allergies || []).join(', '), 'type="text" placeholder="через запятую"')) +
    field('notes', 'Заметки', `<textarea id="f-notes" name="notes" rows="2">${esc(p.notes)}</textarea>`);
  openModal({
    title: id ? p.name : 'Близкий человек',
    body,
    onSave: async (v) => {
      await save('people', id, { client_id: p.client_id, name: v.name.trim(), role: nul(v.role), phone: nul(v.phone), birthday: birthdayValue(v, 'pb'), allergies: toList(v.allergies), notes: nul(v.notes) });
      toast(id ? 'Сохранено' : 'Добавлено в окружение');
    },
    onDelete: id ? async () => { await remove('people', id); toast('Удалено'); } : null,
  });
}

// ---------- важные даты ----------
const DATE_TITLES = ['Годовщина свадьбы', 'Именины', 'День рождения компании', 'Годовщина знакомства', 'Памятная дата'];
export function editDate(id, clientId) {
  const d = id ? state.client_dates.find((x) => x.id === id) : { client_id: clientId };
  if (!d) return;
  const body =
    field('title', 'Что за дата', inp('title', d.title, 'type="text" required list="dtitles" placeholder="Годовщина свадьбы"') + `<datalist id="dtitles">${DATE_TITLES.map((r) => `<option value="${r}">`).join('')}</datalist>`) +
    field('dd_day', 'Дата', birthdayField(d.date, 'dd', 'Год (не важен)'), 'Напоминание придёт в утреннем брифе за неделю') +
    field('notes', 'Заметки', `<textarea id="f-notes" name="notes" rows="2" placeholder="Что обычно дарим, какие цветы">${esc(d.notes)}</textarea>`);
  openModal({
    title: id ? d.title : 'Важная дата',
    body,
    onSave: async (v) => {
      const date = birthdayValue(v, 'dd');
      if (!date) throw new Error('укажите день и месяц');
      await save('client_dates', id, { client_id: d.client_id, title: v.title.trim(), date, notes: nul(v.notes) });
      toast('Дата сохранена');
    },
    onDelete: id ? async () => { await remove('client_dates', id); toast('Дата удалена'); } : null,
  });
}

// все даты гостя: его день рождения, дни рождения близких, свои даты — по ближайшей
export function upcomingDates(c) {
  const out = [];
  if (c.birthday) out.push({ title: 'День рождения', who: c.name, date: c.birthday, kind: 'bday', info: birthdayInfo(c.birthday) });
  for (const p of state.people.filter((x) => x.client_id === c.id && x.birthday))
    out.push({ title: 'День рождения', who: `${p.name}${p.role ? ' · ' + p.role.toLowerCase() : ''}`, date: p.birthday, kind: 'person', ref: p.id, info: birthdayInfo(p.birthday) });
  for (const d of state.client_dates.filter((x) => x.client_id === c.id))
    out.push({ title: d.title, who: d.notes || '', date: d.date, kind: 'date', ref: d.id, info: birthdayInfo(d.date) });
  return out.sort((a, b) => a.info.days - b.info.days);
}

// ---------- «любит / избегает»: метки с быстрым добавлением ----------
export function chipEditor(c, fieldName, { title, cls, placeholder }) {
  const list = c[fieldName] || [];
  return `<div class="tags ${cls}" data-tags="${fieldName}" data-client="${c.id}">
    <span class="tags-title">${title}</span>
    ${list.map((x, i) => `<span class="tag">${esc(x)}<button type="button" class="tag-x" data-tag-del="${i}" aria-label="Убрать «${esc(x)}»">×</button></span>`).join('')}
    <button type="button" class="tag-add" data-tag-add>＋</button>
    <input class="tag-input" type="text" placeholder="${esc(placeholder)}" hidden enterkeyhint="done">
  </div>`;
}
export function bindChipEditors(root) {
  root.querySelectorAll('[data-tags]').forEach((box) => {
    const fieldName = box.dataset.tags;
    const c = byId('clients', box.dataset.client);
    const input = box.querySelector('.tag-input');
    const commit = async (list) => { try { await save('clients', c.id, { [fieldName]: list }); } catch (e) { toast('Не удалось: ' + e.message, 'err'); } };
    box.querySelector('[data-tag-add]').addEventListener('click', () => { input.hidden = false; input.focus(); });
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') { input.value = ''; input.hidden = true; }
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const add = toList(input.value);
      if (!add.length) { input.hidden = true; return; }
      const cur = c[fieldName] || [];
      const next = [...cur, ...add.filter((a) => !cur.some((x) => x.toLowerCase() === a.toLowerCase()))];
      input.value = '';
      await commit(next);
    });
    input.addEventListener('blur', () => { if (!input.value.trim()) input.hidden = true; });
    box.querySelectorAll('[data-tag-del]').forEach((b) => b.addEventListener('click', () => {
      const next = (c[fieldName] || []).filter((_, i) => i !== +b.dataset.tagDel);
      commit(next);
    }));
  });
}

export function personCard(p) {
  const b = birthdayInfo(p.birthday);
  return `<button type="button" class="person" data-person="${p.id}">
    <span class="av av-sm" aria-hidden="true">${esc(initials(p.name))}</span>
    <span class="person-main"><b>${esc(p.name)}</b>${p.role ? `<small>${esc(p.role)}</small>` : ''}
      ${b ? `<span class="person-line">🎂 ${esc(b.text)}${b.days <= 14 ? ` · через ${b.days} дн.` : ''}</span>` : ''}
      ${p.phone ? `<span class="person-line">📞 ${esc(p.phone)}</span>` : ''}
      ${(p.allergies || []).length ? `<span class="person-line warn">⚠ ${esc(p.allergies.join(', '))}</span>` : ''}
    </span></button>`;
}

export { render, toParisInput };

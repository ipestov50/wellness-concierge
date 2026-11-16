// «✦ Варианты для гостя»: 3 места под запрос → сообщение на языке гостя → WhatsApp/Telegram →
// запрос в «Ждёт одобрения» → гость выбрал номер → «Бронируем» (партнёр и адрес подставляются в запрос).
// Всё хранится в запросе (requests.options) — доска, «Мой день» и профиль видят одно и то же.
import { esc, openModal, toast } from './ui.js';
import { state, byId, save } from './data.js';
import { api, isAbort } from './api.js';
import { statusOf } from './statuses.js';
import { setStatus } from './actions.js';

const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
const CHECK = {
  google: ['ok', '✓ место в Google Картах'],
  verified: ['ok', '✓ адрес подтверждён'],
  corrected: ['mid', '↻ адрес уточнён по карте'],
  partner: ['ok', '★ ваш партнёр'],
  unverified: ['bad', '⚠ проверьте адрес'],
};
const HOLIDAY = {
  confirmed_open: ['ok', '● открыто в этот день'],
  unconfirmed_holiday: ['mid', '◐ праздник — часы не подтверждены'],
  closed: ['bad', '○ закрыто в этот день'],
};
const CAT_TYPE = { Dining: 'restaurant', 'Spa & Wellness': 'spa', Activities: 'activity', 'Health & Fitness': 'spa', Transport: 'transport', Accommodation: 'hotel' };
const gem = (x) => x.rating != null && x.reviews != null && x.rating >= 4.4 && x.rating <= 4.9 && x.reviews >= 80 && x.reviews <= 1500;
const fmtN = (n) => Number(n).toLocaleString('ru-RU');
const LOC = { RU: 'ru-RU', EN: 'en-GB', FR: 'fr-FR' };
const TPL = {
  RU: { hi: (n, w) => `${n ? n + ', в' : 'В'}от варианты${w ? ' на ' + w : ''}:`, end: 'Напишите номер — всё забронирую.' },
  EN: { hi: (n, w) => `${n ? n + ', h' : 'H'}ere are a few options${w ? ' for ' + w : ''}:`, end: 'Just reply with the number and I will book it.' },
  FR: { hi: (n, w) => `${n ? n + ', v' : 'V'}oici quelques propositions${w ? ' pour ' + w : ''} :`, end: 'Répondez simplement avec le numéro, je m’occupe de la réservation.' },
};
const first = (c) => (c?.name || '').replace(/\s*\(.*?\)/g, '').trim().split(/\s+/)[0] || '';
const hasStatus = (k) => !!statusOf(k);

// короткая строка для карточек на доске и в «Моём дне»: где сейчас запрос в цикле
export function optionsBadge(r) {
  // только то, чего больше нигде не видно: варианты отправлены, гость ещё не выбрал.
  // Выбранное место видно строкой «📍 …» / «★ …», статус — колонкой доски.
  const o = r?.options;
  if (!o?.sent_at || o.chosen != null || !o.items?.length) return '';
  return '<span class="opt-badge wait">Ждём выбор гостя</span>';
}
// «Гость выбрал: 1 · 2 · 3» — одним нажатием (в «Моём дне» и в окне запроса)
export function pickChips(r) {
  const o = r?.options;
  if (!o?.sent_at || o.chosen != null) return '';
  const list = o.items.map((x, i) => [x, i]).filter(([x]) => x.on !== false);
  return `<div class="opt-pick"><span>Гость выбрал:</span>${list.map(([x, i], k) => `<button type="button" class="chip-btn" data-opt-pick="${esc(r.id)}" data-i="${i}" title="${esc(x.name)}">${k + 1} · ${esc(x.name)}</button>`).join('')}</div>`;
}

// выбор гостя → «Бронируем», партнёр и адрес — в запрос (для «Дороги» и брони)
export async function pickOption(id, i) {
  const r = byId('requests', id);
  const x = r?.options?.items?.[i];
  if (!x) return;
  const patch = { options: { ...r.options, chosen: i, chosen_at: new Date().toISOString() } };
  // партнёр → в поле «Партнёр»; любое другое место → в ячейку «Место»
  if (x.partner_id) { patch.partner_id = x.partner_id; patch.venue = null; }
  else patch.venue = { kind: 'place', name: x.name, address: x.address || '', maps: x.maps || '', phone: x.phone || '', website: x.website || '', rating: x.rating ?? null, reviews: x.reviews ?? null, from: 'options' };
  if (x.address && !r.road_to) patch.road_to = `${x.name}, ${x.address}`;
  try {
    await save('requests', id, patch);
    if (hasStatus('booking')) await setStatus(id, 'booking', { quiet: true });
    toast(`✓ Гость выбрал «${x.name}» — бронируем`, '', { label: 'Отменить', fn: () => save('requests', id, { options: { ...r.options, chosen: null, chosen_at: null } }) });
  } catch (e) { toast('Не сохранилось: ' + (e.message || e), 'err'); }
}

export function openOptions(id, { back = null } = {}) {
  const r = byId('requests', id);
  if (!r) return;
  const c = byId('clients', r.client_id);
  const lang = (c?.language && TPL[c.language]) ? c.language : 'RU';
  const whenG = r.deadline ? new Date(r.deadline).toLocaleString(LOC[lang], { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
  const whenRu = r.deadline ? new Date(r.deadline).toLocaleString('ru-RU', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
  let st = r.options?.items?.length ? structuredClone(r.options) : null;
  let manual = false; // сообщение правили руками — не перезаписываем
  const m = openModal({ title: '✦ Варианты для гостя', saveLabel: 'Закрыть', body: '<div class="vo" id="opt"></div>', onSave: async () => {}, onClose: back });
  m.form.classList.add('wide', 'vo-dlg');
  m.form.querySelector('#cancel').hidden = true;
  const box = m.form.querySelector('#opt');
  const persist = () => save('requests', id, { options: st }).catch(() => {});

  const message = () => {
    const t = TPL[lang];
    const on = st.items.filter((x) => x.on !== false);
    return [t.hi(first(c), whenG), ...on.map((x, k) => `${NUM[k]} *${x.name}*${x.why_guest ? ' — ' + x.why_guest : ''}\n📍 ${x.address}\n${x.maps}`), t.end].join('\n\n');
  };
  const chip = ([cls, label]) => `<span class="vo-chip ${cls}">${label}</span>`;
  const card = (x, i) => {
    const on = x.on !== false;
    const tel = (x.phone || '').replace(/[^\d+]/g, '');
    return `<article class="vo-card${on ? ' sel' : ''}" data-i="${i}">
      <button type="button" class="vo-sel" data-opt-on="${i}" aria-pressed="${on}" title="${on ? 'Убрать из сообщения' : 'Добавить в сообщение'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 12.5l3.5 3.5 7.5-8"/></svg></button>
      <header class="vo-head"><span class="vo-num">${i + 1}</span>
        <div class="vo-title"><h3 class="vo-name" contenteditable="plaintext-only" spellcheck="false" data-f="name">${esc(x.name)}</h3>
          <p class="vo-meta">${[x.kind, x.area, x.price].filter(Boolean).map(esc).join(' · ')}</p></div></header>
      <div class="vo-chips">
        ${x.rating != null ? `<span class="vo-chip rate">★ ${String(x.rating).replace('.', ',')}${x.reviews != null ? ` · ${fmtN(x.reviews)} отзывов` : ''}</span>` : ''}
        ${gem(x) ? '<span class="vo-chip gem">◆ скрытая жемчужина</span>' : ''}
        ${x.partner ? chip(CHECK.partner) : CHECK[x.check] ? chip(CHECK[x.check]) : ''}
        ${x.holiday && HOLIDAY[x.holiday] ? chip(HOLIDAY[x.holiday]) : ''}
      </div>
      ${x.why ? `<p class="vo-why">${esc(x.why)}</p>` : ''}
      ${x.evidence ? `<p class="vo-evidence"><span>Отзывы</span>${esc(x.evidence)}</p>` : ''}
      ${(x.red_flags || []).length ? `<ul class="vo-flags">${x.red_flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      <p class="vo-addr"><span aria-hidden="true">📍</span><span contenteditable="plaintext-only" spellcheck="false" data-f="address">${esc(x.address)}</span>${x.hours ? `<small>· ${esc(x.hours)}</small>` : ''}</p>
      ${x.address_ai ? `<p class="vo-was">Jarvis указал: ${esc(x.address_ai)}</p>` : ''}
      <div class="vo-actions">
        <a class="vo-btn" href="${esc(x.maps)}" target="_blank" rel="noopener">Карта</a>
        ${x.website ? `<a class="vo-btn" href="${esc(x.website)}" target="_blank" rel="noopener">Сайт</a>` : ''}
        ${tel ? `<a class="vo-btn" href="tel:${esc(tel)}">Позвонить</a>` : ''}
        ${x.partner ? '<span class="vo-btn done">★ В партнёрах</span>' : `<button type="button" class="vo-btn" data-opt-partner="${i}">★ В партнёры</button>`}
      </div></article>`;
  };
  const skeleton = () => `<div class="vo-loading"><p class="vo-status"><span class="spin"></span> Jarvis ищет в Google Картах скрытые жемчужины, сверяет отзывы и праздники… 15–40 секунд</p>
    <div class="vo-grid">${[0, 1, 2].map(() => '<div class="vo-card skel"><i></i><i></i><i></i><i></i></div>').join('')}</div></div>`;
  const draw = () => {
    if (!st) { box.innerHTML = skeleton(); return; }
    const phone = (c?.phone || '').replace(/[^\d]/g, '');
    const n = st.items.filter((x) => x.on !== false).length;
    box.innerHTML = `
      <div class="vo-ctx"><div><b>${esc(r.summary)}</b><span>${[c?.name, whenRu].filter(Boolean).map(esc).join(' · ')}</span></div>
        ${st.considered ? `<span class="vo-chip">${st.considered} кандидатов → 3 лучших</span>` : ''}</div>
      ${st.holiday ? `<p class="vo-holiday">🎌 ${esc(st.holiday)} — в этот день праздник. Часы работы проверьте при брони.</p>` : ''}
      <div class="vo-grid">${st.items.map(card).join('')}</div>
      <div class="vo-refine"><input id="opt-notes" placeholder="Уточнить: бельгийское пиво на кране, терраса, без морепродуктов…" value="${esc(st.notes || '')}" autocomplete="off">
        <button type="button" class="btn small" data-opt-more>↻ Найти другие</button></div>
      <details class="vo-msg"${st.sent_at ? '' : ' open'}><summary>Сообщение гостю · ${lang === 'RU' ? 'по-русски' : lang === 'EN' ? 'по-английски' : 'по-французски'} · ${n} ${n === 1 ? 'вариант' : 'варианта'}</summary>
        <textarea id="opt-msg" rows="8">${esc(st.message && manual ? st.message : message())}</textarea></details>
      <div class="vo-foot">
        ${phone ? '<button type="button" class="btn primary" data-opt-send="wa">WhatsApp</button>' : ''}
        ${c?.telegram ? `<button type="button" class="btn${phone ? '' : ' primary'}" data-opt-send="tg">Telegram</button>` : ''}
        <button type="button" class="btn${phone || c?.telegram ? '' : ' primary'}" data-opt-send="copy">Скопировать</button>
        <span class="vo-sent">${st.sent_at ? `отправлено ${new Date(st.sent_at).toLocaleString('ru-RU', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : st.cached ? 'из сохранённого поиска' : ''}</span>
      </div>
      ${pickChips({ ...r, options: st })}
      ${(st.sources || []).length ? `<p class="bf-src">Источники: ${st.sources.map((s) => `<a href="${esc(s.uri)}" target="_blank" rel="noopener">${esc(s.title || 'ссылка')}</a>`).join(' · ')}</p>` : ''}`;
  };

  const fetchOptions = async (notes = '', exclude = []) => {
    st = null; draw();
    try {
      const out = await api('options', { id, notes, exclude }, { signal: m.signal });
      st = { items: out.items.map((x) => ({ ...x, on: true })), city: out.city, lang: out.lang, sources: out.sources, holiday: out.holiday, considered: out.considered, cached: !!out.cached, notes, excluded: exclude, created_at: new Date().toISOString() };
      manual = false;
      await persist(); // черновик сохраняем сразу — видно на доске и в «Моём дне»
      if (m.form.isConnected) draw();
    } catch (e) {
      if (isAbort(e) || !m.form.isConnected) return;
      box.innerHTML = `<div class="vo-error"><p>${e.message === 'rate_limited' ? 'Лимит Gemini на минуту исчерпан — попробуйте чуть позже.' : 'Не получилось подобрать места.'}</p><button type="button" class="btn primary" data-opt-retry>↻ Повторить</button></div>`;
    }
  };
  const refreshMsg = () => { const t = box.querySelector('#opt-msg'); if (t && !manual) t.value = message(); };

  box.addEventListener('input', (e) => {
    if (e.target.id === 'opt-msg') { manual = true; return; }
    const f = e.target.dataset.f;
    if (!f) return;
    const i = +e.target.closest('.vo-card').dataset.i;
    st.items[i][f] = e.target.innerText.trim();
    if (!st.items[i].place_id) st.items[i].maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([st.items[i].name, st.items[i].address].filter(Boolean).join(', '))}`;
    refreshMsg();
  });
  box.addEventListener('focusout', (e) => { if (e.target.dataset?.f) persist(); });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.target.dataset?.f || e.target.id === 'opt-notes')) { e.preventDefault(); if (e.target.id === 'opt-notes') box.querySelector('[data-opt-more]').click(); else e.target.blur(); } });
  box.addEventListener('click', async (e) => {
    if (e.target.closest('[data-opt-retry]')) return fetchOptions(st?.notes || '');
    const sel = e.target.closest('[data-opt-on]');
    if (sel) { const i = +sel.dataset.optOn; st.items[i].on = st.items[i].on === false; draw(); return; }
    if (e.target.closest('[data-opt-more]')) {
      const notes = box.querySelector('#opt-notes').value.trim();
      return fetchOptions(notes, [...new Set([...(st?.excluded || []), ...st.items.map((x) => x.name)])]);
    }
    const tp = e.target.closest('[data-opt-partner]');
    if (tp) {
      const x = st.items[+tp.dataset.optPartner];
      const same = state.partners.find((p) => p.name.trim().toLowerCase() === x.name.trim().toLowerCase());
      try {
        const p = same || await save('partners', null, { name: x.name, address: x.address || null, city: st.city || c?.city || null,
          contact: [x.phone, x.website].filter(Boolean).join(' · ') || null, type: CAT_TYPE[r.category] || 'other', rating: x.rating ? Math.round(x.rating) : null,
          notes: [x.kind, x.why].filter(Boolean).join('. ') || null });
        x.partner = true; x.partner_id = p.id;
        await persist(); draw();
        toast(same ? `«${x.name}» уже в партнёрах — отмечено` : `★ «${x.name}» добавлен в партнёры`);
      } catch (err) { toast('Не сохранилось: ' + (err.message || err), 'err'); }
      return;
    }
    const pick = e.target.closest('[data-opt-pick]');
    if (pick) { await pickOption(id, +pick.dataset.i); m.close(); return; }
    const send = e.target.closest('[data-opt-send]');
    if (!send) return;
    const text = box.querySelector('#opt-msg').value;
    if (!st.items.some((x) => x.on !== false)) return toast('Отметьте хотя бы один вариант', 'err');
    try { await navigator.clipboard.writeText(text); } catch {}
    const how = send.dataset.optSend;
    if (how === 'wa') window.open(`https://wa.me/${(c.phone || '').replace(/[^\d]/g, '')}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    if (how === 'tg') window.open(`https://t.me/${encodeURIComponent(c.telegram.replace(/^@/, ''))}`, '_blank', 'noopener');
    st = { ...st, message: manual ? text : null, sent_at: new Date().toISOString(), chosen: null };
    try {
      await save('requests', id, { options: st });
      const cur = statusOf(byId('requests', id)?.status);
      if (hasStatus('awaiting_approval') && cur?.kind === 'active' && byId('requests', id).status !== 'booking') await setStatus(id, 'awaiting_approval', { quiet: true });
      toast(how === 'copy' ? 'Скопировано · ждём выбор гостя' : how === 'tg' ? 'Текст скопирован — вставьте в чат Telegram · ждём выбор' : 'Открываю WhatsApp · ждём выбор гостя');
      draw();
    } catch (err) { toast('Не сохранилось: ' + (err.message || err), 'err'); }
  });

  if (st) draw(); else fetchOptions();
}

// открыли из карточки запроса → «Закрыть» возвращает в эту карточку, а не закрывает всё
const backTo = (el) => { const f = el.closest('[data-req-id]'); if (!f) return null; const rid = f.dataset.reqId; return () => import('./lazy.js').then((l) => l.editRequest(rid)); };
// общий обработчик кнопок: «✦ Варианты» и «Гость выбрал N» — работают на доске, в «Моём дне» и в профиле
document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-options]');
  if (o) { e.stopPropagation(); e.preventDefault(); openOptions(o.dataset.options, { back: backTo(o) }); return; }
  const p = e.target.closest('[data-opt-pick]');
  if (p && !p.closest('#opt')) { e.stopPropagation(); e.preventDefault(); const back = backTo(p); pickOption(p.dataset.optPick, +p.dataset.i).then(() => back?.()); }
});

// ================== после выбора гостя: партнёр → подтверждение → напоминание ==================
// место брони: выбранный гостем вариант, иначе партнёр запроса
export function venueOf(r) {
  // место, выбранное гостем (не партнёр) — из ячейки «Место»
  const vv = r?.venue;
  if (vv?.name) return { name: vv.name, address: vv.address || '', maps: vv.maps || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([vv.name, vv.address].filter(Boolean).join(', '))}`, website: vv.website || '', contact: vv.phone || '', partner: null };
  const x = r?.options?.chosen != null ? r.options.items?.[r.options.chosen] : null;
  const p = byId('partners', x?.partner_id || r?.partner_id);
  if (!x && !p) return null;
  return { name: x?.name || p?.name, address: x?.address || p?.address || '', maps: x?.maps || (p ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.name, p.address, p.city].filter(Boolean).join(', '))}` : ''), website: x?.website || '', contact: p?.contact || '', partner: p };
}
const stageOf = (r) => {
  const o = r?.options || {};
  if (isClosedLike(r)) return null;
  if (o.booking?.confirmed_at || r.status === 'confirmed') return o.reminded_at ? null : 'remind';
  if (o.booking?.sent_at) return 'confirm';
  if (r.status === 'booking' && venueOf(r)) return 'partner';
  return null;
};
const isClosedLike = (r) => { const k = statusOf(r?.status)?.kind; return k && k !== 'active'; };

// кнопка следующего шага — одинаковая в окне запроса, на блоке «Моего дня» и в профиле
export function stageButton(r, cls = 'btn small primary') {
  const s = stageOf(r);
  // бронь у партнёра вы делаете сами — здесь только напоминание гостю накануне (в «Моём дне»)
  if (s === 'remind' && r.deadline && Date.parse(r.deadline) > Date.now()) return `<button type="button" class="${cls}" data-stage="remind" data-id="${esc(r.id)}">🔔 Напомнить гостю</button>`;
  return '';
}

const phoneOf = (s) => { const m = String(s || '').match(/\+?\d[\d\s().-]{7,}\d/); return m ? m[0].replace(/[^\d]/g, '') : ''; };
const emailOf = (s) => String(s || '').match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] || '';
const guestsFrom = (r) => +(String(`${r.summary} ${r.original_message || ''}`).match(/(\d+)\s*(перс|чел|гост|pers|people|guest|pax)/i)?.[1] || 0) || 2;
const fullName = (c) => (c?.name || '').replace(/\s*\(.*?\)/g, '').trim();

// 1) сообщение партнёру на его языке (Jarvis переводит и учитывает аллергии; имя гостя подставляем только здесь)
export function openPartnerMsg(id, { back = null } = {}) {
  const r = byId('requests', id);
  const v = venueOf(r);
  if (!r || !v) return toast('Сначала выберите место', 'err');
  const c = byId('clients', r.client_id);
  const bk = r.options?.booking || {};
  const m = openModal({ title: '✉ Бронь у партнёра', saveLabel: 'Закрыть', body: `<div class="opt" id="pm">
    <p class="opt-ctx"><b>${esc(v.name)}</b>${v.address ? ' · ' + esc(v.address) : ''}</p>
    <div class="pm-row"><label class="f"><span>Гостей</span><input type="number" id="pm-n" min="1" max="40" value="${bk.guests || guestsFrom(r)}"></label>
      <label class="f grow"><span>Пожелания (по-русски — Jarvis переведёт)</span><input id="pm-wish" value="${esc(bk.wish || '')}" placeholder="столик у окна, тихий зал, торт на десерт…"></label></div>
    <button type="button" class="btn small" data-pm-gen>✦ Составить сообщение</button>
    <div id="pm-out"></div></div>`, onSave: async () => {}, onClose: back });
  m.form.querySelector('#cancel').hidden = true;
  const out = m.form.querySelector('#pm-out');
  const gen = async () => {
    out.innerHTML = '<div class="bf-busy"><span class="spin"></span> Jarvis пишет партнёру на его языке…</div>';
    const n = +m.form.querySelector('#pm-n').value || 2, wish = m.form.querySelector('#pm-wish').value.trim();
    try {
      const res = await api('message', { kind: 'partner', title: `Забронировать: ${v.name}`, detail: `Место: ${v.name}${v.address ? ', ' + v.address : ''}. Гостей: ${n}.${wish ? ' Пожелания: ' + wish + '.' : ''} Попросить подтвердить бронь ответным сообщением.`, request_id: id, client_id: r.client_id }, { signal: m.signal });
      const text = String(res.text || '').replace(/\{гость\}/g, fullName(c)).replace(/\{имя\}/g, fullName(c));
      const phone = phoneOf(v.contact), email = emailOf(v.contact);
      out.innerHTML = `<label class="f"><span>Сообщение ${esc(res.lang_label || '')}</span><textarea id="pm-text" rows="8">${esc(text)}</textarea></label>
        <div class="opt-act"><button type="button" class="btn primary" data-pm-send="copy">Скопировать</button>
          ${phone ? `<button type="button" class="btn" data-pm-send="wa" data-phone="${phone}">WhatsApp</button>` : ''}
          ${email ? `<button type="button" class="btn" data-pm-send="mail" data-email="${esc(email)}">Почта</button>` : ''}
          ${!phone && !email ? `<span class="muted">Контакт: ${v.website ? `<a href="${esc(v.website)}" target="_blank" rel="noopener">сайт</a> · ` : ''}<a href="${esc(v.maps)}" target="_blank" rel="noopener">телефон в Google Maps</a></span>` : ''}</div>`;
    } catch (e) {
      if (isAbort(e)) return;
      out.innerHTML = `<p class="muted">${e.message === 'rate_limited' ? 'Лимит Gemini — попробуйте через минуту.' : 'Не получилось составить сообщение.'}</p>`;
    }
  };
  m.form.addEventListener('click', async (e) => {
    if (e.target.closest('[data-pm-gen]')) return gen();
    const s = e.target.closest('[data-pm-send]');
    if (!s) return;
    const text = m.form.querySelector('#pm-text').value;
    try { await navigator.clipboard.writeText(text); } catch {}
    if (s.dataset.pmSend === 'wa') window.open(`https://wa.me/${s.dataset.phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    if (s.dataset.pmSend === 'mail') location.href = `mailto:${s.dataset.email}?subject=${encodeURIComponent('Réservation / Booking')}&body=${encodeURIComponent(text)}`;
    const cur = byId('requests', id);
    const booking = { sent_at: new Date().toISOString(), guests: +m.form.querySelector('#pm-n').value || 2, wish: m.form.querySelector('#pm-wish').value.trim() };
    try {
      await save('requests', id, { options: { ...(cur.options || {}), booking } });
      if (hasStatus('booking') && cur.status !== 'booking' && statusOf(cur.status)?.kind === 'active') await setStatus(id, 'booking', { quiet: true });
      toast('Отправлено партнёру · ждём подтверждения');
      m.close();
    } catch (err) { toast('Не сохранилось: ' + (err.message || err), 'err'); }
  });
  gen();
}

// 2) партнёр подтвердил → «Подтверждено»
export async function confirmBooking(id) {
  const r = byId('requests', id);
  if (!r) return;
  const o = r.options || {};
  try {
    await save('requests', id, { options: { ...o, booking: { ...(o.booking || {}), confirmed_at: new Date().toISOString() } } });
    if (hasStatus('confirmed')) await setStatus(id, 'confirmed', { quiet: true });
    toast('✓ Бронь подтверждена — накануне напомню гостю', '', { label: 'Отменить', fn: async () => { await save('requests', id, { options: o }); if (hasStatus('booking')) await setStatus(id, 'booking', { quiet: true }); } });
  } catch (e) { toast('Не сохранилось: ' + (e.message || e), 'err'); }
}

// 3) напоминание гостю: когда, где, карта — на его языке, без ИИ (точные данные из запроса)
const REM = {
  RU: (f, when, v, n) => `${f ? f + ', н' : 'Н'}апоминаю: ${when} — ${v.name}.${n ? ` Столик на ${n}.` : ''}`,
  EN: (f, when, v, n) => `${f ? f + ', a' : 'A'} quick reminder: ${when} — ${v.name}.${n ? ` Table for ${n}.` : ''}`,
  FR: (f, when, v, n) => `${f ? f + ', p' : 'P'}etit rappel : ${when} — ${v.name}.${n ? ` Table pour ${n}.` : ''}`,
};
const REM_END = { RU: 'Если планы изменятся — напишите, всё перенесу.', EN: 'If your plans change, just let me know and I will rearrange everything.', FR: 'Si vos plans changent, écrivez-moi, je m’occupe de tout.' };
export function openReminder(id, { back = null } = {}) {
  const r = byId('requests', id);
  const v = venueOf(r);
  if (!r) return;
  const c = byId('clients', r.client_id);
  const lang = (c?.language && REM[c.language]) ? c.language : 'RU';
  const d = new Date(r.deadline);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const dDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
  const time = d.toLocaleTimeString(LOC[lang], { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
  const rel = { RU: dDay === today ? 'сегодня' : 'завтра', EN: dDay === today ? 'today' : 'tomorrow', FR: dDay === today ? 'aujourd’hui' : 'demain' }[lang];
  const at = { RU: `${rel} в ${time}`, EN: `${rel} at ${time}`, FR: `${rel} à ${time}` }[lang];
  const venue = v || { name: r.summary, address: '', maps: '' };
  const n = r.options?.booking?.guests;
  const text = [REM[lang](first(c), at, venue, n), venue.address ? `📍 ${venue.address}` : '', venue.maps || '', REM_END[lang]].filter(Boolean).join('\n\n');
  const phone = (c?.phone || '').replace(/[^\d]/g, '');
  const m = openModal({ title: '🔔 Напоминание гостю', saveLabel: 'Закрыть', body: `<div class="opt">
    <label class="f"><span>Сообщение · ${lang === 'RU' ? 'по-русски' : lang === 'EN' ? 'по-английски' : 'по-французски'}</span><textarea id="rm-text" rows="8">${esc(text)}</textarea></label>
    <div class="opt-act"><button type="button" class="btn primary" data-rm="copy">Скопировать</button>
      ${phone ? '<button type="button" class="btn" data-rm="wa">WhatsApp</button>' : ''}${c?.telegram ? '<button type="button" class="btn" data-rm="tg">Telegram</button>' : ''}</div></div>`, onSave: async () => {}, onClose: back });
  m.form.querySelector('#cancel').hidden = true;
  m.form.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    const t = m.form.querySelector('#rm-text').value;
    try { await navigator.clipboard.writeText(t); } catch {}
    if (b.dataset.rm === 'wa') window.open(`https://wa.me/${phone}?text=${encodeURIComponent(t)}`, '_blank', 'noopener');
    if (b.dataset.rm === 'tg') window.open(`https://t.me/${encodeURIComponent(c.telegram.replace(/^@/, ''))}`, '_blank', 'noopener');
    try { const cur = byId('requests', id); await save('requests', id, { options: { ...(cur.options || {}), reminded_at: new Date().toISOString() } }); toast('Напоминание отправлено'); m.close(); }
    catch (err) { toast('Не сохранилось: ' + (err.message || err), 'err'); }
  });
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-stage]');
  if (!b) return;
  e.stopPropagation(); e.preventDefault();
  const id = b.dataset.id;
  if (b.dataset.stage === 'partner') openPartnerMsg(id, { back: backTo(b) });
  else if (b.dataset.stage === 'confirm') { b.disabled = true; confirmBooking(id).then(() => { const back = backTo(b); if (back) back(); }); }
  else if (b.dataset.stage === 'remind') openReminder(id, { back: backTo(b) });
});

// верх карточки запроса: только факты. Кнопка подбора — неброская; пока гость выбирает — «ждём выбор» и номера
export function requestOptionsBar(r) {
  const o = r?.options;
  if (o?.sent_at && o.chosen == null) return `<div class="req-opts"><span class="opt-badge wait">Ждём выбор гостя</span>${pickChips(r)}</div>`;
  if (o?.chosen != null || r?.venue?.name) return '';
  return `<div class="req-opts"><button type="button" class="vo-btn" data-options="${esc(r.id)}">✦ Варианты для гостя</button><button type="button" class="vo-btn" data-search-req="${esc(r.id)}">🔎 Поиск</button></div>`;
}

// «✦ Варианты для гостя»: 3 места под запрос → сообщение на языке гостя → WhatsApp/Telegram →
// запрос в «Ждёт одобрения» → гость выбрал номер → «Бронируем» (партнёр и адрес подставляются в запрос).
// Всё хранится в запросе (requests.options) — доска, «Мой день» и профиль видят одно и то же.
import { esc, openModal, toast } from './ui.js';
import { byId, save } from './data.js';
import { api, isAbort } from './api.js';
import { statusOf } from './statuses.js';
import { setStatus } from './actions.js';

const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
const CHECK = {
  verified: ['ok', '✓ адрес подтверждён по карте'],
  corrected: ['mid', '↻ адрес уточнён по карте'],
  partner: ['ok', '★ ваш партнёр'],
  unverified: ['bad', '⚠ не нашёл на карте — проверьте'],
};
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
  const o = r?.options;
  if (!o) return '';
  const v = venueOf(r)?.name || '';
  if (o.reminded_at) return `<span class="opt-badge ok">✓ подтверждено · гостю напомнили${v ? ' · ' + esc(v) : ''}</span>`;
  if (o.booking?.confirmed_at) return `<span class="opt-badge ok">✓ подтверждено${v ? ' · ' + esc(v) : ''}</span>`;
  if (o.booking?.sent_at) return `<span class="opt-badge wait">⏳ ждём подтверждения${v ? ' · ' + esc(v) : ''}</span>`;
  if (!o.items?.length) return '';
  if (o.chosen != null) return `<span class="opt-badge ok">✓ ${esc(o.items[o.chosen]?.name || 'выбрано')} · бронируем</span>`;
  if (o.sent_at) return `<span class="opt-badge wait">✦ ${o.items.filter((x) => x.on !== false).length} варианта · ждём выбор</span>`;
  return '<span class="opt-badge">✦ варианты готовы</span>';
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
  if (x.partner_id) patch.partner_id = x.partner_id;
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
  let st = r.options?.items?.length ? structuredClone(r.options) : null;
  let manual = false; // сообщение правили руками — не перезаписываем
  const m = openModal({ title: '✦ Варианты для гостя', saveLabel: 'Закрыть', body: '<div class="opt" id="opt"></div>', onSave: async () => {}, onClose: back });
  m.form.classList.add('wide');
  m.form.querySelector('#cancel').hidden = true;
  const box = m.form.querySelector('#opt');

  const message = () => {
    const t = TPL[lang];
    const on = st.items.filter((x) => x.on !== false);
    return [t.hi(first(c), whenG), '', ...on.map((x, k) => `${NUM[k]} *${x.name}*${x.why_guest ? ' — ' + x.why_guest : ''}\n📍 ${x.address}\n${x.maps}`), '', t.end].join('\n\n').replace(/\n{4,}/g, '\n\n');
  };
  const card = (x, i) => {
    const [cls, label] = CHECK[x.check] || CHECK.unverified;
    return `<article class="opt-i${x.on === false ? ' off' : ''}" data-i="${i}">
      <label class="opt-on"><input type="checkbox" data-opt-on="${i}"${x.on === false ? '' : ' checked'}></label>
      <div class="opt-body">
        <div class="opt-h"><input class="opt-name" data-f="name" value="${esc(x.name)}"><span class="opt-check ${cls}">${label}</span></div>
        <small class="opt-meta">${[x.kind, x.area, x.price].filter(Boolean).map(esc).join(' · ')}</small>
        <input class="opt-addr" data-f="address" value="${esc(x.address)}" placeholder="Адрес">
        ${x.address_ai ? `<small class="opt-was">Jarvis указал: ${esc(x.address_ai)}</small>` : ''}
        <p class="opt-why">${esc(x.why)}</p>
        ${x.note ? `<p class="opt-note">💡 ${esc(x.note)}</p>` : ''}
        <div class="opt-links"><a href="${esc(x.maps)}" target="_blank" rel="noopener">📍 Google Maps</a>${x.website ? `<a href="${esc(x.website)}" target="_blank" rel="noopener">🌐 сайт</a>` : ''}</div>
      </div></article>`;
  };
  const draw = () => {
    if (!st) { box.innerHTML = loading(); return; }
    const phone = (c?.phone || '').replace(/[^\d]/g, '');
    box.innerHTML = `
      <p class="opt-ctx"><b>${esc(r.summary)}</b>${c ? ' · ' + esc(c.name) : ''}${whenG ? ' · ' + esc(whenG) : ''}</p>
      <div class="opt-list">${st.items.map(card).join('')}</div>
      <div class="opt-more"><input id="opt-notes" placeholder="Уточнить для Jarvis: ближе к отелю, с террасой, без морепродуктов…" value="${esc(st.notes || '')}"><button type="button" class="btn small" data-opt-more>↻ Другие варианты</button></div>
      <label class="f"><span>Сообщение гостю · ${lang === 'RU' ? 'по-русски' : lang === 'EN' ? 'по-английски' : 'по-французски'}</span><textarea id="opt-msg" rows="9">${esc(st.message && manual ? st.message : message())}</textarea></label>
      <div class="opt-act">
        <button type="button" class="btn primary" data-opt-send="copy">Скопировать</button>
        ${phone ? '<button type="button" class="btn" data-opt-send="wa">WhatsApp</button>' : ''}
        ${c?.telegram ? '<button type="button" class="btn" data-opt-send="tg">Telegram</button>' : ''}
        ${st.sent_at ? `<span class="muted">отправлено ${new Date(st.sent_at).toLocaleString('ru-RU', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>` : ''}
      </div>
      ${pickChips({ ...r, options: st })}
      ${(st.sources || []).length ? `<p class="bf-src">Источники Jarvis: ${st.sources.map((s) => `<a href="${esc(s.uri)}" target="_blank" rel="noopener">${esc(s.title || 'ссылка')}</a>`).join(' · ')}</p>` : ''}`;
  };
  const loading = () => `<div class="bf-busy"><span class="spin"></span> Jarvis подбирает места и сверяет адреса с картой… обычно 10–25 секунд</div><div class="bf-skel"><i></i><i></i><i></i></div>`;

  const fetchOptions = async (notes = '', exclude = []) => {
    box.innerHTML = loading();
    try {
      const out = await api('options', { id, notes, exclude }, { signal: m.signal });
      st = { items: out.items.map((x) => ({ ...x, on: true })), lang: out.lang, sources: out.sources, notes, created_at: new Date().toISOString() };
      manual = false;
      await save('requests', id, { options: st }).catch(() => {}); // черновик сохраняем сразу — видно везде
      if (m.form.isConnected) draw();
    } catch (e) {
      if (isAbort(e) || !m.form.isConnected) return;
      box.innerHTML = `<div class="notice retry-card"><p>${e.message === 'rate_limited' ? 'Лимит Gemini — попробуйте через минуту.' : 'Не получилось подобрать варианты.'}</p><button type="button" class="btn primary" data-opt-retry>↻ Повторить</button></div>`;
    }
  };

  box.addEventListener('input', (e) => {
    if (e.target.id === 'opt-msg') { manual = true; return; }
    const f = e.target.dataset.f;
    if (!f) return;
    const i = +e.target.closest('.opt-i').dataset.i;
    st.items[i][f] = e.target.value;
    if (f === 'address' || f === 'name') st.items[i].maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([st.items[i].name, st.items[i].address].filter(Boolean).join(', '))}`;
    if (!manual) box.querySelector('#opt-msg').value = message();
  });
  box.addEventListener('change', (e) => {
    const on = e.target.closest('[data-opt-on]');
    if (!on) return;
    st.items[+on.dataset.optOn].on = on.checked;
    on.closest('.opt-i').classList.toggle('off', !on.checked);
    if (!manual) box.querySelector('#opt-msg').value = message();
  });
  box.addEventListener('click', async (e) => {
    if (e.target.closest('[data-opt-retry]')) return fetchOptions(st?.notes || '');
    if (e.target.closest('[data-opt-more]')) {
      const notes = box.querySelector('#opt-notes').value.trim();
      return fetchOptions(notes, [...new Set([...(st?.excluded || []), ...st.items.map((x) => x.name)])]);
    }
    const pick = e.target.closest('[data-opt-pick]');
    if (pick) { await pickOption(id, +pick.dataset.i); m.close(); return; }
    const send = e.target.closest('[data-opt-send]');
    if (!send) return;
    const text = box.querySelector('#opt-msg').value;
    if (!st.items.some((x) => x.on !== false)) return toast('Отметьте хотя бы один вариант', 'err');
    try { await navigator.clipboard.writeText(text); } catch {}
    const how = send.dataset.optSend;
    if (how === 'wa') window.open(`https://wa.me/${(c.phone || '').replace(/[^\d]/g, '')}?text=${encodeURIComponent(text.replace(/\*/g, '*'))}`, '_blank', 'noopener');
    if (how === 'tg') window.open(`https://t.me/${encodeURIComponent(c.telegram.replace(/^@/, ''))}`, '_blank', 'noopener');
    st = { ...st, message: manual ? text : null, sent_at: new Date().toISOString(), chosen: null };
    try {
      await save('requests', id, { options: st });
      const cur = statusOf(byId('requests', id)?.status);
      if (hasStatus('awaiting_approval') && cur?.kind === 'active' && byId('requests', id).status !== 'booking') await setStatus(id, 'awaiting_approval', { quiet: true });
      toast(how === 'copy' ? 'Скопировано · запрос ждёт выбор гостя' : how === 'tg' ? 'Текст скопирован — вставьте в чат Telegram · ждём выбор' : 'Открываю WhatsApp · ждём выбор гостя');
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
  if (p && !p.closest('#opt')) { e.stopPropagation(); e.preventDefault(); pickOption(p.dataset.optPick, +p.dataset.i); }
});

// ================== после выбора гостя: партнёр → подтверждение → напоминание ==================
// место брони: выбранный гостем вариант, иначе партнёр запроса
export function venueOf(r) {
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
  if (s === 'partner') return `<button type="button" class="${cls}" data-stage="partner" data-id="${esc(r.id)}">✉ Партнёру: забронировать</button>`;
  if (s === 'confirm') return `<button type="button" class="${cls}" data-stage="confirm" data-id="${esc(r.id)}">✓ Партнёр подтвердил</button>`;
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

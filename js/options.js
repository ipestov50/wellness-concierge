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

// короткая строка для карточек на доске и в «Моём дне»
export function optionsBadge(r) {
  const o = r?.options;
  if (!o?.items?.length) return '';
  if (o.chosen != null) return `<span class="opt-badge ok">✓ ${esc(o.items[o.chosen]?.name || 'выбрано')}</span>`;
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

export function openOptions(id) {
  const r = byId('requests', id);
  if (!r) return;
  const c = byId('clients', r.client_id);
  const lang = (c?.language && TPL[c.language]) ? c.language : 'RU';
  const whenG = r.deadline ? new Date(r.deadline).toLocaleString(LOC[lang], { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
  let st = r.options?.items?.length ? structuredClone(r.options) : null;
  let manual = false; // сообщение правили руками — не перезаписываем
  const m = openModal({ title: '✦ Варианты для гостя', saveLabel: 'Закрыть', body: '<div class="opt" id="opt"></div>', onSave: async () => {} });
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

// общий обработчик кнопок: «✦ Варианты» и «Гость выбрал N» — работают на доске, в «Моём дне» и в профиле
document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-options]');
  if (o) { e.stopPropagation(); e.preventDefault(); openOptions(o.dataset.options); return; }
  const p = e.target.closest('[data-opt-pick]');
  if (p && !p.closest('#opt')) { e.stopPropagation(); e.preventDefault(); pickOption(p.dataset.optPick, +p.dataset.i); }
});

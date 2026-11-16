// «🔎 Поиск Jarvis»: одна строка поиска → места и события из нескольких источников с запасом по лимитам.
// Из профиля гостя/запроса подставляются город, даты и предпочтения. Карточка → «★ В партнёры» или «📅 В календарь гостя».
import { esc, openModal, toast } from './ui.js';
import { state, byId, save } from './data.js';
import { api, isAbort } from './api.js';
import { firstKey } from './statuses.js';

const PROVIDER = { black_book: ['ok', '★ ваш партнёр'], ticketmaster: ['', 'Ticketmaster'], tavily: ['', 'Tavily'], gemini: ['', 'Google'] };
const CATS = [['auto', 'Авто'], ['events', 'События'], ['venues', 'Места'], ['general', 'Исследование']];
const CAT_OF = (x, q) => (x.kind === 'event' ? 'Activities' : /спа|массаж|хаммам|wellness|spa/i.test(q + ' ' + x.title) ? 'Spa & Wellness' : /ресторан|ужин|обед|бар|пив|вин|кафе|кухн|restaurant|bar|beer|wine|café|cafe/i.test(q + ' ' + x.title + ' ' + x.summary) ? 'Dining' : 'Activities');
const PTYPE = { Dining: 'restaurant', 'Spa & Wellness': 'spa', Activities: 'activity' };
const fmtDate = (ymd) => (ymd ? new Date(ymd + 'T12:00:00Z').toLocaleDateString('ru-RU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'long' }) : '');

// местное время в поясе места → UTC (ISO)
function localToUtc(ymd, hm, tz) {
  const [y, m, d] = ymd.split('-').map(Number), [h, mi] = (hm || '20:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = (t) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t)).map((x) => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - t; };
  return new Date(guess - off(guess - off(guess))).toISOString();
}

export function openSearch({ client_id = null, request_id = null, query = '', back = null } = {}) {
  const r = request_id ? byId('requests', request_id) : null;
  const cid = client_id || r?.client_id || null;
  const c = cid ? byId('clients', cid) : null;
  const day = r?.deadline ? r.deadline.slice(0, 10) : '';
  let st = { q: query || r?.summary || '', cat: 'auto', city: '', from: day, to: day, out: null, busy: false };
  const m = openModal({ title: '🔎 Поиск Jarvis', saveLabel: 'Закрыть', body: '<div class="vo cs" id="cs"></div>', onSave: async () => {}, onClose: back ? () => import('./lazy.js').then((l) => l.editRequest(back)) : null });
  m.form.classList.add('wide', 'vo-dlg');
  m.form.querySelector('#cancel').hidden = true;
  const box = m.form.querySelector('#cs');

  const card = (x, i) => {
    const [pcls, plabel] = PROVIDER[x.sourceProvider] || ['', x.sourceProvider];
    const partner = x.partner_id || state.partners.some((p) => p.name.trim().toLowerCase() === x.title.trim().toLowerCase());
    return `<article class="vo-card sel cs-card" data-i="${i}">
      ${x.image ? `<div class="cs-img"><img src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>` : ''}
      <header class="vo-head"><span class="vo-num">${x.kind === 'event' ? '🎟' : '📍'}</span>
        <div class="vo-title"><h3 class="vo-name">${esc(x.title)}</h3><p class="vo-meta">${esc(x.addressOrVenue || '')}</p></div></header>
      <div class="vo-chips">
        <span class="vo-chip ${pcls}">${plabel}</span>
        ${x.date ? `<span class="vo-chip rate">${esc(fmtDate(x.date))}${x.time ? ' · ' + esc(x.time) : ''}</span>` : ''}
        ${x.price ? `<span class="vo-chip">${esc(x.price)}</span>` : ''}
        ${x.status && x.status !== 'onsale' ? `<span class="vo-chip mid">${x.status === 'offsale' ? 'продажа закрыта' : esc(x.status)}</span>` : ''}
        ${x.holiday ? `<span class="vo-chip mid">◐ ${esc(x.holiday)}</span>` : ''}
      </div>
      ${x.summary ? `<p class="vo-why">${esc(x.summary)}</p>` : ''}
      ${(x.red_flags || []).length ? `<ul class="vo-flags">${x.red_flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      <div class="vo-actions">
        ${x.url ? `<a class="vo-btn" href="${esc(x.url)}" target="_blank" rel="noopener">${x.kind === 'event' ? 'Билеты' : 'Сайт'}</a>` : ''}
        <a class="vo-btn" href="${esc(x.maps)}" target="_blank" rel="noopener">Карта</a>
        ${x.kind !== 'event' ? (partner ? '<span class="vo-btn done">★ В партнёрах</span>' : `<button type="button" class="vo-btn" data-cs-partner="${i}">★ В партнёры</button>`) : ''}
        ${c ? `<button type="button" class="vo-btn" data-cs-cal="${i}">📅 В календарь гостя</button>` : ''}
      </div></article>`;
  };
  const results = () => {
    const o = st.out;
    if (st.busy) return `<p class="vo-status"><span class="spin"></span> Ищу: ваши партнёры → ${st.cat === 'events' || (st.cat === 'auto' && /концерт|билет|матч|театр|опер|балет|шоу|фестивал|выставк|спектакл|ticket|concert/i.test(st.q)) ? 'Ticketmaster → ' : ''}Tavily → Google… 5–30 секунд</p>
      <div class="vo-grid">${[0, 1, 2].map(() => '<div class="vo-card skel"><i></i><i></i><i></i><i></i></div>').join('')}</div>`;
    if (!o) return '<p class="cs-hint">Например: «аутентичный баварский Wirtshaus с Paulaner на кране, 26 декабря» или «VIP-ложа на хоккей». Учту город, даты и предпочтения гостя.</p>';
    if (o.error) return `<div class="vo-error"><p>${o.error === 'rate_limited' ? 'Все источники сейчас упёрлись в лимит — попробуйте через минуту.' : 'Поиск не удался.'}</p><button type="button" class="btn primary" data-cs-go>↻ Повторить</button></div>`;
    if (!o.results.length) return '<p class="cs-hint">Ничего не нашлось — попробуйте сформулировать иначе или убрать даты.</p>';
    const chain = (o.tried || []).map((t) => `${t.provider === 'ticketmaster' ? 'Ticketmaster' : t.provider === 'tavily' ? 'Tavily' : 'Google'}${t.status === 'ok' ? ' ✓' : t.status === 'no_key' ? ' (нет ключа)' : t.status === 'empty' ? ' (пусто)' : ' (лимит)'}`).join(' → ');
    return `${o.answer ? `<p class="cs-answer">${esc(o.answer)}</p>` : ''}
      <div class="vo-grid">${o.results.map(card).join('')}</div>
      <p class="cs-meta">${o.cached ? 'из сохранённого поиска · ' : ''}${chain ? 'источники: ' + esc(chain) : 'из вашей базы партнёров'}${o.city_en ? ` · ${esc(o.city_en)}` : ''}</p>
      ${(o.sources || []).length ? `<p class="bf-src">Ссылки: ${o.sources.slice(0, 6).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || 'ссылка')}</a>`).join(' · ')}</p>` : ''}`;
  };
  const draw = () => {
    box.innerHTML = `
      <div class="vo-refine cs-bar"><input id="cs-q" type="text" value="${esc(st.q)}" placeholder="Что ищем для гостя?" autocomplete="off"><button type="button" class="btn small primary" data-cs-go>Найти</button></div>
      <div class="cs-opts">
        <div class="cs-cats">${CATS.map(([k, l]) => `<button type="button" class="vo-btn sm${st.cat === k ? ' on' : ''}" data-cs-cat="${k}">${l}</button>`).join('')}</div>
        <label class="cs-f"><span>Город</span><input id="cs-city" type="text" value="${esc(st.city)}" placeholder="${c ? 'из поездки гостя' : 'Город'}" autocomplete="off"></label>
        <label class="cs-f"><span>С</span><input id="cs-from" type="date" value="${esc(st.from)}"></label>
        <label class="cs-f"><span>По</span><input id="cs-to" type="date" value="${esc(st.to)}"></label>
      </div>
      ${c ? `<p class="cs-guest">Для гостя: <b>${esc(c.name)}</b>${[c.diet?.length && 'диета', c.allergies?.length && 'аллергии', c.dislikes?.length && 'стоп-лист'].filter(Boolean).length ? ' · учту ' + [c.diet?.length && 'диету', c.allergies?.length && 'аллергии', c.dislikes?.length && 'стоп-лист'].filter(Boolean).join(', ') : ''}</p>` : ''}
      <div id="cs-res">${results()}</div>`;
  };
  const go = async (force = false) => {
    st.q = box.querySelector('#cs-q').value.trim(); st.city = box.querySelector('#cs-city').value.trim();
    st.from = box.querySelector('#cs-from').value; st.to = box.querySelector('#cs-to').value || st.from;
    if (!st.q) return box.querySelector('#cs-q').focus();
    st.busy = true; box.querySelector('#cs-res').innerHTML = results();
    try {
      st.out = await api('concierge-search', { query: st.q, category: st.cat === 'auto' ? null : st.cat, city: st.city, date_from: st.from, date_to: st.to, client_id: cid, force }, { signal: m.signal });
      if (!st.city && st.out.city) st.city = st.out.city;
      if (!st.from && st.out.from) { st.from = st.out.from; st.to = st.out.to; }
    } catch (e) {
      if (isAbort(e)) return;
      st.out = { error: e.message === 'rate_limited' ? 'rate_limited' : 'fail' };
    }
    st.busy = false;
    if (m.form.isConnected) draw();
  };

  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('.cs-bar, .cs-opts')) { e.preventDefault(); go(); } });
  box.addEventListener('click', async (e) => {
    if (e.target.closest('[data-cs-go]')) return go();
    const k = e.target.closest('[data-cs-cat]');
    if (k) { st.cat = k.dataset.csCat; box.querySelectorAll('[data-cs-cat]').forEach((b) => b.classList.toggle('on', b === k)); return; }
    const tp = e.target.closest('[data-cs-partner]');
    if (tp) {
      const x = st.out.results[+tp.dataset.csPartner];
      try {
        await save('partners', null, { name: x.title, address: x.addressOrVenue || null, city: st.city || st.out.city || null, contact: [x.contact, x.url].filter(Boolean).join(' · ') || null,
          type: PTYPE[CAT_OF(x, st.q)] || 'other', notes: x.summary || null });
        toast(`★ «${x.title}» добавлен в партнёры — следующий поиск найдёт его без запросов к API`);
        draw();
      } catch (err) { toast('Не сохранилось: ' + (err.message || err), 'err'); }
      return;
    }
    const cal = e.target.closest('[data-cs-cal]');
    if (cal) {
      const x = st.out.results[+cal.dataset.csCal];
      const ymd = x.date || st.from;
      const deadline = ymd ? localToUtc(ymd, x.time || '20:00', x.tz || st.out.tz) : null;
      const category = CAT_OF(x, st.q);
      try {
        const row = await save('requests', null, {
          client_id: cid, summary: x.title, category, urgency: 'normal', status: firstKey(), deadline,
          original_message: [x.summary, x.url].filter(Boolean).join('\n') || null,
          partner_id: x.partner_id || null,
          venue: x.partner_id ? null : { kind: 'place', name: x.kind === 'event' ? (x.addressOrVenue || '').split(',')[0] || x.title : x.title, address: x.addressOrVenue || '', maps: x.maps, website: x.url || '', from: 'search' },
        });
        toast(deadline ? `📅 В календаре гостя: ${fmtDate(ymd)}${x.time ? ' · ' + x.time : ' · 20:00'} (местное время)` : '📅 Добавлено — укажите дату в карточке запроса', '',
          { label: 'Открыть', fn: () => import('./lazy.js').then((l) => l.editRequest(row.id)) });
      } catch (err) { toast('Не сохранилось: ' + (err.message || err), 'err'); }
    }
  });
  draw();
  if (st.q && (r || query)) go(); else box.querySelector('#cs-q').focus();
}

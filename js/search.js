// «⌕ Поиск» Jarvis: одна строка → места и события из нескольких источников (ваши партнёры → Ticketmaster → Tavily → Google).
// Открывается из строки Jarvis. Можно выбрать гостя — подставятся его город, даты поездки и предпочтения.
// Карточка → «★ В партнёры» или «📅 В календарь гостя».
import { esc, openModal, toast } from './ui.js';
import { state, byId, save } from './data.js';
import { api, isAbort } from './api.js';
import { firstKey } from './statuses.js';
import { updateGliders } from './router.js';
import { getSupabase } from './supabase.js';

const keyOf = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9а-яё]+/g, ' ').trim();
const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
// метка доверия: что именно подтвердило место
function trustLine(x) {
  const t = x.trust || {};
  if (t.level === 'own') return '';
  if (x.kind === 'event' && (t.primary || x.primary)) return '<p class="cs-trust high"><b>✓ Официальная продажа</b></p>';
  if (t.level === 'high' || t.level === 'medium') {
    const parts = [t.official && 'официальный сайт', ...(t.guides || []), t.map && 'карта'].filter(Boolean);
    return `<p class="cs-trust ${t.level}"><b>✓ ${t.level === 'high' ? 'Проверено' : 'Подтверждено'}</b>${parts.length ? ' · ' + parts.map(esc).join(' · ') : ''}${t.sources ? ` · источников: ${t.sources}` : ''}</p>`;
  }
  return `<p class="cs-trust low"><b>⚠ Проверьте</b>${(t.missing || []).length ? ' · нет: ' + t.missing.map(esc).join(', ') : ''}</p>`;
}
const srcLink = (x) => (x.source_url ? ` · <a class="cs-srcl" href="${esc(x.source_url)}" target="_blank" rel="noopener noreferrer" title="Источник, не официальный сайт">${esc(domainOf(x.source_url))}</a>` : '');

const SOURCE = { black_book: 'ваш партнёр', ticketmaster: 'Ticketmaster', tavily: 'Tavily', gemini: 'Google' };
const CATS = [['auto', 'Всё'], ['venues', 'Места'], ['events', 'События'], ['general', 'Разузнать']];
const EXAMPLES = ['Бельгийское пиво на кране, без туристов', 'VIP-ложа на хоккей', 'Тихий спа с хаммамом', 'Рестораны, открытые 26 декабря'];
const CAT_OF = (x, q) => (x.kind === 'event' ? 'Activities' : /спа|массаж|хаммам|wellness|spa/i.test(q + ' ' + x.title) ? 'Spa & Wellness' : /ресторан|ужин|обед|бар|пив|вин|кафе|кухн|restaurant|bar|beer|wine|café|cafe/i.test(q + ' ' + x.title + ' ' + x.summary) ? 'Dining' : 'Activities');
const PTYPE = { Dining: 'restaurant', 'Spa & Wellness': 'spa', Activities: 'activity' };
const fmtDate = (ymd) => (ymd ? new Date(ymd + 'T12:00:00Z').toLocaleDateString('ru-RU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }) : '');
const clean = (n) => (n || '').replace(/\s*\(.*?\)/g, '').trim();

// местное время в поясе места → UTC (ISO)
function localToUtc(ymd, hm, tz) {
  const [y, m, d] = ymd.split('-').map(Number), [h, mi] = (hm || '20:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = (t) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t)).map((x) => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - t; };
  return new Date(guess - off(guess - off(guess))).toISOString();
}

export function openSearch({ query = '' } = {}) {
  const st = { q: query, cat: 'auto', cid: '', city: '', from: '', to: '', out: null, busy: false };
  const m = openModal({ title: 'Поиск', saveLabel: 'Закрыть', body: '<div class="cs" id="cs"></div>', onSave: async () => {} });
  m.form.classList.add('wide', 'vo-dlg', 'cs-dlg');
  m.form.querySelector('#cancel').hidden = true;
  m.form.querySelector('#ok').hidden = true;
  const box = m.form.querySelector('#cs');
  const guest = () => (st.cid ? byId('clients', st.cid) : null);

  const card = (x, i) => {
    const c = guest();
    const isPartner = x.sourceProvider === 'black_book' || state.partners.some((p) => p.name.trim().toLowerCase() === x.title.trim().toLowerCase());
    const meta = [x.date && `${fmtDate(x.date)}${x.time ? ' · ' + x.time : ''}`, x.price].filter(Boolean);
    return `<article class="cs-card${x.sourceProvider === 'black_book' ? ' own' : ''}${x.trust?.level === 'low' ? ' low' : ''}">
      ${x.image ? `<div class="cs-img"><img src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>` : ''}
      <div class="cs-body">
        <p class="cs-src">${x.kind === 'event' ? 'Событие' : 'Место'} · ${esc(SOURCE[x.sourceProvider] || x.sourceProvider)}</p>
        <h3 class="cs-title">${esc(x.title)}</h3>
        ${meta.length ? `<p class="cs-meta">${meta.map(esc).join(' · ')}</p>` : ''}
        ${trustLine(x).replace(/<\/p>$/, srcLink(x) + '</p>') || (x.source_url ? `<p class="cs-trust">источник${srcLink(x)}</p>` : '')}
        ${x.summary ? `<p class="cs-sum">${esc(x.summary)}</p>` : ''}
        ${x.addressOrVenue ? `<p class="cs-addr">${esc(x.addressOrVenue)}</p>` : ''}
        ${x.holiday || x.status === 'offsale' || (x.red_flags || []).length ? `<ul class="cs-notes">
          ${x.holiday ? `<li class="mid">${esc(x.holiday)}</li>` : ''}${x.status === 'offsale' ? '<li class="bad">Продажа билетов закрыта</li>' : ''}
          ${(x.red_flags || []).map((f) => `<li class="mid">${esc(f)}</li>`).join('')}</ul>` : ''}
      </div>
      <footer class="cs-act">
        ${x.url ? `<a class="vo-btn sm" href="${esc(x.url)}" target="_blank" rel="noopener">${x.kind === 'event' ? 'Билеты' : 'Сайт'}</a>` : ''}
        <a class="vo-btn sm" href="${esc(x.maps)}" target="_blank" rel="noopener">Карта</a>
        ${x.kind !== 'event' ? (isPartner ? '<span class="vo-btn sm done">★ Партнёр</span>' : `<button type="button" class="vo-btn sm" data-cs-partner="${i}">★ В партнёры</button>`) : ''}
        ${c ? `<button type="button" class="vo-btn sm accent" data-cs-cal="${i}">В календарь гостя</button>` : ''}
        ${x.sourceProvider !== 'black_book' ? `<button type="button" class="vo-btn sm icon cs-ban" data-cs-ban="${i}" title="Не предлагать это место${x.url && !x.trust?.official ? ' и этот сайт' : ''}" aria-label="Не предлагать">🚫</button>` : ''}
      </footer></article>`;
  };
  const results = () => {
    const o = st.out;
    if (st.busy) return `<p class="cs-status"><span class="spin"></span> Ищу в ваших партнёрах и в сети…</p><div class="cs-grid">${[0, 1, 2].map(() => '<div class="cs-card skel"><i></i><i></i><i></i></div>').join('')}</div>`;
    if (!o) return `<div class="cs-empty"><p>Например</p><div>${EXAMPLES.map((e) => `<button type="button" class="cs-ex" data-cs-ex="${esc(e)}">${esc(e)}</button>`).join('')}</div></div>`;
    if (o.error) return `<div class="cs-empty"><p>${o.error === 'rate_limited' ? 'Все источники сейчас упёрлись в лимит. Попробуйте через минуту.' : 'Поиск не удался.'}</p><div><button type="button" class="vo-btn" data-cs-go>Повторить</button></div></div>`;
    if (!o.results.length) return '<div class="cs-empty"><p>Ничего не нашлось. Попробуйте иначе сформулировать или убрать даты.</p></div>';
    const via = [...new Set((o.tried || []).filter((t) => t.status === 'ok' && t.provider !== 'cards').map((t) => SOURCE[t.provider] || t.provider))];
    return `${o.answer ? `<p class="cs-answer">${esc(o.answer)}</p>` : ''}
      <div class="cs-grid">${o.results.map(card).join('')}</div>
      <p class="cs-foot"><button type="button" class="link cs-bans-btn" data-cs-bans>Мои запреты${bans ? ` · ${bans.length}` : ''}</button> · ${o.results.length} · ${[o.city_en || o.city, o.from && fmtDate(o.from)].filter(Boolean).map(esc).join(', ')}${via.length ? ` · через ${esc(via.join(', '))}` : ''}${o.cached ? ' · сохранённый поиск' : ''}
        ${(o.sources || []).length ? ` · <span class="cs-links">${o.sources.slice(0, 4).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc((s.title || 'источник').slice(0, 40))}</a>`).join(', ')}</span>` : ''}</p>`;
  };
  // ---------- «Не предлагать»: ваш чёрный список ----------
  let bans = null;
  const loadBans = async () => { const sb = await getSupabase(); const { data } = await sb.from('search_blocks').select('id,kind,value,label').order('created_at', { ascending: false }); bans = data || []; };
  const bansPanel = () => `<div class="cs-bans">${bans?.length ? bans.map((b) => `<span class="cs-ban-i">${b.kind === 'domain' ? '🌐' : '📍'} ${esc(b.label || b.value)}<button type="button" data-cs-unban="${b.id}" aria-label="Убрать из запретов">✕</button></span>`).join('') : '<span class="muted">Пока пусто. Нажмите 🚫 на карточке — место (и сомнительный сайт) больше не появятся.</span>'}</div>`;
  const clients = () => [...state.clients].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const draw = () => {
    const c = guest();
    box.innerHTML = `
      <div class="cs-search"><span class="cs-ic" aria-hidden="true">⌕</span>
        <input id="cs-q" type="text" value="${esc(st.q)}" placeholder="Что ищем?" autocomplete="off">
        <button type="button" class="btn primary" data-cs-go>Найти</button></div>
      <div class="cs-filters">
        <div class="seg cs-seg" role="tablist" aria-label="Что ищем">${CATS.map(([k, l]) => `<button type="button" data-cs-cat="${k}" aria-selected="${st.cat === k}">${l}</button>`).join('')}</div>
        <label class="cs-pill"><span>Гость</span><select id="cs-guest"><option value="">—</option>${clients().map((x) => `<option value="${x.id}"${x.id === st.cid ? ' selected' : ''}>${esc(clean(x.name))}</option>`).join('')}</select></label>
        <label class="cs-pill"><span>Город</span><input id="cs-city" type="text" value="${esc(st.city)}" placeholder="${c ? 'из поездки' : 'любой'}" autocomplete="off"></label>
        <label class="cs-pill"><span>Даты</span><input id="cs-from" type="date" value="${esc(st.from)}"><i>—</i><input id="cs-to" type="date" value="${esc(st.to)}"></label>
      </div>
      ${c && [c.diet?.length, c.allergies?.length, c.dislikes?.length].some(Boolean) ? `<p class="cs-ctx">Учту: ${[c.diet?.length && 'диету', c.allergies?.length && 'аллергии', c.dislikes?.length && 'стоп-лист'].filter(Boolean).join(', ')}</p>` : ''}
      <div id="cs-res">${results()}</div>`;
    updateGliders();
  };
  const read = () => {
    st.q = box.querySelector('#cs-q').value.trim(); st.city = box.querySelector('#cs-city').value.trim();
    st.from = box.querySelector('#cs-from').value; st.to = box.querySelector('#cs-to').value || st.from; st.cid = box.querySelector('#cs-guest').value;
  };
  const go = async () => {
    read();
    if (!st.q) return box.querySelector('#cs-q').focus();
    st.busy = true; box.querySelector('#cs-res').innerHTML = results();
    try {
      st.out = await api('concierge-search', { query: st.q, category: st.cat === 'auto' ? null : st.cat, city: st.city, date_from: st.from, date_to: st.to, client_id: st.cid || null }, { signal: m.signal });
      if (!st.city && st.out.city) st.city = st.out.city;
      if (!st.from && st.out.from) { st.from = st.out.from; st.to = st.out.to; }
    } catch (e) {
      if (isAbort(e)) return;
      st.out = { error: e.message === 'rate_limited' ? 'rate_limited' : 'fail' };
    }
    st.busy = false;
    if (m.form.isConnected) draw();
  };

  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('.cs-search, .cs-filters')) { e.preventDefault(); go(); } });
  box.addEventListener('change', (e) => { if (e.target.id === 'cs-guest') { read(); draw(); } });
  box.addEventListener('click', async (e) => {
    if (e.target.closest('[data-cs-go]')) return go();
    if (e.target.closest('[data-cs-bans]')) {
      const ex = box.querySelector('.cs-bans');
      if (ex) { ex.remove(); return; }
      await loadBans(); box.querySelector('.cs-foot').insertAdjacentHTML('afterend', bansPanel()); return;
    }
    const ub = e.target.closest('[data-cs-unban]');
    if (ub) { const sb = await getSupabase(); await sb.from('search_blocks').delete().eq('id', ub.dataset.csUnban); await loadBans(); box.querySelector('.cs-bans').outerHTML = bansPanel(); toast('Убрано из запретов'); return; }
    const ban = e.target.closest('[data-cs-ban]');
    if (ban) {
      const x = st.out.results[+ban.dataset.csBan];
      const rows = [{ kind: 'venue', value: keyOf(x.title), label: x.title }];
      if (x.url && !x.trust?.official && !/ticketmaster|eventim/.test(domainOf(x.url))) rows.push({ kind: 'domain', value: domainOf(x.url), label: domainOf(x.url) });
      try {
        const sb = await getSupabase();
        const { error } = await sb.from('search_blocks').upsert(rows, { onConflict: 'owner_id,kind,value', ignoreDuplicates: true });
        if (error) throw error;
        st.out.results = st.out.results.filter((r) => r !== x);
        bans = null; read(); draw();
        toast(`🚫 «${x.title}» больше не будет предлагаться`, '', { label: 'Отменить', fn: async () => { for (const r of rows) await sb.from('search_blocks').delete().eq('kind', r.kind).eq('value', r.value); toast('Вернул'); } });
      } catch (err) { toast('Не сохранилось: ' + (err.message || err), 'err'); }
      return;
    }
    const ex = e.target.closest('[data-cs-ex]');
    if (ex) { box.querySelector('#cs-q').value = ex.dataset.csEx; return go(); }
    const k = e.target.closest('[data-cs-cat]');
    if (k) { st.cat = k.dataset.csCat; box.querySelectorAll('[data-cs-cat]').forEach((b) => b.setAttribute('aria-selected', String(b === k))); updateGliders(); return; }
    const tp = e.target.closest('[data-cs-partner]');
    if (tp) {
      const x = st.out.results[+tp.dataset.csPartner];
      try {
        await save('partners', null, { name: x.title, address: x.addressOrVenue || null, city: st.city || st.out.city || null, contact: [x.contact, x.url].filter(Boolean).join(' · ') || null,
          type: PTYPE[CAT_OF(x, st.q)] || 'other', notes: x.summary || null });
        toast(`★ «${x.title}» в партнёрах — в следующий раз найдётся бесплатно`);
        read(); draw();
      } catch (err) { toast('Не сохранилось: ' + (err.message || err), 'err'); }
      return;
    }
    const cal = e.target.closest('[data-cs-cal]');
    if (cal) {
      const x = st.out.results[+cal.dataset.csCal];
      const ymd = x.date || st.from;
      const deadline = ymd ? localToUtc(ymd, x.time || '20:00', x.tz || st.out.tz) : null;
      try {
        const row = await save('requests', null, {
          client_id: st.cid, summary: x.title, category: CAT_OF(x, st.q), urgency: 'normal', status: firstKey(), deadline,
          original_message: [x.summary, x.url].filter(Boolean).join('\n') || null, partner_id: x.partner_id || null,
          venue: x.partner_id ? null : { kind: 'place', name: x.kind === 'event' ? (x.addressOrVenue || '').split(',')[0] || x.title : x.title, address: x.addressOrVenue || '', maps: x.maps, website: x.url || '', from: 'search' },
        });
        toast(deadline ? `В календаре: ${fmtDate(ymd)} · ${x.time || '20:00'} по местному времени` : 'Добавлено — укажите дату в карточке запроса', '',
          { label: 'Открыть', fn: () => import('./lazy.js').then((l) => l.editRequest(row.id)) });
      } catch (err) { toast('Не сохранилось: ' + (err.message || err), 'err'); }
    }
  });
  draw();
  if (st.q) go(); else box.querySelector('#cs-q').focus();
}

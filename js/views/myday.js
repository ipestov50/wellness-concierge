// «Мой день»: мировые часы гостей, «Сейчас», список действий без таймингов, «Запрос выполнен / Шаг сделан / Позже», черновики, перетаскивание
import { esc, toast, openModal, options, field, avatar } from '../ui.js';
import { state, byId, save, remove, dataVersion } from '../data.js';
import { ui, render } from '../router.js';
import { getSupabase } from '../supabase.js';
import { planDay, why, hmIn, dayIn, zoned, OWNER_TZ, weekAgenda } from '../planner.js';
import { guestWhere, timeIn } from '../tz.js';
import { setStatus, completeRequest, reopenRequest, isDone } from '../actions.js';
import { statusLabel } from '../statuses.js';
import { editRequest } from '../forms.js';

let settings = null;
async function loadSettings() {
  if (settings) return settings;
  const sb = await getSupabase();
  let { data } = await sb.from('app_settings').select('*').maybeSingle();
  if (!data) ({ data } = await sb.from('app_settings').insert({}).select().single());
  settings = data || {};
  render();
  return settings;
}
const hm = (ms) => hmIn(OWNER_TZ, ms);
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// дни для переноса: послезавтра … через 6 дней
const nextDays = () => { const t = dayIn(OWNER_TZ, Date.now()); return [2, 3, 4, 5, 6].map((i) => { const d = addDays(t, i); const dt = new Date(d + 'T12:00:00Z'); return [d, `${WD[dt.getUTCDay()]} ${dt.getUTCDate()}`]; }); };
const KIND = { guest: ['Гость', 'k-guest'], partner: ['Партнёр', 'k-partner'], check: ['Проверка', 'k-check'], prep: ['Подготовка', 'k-prep'] };

// план кэшируется: пересчёт только если изменились данные, настройки или наступила новая минута
let cache = { k: '', plan: null };
export function currentPlan() {
  if (!settings) loadSettings();
  const k = `${dataVersion()}|${Math.floor(Date.now() / 60e3)}|${settings ? JSON.stringify([settings.work_from, settings.work_to, settings.lunch_from, settings.lunch_to, settings.guest_from, settings.guest_to]) : ''}`;
  if (cache.k !== k) cache = { k, plan: planDay({ now: Date.now(), data: state, settings: settings || {}, marks: state.day_items }) };
  return cache.plan;
}
let weekCache = { k: '', week: null };
function currentWeek() {
  const k = `${dataVersion()}|${new Date().toDateString()}`;
  if (weekCache.k !== k) weekCache = { k, week: weekAgenda({ data: state, marks: state.day_items, days: 7 }) };
  return weekCache.week;
}

// ---------- мировые часы: города гостей прямо сейчас ----------
function worldClocks() {
  const seen = new Map();
  const add = (tz, label) => { if (tz && !seen.has(tz)) seen.set(tz, label); };
  add(OWNER_TZ, 'Вы · Париж');
  const relevant = new Set(state.requests.filter((r) => r.client_id).map((r) => r.client_id));
  for (const c of state.clients) { if (!relevant.has(c.id) && !c.vip) continue; const w = guestWhere(c); if (w) add(w.tz, w.place || w.tz.split('/').pop().replace(/_/g, ' ')); }
  const list = [...seen.entries()].map(([tz, label]) => ({ tz, label, h: +hmIn(tz, Date.now()).slice(0, 2) }));
  const off = (tz) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, day: '2-digit' }).formatToParts(new Date()).map((x) => [x.type, x.value])); return +p.day * 1440 + (+p.hour % 24) * 60 + +p.minute; };
  list.sort((a, b) => off(a.tz) - off(b.tz));
  return `<div class="wclock">${list.map((x) => { const ph = x.h >= 22 || x.h < 7 ? 'night' : x.h < 9 ? 'dawn' : x.h >= 19 ? 'dusk' : 'day';
    const ok = x.h >= (settings?.guest_from ?? 10) && x.h < (settings?.guest_to ?? 21);
    return `<div class="wc ph-${ph}${x.tz === OWNER_TZ ? ' me' : ''}" title="${esc(x.tz)}"><b data-tz-clock="${esc(x.tz)}">${timeIn(x.tz)}</b><span>${esc(x.label)}</span>${x.tz === OWNER_TZ ? '' : `<i class="${ok ? 'ok' : 'no'}">${ok ? 'можно писать' : ph === 'night' ? 'спит' : 'не беспокоить'}</i>`}</div>`; }).join('')}</div>`;
}

// ---------- блок действия (без времени) ----------
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7.2 12.4l3.2 3.2 6.4-6.6"/></svg>';
// «почему» без часов: только то, что влияет на решение
const whyClean = (b) => why(b).split(' · ').filter((x) => x && !/^у (гостя|партнёра) /.test(x) && !/^\d/.test(x) && x !== 'вы поставили это время').join(' · ');
function blockHtml(b, { big = false } = {}) {
  const c = byId('clients', b.client_id);
  const r = b.request_id ? byId('requests', b.request_id) : null;
  const w = whyClean(b);
  return `<article class="db ${KIND[b.kind]?.[1] || ''}${b.late || b.missed || b.overdue ? ' warn' : ''}${big ? ' big' : ''}${r ? ' has-req' : ''}" data-db="${esc(b.key)}">
    ${r ? `<button type="button" class="db-check" data-db-complete="${esc(r.id)}" title="Запрос выполнен — уйдёт в «Выполнено» на доске" aria-label="Запрос выполнен: ${esc(r.summary)}">${CHECK}</button>` : '<span class="db-check-sp"></span>'}
    <div class="db-body">
      <div class="db-title"><span class="db-ic">${b.icon}</span><b>${esc(b.title)}</b></div>
      ${c || b.who ? `<div class="db-who">${c ? avatar(c, 'av-xs') : ''}<span>${esc(b.who || c?.name || '')}</span>${r ? `<span class="db-st">${esc(statusLabel(r.status))}</span>` : ''}</div>` : ''}
      ${b.detail || r?.summary ? `<p class="db-detail">${esc(b.detail || r.summary)}</p>` : ''}
      ${w ? `<p class="db-why">${esc(w)}</p>` : ''}
      <div class="db-actions">
        ${b.kind === 'guest' || b.kind === 'partner' ? `<button type="button" class="btn small" data-db-draft="${esc(b.key)}">✍ Черновик</button>` : ''}
        ${r ? `<button type="button" class="btn small ghostish" data-db-open="${esc(r.id)}">Открыть</button>` : ''}
        <span class="db-sp"></span>
        <div class="db-later"><button type="button" class="btn small ghostish" data-db-later="${esc(b.key)}">⏭ Позже</button>
          <div class="db-menu" hidden><button type="button" data-db-snooze="later">Ниже в списке</button><button type="button" data-db-snooze="tomorrow">Завтра</button>
            <div class="db-days">${nextDays().map(([d, l]) => `<button type="button" data-db-moveto="${d}">${l}</button>`).join('')}</div></div></div>
        ${r ? `<button type="button" class="btn small primary" data-db-complete="${esc(r.id)}">✓ Сделано</button>
          <button type="button" class="btn small ghostish" data-db-done="${esc(b.key)}" title="Только этот шаг, запрос остаётся в работе">Шаг сделан</button>`
          : `<button type="button" class="btn small primary" data-db-done="${esc(b.key)}">✓ Сделано</button>`}
      </div>
    </div>
    <button type="button" class="db-grip" data-db-grip aria-label="Перетащить выше или ниже">⋮⋮</button>
  </article>`;
}

// ---------- вкладка ----------
export function dayView() {
  if (!settings) { loadSettings(); return `<div class="dayv"><div class="empty">Собираю ваш день…</div></div>`; }
  const P = currentPlan();
  const now = Date.now();
  const left = P.blocks.filter((b) => b.end > now || P.tomorrow);
  const first = left[0];
  const dateLabel = new Date(P.dayStart).toLocaleDateString('ru-RU', { timeZone: OWNER_TZ, weekday: 'long', day: 'numeric', month: 'long' });
  const doneReqs = closedToday();
  const doneN = P.done.length + doneReqs.length;
  const rows = P.blocks.filter((b) => b !== first).map((b) => blockHtml(b)).join('');
  return `<div class="dayv">
    ${worldClocks()}
    <header class="day-head">
      <div><h2>${P.tomorrow ? 'План на завтра' : 'Мой день'}</h2><span>${esc(dateLabel)}</span></div>
      <div class="day-stats"><b>${P.blocks.length}</b><small>в работе</small><b>${doneN}</b><small>сделано</small></div>
      <button type="button" class="icon-btn" id="daySettings" title="Рабочие часы и окна">⚙</button>
    </header>
    ${weekStrip()}
    ${first ? `<section class="day-now"><span class="day-now-l">${P.tomorrow ? 'Первым делом' : 'Сейчас'}</span>${blockHtml(first, { big: true })}</section>` : ''}
    ${P.blocks.length > 1 ? `<section class="day-line" id="dayLine"><h3 class="day-line-h">Дальше · ${P.blocks.length - 1}</h3>${rows}</section>`
      : !P.blocks.length ? `<div class="empty calm">${P.tomorrow ? 'На завтра пока пусто.' : 'На сегодня всё сделано. Можно выдохнуть ✨'}</div>` : ''}
    ${P.overflow.length ? `<section class="day-over"><h3>Не помещается сегодня · ${P.overflow.length}</h3>${P.overflow.map((a) => `<div class="day-over-i"><span>${a.icon} ${esc(a.title)}${a.who ? ` · ${esc(a.who)}` : ''}</span></div>`).join('')}
      <button type="button" class="btn small" data-db-all-tomorrow>Перенести всё на завтра</button></section>` : ''}
    ${doneN ? `<details class="day-done"${doneReqs.length ? ' open' : ''}><summary>Сделано сегодня · ${doneN}</summary>
      ${doneReqs.map((r) => `<div class="day-done-i is-req"><span>✓ <s>${esc(r.summary)}</s>${byId('clients', r.client_id) ? ` · ${esc(byId('clients', r.client_id).name)}` : ''} <em>запрос выполнен</em></span><button type="button" class="link" data-db-reopen="${esc(r.id)}">вернуть в работу</button></div>`).join('')}
      ${P.done.map((a) => `<div class="day-done-i"><span>✓ <s>${esc(a.title)}</s>${a.who ? ` · ${esc(a.who)}` : ''}</span><button type="button" class="link" data-db-undo="${esc(a.key)}">вернуть</button></div>`).join('')}</details>` : ''}
  </div>`;
}

// запросы, закрытые сегодня (по Парижу) — видно, что сделано, и можно вернуть
function closedToday() {
  const today = dayIn(OWNER_TZ, Date.now());
  return state.requests.filter((r) => isDone(r) && r.updated_at && dayIn(OWNER_TZ, +new Date(r.updated_at)) === today);
}

// ---------- неделя: что впереди, чтобы распланировать ----------
const WK_ICON = { deadline: '📌', arrive: '🛬', depart: '🛫', date: '🎂', moved: '↪︎' };
function weekStrip() {
  const W = currentWeek();
  const max = Math.max(3, ...W.map((d) => d.load));
  const sel = ui.weekDay && W.some((d) => d.day === ui.weekDay) ? ui.weekDay : null;
  const chosen = sel ? W.find((d) => d.day === sel) : null;
  return `<section class="week">
    <div class="week-head"><h3>Неделя</h3><small>нажмите на день — увидите, что там запланировано</small></div>
    <div class="week-strip">${W.map((d, i) => { const dt = new Date(d.day + 'T12:00:00Z');
      return `<button type="button" class="wk${i === 0 ? ' today' : ''}${sel === d.day ? ' on' : ''}" data-wk="${d.day}">
        <small>${i === 0 ? 'сегодня' : i === 1 ? 'завтра' : WD[dt.getUTCDay()]}</small><b>${dt.getUTCDate()}</b>
        <span class="wk-bar"><i style="width:${Math.min(100, (d.load / max) * 100)}%"></i></span>
        <em>${d.items.length ? d.items.length : '—'}</em></button>`; }).join('')}</div>
    ${chosen ? `<div class="week-list">${chosen.items.length ? chosen.items.map((x) => `<button type="button" class="wk-i k-${x.kind}" ${x.request_id ? `data-db-open="${x.request_id}"` : ''}>
        <span class="wk-ic">${WK_ICON[x.kind]}</span><span class="wk-x"><b>${esc(x.title)}</b>${x.who ? `<small>${esc(x.who)}</small>` : ''}</span>
        ${x.kind === 'moved' ? '<em>перенесено сюда</em>' : x.urgency === 'critical' || x.urgency === 'high' ? '<em class="hot">срочно</em>' : ''}</button>`).join('')
      : '<p class="muted">В этот день пока ничего — свободный день, можно перенести сюда дела.</p>'}</div>` : ''}
  </section>`;
}

// ---------- отметки ----------
async function mark(key, status, at = null) {
  const P = currentPlan();
  const ex = state.day_items.find((x) => x.day === P.day && x.key === key);
  const row = { day: P.day, key, status, at };
  if (ex) await save('day_items', ex.id, row); else await save('day_items', null, row);
}
async function moveTo(key, target) {
  const P = currentPlan();
  for (let d = P.day; d < target; d = addDays(d, 1)) {
    const ex = state.day_items.find((x) => x.day === d && x.key === key);
    const row = { day: d, key, status: 'tomorrow', at: null };
    if (ex) await save('day_items', ex.id, row); else await save('day_items', null, row);
  }
}
async function unmark(key) {
  const P = currentPlan();
  const ex = state.day_items.find((x) => x.day === P.day && x.key === key);
  if (ex) await remove('day_items', ex.id);
}

// «Сделано» двигает запрос дальше, если это очевидно, — с возможностью отменить
async function sideEffects(b) {
  const r = b.request_id ? byId('requests', b.request_id) : null;
  const c = b.client_id ? byId('clients', b.client_id) : null;
  if (b.kind === 'guest' && c) await save('clients', c.id, { last_contact: dayIn(OWNER_TZ, Date.now()) }).catch(() => {});
  if (r && b.next && r.status !== b.next) {
    const before = r.status;
    await setStatus(r.id, b.next, { quiet: true });
    toast(`✓ ${b.title} · статус → ${statusLabel(b.next)}`, '', { label: 'Отменить', fn: () => { unmark(b.key); setStatus(r.id, before, { quiet: true }); } });
    return true;
  }
  return false;
}

export function bindDay(app) {
  const root = app.querySelector('.dayv');
  if (!root) return;
  root.querySelector('#daySettings')?.addEventListener('click', openSettings);
  root.addEventListener('click', async (e) => {
    const t = e.target;
    const P = currentPlan();
    const find = (k) => P.blocks.find((b) => b.key === k);
    const comp = t.closest('[data-db-complete]');
    if (comp) {
      const el = comp.closest('.db');
      el?.classList.add('leaving');
      comp.classList.add('checked');
      await new Promise((r) => setTimeout(r, 240));
      try { await completeRequest(comp.dataset.dbComplete); } catch { el?.classList.remove('leaving'); }
      return;
    }
    const ro = t.closest('[data-db-reopen]');
    if (ro) { reopenRequest(ro.dataset.dbReopen).catch(() => {}); return; }
    const done = t.closest('[data-db-done]');
    if (done) {
      const b = find(done.dataset.dbDone);
      const el = done.closest('.db');
      el?.classList.add('leaving');
      await new Promise((r) => setTimeout(r, 260));
      try { await mark(b.key, 'done'); if (!(await sideEffects(b))) toast(`✓ ${b.title}`, '', { label: 'Вернуть', fn: () => unmark(b.key) }); }
      catch (err) { el?.classList.remove('leaving'); toast('Не сохранилось: ' + err.message, 'err'); }
      return;
    }
    const later = t.closest('[data-db-later]');
    if (later) { const menu = later.parentElement.querySelector('.db-menu'); root.querySelectorAll('.db-menu').forEach((m) => m !== menu && (m.hidden = true)); menu.hidden = !menu.hidden; return; }
    const sn = t.closest('[data-db-snooze]');
    if (sn) {
      const key = sn.closest('.db').dataset.db;
      const v = sn.dataset.dbSnooze;
      if (v === 'tomorrow') { await mark(key, 'tomorrow'); toast('Перенесено на завтра', '', { label: 'Вернуть', fn: () => unmark(key) }); }
      else {
        // «ниже в списке»: ставим после последнего дела сегодня
        const last = P.blocks.filter((x) => x.key !== key).at(-1);
        const at = Math.max(Date.now(), last ? last.end : Date.now()) + 6e4;
        await mark(key, 'snoozed', new Date(Math.ceil(at / 3e5) * 3e5).toISOString());
        toast('Опущено ниже в списке', '', { label: 'Вернуть', fn: () => unmark(key) });
      }
      return;
    }
    const mv = t.closest('[data-db-moveto]');
    if (mv) {
      const key = mv.closest('.db').dataset.db;
      await moveTo(key, mv.dataset.dbMoveto);
      const dt = new Date(mv.dataset.dbMoveto + 'T12:00:00Z');
      toast(`Перенесено на ${WD[dt.getUTCDay()]} ${dt.getUTCDate()}`);
      return;
    }
    const wk = t.closest('[data-wk]');
    if (wk) { ui.weekDay = ui.weekDay === wk.dataset.wk ? null : wk.dataset.wk; render(); return; }
    const undo = t.closest('[data-db-undo]');
    if (undo) { await unmark(undo.dataset.dbUndo); return; }
    if (t.closest('[data-db-all-tomorrow]')) { for (const a of P.overflow) await mark(a.key, 'tomorrow'); toast('Перенесено на завтра'); return; }
    const op = t.closest('[data-db-open]');
    if (op) { editRequest(op.dataset.dbOpen); return; }
    const dr = t.closest('[data-db-draft]');
    if (dr) { openDraft(find(dr.dataset.dbDraft)); return; }
    if (!t.closest('.db-later')) root.querySelectorAll('.db-menu').forEach((m) => (m.hidden = true));
  });
  enableBlockDrag(root);
}

// ---------- перетаскивание блока на время другого блока или окна ----------
function enableBlockDrag(root) {
  root.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('[data-db-grip]');
    const el = grip?.closest('.db');
    if (!el || el.classList.contains('big')) return;
    e.preventDefault();
    const sy = e.clientY, rect = el.getBoundingClientRect();
    let started = false, ghost = null, target = null, y = sy;
    const P = currentPlan();
    const b = P.blocks.find((x) => x.key === el.dataset.db);
    const move = (ev) => {
      y = ev.clientY;
      if (!started) { if (Math.abs(y - sy) < 5) return; started = true; ghost = el.cloneNode(true); ghost.classList.add('db-ghost'); Object.assign(ghost.style, { width: rect.width + 'px', left: rect.left + 'px', top: rect.top + 'px' }); document.body.append(ghost); el.classList.add('db-lifted'); }
      ghost.style.transform = `translateY(${y - sy}px) scale(1.02) rotate(.4deg)`;
      const over = document.elementFromPoint(rect.left + 40, y)?.closest('.db');
      if (over !== target) { target?.classList.remove('drop-on'); target = over && over !== el ? over : null; target?.classList.add('drop-on'); }
    };
    const up = async () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (!started) return;
      ghost.remove(); el.classList.remove('db-lifted'); target?.classList.remove('drop-on');
      if (!target) return;
      const tb = target.dataset.db ? P.blocks.find((x) => x.key === target.dataset.db) : null;
      const at = tb ? tb.start : null;
      if (!at) return;
      await mark(b.key, 'pinned', new Date(at).toISOString());
      if (b.kind === 'guest' && b.guestTz) {
        const h = +hmIn(b.guestTz, at).slice(0, 2);
        if (h >= (settings?.guest_to ?? 21) || h < (settings?.guest_from ?? 10)) toast('⚠ У гостя в это время поздно для сообщения', 'err');
        else toast('Порядок изменён');
      } else toast('Порядок изменён');
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
}

// ---------- черновик сообщения от Jarvis ----------
async function openDraft(b) {
  const c = byId('clients', b.client_id);
  const r = b.request_id ? byId('requests', b.request_id) : null;
  const p = r?.partner_id ? byId('partners', r.partner_id) : null;
  const m = openModal({ title: b.kind === 'partner' ? 'Сообщение партнёру' : 'Сообщение гостю', saveLabel: 'Закрыть', body: `<div class="dr"><p class="dr-ctx">${b.icon} ${esc(b.title)}${b.who ? ' · ' + esc(b.who) : ''}</p><div class="dr-text"><span class="spin"></span> Jarvis пишет…</div></div>`, onSave: async () => {} });
  m.form.querySelector('#cancel').hidden = true;
  try {
    const sb = await getSupabase();
    const token = (await sb.auth.getSession()).data.session?.access_token;
    const res = await fetch('/api/message', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ kind: b.kind, title: b.title, detail: b.detail || '', request_id: r?.id || null, client_id: c?.id || null }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error === 'rate_limited' ? 'лимит Gemini, попробуйте через минуту' : body.error || res.status);
    const first = (c?.name || '').replace(/\s*\(.*?\)/g, '').split(/\s+/)[0] || '';
    const text = String(body.text || '').replace(/\{имя\}/g, first).replace(/\{гость\}/g, (c?.name || '').replace(/\s*\(.*?\)/g, ''));
    const phone = b.kind === 'guest' ? (c?.phone || '').replace(/[^\d]/g, '') : '';
    m.form.querySelector('.dr-text').outerHTML = `<textarea class="dr-area" rows="7">${esc(text)}</textarea>
      <p class="dr-lang">${esc(body.lang_label || '')}${b.kind === 'partner' && p?.contact ? ` · контакт: ${esc(p.contact)}` : ''}</p>
      <div class="dr-act"><button type="button" class="btn small primary" data-dr-copy>Скопировать</button>
      ${phone ? `<a class="btn small" target="_blank" rel="noopener" data-dr-wa href="https://wa.me/${phone}">WhatsApp</a>` : ''}
      ${b.kind === 'guest' && c?.telegram ? `<a class="btn small" target="_blank" rel="noopener" href="https://t.me/${esc(c.telegram.replace(/^@/, ''))}">Telegram</a>` : ''}</div>`;
    const area = m.form.querySelector('.dr-area');
    m.form.querySelector('[data-dr-copy]').onclick = async () => { await navigator.clipboard.writeText(area.value); toast('Скопировано'); };
    const wa = m.form.querySelector('[data-dr-wa]');
    if (wa) wa.onclick = () => { wa.href = `https://wa.me/${phone}?text=${encodeURIComponent(area.value)}`; };
  } catch (err) {
    m.form.querySelector('.dr-text').textContent = 'Не получилось: ' + err.message;
  }
}

// ---------- настройки дня ----------
function openSettings() {
  const s = settings || {};
  const hours = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => [from + i, String(from + i).padStart(2, '0') + ':00']);
  openModal({
    title: 'Мой день · настройки',
    body: `<div class="f2">${field('work_from', 'Начало работы', `<select id="f-work_from" name="work_from">${options(hours(5, 12), s.work_from ?? 8)}</select>`)}${field('work_to', 'Конец работы', `<select id="f-work_to" name="work_to">${options(hours(14, 24), s.work_to ?? 20)}</select>`)}</div>
      <div class="f2">${field('lunch_from', 'Обед с', `<select id="f-lunch_from" name="lunch_from">${options(hours(11, 15), s.lunch_from ?? 13)}</select>`)}${field('lunch_to', 'Обед до', `<select id="f-lunch_to" name="lunch_to">${options(hours(12, 16), s.lunch_to ?? 14)}</select>`)}</div>
      <div class="f2">${field('guest_from', 'Писать гостям с', `<select id="f-guest_from" name="guest_from">${options(hours(7, 12), s.guest_from ?? 10)}</select>`, 'по времени гостя')}${field('guest_to', 'Писать гостям до', `<select id="f-guest_to" name="guest_to">${options(hours(18, 23), s.guest_to ?? 21)}</select>`)}</div>
      <label class="check"><input type="checkbox" name="day_remind"${s.day_remind !== false ? ' checked' : ''}> Напоминать в Telegram за 15 минут до блока</label>`,
    onSave: async (v) => {
      const sb = await getSupabase();
      const patch = { work_from: +v.work_from, work_to: +v.work_to, lunch_from: +v.lunch_from, lunch_to: +v.lunch_to, guest_from: +v.guest_from, guest_to: +v.guest_to, day_remind: !!v.day_remind };
      const { data, error } = await sb.from('app_settings').update(patch).eq('owner_id', settings.owner_id).select().single();
      if (error) throw error;
      settings = data; render(); toast('Настройки дня сохранены');
    },
  });
}

// план пересобирается сам каждую минуту — «Сейчас» двигается
setInterval(() => { if (ui.tab === 'requests' && ui.reqView === 'day' && !document.querySelector('.ov, .db-ghost, .db-menu:not([hidden])')) render(); }, 60e3);

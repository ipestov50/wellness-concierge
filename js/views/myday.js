// «Мой день»: мировые часы гостей, «Сейчас», шкала дня по часам, «Сделано / Позже / Завтра», черновики, перетаскивание
import { esc, toast, openModal, options, field, avatar } from '../ui.js';
import { state, byId, save, remove } from '../data.js';
import { ui, render } from '../router.js';
import { getSupabase } from '../supabase.js';
import { planDay, why, hmIn, dayIn, zoned, OWNER_TZ } from '../planner.js';
import { guestWhere, timeIn, flag } from '../tz.js';
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
const KIND = { guest: ['Гость', 'k-guest'], partner: ['Партнёр', 'k-partner'], check: ['Проверка', 'k-check'], prep: ['Подготовка', 'k-prep'] };

export function currentPlan() {
  return planDay({ now: Date.now(), data: state, settings: settings || {}, marks: state.day_items });
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

// ---------- блок шкалы ----------
function blockHtml(b, now, { big = false } = {}) {
  const c = byId('clients', b.client_id);
  const r = b.request_id ? byId('requests', b.request_id) : null;
  const live = now >= b.start && now < b.end;
  const past = now >= b.end;
  const w = why(b);
  return `<article class="db ${KIND[b.kind]?.[1] || ''}${live ? ' live' : ''}${past ? ' past' : ''}${b.late || b.missed ? ' warn' : ''}${big ? ' big' : ''}" data-db="${esc(b.key)}">
    <div class="db-time"><b>${hm(b.start)}</b><small>${b.dur} мин</small></div>
    <div class="db-body">
      <div class="db-title"><span class="db-ic">${b.icon}</span><b>${esc(b.title)}</b>${b.fixed ? '<span class="db-pin" title="Точное время">⏱</span>' : ''}</div>
      ${c || b.who ? `<div class="db-who">${c ? avatar(c, 'av-xs') : ''}<span>${esc(b.who || c?.name || '')}</span>${b.guestLocal ? `<span class="db-tz">у гостя ${b.guestLocal}${b.guestPlace ? ' · ' + esc(b.guestPlace) : ''}</span>` : ''}${b.partnerLocal ? `<span class="db-tz">у партнёра ${b.partnerLocal}</span>` : ''}</div>` : ''}
      ${b.detail || r?.summary ? `<p class="db-detail">${esc(b.detail || r.summary)}</p>` : ''}
      ${w && !b.guestLocal && !b.partnerLocal ? `<p class="db-why">${esc(w)}</p>` : w && (b.pinned || b.late || b.missed || b.outside || b.batch || b.overdue) ? `<p class="db-why">${esc(w.replace(/^у (гостя|партнёра) [^·]+·?\s?/, ''))}</p>` : ''}
      <div class="db-actions">
        ${b.kind === 'guest' || b.kind === 'partner' ? `<button type="button" class="btn small" data-db-draft="${esc(b.key)}">✍ Черновик</button>` : ''}
        ${r ? `<button type="button" class="btn small ghostish" data-db-open="${esc(r.id)}">Открыть</button>` : ''}
        <span class="db-sp"></span>
        <div class="db-later"><button type="button" class="btn small ghostish" data-db-later="${esc(b.key)}">⏭ Позже</button>
          <div class="db-menu" hidden><button type="button" data-db-snooze="30">+30 минут</button><button type="button" data-db-snooze="lunch">После обеда</button><button type="button" data-db-snooze="tomorrow">Завтра</button></div></div>
        <button type="button" class="btn small primary" data-db-done="${esc(b.key)}">✓ Сделано</button>
      </div>
    </div>
    <button type="button" class="db-grip" data-db-grip aria-label="Перетащить на другое время">⋮⋮</button>
  </article>`;
}

// ---------- вкладка ----------
export function dayView() {
  if (!settings) { loadSettings(); return `<div class="dayv"><div class="empty">Собираю ваш день…</div></div>`; }
  const P = currentPlan();
  const now = Date.now();
  const left = P.blocks.filter((b) => b.end > now);
  const nowB = left.find((b) => b.start <= now) || left[0];
  const total = P.blocks.reduce((s, b) => s + b.dur, 0);
  const dateLabel = new Date(P.dayStart).toLocaleDateString('ru-RU', { timeZone: OWNER_TZ, weekday: 'long', day: 'numeric', month: 'long' });
  const nowLine = !P.tomorrow && now > P.dayStart && now < P.dayEnd;
  let rows = '', lineDone = false;
  const gapHtml = (s, e) => `<div class="db-gap"><span>${hm(s)}</span><i></i><em>Свободно ${Math.round((e - s) / 6e4)} мин${P.overflow.length ? ' — можно взять из «не помещается»' : ''}</em></div>`;
  const items = [...P.blocks.map((b) => ({ t: b.start, b })), ...P.gaps.map(([s, e]) => ({ t: s, gap: [s, e] })), { t: P.lunch[0], lunch: true }].sort((a, b) => a.t - b.t);
  for (const it of items) {
    if (nowLine && !lineDone && it.t > now) { rows += `<div class="db-now"><span>${hm(now)}</span><i></i></div>`; lineDone = true; }
    if (it.lunch) rows += `<div class="db-lunch">🍽 ${hm(P.lunch[0])}–${hm(P.lunch[1])} · обед</div>`;
    else if (it.gap) rows += gapHtml(...it.gap);
    else rows += blockHtml(it.b, now).replace('class="db ', `class="db ${nowB && it.b.key === nowB.key && !P.tomorrow ? 'is-echo ' : ''}`);
  }
  return `<div class="dayv">
    ${worldClocks()}
    <header class="day-head">
      <div><h2>${P.tomorrow ? 'План на завтра' : 'Мой день'}</h2><span>${esc(dateLabel)} · рабочий день ${hm(P.dayStart)}–${hm(P.dayEnd)}</span></div>
      <div class="day-stats"><b>${P.blocks.length}</b><small>действий</small><b>${Math.floor(total / 60)} ч ${total % 60} мин</b><small>работы</small><b>${P.done.length}</b><small>сделано</small></div>
      <button type="button" class="icon-btn" id="daySettings" title="Рабочие часы и окна">⚙</button>
    </header>
    ${nowB && !P.tomorrow ? `<section class="day-now"><span class="day-now-l">${nowB.start <= now ? 'Сейчас' : `Дальше · в ${hm(nowB.start)}`}</span>${blockHtml(nowB, now, { big: true })}</section>` : ''}
    ${P.blocks.length ? `<section class="day-line" id="dayLine">${rows}</section>` : `<div class="empty calm">${P.tomorrow ? 'На завтра пока пусто.' : 'На сегодня всё сделано. Можно выдохнуть ✨'}</div>`}
    ${P.overflow.length ? `<section class="day-over"><h3>Не помещается сегодня · ${P.overflow.length}</h3>${P.overflow.map((a) => `<div class="day-over-i"><span>${a.icon} ${esc(a.title)}${a.who ? ` · ${esc(a.who)}` : ''}</span><small>${esc(a.why)}</small></div>`).join('')}
      <button type="button" class="btn small" data-db-all-tomorrow>Перенести всё на завтра</button></section>` : ''}
    ${P.done.length ? `<details class="day-done"><summary>Сделано сегодня · ${P.done.length}</summary>${P.done.map((a) => `<div class="day-done-i"><span>✓ ${esc(a.title)}${a.who ? ` · ${esc(a.who)}` : ''}</span><button type="button" class="link" data-db-undo="${esc(a.key)}">вернуть</button></div>`).join('')}</details>` : ''}
  </div>`;
}

// ---------- отметки ----------
async function mark(key, status, at = null) {
  const P = currentPlan();
  const ex = state.day_items.find((x) => x.day === P.day && x.key === key);
  const row = { day: P.day, key, status, at };
  if (ex) await save('day_items', ex.id, row); else await save('day_items', null, row);
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
    const label = state.statuses.find((s) => s.key === b.next)?.label || b.next;
    await save('requests', r.id, { status: b.next });
    toast(`✓ ${b.title} · статус → ${label}`, '', { label: 'Отменить', fn: () => save('requests', r.id, { status: before }) });
    return true;
  }
  if (b.suggestion_id) { /* предложение откроется на «Сегодня» */ }
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
      const b = find(key);
      const v = sn.dataset.dbSnooze;
      if (v === 'tomorrow') { await mark(key, 'tomorrow'); toast('Перенесено на завтра', '', { label: 'Вернуть', fn: () => unmark(key) }); }
      else {
        const at = v === 'lunch' ? P.lunch[1] : Math.max(Date.now(), b.start) + 30 * 6e4;
        await mark(key, 'snoozed', new Date(Math.ceil(at / 3e5) * 3e5).toISOString());
        toast(`Перенесено на ${hm(at)}`);
      }
      return;
    }
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
      const over = document.elementFromPoint(rect.left + 40, y)?.closest('.db, .db-gap, .db-lunch');
      if (over !== target) { target?.classList.remove('drop-on'); target = over && over !== el ? over : null; target?.classList.add('drop-on'); }
    };
    const up = async () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (!started) return;
      ghost.remove(); el.classList.remove('db-lifted'); target?.classList.remove('drop-on');
      if (!target) return;
      const tb = target.dataset.db ? P.blocks.find((x) => x.key === target.dataset.db) : null;
      let at = tb ? tb.start : null;
      if (!at && target.classList.contains('db-gap')) { const [h, m] = target.querySelector('span').textContent.split(':').map(Number); at = zoned(OWNER_TZ, P.day, h, m); }
      if (!at && target.classList.contains('db-lunch')) at = P.lunch[1];
      if (!at) return;
      await mark(b.key, 'pinned', new Date(at).toISOString());
      if (b.kind === 'guest' && b.guestTz) {
        const h = +hmIn(b.guestTz, at).slice(0, 2);
        if (h >= (settings?.guest_to ?? 21) || h < (settings?.guest_from ?? 10)) toast(`⚠ У гостя будет ${hmIn(b.guestTz, at)} — поздно для сообщения`, 'err');
        else toast(`Поставлено на ${hm(at)} · у гостя ${hmIn(b.guestTz, at)}`);
      } else toast(`Поставлено на ${hm(at)}`);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
}

// ---------- черновик сообщения от Jarvis ----------
async function openDraft(b) {
  const c = byId('clients', b.client_id);
  const r = b.request_id ? byId('requests', b.request_id) : null;
  const p = r?.partner_id ? byId('partners', r.partner_id) : null;
  const m = openModal({ title: b.kind === 'partner' ? 'Сообщение партнёру' : 'Сообщение гостю', saveLabel: 'Закрыть', body: `<div class="dr"><p class="dr-ctx">${b.icon} ${esc(b.title)}${b.who ? ' · ' + esc(b.who) : ''}${b.guestLocal ? ` · у гостя ${b.guestLocal}` : ''}</p><div class="dr-text"><span class="spin"></span> Jarvis пишет…</div></div>`, onSave: async () => {} });
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

// план пересобирается сам каждую минуту — «Сейчас» и линия времени двигаются
setInterval(() => { if (ui.tab === 'requests' && ui.reqView === 'day' && !document.querySelector('.ov, .db-ghost, .db-menu:not([hidden])')) render(); }, 60e3);

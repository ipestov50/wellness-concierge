// «Jarvis предлагает»: карточки поводов с готовым планом. Принять / Изменить / Позже / Не нужно.
import { getSupabase } from './supabase.js';
import { api } from './api.js';
import { CATEGORIES, TZ } from './const.js';
import { esc, toast, openModal, fromParisInput } from './ui.js';
import { state, byId, save } from './data.js';
import { firstKey, isClosed, statusLabel } from './statuses.js';
import { preview } from './smart.js';
import { render } from './router.js';
import { quietNote } from './tz.js';
import { upcomingDates } from './dossier.js';

const KIND_ICON = { pre_arrival: '✈️', transfer: '🛬', close_date: '🎂', reconnect: '💬' };
const drafting = new Set();   // какие планы сейчас составляются
const deep = { on: false, text: '', ahead: false }; // ручной запуск «Что впереди?»; ahead — показать обзор запросов
const failed = new Set();
const deckAt = new Map();     // какая карточка открыта в каждой стопке: 'main' или id гостя

export function visibleSuggestions(clientId) {
  const now = Date.now();
  return state.suggestions
    .filter((s) => (s.status === 'new' || (s.status === 'snoozed' && s.snooze_until && Date.parse(s.snooze_until) <= now)) && (!clientId || s.client_id === clientId))
    .sort((a, b) => (a.due_at || '').localeCompare(b.due_at || ''));
}

// раз в полчаса просим сервер пересмотреть поводы (ночью это делает расписание)
let refreshing = false;
export async function refreshSuggestions(force = false) {
  let last = 0; try { last = +localStorage.getItem('sugg.refreshed') || 0; } catch {}
  if (refreshing || (!force && Date.now() - last < 30 * 60e3)) return;
  refreshing = true;
  try {
    const sb = await getSupabase();
    await sb.functions.invoke('jarvis', { body: { mode: 'suggest' } });
    try { localStorage.setItem('sugg.refreshed', String(Date.now())); } catch {}
    const { data } = await sb.from('suggestions').select('*');
    if (data) { state.suggestions = data; render(); }
  } catch {} finally { refreshing = false; }
}

async function draft(s, force = false) {
  if (drafting.has(s.id) || (!force && s.payload?.tasks)) return;
  drafting.add(s.id); failed.delete(s.id); render();
  try {
    const body = await api('draft', { id: s.id });
    s.payload = body.payload;
  } catch (e) {
    failed.add(s.id);
    if (String(e.message) === 'rate_limited') toast('Лимит Gemini на минуту исчерпан — план составлю чуть позже', 'err');
  } finally { drafting.delete(s.id); render(); }
}

const fmtWhen = (local) => {
  if (!local) return 'без срока';
  const d = new Date(fromParisInput(local));
  return d.toLocaleString('ru-RU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '');
};
const firstName = (c) => (c?.name || '').replace(/\s*\(.*?\)/g, '').split(/\s+/)[0] || '';
const personal = (msg, c) => String(msg || '').replace(/\{имя\}/g, firstName(c));

// старые планы (warnings/insight/message) показываем в новом виде
const alertsOf = (p) => p.alerts || (p.warnings || []).filter((w) => w.level !== 'info').map((w) => ({ text: w.text, level: w.level === 'critical' ? 'stop' : 'missing' }));
const tipOf = (p) => p.concierge_tip ?? p.insight ?? '';
const msgOf = (p) => p.client_message_draft || p.message || '';

function card(s) {
  const c = byId('clients', s.client_id);
  const p = s.payload || {};
  const tasks = p.tasks || [];
  const busy = drafting.has(s.id);
  const alerts = alertsOf(p), tip = tipOf(p), msg = personal(msgOf(p), c);
  const phone = (c?.phone || '').replace(/[^\d]/g, '');
  return `<article class="sg" data-sg="${s.id}">
    <header class="sg-head"><span class="sg-ico" aria-hidden="true">${KIND_ICON[s.kind] || '✨'}</span>
      <div class="sg-txt"><h3 class="sg-h">${esc(s.title.replace(/^\S+\s/, ''))}</h3><small>${esc(s.reason || '')}</small></div></header>
    ${busy ? `<div class="sg-drafting"><span class="spin"></span> Jarvis составляет план с учётом вкусов и стоп-листа…</div>` : ''}
    ${!busy && !tasks.length ? `<div class="sg-empty">${failed.has(s.id) ? 'Не получилось составить план. ' : ''}<button type="button" class="btn small" data-sg-draft="${s.id}">✦ Составить план</button></div>` : ''}
    ${tasks.length ? `<ul class="sg-tasks">${tasks.map((t, i) => {
        const partner = t.partner_id && byId('partners', t.partner_id);
        return `<li class="sg-task"><label>
          <input type="checkbox" class="sg-check" data-sg-task="${i}" checked><span class="sg-box" aria-hidden="true"></span>
          <span class="sg-tmain"><b><span class="sg-cat" aria-hidden="true">${CATEGORIES[t.category] || '📌'}</span> ${esc(t.summary)}</b>
            <small class="sg-meta"><span class="sg-when">${esc(fmtWhen(t.when_local))}</span>${partner ? `<span class="sg-partner">★ ${esc(partner.name)}</span>` : ''}${t.note ? `<span class="sg-note">${esc(t.note)}</span>` : ''}</small></span></label></li>`;
      }).join('')}</ul>
      ${alerts.length ? `<div class="sg-alerts">${alerts.map((a) => `<p class="sg-alert ${a.level === 'stop' ? 'stop' : 'missing'}"><span aria-hidden="true">${a.level === 'stop' ? '⚠' : '?'}</span>${esc(a.text)}</p>`).join('')}</div>` : ''}
      ${tip ? `<p class="sg-tip"><span aria-hidden="true">✦</span>${esc(tip)}</p>` : ''}
      ${msg ? `<div class="sg-bubble"><div class="sg-bubble-h"><span>Сообщение клиенту${firstName(c) ? ' · ' + esc(firstName(c)) : ''}</span>${quietNote(c)}</div>
        <p class="sg-bubble-t">${esc(msg)}</p>
        <div class="sg-bubble-a"><button type="button" class="sg-copy" data-sg-copy="${s.id}"><i aria-hidden="true">⧉</i> Скопировать</button>
          ${phone ? `<a class="sg-wa" target="_blank" rel="noopener" href="https://wa.me/${esc(phone)}?text=${encodeURIComponent(msg)}">WhatsApp ↗</a>` : ''}</div></div>` : ''}` : ''}
    <div class="sg-actions">
      ${tasks.length ? `<button type="button" class="btn small primary sg-accept" data-sg-accept="${s.id}">Принять</button>
      <button type="button" class="btn small" data-sg-edit="${s.id}">Изменить</button>` : ''}
      ${tasks.length && s.kind !== 'transfer' ? `<button type="button" class="btn small ghostish" data-sg-redraft="${s.id}" title="Составить план заново" aria-label="Составить план заново">↻</button>` : ''}
      <span class="sg-gap"></span>
      <button type="button" class="btn small ghostish" data-sg-snooze="${s.id}">Позже</button>
      <button type="button" class="btn small ghostish" data-sg-dismiss="${s.id}">Не нужно</button>
    </div>
  </article>`;
}

// стопка карточек «1 / N» с листанием
const deckList = (key) => (key === 'main' ? visibleSuggestions() : visibleSuggestions(key));
function deck(key, list, extra = '') {
  const n = list.length;
  const i = Math.min(deckAt.get(key) || 0, n - 1);
  deckAt.set(key, i);
  return `<section class="jarvis-sg deck${key === 'main' ? '' : ' in-profile'}" data-deck="${esc(key)}">
    <div class="sg-title"><span class="sg-eyebrow">✦ Jarvis предлагает</span>${extra}
      ${n > 1 ? `<span class="sg-pager"><button type="button" data-sg-nav="-1" aria-label="Предыдущее предложение">←</button><b class="sg-count"><span>${i + 1}</span> / ${n}</b><button type="button" data-sg-nav="1" aria-label="Следующее предложение">→</button></span>` : ''}</div>
    <div class="sg-stage">${card(list[i])}</div>
  </section>`;
}
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPRING = CSS.supports?.('animation-timing-function', 'linear(0, 1)')
  ? 'linear(0, .06 2%, .23 5%, .5 9.5%, .77 15%, .93 21%, 1.01 28%, 1.03 34%, 1.015 44%, 1 60%, 1)' : 'cubic-bezier(.22, 1, .36, 1)';
function navDeck(sec, dir) {
  const key = sec.dataset.deck, list = deckList(key), n = list.length;
  if (n < 2) return;
  const i = ((deckAt.get(key) || 0) + dir + n) % n;
  deckAt.set(key, i);
  const stage = sec.querySelector('.sg-stage');
  stage.innerHTML = card(list[i]);
  sec.querySelector('.sg-count span').textContent = i + 1;
  if (reducedMotion()) return;
  stage.firstElementChild.animate([{ opacity: 0, transform: `translateX(${dir * 36}px) scale(.985)` }, { opacity: 1, transform: 'none' }], { duration: 460, easing: SPRING });
  sec.querySelector('.sg-count').animate([{ transform: `translateY(${dir * -6}px)`, opacity: .3 }, { transform: 'none', opacity: 1 }], { duration: 360, easing: SPRING });
}

// ---------- «Что впереди?»: ваши запросы на 14 дней и чего в каждом не хватает (без ИИ, мгновенно) ----------
const AHEAD_DAYS = 14;
function upcoming() {
  const now = Date.now(), to = now + AHEAD_DAYS * 864e5;
  return state.requests
    .filter((r) => r.deadline && !isClosed(r.status) && Date.parse(r.deadline) > now && Date.parse(r.deadline) <= to)
    .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
}
function gaps(r) {
  const c = byId('clients', r.client_id);
  const out = [];
  if (!r.client_id) out.push('не указан гость');
  if (!r.partner_id && r.category !== 'Other') out.push('не выбран партнёр');
  if (r.needs_approval) out.push('ждёт одобрения гостя');
  if (r.clarifying_questions) out.push('уточнить: ' + String(r.clarifying_questions).split('\n')[0].slice(0, 90));
  const items = r.checklist?.items || [];
  const left = items.filter((x) => !x.done).length;
  if (left) out.push(`чек-лист: осталось ${left} из ${items.length}`);
  if (c && (c.allergies?.length || c.diet?.length)) out.push('⚠ учесть аллергии и диету');
  return out;
}
// «Радар»: гости, у которых в ближайшие 3 недели повод (день рождения, важная дата) — по кнопке Jarvis предложит идеи
function radar() {
  const out = [];
  for (const c of state.clients) {
    const d = upcomingDates(c).find((x) => x.info.days <= 21);
    if (d) out.push({ c, d });
  }
  out.sort((a, b) => a.d.info.days - b.d.info.days);
  if (!out.length) return '';
  return `<div class="radar"><div class="radar-h">✦ Радар поводов</div><div class="radar-l">${out.slice(0, 6).map(({ c, d }) => `<button type="button" class="radar-i" data-ideas="${c.id}">
    <span class="radar-ic">${d.kind === 'date' ? '📅' : '🎂'}</span><span><b>${esc((c.name || '').replace(/\s*\(.*?\)/g, ''))}</b><small>${esc(d.title)}${d.kind === 'person' ? ' · ' + esc(d.who.split(' · ')[0]) : ''} · ${d.info.days === 0 ? 'сегодня' : d.info.days === 1 ? 'завтра' : 'через ' + d.info.days + ' дн.'}</small></span><i>Идеи →</i></button>`).join('')}</div></div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ideas]');
  if (b) { e.preventDefault(); e.stopPropagation(); import('./ideas.js').then((m) => m.openIdeas(b.dataset.ideas)); }
});

function aheadBlock() {
  const list = upcoming();
  const when = (iso) => new Date(iso).toLocaleString('ru-RU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '');
  return `<section class="jarvis-sg ahead"><div class="sg-title"><span>✦ Впереди · ${AHEAD_DAYS} дней · запросов: ${list.length}</span><button type="button" class="link" data-ahead-close>Скрыть</button></div>
    ${list.length ? `<div class="ah-list">${list.map((r) => { const g = gaps(r); const c = byId('clients', r.client_id);
      return `<button type="button" class="ah" data-req="${esc(r.id)}">
        <span class="ah-when">${esc(when(r.deadline))}</span>
        <span class="ah-main"><b>${CATEGORIES[r.category] || '📌'} ${esc(r.summary)}</b><small>${c ? esc(c.name) + ' · ' : ''}${esc(statusLabel(r.status))}</small>
        ${g.length ? `<span class="ah-gaps">${g.map((x) => `<i>${esc(x)}</i>`).join('')}</span>` : '<span class="ah-ok">✓ всё готово</span>'}</span></button>`; }).join('')}</div>`
      : '<p class="muted">На ближайшие две недели запросов со сроком нет.</p>'}
    ${radar()}
  </section>`;
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-ahead-close]')) { deep.ahead = false; render(); } });

export function suggestionsBlock() {
  if (deep.ahead) return aheadBlock() + suggestionsOnly();
  return suggestionsOnly();
}
function suggestionsOnly() {
  const list = visibleSuggestions();
  const progress = deep.on ? `<span class="sg-progress"><span class="spin"></span> ${esc(deep.text)}</span>` : '';
  if (!list.length && deep.on) return `<section class="jarvis-sg"><div class="sg-title"><span class="sg-eyebrow">✦ Jarvis предлагает</span>${progress}</div></section>`;
  if (!list.length) return '';
  // план по подсказке Jarvis составляет только по кнопке «✦ Составить план» — без фоновых трат лимита Gemini
  return deck('main', list, progress || (list.length > 3 ? '<button type="button" class="link sg-all" data-sg-all>Все</button>' : ''));
}

export function clientSuggestions(clientId) {
  const list = visibleSuggestions(clientId);
  return list.length ? deck(clientId, list) : '';
}

// ---------- действия ----------
function selected(root, s) {
  const box = root.querySelector(`[data-sg="${s.id}"]`);
  const tasks = s.payload?.tasks || [];
  if (!box) return tasks;
  return tasks.filter((_, i) => box.querySelector(`[data-sg-task="${i}"]`)?.checked !== false);
}

async function accept(s, tasks) {
  const c = byId('clients', s.client_id);
  if (!tasks.length) return toast('Отметьте хотя бы один пункт', 'err');
  for (const t of tasks) {
    await save('requests', null, {
      client_id: s.client_id, summary: t.summary, category: t.category, urgency: 'normal', status: firstKey(),
      deadline: t.when_local ? fromParisInput(t.when_local) : null, partner_id: t.partner_id || null,
      clarifying_questions: t.note || null, original_message: `Jarvis: ${s.title}`,
    });
  }
  await save('suggestions', s.id, { status: 'accepted' });
  if (s.kind === 'reconnect' && c) await save('clients', c.id, { last_contact: new Date().toISOString().slice(0, 10) });
  toast(`Создано запросов: ${tasks.length}${c ? ' — ' + c.name : ''}`);
}

function edit(s, tasks) {
  const c = byId('clients', s.client_id);
  const drafts = tasks.map((t) => ({
    guest_name: c?.name || null, guest_language: c?.language || null, category: t.category, urgency: 'normal', summary: t.summary,
    deadline_iso: t.when_local, deadline_local: t.when_local || '', budget_amount: null, currency: null, partner_id: t.partner_id,
    missing_questions: t.note ? [t.note] : [], new_restrictions: { allergies: [], diet: [], health: [] }, preferences: {}, likes: [], dislikes: [],
    approval_needed: false, needs_review: false, client_id: s.client_id || '', ambiguous: false, new_name: c?.name || '',
  }));
  preview(drafts, `Jarvis: ${s.title}`, async () => {
    await save('suggestions', s.id, { status: 'accepted' });
    if (s.kind === 'reconnect' && c) await save('clients', c.id, { last_contact: new Date().toISOString().slice(0, 10) });
  });
}

function showAll() {
  openModal({
    title: 'Jarvis предлагает',
    saveLabel: 'Закрыть',
    body: `<div class="jarvis-sg in-modal"><div class="sg-list">${visibleSuggestions().map((x) => card(x)).join('')}</div></div>`,
    onSave: async () => {},
  }).form.querySelector('#cancel').hidden = true;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-sg-draft],[data-sg-redraft],[data-sg-accept],[data-sg-edit],[data-sg-snooze],[data-sg-dismiss],[data-sg-copy],[data-sg-all],[data-sg-nav]');
  if (!b) return;
  if (b.hasAttribute('data-sg-all')) return showAll();
  if (b.dataset.sgNav) return navDeck(b.closest('[data-deck]'), +b.dataset.sgNav);
  const id = b.dataset.sgDraft || b.dataset.sgRedraft || b.dataset.sgAccept || b.dataset.sgEdit || b.dataset.sgSnooze || b.dataset.sgDismiss || b.dataset.sgCopy;
  const s = state.suggestions.find((x) => x.id === id);
  if (!s) return;
  const root = b.closest('.jarvis-sg') || document;
  try {
    if (b.dataset.sgDraft) draft(s);
    else if (b.dataset.sgRedraft) draft(s, true);
    else if (b.dataset.sgAccept) {
      b.disabled = true;
      const picked = selected(root, s);
      await accept(s, picked);
      if (picked.length) { b.classList.add('done'); b.textContent = '✓ Создано'; if (!reducedMotion()) b.animate([{ transform: 'scale(.92)' }, { transform: 'scale(1.06)' }, { transform: 'none' }], { duration: 520, easing: SPRING }); }
      else b.disabled = false;
    }
    else if (b.dataset.sgEdit) edit(s, selected(root, s));
    else if (b.dataset.sgSnooze) {
      const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + 864e5));
      await save('suggestions', id, { status: 'snoozed', snooze_until: fromParisInput(`${tomorrow}T08:00`) });
      toast('Напомню завтра утром');
    } else if (b.dataset.sgDismiss) {
      await save('suggestions', id, { status: 'dismissed' });
      toast('Понял. Этому гостю такое не предложу ещё месяц', '', { label: 'Вернуть', fn: () => save('suggestions', id, { status: 'new' }) });
    } else if (b.dataset.sgCopy) {
      await navigator.clipboard.writeText(personal(msgOf(s.payload || {}), byId('clients', s.client_id)));
      b.classList.add('ok'); b.querySelector('i').textContent = '✓';
      setTimeout(() => { b.classList.remove('ok'); const i = b.querySelector('i'); if (i) i.textContent = '⧉'; }, 1600);
      toast('Сообщение скопировано');
    }
  } catch (err) { b.disabled = false; toast('Не получилось: ' + (err.message || err), 'err'); }
});

// «✦ Что впереди?»: пересмотреть поводы на 3–4 недели вперёд и составить планы для всех
export async function runDeep() {
  if (deep.on) return;
  const { ui } = await import('./router.js');
  if (ui.tab !== 'requests' || ui.reqView !== 'day') { ui.tab = 'requests'; ui.reqView = 'day'; }
  deep.on = true; deep.ahead = true; deep.text = 'Jarvis изучает гостей и ближайшие события…';
  render();
  document.querySelector('.jarvis-sg')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const sb = await getSupabase();
    await sb.functions.invoke('jarvis', { body: { mode: 'suggest', wide: true } });
    try { localStorage.setItem('sugg.refreshed', String(Date.now())); } catch {}
    const { data } = await sb.from('suggestions').select('*');
    if (data) state.suggestions = data;
    // планы по подсказкам — по кнопке на каждой карточке (каждый план = обращение к Gemini)
    const n = visibleSuggestions().length, u = upcoming().length;
    toast([u ? `Впереди запросов: ${u}` : '', n ? `новых предложений: ${n}` : ''].filter(Boolean).join(' · ') || 'На ближайшие недели всё под контролем ✨');
  } catch (e) {
    toast('Не получилось: ' + (e.message || e), 'err');
  } finally { deep.on = false; render(); }
}

// листание стопки свайпом и стрелками клавиатуры
let swipe = null;
document.addEventListener('pointerdown', (e) => { const st = e.target.closest('.deck .sg-stage'); swipe = st ? { st, x: e.clientX, y: e.clientY } : null; });
document.addEventListener('pointerup', (e) => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y, sec = swipe.st.closest('[data-deck]');
  swipe = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) navDeck(sec, dx < 0 ? 1 : -1);
});
document.addEventListener('keydown', (e) => {
  const sec = e.target.closest?.('[data-deck]');
  if (!sec || /input|textarea|select/i.test(e.target.tagName) && e.target.type !== 'checkbox') return;
  if (e.key === 'ArrowRight') navDeck(sec, 1); else if (e.key === 'ArrowLeft') navDeck(sec, -1);
});

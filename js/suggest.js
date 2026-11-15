// «Jarvis предлагает»: карточки поводов с готовым планом. Принять / Изменить / Позже / Не нужно.
import { getSupabase } from './supabase.js';
import { CATEGORIES, TZ } from './const.js';
import { esc, toast, openModal, fromParisInput } from './ui.js';
import { state, byId, save } from './data.js';
import { firstKey } from './statuses.js';
import { preview } from './smart.js';
import { render } from './router.js';
import { quietNote } from './tz.js';

const KIND_ICON = { pre_arrival: '✈️', transfer: '🛬', close_date: '🎂', reconnect: '💬' };
const drafting = new Set();   // какие планы сейчас составляются
const deep = { on: false, text: '' }; // ручной запуск «Что впереди?»
const failed = new Set();
const expanded = new Set();   // у каких карточек открыт полный план

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
    const sb = await getSupabase();
    const token = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/draft', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ id: s.id }) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || r.status);
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

function card(s, { compact = false } = {}) {
  const c = byId('clients', s.client_id);
  const p = s.payload || {};
  const tasks = p.tasks || [];
  const busy = drafting.has(s.id);
  const open = expanded.has(s.id) || !compact;
  return `<article class="sg" data-sg="${s.id}">
    <div class="sg-head"><span class="sg-ico">${KIND_ICON[s.kind] || '✨'}</span>
      <div class="sg-txt"><b>${esc(s.title.replace(/^\S+\s/, ''))}</b><small>${esc(s.reason || '')}</small></div></div>
    ${busy ? `<div class="sg-drafting"><span class="spin"></span> Jarvis составляет план с учётом вкусов гостя…</div>` : ''}
    ${!busy && !tasks.length ? `<div class="sg-empty">${failed.has(s.id) ? 'Не получилось составить план. ' : ''}<button type="button" class="btn small" data-sg-draft="${s.id}">✦ Составить план</button></div>` : ''}
    ${tasks.length ? `<ul class="sg-tasks">${tasks.map((t, i) => `<li${!open && i > 2 ? ' hidden' : ''}>
        <label><input type="checkbox" data-sg-task="${i}" checked><span class="sg-cat">${CATEGORIES[t.category] || '📌'}</span>
        <span class="sg-tmain"><b>${esc(t.summary)}</b><small>${esc(fmtWhen(t.when_local))}${t.partner_id && byId('partners', t.partner_id) ? ' · ' + esc(byId('partners', t.partner_id).name) : ''}${t.note ? ' · ' + esc(t.note) : ''}</small></span></label></li>`).join('')}</ul>
      ${!open && tasks.length > 3 ? `<button type="button" class="sg-more" data-sg-expand="${s.id}">Ещё ${tasks.length - 3}</button>` : ''}
      ${(p.warnings || []).length ? `<div class="sg-warn"><b>Jarvis заметил</b><ul>${p.warnings.map((w) =>
        `<li class="w-${esc(w.level)}"><span>${w.level === 'critical' ? '⚠️' : w.level === 'important' ? '❗' : 'ℹ️'}</span>${esc(w.text)}</li>`).join('')}</ul></div>` : ''}
      ${(p.touches || []).length ? `<div class="sg-touch"><b>Детали, которые удивят</b><ul>${p.touches.map((t) => `<li>✦ ${esc(t)}</li>`).join('')}</ul></div>` : ''}
      ${p.insight ? `<p class="sg-insight">✦ ${esc(p.insight)}</p>` : ''}
      ${p.message ? `<details class="sg-msg"><summary>Сообщение гостю</summary><p>${esc(personal(p.message, c))}</p>
        <div class="sg-msg-actions">${quietNote(c)}<button type="button" class="btn small" data-sg-copy="${s.id}">Скопировать</button>
        ${c?.phone ? `<a class="btn small" target="_blank" rel="noopener" href="https://wa.me/${esc((c.phone || '').replace(/[^\d]/g, ''))}?text=${encodeURIComponent(personal(p.message, c))}">WhatsApp</a>` : ''}</div></details>` : ''}` : ''}
    <div class="sg-actions">
      ${tasks.length ? `<button type="button" class="btn small primary" data-sg-accept="${s.id}">Принять</button>
      <button type="button" class="btn small" data-sg-edit="${s.id}">Изменить</button>` : ''}
      ${tasks.length && s.kind !== 'transfer' ? `<button type="button" class="btn small ghostish" data-sg-redraft="${s.id}" title="Составить план заново">↻</button>` : ''}
      <button type="button" class="btn small ghostish" data-sg-snooze="${s.id}">Позже</button>
      <button type="button" class="btn small ghostish" data-sg-dismiss="${s.id}">Не нужно</button>
    </div>
  </article>`;
}

export function suggestionsBlock() {
  const list = visibleSuggestions();
  if (!list.length && deep.on) return `<section class="jarvis-sg"><div class="sg-title"><span>✦ Jarvis предлагает</span><span class="sg-progress"><span class="spin"></span> ${esc(deep.text)}</span></div></section>`;
  if (!list.length) return '';
  const top = list.slice(0, 3);
  // первые карточки без плана — составляем план сразу, чтобы он был готов, когда вы посмотрите
  if (!deep.on) setTimeout(() => top.filter((s) => !s.payload?.tasks && !failed.has(s.id)).slice(0, 2).forEach((x) => draft(x)), 0);
  return `<section class="jarvis-sg">
    <div class="sg-title"><span>✦ Jarvis предлагает</span>${deep.on ? `<span class="sg-progress"><span class="spin"></span> ${esc(deep.text)}</span>` : list.length > 3 ? `<button type="button" class="link" data-sg-all>Все · ${list.length}</button>` : `<span class="muted">${list.length}</span>`}</div>
    <div class="sg-list">${top.map((s) => card(s, { compact: true })).join('')}</div>
  </section>`;
}

export function clientSuggestions(clientId) {
  const list = visibleSuggestions(clientId);
  return list.length ? `<section class="psec jarvis-sg in-profile"><h4>✦ Jarvis предлагает</h4><div class="sg-list">${list.map((s) => card(s, { compact: true })).join('')}</div></section>` : '';
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
    body: `<div class="jarvis-sg in-modal"><div class="sg-list">${visibleSuggestions().map((s) => card(s)).join('')}</div></div>`,
    onSave: async () => {},
  }).form.querySelector('#cancel').hidden = true;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-sg-draft],[data-sg-redraft],[data-sg-accept],[data-sg-edit],[data-sg-snooze],[data-sg-dismiss],[data-sg-copy],[data-sg-expand],[data-sg-all]');
  if (!b) return;
  if (b.hasAttribute('data-sg-all')) return showAll();
  const id = b.dataset.sgDraft || b.dataset.sgRedraft || b.dataset.sgAccept || b.dataset.sgEdit || b.dataset.sgSnooze || b.dataset.sgDismiss || b.dataset.sgCopy || b.dataset.sgExpand;
  const s = state.suggestions.find((x) => x.id === id);
  if (!s) return;
  const root = b.closest('.jarvis-sg') || document;
  try {
    if (b.dataset.sgDraft) draft(s);
    else if (b.dataset.sgRedraft) draft(s, true);
    else if (b.dataset.sgExpand) { expanded.add(id); render(); }
    else if (b.dataset.sgAccept) { b.disabled = true; await accept(s, selected(root, s)); }
    else if (b.dataset.sgEdit) edit(s, selected(root, s));
    else if (b.dataset.sgSnooze) {
      const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(8, 0, 0, 0);
      await save('suggestions', id, { status: 'snoozed', snooze_until: t.toISOString() });
      toast('Напомню завтра утром');
    } else if (b.dataset.sgDismiss) {
      await save('suggestions', id, { status: 'dismissed' });
      toast('Понял. Этому гостю такое не предложу ещё месяц', '', { label: 'Вернуть', fn: () => save('suggestions', id, { status: 'new' }) });
    } else if (b.dataset.sgCopy) {
      await navigator.clipboard.writeText(personal(s.payload?.message, byId('clients', s.client_id)));
      toast('Сообщение скопировано');
    }
  } catch (err) { b.disabled = false; toast('Не получилось: ' + (err.message || err), 'err'); }
});

// «✦ Что впереди?»: пересмотреть поводы на 3–4 недели вперёд и составить планы для всех
export async function runDeep() {
  if (deep.on) return;
  const { ui } = await import('./router.js');
  if (ui.tab !== 'requests' || ui.reqView !== 'day') { ui.tab = 'requests'; ui.reqView = 'day'; }
  deep.on = true; deep.text = 'Jarvis изучает гостей и ближайшие события…';
  render();
  document.querySelector('.jarvis-sg')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const sb = await getSupabase();
    await sb.functions.invoke('jarvis', { body: { mode: 'suggest', wide: true } });
    try { localStorage.setItem('sugg.refreshed', String(Date.now())); } catch {}
    const { data } = await sb.from('suggestions').select('*');
    if (data) state.suggestions = data;
    const todo = visibleSuggestions().filter((x) => !x.payload?.tasks);
    // по одному: так не упрёмся в бесплатный лимит Gemini
    for (let i = 0; i < todo.length; i++) {
      deep.text = `Jarvis продумывает планы: ${i + 1} из ${todo.length}`;
      render();
      await draft(todo[i]);
    }
    const n = visibleSuggestions().length;
    toast(n ? `Jarvis подготовил предложений: ${n}` : 'На ближайшие недели всё под контролем ✨');
  } catch (e) {
    toast('Не получилось: ' + (e.message || e), 'err');
  } finally { deep.on = false; render(); }
}

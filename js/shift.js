// «Конец смены»: итоги дня, список для передачи коллеге и личный дневник (чему научился, что улучшить).
// Считается на месте, без ИИ — открывается мгновенно и ничего не стоит.
import { esc, toast, openModal } from './ui.js';
import { state, byId, save } from './data.js';
import { statusLabel, isClosed, statusOf } from './statuses.js';
import { CATEGORIES } from './const.js';
import { dayIn, OWNER_TZ } from './planner.js';

const SHIFTS = [['am', '☀️ Утро'], ['pm', '🌙 Вечер'], ['day', 'Весь день']];
const WAIT = new Set(['clarifying', 'awaiting_approval', 'booking', 'sourcing']);
const HOUR = 36e5;
const fmtDay = (ymd) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short', timeZone: 'UTC' });
const when = (iso) => iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: OWNER_TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '';
const guestOf = (r) => byId('clients', r.client_id)?.name || '';
const today = () => dayIn(OWNER_TZ, Date.now());

function collect() {
  const day = today(), now = Date.now();
  const live = state.requests.filter((r) => !r.archived_at || !isClosed(r.status));
  const done = state.requests.filter((r) => statusOf(r.status)?.kind === 'done' && r.updated_at && dayIn(OWNER_TZ, +new Date(r.updated_at)) === day);
  const open = live.filter((r) => !isClosed(r.status));
  const dl = (r) => (r.deadline ? Date.parse(r.deadline) : null);
  const urgent = open.filter((r) => r.urgency === 'critical' || (dl(r) && dl(r) < now + 24 * HOUR));
  const ids = new Set(urgent.map((r) => r.id));
  const waiting = open.filter((r) => !ids.has(r.id) && WAIT.has(r.status));
  waiting.forEach((r) => ids.add(r.id));
  const rest = open.filter((r) => !ids.has(r.id) && dl(r) && dl(r) < now + 7 * 864e5);
  const by = (a, b) => (dl(a) ?? 9e15) - (dl(b) ?? 9e15);
  return { day, done, open, urgent: urgent.sort(by), waiting: waiting.sort(by), rest: rest.sort(by) };
}

const line = (r) => {
  const g = guestOf(r), w = when(r.deadline);
  const extra = r.status === 'clarifying' && r.clarifying_questions ? ` — уточнить: ${String(r.clarifying_questions).split('\n')[0].slice(0, 80)}` : '';
  return `• ${g ? g + ' — ' : ''}${r.summary}${w ? ' · ' + w : ''} · ${statusLabel(r.status)}${extra}`;
};
export function handoverText(d, picked, shift, notes = {}) {
  const sec = (t, list) => { const x = list.filter((r) => picked.has(r.id)); return x.length ? `\n${t}\n${x.map(line).join('\n')}\n` : ''; };
  const head = `Передача смены · ${fmtDay(d.day)}${shift === 'am' ? ', утро' : shift === 'pm' ? ', вечер' : ''}`;
  const doneLine = d.done.length ? `\nСделано за смену: ${d.done.length}${d.done.length <= 6 ? ' — ' + d.done.map((r) => `${guestOf(r) ? guestOf(r).split(' ')[0] + ': ' : ''}${r.summary}`).join('; ') : ''}\n` : '';
  const out = [head, doneLine, sec('🔴 Срочно', d.urgent), sec('⏳ Ждём ответа / подтверждения', d.waiting), sec('📌 В работе на неделе', d.rest)].join('');
  return (out.trim() + (notes.note ? `\n\nОт меня: ${notes.note}` : '')).trim();
}

export function openShift() {
  const d = collect();
  const hr = new Date().getHours();
  const st = { tab: 'today', shift: hr < 15 ? 'am' : 'pm', edited: false, picked: new Set([...d.urgent, ...d.waiting, ...d.rest].map((r) => r.id)), learned: '', improve: '', note: '', text: '' };
  const existing = () => state.shift_logs.find((l) => l.day === d.day && l.shift === st.shift);
  const load = () => { const l = existing(); st.learned = l?.learned || ''; st.improve = l?.improve || ''; st.text = l?.handover || ''; st.edited = !!l?.handover; };
  load();
  const m = openModal({ title: 'Конец смены', saveLabel: 'Сохранить в дневник', body: '<div class="sh" id="sh"></div>', onSave: async () => { grab(); await persist(); } });
  m.form.classList.add('wide', 'sh-dlg');
  const box = m.form.querySelector('#sh'), ok = m.form.querySelector('#ok');

  const grab = () => {
    const g = (s) => box.querySelector(s);
    if (st.tab !== 'today') return;
    st.learned = g('#sh-learned')?.value ?? st.learned; st.improve = g('#sh-improve')?.value ?? st.improve; st.note = g('#sh-note')?.value ?? st.note;
    if (g('#sh-text')) st.text = g('#sh-text').value;
  };
  const rebuild = () => { if (!st.edited) st.text = handoverText(d, st.picked, st.shift, st); };
  const persist = async () => {
    const stats = { done: d.done.length, open: d.open.length, urgent: d.urgent.length, waiting: d.waiting.length };
    const l = existing();
    await save('shift_logs', l?.id || null, { day: d.day, shift: st.shift, learned: st.learned.trim() || null, improve: st.improve.trim() || null, handover: st.text.trim() || null, stats });
    toast('📓 Смена записана в дневник');
  };

  const row = (r) => `<label class="sh-row${st.picked.has(r.id) ? '' : ' off'}"><input type="checkbox" data-pick="${r.id}"${st.picked.has(r.id) ? ' checked' : ''}>
    <span class="sh-ck" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg></span>
    <span class="sh-rt"><b>${CATEGORIES[r.category] || '📌'} ${esc(r.summary)}</b><small>${esc([guestOf(r), when(r.deadline), statusLabel(r.status)].filter(Boolean).join(' · '))}</small></span></label>`;
  const group = (title, cls, list) => list.length ? `<section class="sh-grp ${cls}"><h4>${title}<span>${list.length}</span></h4>${list.map(row).join('')}</section>` : '';

  const todayTab = () => `
    <div class="sh-seg" role="tablist">${SHIFTS.map(([k, l]) => `<button type="button" data-shift="${k}" aria-selected="${st.shift === k}">${l}</button>`).join('')}</div>
    <div class="sh-stats">
      <div class="sh-stat ok"><b>${d.done.length}</b><small>сделано</small></div>
      <div class="sh-stat${d.urgent.length ? ' hot' : ''}"><b>${d.urgent.length}</b><small>срочно</small></div>
      <div class="sh-stat"><b>${d.waiting.length}</b><small>ждём</small></div>
      <div class="sh-stat"><b>${d.open.length}</b><small>в работе всего</small></div>
    </div>
    ${group('Срочно — на ближайшие сутки', 'hot', d.urgent)}${group('Ждём ответа или подтверждения', 'wait', d.waiting)}${group('В работе на этой неделе', '', d.rest)}
    ${!d.urgent.length && !d.waiting.length && !d.rest.length ? '<p class="sh-empty">Передавать нечего — всё закрыто ✨</p>' : ''}
    <div class="sh-out">
      <div class="sh-out-h"><b>Текст для коллеги</b><button type="button" class="vo-btn" id="sh-copy">Скопировать</button></div>
      <textarea id="sh-text" rows="8" spellcheck="false">${esc(st.text)}</textarea>
      <label class="sh-note"><span>Своё слово в передачу</span><input type="text" id="sh-note" value="${esc(st.note)}" placeholder="например: гость просил не звонить после 21:00" maxlength="160"></label>
    </div>
    <div class="sh-diary">
      <h4>📓 Мой дневник</h4>
      <label><span>Чему научился сегодня</span><textarea id="sh-learned" rows="2" placeholder="Новое о гостях, поставщиках, процессах…">${esc(st.learned)}</textarea></label>
      <label><span>Что улучшить в следующий раз</span><textarea id="sh-improve" rows="2" placeholder="Где потерял время, что делать иначе…">${esc(st.improve)}</textarea></label>
    </div>`;

  const journalTab = () => {
    const week = Date.now() - 7 * 864e5;
    const wd = state.requests.filter((r) => statusOf(r.status)?.kind === 'done' && r.updated_at && Date.parse(r.updated_at) > week);
    const cats = {}; wd.forEach((r) => { cats[r.category] = (cats[r.category] || 0) + 1; });
    const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
    const logs = [...state.shift_logs].sort((a, b) => (b.day + b.shift).localeCompare(a.day + a.shift)).slice(0, 30);
    return `<div class="sh-week"><div><b>${wd.length}</b><small>выполнено за 7 дней</small></div><div><b>${top ? (CATEGORIES[top[0]] || '📌') + ' ' + top[1] : '—'}</b><small>чаще всего</small></div><div><b>${state.shift_logs.filter((l) => Date.parse(l.day) > week).length}</b><small>смен записано</small></div></div>
      ${logs.length ? logs.map((l) => `<article class="sh-log"><header><b>${esc(fmtDay(l.day))}</b><span>${esc((SHIFTS.find(([k]) => k === l.shift) || [, ''])[1])}</span><em>✓ ${l.stats?.done ?? 0} · ждём ${l.stats?.waiting ?? 0}</em></header>
        ${l.learned ? `<p><i>Узнал</i>${esc(l.learned)}</p>` : ''}${l.improve ? `<p><i>Улучшить</i>${esc(l.improve)}</p>` : ''}
        ${l.handover ? `<button type="button" class="link" data-copy-log="${l.id}">Скопировать передачу</button>` : ''}</article>`).join('') : '<p class="sh-empty">Пока записей нет. Сохраните первую смену — и здесь начнётся ваш дневник.</p>'}`;
  };

  const paint = () => {
    rebuild();
    box.innerHTML = `<nav class="sh-tabs"><button type="button" data-tab="today" aria-selected="${st.tab === 'today'}">Итоги смены</button><button type="button" data-tab="journal" aria-selected="${st.tab === 'journal'}">Дневник</button></nav>${st.tab === 'today' ? todayTab() : journalTab()}`;
    ok.hidden = st.tab !== 'today';
    m.form.querySelector('#cancel').textContent = st.tab === 'today' ? 'Отмена' : 'Закрыть';
  };
  box.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab],[data-shift],#sh-copy,[data-copy-log]');
    if (!t) return;
    if (t.dataset.tab) { grab(); st.tab = t.dataset.tab; paint(); }
    else if (t.dataset.shift) { grab(); st.shift = t.dataset.shift; load(); paint(); }
    else if (t.id === 'sh-copy') { grab(); try { await navigator.clipboard.writeText(st.text); toast('Скопировано — вставьте в CRM или чат'); } catch { toast('Не удалось скопировать', 'err'); } }
    else if (t.dataset.copyLog) { try { await navigator.clipboard.writeText(state.shift_logs.find((l) => l.id === t.dataset.copyLog)?.handover || ''); toast('Скопировано'); } catch {} }
  });
  box.addEventListener('change', (e) => {
    const p = e.target.dataset.pick;
    if (p) { grab(); e.target.checked ? st.picked.add(p) : st.picked.delete(p); st.edited = false; paint(); }
  });
  box.addEventListener('input', (e) => {
    if (e.target.id === 'sh-text') st.edited = true;
    else if (e.target.id === 'sh-note') { st.note = e.target.value; if (!st.edited) { rebuild(); box.querySelector('#sh-text').value = st.text; } }
  });
  paint();
}

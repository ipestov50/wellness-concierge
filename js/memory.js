// «✦ Запомнить»: после выполнения запроса Jarvis предлагает, что стоит сохранить в профиле гостя.
// Ничего не тратится, пока вы не нажмёте кнопку: подсказка — это просто всплывающая кнопка.
import { api } from './api.js';
import { esc, toast, openModal } from './ui.js';
import { byId, save } from './data.js';
import { statusOf } from './statuses.js';

const KINDS = {
  like: ['👍', 'Любит'], dislike: ['👎', 'Избегает'], allergy: ['⚠️', 'Аллергия'], diet: ['🥗', 'Диета'],
  health: ['🩺', 'Здоровье'], habit: ['🧭', 'Привычка'], note: ['📝', 'Заметка'],
};
const FIELD = { like: 'likes', dislike: 'dislikes', allergy: 'allergies', diet: 'diet', health: 'health' };
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const firstName = (c) => (c?.name || '').replace(/\s*\(.*?\)/g, '').split(/\s+/)[0] || 'гостя';

// ---- всплывающая кнопка после «Сделано» ----
let pill, pillTimer;
export function offerMemory(reqId) {
  const r = byId('requests', reqId);
  if (!r?.client_id || !byId('clients', r.client_id)) return;
  hidePill();
  pill = document.createElement('div');
  pill.className = 'mem-pill';
  pill.innerHTML = `<button type="button" class="mem-go"><span class="mem-spark">✦</span><span><b>Запомнить о госте?</b><small>Jarvis предложит, что сохранить</small></span></button><button type="button" class="mem-x" aria-label="Скрыть">✕</button>`;
  pill.querySelector('.mem-go').onclick = () => { hidePill(); openMemory(reqId); };
  pill.querySelector('.mem-x').onclick = hidePill;
  document.body.appendChild(pill);
  requestAnimationFrame(() => pill?.classList.add('in'));
  pillTimer = setTimeout(hidePill, 15000);
}
function hidePill() {
  clearTimeout(pillTimer);
  const p = pill; pill = null;
  if (!p) return;
  p.classList.remove('in');
  setTimeout(() => p.remove(), 250);
}

// ---- окно подтверждения ----
export function openMemory(reqId) {
  const r = byId('requests', reqId);
  const c = r && byId('clients', r.client_id);
  if (!r || !c) return toast('У запроса не указан гость', 'err');
  let rows = [], busy = true, failed = '';
  const m = openModal({
    title: 'Запомнить о госте', saveLabel: 'Сохранить в профиль',
    body: `<div class="mem" id="mem"></div>`,
    onSave: async () => {
      const list = [...m.form.querySelectorAll('.mem-row')].filter((el) => el.querySelector('.mem-on').checked)
        .map((el) => ({ kind: el.querySelector('.mem-kind').value, text: el.querySelector('.mem-t').value.trim() })).filter((x) => x.text);
      if (!list.length) return;
      await applyMemory(c.id, list);
      toast(`✦ Сохранено в профиль: ${list.length}`);
    },
  });
  m.form.classList.add('mem-dlg');
  const box = m.form.querySelector('#mem');
  const ok = m.form.querySelector('#ok');

  const rowHtml = (x, i) => `<div class="mem-row" data-i="${i}">
      <label class="mem-chk"><input type="checkbox" class="mem-on" checked><span class="mem-box" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg></span></label>
      <div class="mem-main">
        <div class="mem-top"><select class="mem-kind" aria-label="Тип">${Object.entries(KINDS).map(([k, [ic, l]]) => `<option value="${k}"${k === x.kind ? ' selected' : ''}>${ic} ${l}</option>`).join('')}</select></div>
        <input type="text" class="mem-t" value="${esc(x.text)}" maxlength="90" aria-label="Что запомнить">
        ${x.why ? `<small class="mem-why">${esc(x.why)}</small>` : ''}
      </div>
    </div>`;
  const paint = () => {
    ok.disabled = busy;
    if (busy) { box.innerHTML = `<p class="mem-lead">Jarvis читает итоги запроса…</p><div class="mem-skel"><i></i><i></i><i></i></div>`; return; }
    box.innerHTML = `<p class="mem-lead">${rows.length ? `Что стоит запомнить о ${esc(firstName(c))} — отметьте нужное, текст можно поправить.` : failed ? esc(failed) : 'Из этого запроса нового о госте не узнал. Добавьте своё, если хотите.'}</p>
      <div class="mem-list">${rows.map(rowHtml).join('')}</div>
      <button type="button" class="mem-add" id="mem-add">＋ Своё</button>
      ${failed && rows.length === 0 ? '<button type="button" class="btn small" id="mem-retry">↻ Ещё раз</button>' : ''}`;
  };
  const sync = () => { rows = [...box.querySelectorAll('.mem-row')].map((el) => ({ kind: el.querySelector('.mem-kind').value, text: el.querySelector('.mem-t').value })); };
  box.addEventListener('click', (e) => {
    if (e.target.closest('#mem-add')) { sync(); rows.push({ kind: 'like', text: '' }); paint(); box.querySelector('.mem-row:last-child .mem-t')?.focus(); }
    if (e.target.closest('#mem-retry')) load(true);
  });
  box.addEventListener('change', (e) => { if (e.target.classList.contains('mem-on')) e.target.closest('.mem-row').classList.toggle('off', !e.target.checked); });
  const load = async (force = false) => {
    busy = true; failed = ''; paint();
    try { const out = await api('memory', { id: reqId, force }, { signal: m.signal }); rows = out.items || []; }
    catch (e) { if (e.name === 'AbortError') return; rows = []; failed = e.message === 'rate_limited' ? 'Лимит Gemini на минуту исчерпан — попробуйте чуть позже или добавьте своё.' : 'Не получилось связаться с Jarvis. Можно добавить своё.'; }
    busy = false; paint();
  };
  paint(); load();
}

// слить пункты в профиль: списки без дублей, привычки и заметки — дописываем строкой
export async function applyMemory(clientId, items) {
  const c = byId('clients', clientId);
  if (!c) return;
  const patch = {};
  const stamp = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  for (const { kind, text } of items) {
    const f = FIELD[kind];
    if (f) {
      const cur = patch[f] || c[f] || [];
      if (!cur.some((x) => norm(x) === norm(text))) patch[f] = [...cur, text];
    } else if (kind === 'habit') {
      const cur = patch.travel_habits ?? c.travel_habits ?? '';
      if (!norm(cur).includes(norm(text))) patch.travel_habits = cur ? `${cur}; ${text}` : text;
    } else {
      const cur = patch.concierge_notes ?? c.concierge_notes ?? '';
      if (!norm(cur).includes(norm(text))) patch.concierge_notes = `${cur ? cur + '\n' : ''}• ${stamp} — ${text}`;
    }
  }
  if (Object.keys(patch).length) await save('clients', clientId, patch);
}

export const isDoneStatus = (s) => statusOf(s)?.kind === 'done';

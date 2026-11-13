import { STATUSES, ARCHIVE, CATEGORIES, URGENCY_LABEL, STATUS_LABEL, TZ } from '../const.js';
import { esc, fmtDeadline, fmtMoney, toast } from '../ui.js';
import { state, byId, save } from '../data.js';
import { ui, render, registerView } from '../router.js';
import { editRequest } from '../forms.js';

const isLate = (r) => r.deadline && !ARCHIVE.includes(r.status) && new Date(r.deadline) < new Date();
const clientName = (id) => byId('clients', id)?.name || 'Без клиента';

export function requestCard(r, { showClient = true } = {}) {
  const c = byId('clients', r.client_id);
  const p = byId('partners', r.partner_id);
  const late = isLate(r);
  const allergic = c && (c.allergies?.length || c.diet?.length || c.health?.length);
  return `<button class="card" data-req="${r.id}" type="button">
    <div class="who"><span class="cat" title="${esc(r.category)}">${CATEGORIES[r.category] || '📌'}</span>${showClient ? esc(clientName(r.client_id)) : esc(r.summary)}${c?.vip && showClient ? ' <span class="vip">★</span>' : ''}</div>
    ${showClient ? `<div class="sum">${esc(r.summary)}</div>` : ''}
    <div class="meta">
      <span class="pill u-${esc(r.urgency)}">${esc(URGENCY_LABEL[r.urgency] || '')}</span>
      ${r.deadline ? `<span class="${late ? 'late' : ''}">${late ? 'Просрочено · ' : ''}${esc(fmtDeadline(r.deadline))}</span>` : ''}
      ${r.budget_amount != null ? `<span>${esc(fmtMoney(r.budget_amount, r.currency))}</span>` : ''}
      ${p ? `<span>· ${esc(p.name)}</span>` : ''}
    </div>
    ${allergic || r.needs_review || r.needs_approval ? `<div class="flags">
      ${allergic ? '<span class="flag warn">⚠ ограничения</span>' : ''}
      ${r.needs_review ? '<span class="flag">проверить</span>' : ''}
      ${r.needs_approval ? '<span class="flag">одобрение гостя</span>' : ''}</div>` : ''}
  </button>`;
}

// ---------- режим «Сегодня»: открытые запросы по срокам ----------
const parisDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const URG_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

function groupOf(r, today, tomorrow, weekEnd) {
  if (!r.deadline) return 'none';
  const day = parisDay(new Date(r.deadline));
  if (new Date(r.deadline) < new Date() && day < today) return 'late';
  if (day === today) return new Date(r.deadline) < new Date() && fmtTime(r.deadline) !== '00:00' ? 'late' : 'today';
  if (day === tomorrow) return 'tomorrow';
  if (day <= weekEnd) return 'week';
  return 'later';
}
const GROUPS = [['late', 'Просрочено'], ['today', 'Сегодня'], ['tomorrow', 'Завтра'], ['week', 'На этой неделе'], ['later', 'Позже'], ['none', 'Без срока']];

function rowHtml(r, group) {
  const c = byId('clients', r.client_id);
  const warn = c && (c.allergies?.length || c.diet?.length || c.health?.length);
  const when = !r.deadline ? '' : (group === 'today' || group === 'tomorrow')
    ? (fmtTime(r.deadline) === '00:00' ? '' : fmtTime(r.deadline)) : fmtDeadline(r.deadline);
  return `<button class="trow u-line-${esc(r.urgency)}" data-req="${r.id}" type="button">
    <span class="cat">${CATEGORIES[r.category] || '📌'}</span>
    <span class="tmain"><b>${esc(c?.name || 'Без клиента')}${c?.vip ? ' <span class="vip">★</span>' : ''}${warn ? ' <span class="warn-dot" title="Есть ограничения">⚠</span>' : ''}</b>
      <span class="tsum">${esc(r.summary)}</span></span>
    <span class="tside"><span class="twhen${group === 'late' ? ' late' : ''}">${esc(when)}</span>
      <span class="tstatus">${esc(STATUS_LABEL[r.status] || '')}</span></span>
  </button>`;
}

function todayView(list) {
  const now = new Date();
  const today = parisDay(now), tomorrow = parisDay(new Date(+now + 864e5)), weekEnd = parisDay(new Date(+now + 7 * 864e5));
  const open = list.filter((r) => !ARCHIVE.includes(r.status));
  const by = {};
  for (const r of open) (by[groupOf(r, today, tomorrow, weekEnd)] ||= []).push(r);
  const sort = (a, b) => (a.deadline || '9').localeCompare(b.deadline || '9') || URG_ORDER[a.urgency] - URG_ORDER[b.urgency];
  const html = GROUPS.filter(([g]) => by[g]?.length).map(([g, label]) =>
    `<section class="tgroup g-${g}"><h3>${label}<span>${by[g].length}</span></h3>
      <div class="tlist">${by[g].sort(sort).map((r) => rowHtml(r, g)).join('')}</div></section>`).join('');
  return html || `<div class="empty calm">${ui.q ? 'Ничего не нашлось.' : 'Открытых запросов нет. Можно выдохнуть.'}</div>`;
}

function boardView(list) {
  const cols = STATUSES.filter(([s]) => ui.archive || !ARCHIVE.includes(s));
  return `<div class="board" id="board">${cols.map(([s, label]) => {
      const items = list.filter((r) => r.status === s).sort((a, b) => a.position - b.position);
      return `<section class="col${ARCHIVE.includes(s) ? ' archived' : ''}" data-status="${s}">
        <h3>${esc(label)}<span>${items.length}</span></h3>
        <div class="col-body">${items.map((r) => requestCard(r)).join('') || '<div class="col-empty">Пусто</div>'}</div>
      </section>`;
    }).join('')}</div>
    <p class="hint board-hint">Карточки можно перетаскивать между колонками. На телефоне — нажмите и подержите карточку.</p>`;
}

function view(app) {
  const q = ui.q.trim().toLowerCase();
  const list = state.requests.filter((r) => !q ||
    [r.summary, clientName(r.client_id), r.original_message, r.category].join(' ').toLowerCase().includes(q));
  const open = state.requests.filter((r) => !ARCHIVE.includes(r.status)).length;
  const board = ui.reqView === 'board';
  app.innerHTML = `
    <div class="bar">
      <div class="seg" role="tablist" aria-label="Вид">
        <button type="button" data-view="today" aria-selected="${!board}">Сегодня</button>
        <button type="button" data-view="board" aria-selected="${board}">Доска</button>
      </div>
      <div class="grow"><input type="search" id="q" placeholder="Поиск по запросам и клиентам" value="${esc(ui.q)}" autocomplete="off"></div>
      <span class="count">Открытых: ${open}</span>
      ${board ? `<button class="btn small" id="arch" type="button">${ui.archive ? 'Скрыть архив' : 'Показать архив'}</button>` : ''}
    </div>
    ${board ? boardView(list) : todayView(list)}`;
  app.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => {
    ui.reqView = b.dataset.view;
    try { localStorage.setItem('reqView', ui.reqView); } catch {}
    render();
  });
  app.querySelector('#arch')?.addEventListener('click', () => { ui.archive = !ui.archive; render(); });
  if (board) enableDrag(app.querySelector('#board'));
}
registerView('requests', view);

// ---------- перетаскивание (мышь и палец) ----------
let suppressClick = false;
document.addEventListener('click', (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);
let dragActive = false;
document.addEventListener('touchmove', (e) => { if (dragActive) e.preventDefault(); }, { passive: false });

function enableDrag(board) {
  board.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.card[data-req]');
    if (!card || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const touch = e.pointerType !== 'mouse';
    const sx = e.clientX, sy = e.clientY;
    let x = sx, y = sy, ghost = null, timer = null, raf = null, overCol = null;
    const rect = card.getBoundingClientRect();
    const dx = sx - rect.left, dy = sy - rect.top;

    const start = () => {
      dragActive = true;
      card.classList.add('dragging');
      ghost = card.cloneNode(true);
      ghost.classList.add('ghost');
      ghost.style.width = rect.width + 'px';
      document.body.append(ghost);
      document.body.classList.add('is-dragging');
      if (navigator.vibrate && touch) navigator.vibrate(15);
      move();
      tick();
    };
    const move = () => {
      if (!ghost) return;
      ghost.style.transform = `translate(${x - dx}px, ${y - dy}px) rotate(1.5deg)`;
      const el = document.elementFromPoint(x, y)?.closest('.col');
      if (el !== overCol) { overCol?.classList.remove('over'); overCol = el; overCol?.classList.add('over'); }
    };
    const tick = () => {
      const b = board.getBoundingClientRect();
      const edge = 48;
      if (x < b.left + edge) board.scrollLeft -= 12; else if (x > b.right - edge) board.scrollLeft += 12;
      if (y < 60) window.scrollBy(0, -10); else if (y > innerHeight - 60) window.scrollBy(0, 10);
      raf = requestAnimationFrame(tick);
    };
    const onMove = (ev) => {
      x = ev.clientX; y = ev.clientY;
      const dist = Math.hypot(x - sx, y - sy);
      if (!ghost) {
        if (touch) { if (dist > 10) cleanup(); return; } // палец двигается — это прокрутка
        if (dist > 6) start();
        return;
      }
      move();
    };
    const cleanup = () => {
      clearTimeout(timer); cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      ghost?.remove(); card.classList.remove('dragging'); overCol?.classList.remove('over');
      document.body.classList.remove('is-dragging');
      dragActive = false;
    };
    const onCancel = () => cleanup();
    const onUp = () => {
      const wasDragging = !!ghost;
      const col = overCol;
      cleanup();
      if (!wasDragging) return;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 50);
      if (col) drop(card.dataset.req, col, y);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    if (touch) timer = setTimeout(start, 350);
  });
}

async function drop(id, col, y) {
  const r = byId('requests', id);
  if (!r) return;
  const status = col.dataset.status;
  const cards = [...col.querySelectorAll('.card[data-req]')].filter((c) => c.dataset.req !== id);
  let idx = cards.findIndex((c) => { const b = c.getBoundingClientRect(); return y < b.top + b.height / 2; });
  if (idx < 0) idx = cards.length;
  const pos = (el) => byId('requests', el.dataset.req)?.position;
  const prev = cards[idx - 1] && pos(cards[idx - 1]);
  const next = cards[idx] && pos(cards[idx]);
  const position = prev != null && next != null ? (prev + next) / 2 : prev != null ? prev + 1 : next != null ? next - 1 : Date.now() / 1000;
  if (status === r.status && position === r.position) return;
  const before = { status: r.status, position: r.position };
  Object.assign(r, { status, position }); // сразу показываем
  render();
  try {
    await save('requests', id, { status, position });
    if (status !== before.status) toast(`«${r.summary}» → ${col.querySelector('h3').firstChild.textContent}`);
  } catch (err) {
    Object.assign(r, before); render();
    toast('Не удалось переместить: ' + (err.message || err), 'err');
  }
}

export { editRequest };

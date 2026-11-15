import { CATEGORIES, URGENCY_LABEL, TZ } from '../const.js';
import { setStatus, toggleDone, isDone } from '../actions.js';
import { birthdayInfo } from '../birthday.js';
import { smartBar, bindSmart } from '../smart.js';
import { suggestionsBlock, refreshSuggestions } from '../suggest.js';
import { viewSkeleton } from '../router.js';
// календарь — отдельный модуль, грузится при первом открытии
let cal$ = null, calLoading = null;
const loadCal = () => calLoading || (calLoading = import('./calendar.js').then((m) => { cal$ = m; render(); }).catch(() => { calLoading = null; }));
import { dayView, bindDay } from './myday.js';
import { backupDue, daysSinceBackup } from '../backup.js';
import { columns, statusLabel, isClosed, effectiveStatus, KINDS } from '../statuses.js';
import { esc, fmtDeadline, fmtMoney, toast, field, options, openModal } from '../ui.js';
import { state, byId, save, remove, updateWhere } from '../data.js';
import { ui, render, registerView } from '../router.js';
import { editRequest } from '../lazy.js';

const isLate = (r) => r.deadline && !isClosed(r.status) && new Date(r.deadline) < new Date();
const clientName = (id) => byId('clients', id)?.name || 'Без клиента';

export function requestCard(r, { showClient = true } = {}) {
  const c = byId('clients', r.client_id);
  const p = byId('partners', r.partner_id);
  const late = isLate(r);
  const allergic = c && (c.allergies?.length || c.diet?.length || c.health?.length);
  const done = isDone(r);
  const closed = isClosed(r.status);
  return `<div class="card-wrap${done ? ' is-done' : closed ? ' is-closed' : ''}"><button class="card" data-req="${r.id}" type="button">
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
    ${(r.checklist?.items || []).length ? `<span class="card-cl"><i style="width:${(r.checklist.items.filter((x) => x.done).length / r.checklist.items.length) * 100}%"></i></span>` : ''}
  </button><button class="card-check${done ? ' on' : ''}" data-complete="${r.id}" type="button" title="${done ? 'Вернуть в работу' : 'Отметить «Сделано»'}" aria-pressed="${done}" aria-label="${done ? 'Вернуть в работу' : 'Сделано'}: ${esc(r.summary)}">${CHECK}</button><button class="card-menu" data-cardmenu="${r.id}" type="button" aria-label="Действия с запросом" aria-haspopup="menu">⋯</button></div>`;
}

// ---------- меню карточки: изменить, статус, удалить ----------
function closeCardMenu() { document.getElementById('cardmenu')?.remove(); document.getElementById('cardmenu-bg')?.remove(); }
function openCardMenu(id, anchor) {
  closeCardMenu();
  const r = byId('requests', id);
  if (!r) return;
  const m = document.createElement('div');
  m.id = 'cardmenu'; m.className = 'popover'; m.setAttribute('role', 'menu');
  m.innerHTML = `<div class="pop-title">${esc(r.summary)}</div>
    <button type="button" role="menuitem" data-act="edit">✎ Изменить</button>
    <div class="pop-label">Перенести в</div>
    <div class="pop-statuses">${columns().map(({ key: s, label: l }) =>
      `<button type="button" role="menuitem" data-act="status" data-status="${esc(s)}"${s === r.status ? ' aria-current="true" disabled' : ''}>${s === r.status ? '✓ ' : ''}${esc(l)}</button>`).join('')}</div>
    <button type="button" role="menuitem" data-act="delete" class="pop-danger">Удалить</button>`;
  document.body.append(m);
  const a = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  // телефон (или любой сенсорный экран): нижняя шторка — статус меняется одним касанием, без перетаскивания
  if (innerWidth < 768 || matchMedia('(pointer: coarse)').matches) {
    m.classList.add('sheet');
    const bg = document.createElement('div');
    bg.id = 'cardmenu-bg'; bg.className = 'sheet-bg';
    bg.addEventListener('click', closeCardMenu);
    m.before(bg);
    requestAnimationFrame(() => bg.classList.add('open'));
  }
  else {
    m.style.left = Math.max(8, Math.min(a.right - w, innerWidth - w - 8)) + 'px';
    m.style.top = (a.bottom + 6 + h > innerHeight - 8 ? Math.max(8, a.top - h - 6) : a.bottom + 6) + 'px';
  }
  requestAnimationFrame(() => m.classList.add('open'));
  let armed = false;
  m.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'edit') { closeCardMenu(); editRequest(id); }
    else if (b.dataset.act === 'status') {
      closeCardMenu();
      setStatus(id, b.dataset.status).catch(() => {});
    } else if (b.dataset.act === 'delete') {
      if (!armed) { armed = true; b.textContent = 'Точно удалить? Нажмите ещё раз'; b.classList.add('armed'); return; }
      closeCardMenu();
      try { await remove('requests', id); toast('Запрос удалён'); }
      catch (err) { toast('Не удалось удалить: ' + (err.message || err), 'err'); }
    }
  });
}
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7.2 12.4l3.2 3.2 6.4-6.6"/></svg>';
document.addEventListener('click', (e) => {
  const ck = e.target.closest('[data-complete]');
  if (ck) { e.stopPropagation(); e.preventDefault(); toggleDone(ck.dataset.complete)?.catch?.(() => {}); return; }
  const t = e.target.closest('[data-cardmenu]');
  if (t) { e.stopPropagation(); openCardMenu(t.dataset.cardmenu, t); return; }
  const cm = e.target.closest('[data-colmenu]');
  if (cm) { e.stopPropagation(); openColumnMenu(cm.dataset.colmenu, cm); return; }
  if (e.target.closest('#colAdd')) { editColumn(null); return; }
  if (!e.target.closest('#cardmenu')) closeCardMenu();
  const bo = e.target.closest('[data-cl-open]');
  if (bo) { ui.tab = 'clients'; ui.client = bo.dataset.clOpen; ui.q = ''; render(); scrollTo(0, 0); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCardMenu(); });
addEventListener('resize', closeCardMenu);

function boardView(list) {
  const cols = columns();
  return `<div class="board" id="board">${cols.map((c) => {
      const items = list.filter((r) => effectiveStatus(r.status) === c.key).sort((a, b) => a.position - b.position);
      return `<section class="col${c.kind === 'done' ? ' col-done' : c.kind !== 'active' ? ' archived' : ''}" data-status="${esc(c.key)}">
        <h3><span class="col-name">${esc(c.label)}</span><span class="col-count">${items.length}</span>
          <button class="col-menu" data-colmenu="${c.id}" type="button" aria-label="Настроить колонку «${esc(c.label)}»">⋯</button></h3>
        <div class="col-body">${items.map((r) => requestCard(r)).join('') || '<div class="col-empty">Пусто</div>'}</div>
      </section>`;
    }).join('')}
    <button class="col-add" id="colAdd" type="button"><span>＋</span>Новая колонка</button></div>
    <p class="hint board-hint">Карточки перетаскиваются между колонками (на телефоне — нажмите и подержите). Кружок ✓ на карточке или перенос в «Выполнено» — одно и то же: запрос закрывается везде. Колонки настраиваются кнопкой ⋯.</p>`;
}

// ---------- настройка колонок ----------
function editColumn(id) {
  const c = id ? state.statuses.find((x) => x.id === id) : { label: '', kind: 'active' };
  if (!c) return;
  const count = id ? state.requests.filter((r) => effectiveStatus(r.status) === c.key).length : 0;
  const others = columns().filter((x) => x.id !== id);
  const body =
    field('label', 'Название колонки', `<input id="f-label" name="label" type="text" required value="${esc(c.label)}" placeholder="Например: Ждём партнёра" autocomplete="off">`) +
    field('kind', 'Тип', `<select id="f-kind" name="kind">${options(KINDS, c.kind)}</select>`,
      'Запросы в рабочих колонках попадают в «Мой день». «Выполнено» и «Архив» закрывают запрос во всём приложении.') +
    (id && count ? field('move_to', `При удалении перенести карточки (${count}) в`, `<select id="f-move_to" name="move_to">${options(others.map((x) => [x.key, x.label]), others.find((x) => x.kind === 'active')?.key)}</select>`) : '');
  openModal({
    title: id ? 'Колонка' : 'Новая колонка',
    body,
    onSave: async (v) => {
      if (id) await save('statuses', id, { label: v.label.trim(), kind: v.kind });
      else {
        const last = columns().filter((x) => x.kind === 'active').at(-1);
        const after = columns().find((x) => x.position > (last?.position ?? 0));
        const position = last ? (after ? (last.position + after.position) / 2 : last.position + 1) : 1;
        await save('statuses', null, { key: 'c_' + Math.random().toString(36).slice(2, 10), label: v.label.trim(), kind: v.kind, position });
      }
      toast(id ? 'Колонка сохранена' : 'Колонка добавлена');
    },
    onDelete: id ? async () => {
      if (columns().length <= 1) throw new Error('нужна хотя бы одна колонка');
      if (count) {
        const target = document.getElementById('f-move_to')?.value;
        if (!target) throw new Error('выберите, куда перенести карточки');
        await updateWhere('requests', 'status', c.key, { status: target });
      }
      await remove('statuses', id);
      toast(`Колонка «${c.label}» удалена${count ? ', карточки перенесены' : ''}`);
    } : null,
  });
}

async function moveColumn(id, dir) {
  const list = columns();
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = list[i], b = list[j];
  const pa = a.position, pb = b.position;
  Object.assign(a, { position: pb }); Object.assign(b, { position: pa }); render();
  try { await Promise.all([save('statuses', a.id, { position: pb }), save('statuses', b.id, { position: pa })]); }
  catch (err) { toast('Не удалось переставить: ' + (err.message || err), 'err'); }
}

function openColumnMenu(id, anchor) {
  closeCardMenu();
  const c = state.statuses.find((x) => x.id === id);
  if (!c) return;
  const list = columns(), i = list.findIndex((x) => x.id === id);
  const m = document.createElement('div');
  m.id = 'cardmenu'; m.className = 'popover'; m.setAttribute('role', 'menu');
  m.innerHTML = `<div class="pop-title">${esc(c.label)}</div>
    <button type="button" data-act="edit">✎ Переименовать или изменить тип</button>
    <button type="button" data-act="left"${i === 0 ? ' disabled' : ''}>← Сдвинуть левее</button>
    <button type="button" data-act="right"${i === list.length - 1 ? ' disabled' : ''}>Сдвинуть правее →</button>
    <button type="button" data-act="add">＋ Новая колонка</button>
    <button type="button" data-act="delete" class="pop-danger">Удалить колонку…</button>`;
  placePopover(m, anchor);
  m.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    closeCardMenu();
    if (b.dataset.act === 'edit' || b.dataset.act === 'delete') editColumn(id);
    else if (b.dataset.act === 'add') editColumn(null);
    else moveColumn(id, b.dataset.act === 'left' ? -1 : 1);
  });
}

function placePopover(m, anchor) {
  document.body.append(m);
  const a = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  if (innerWidth <= 520) m.classList.add('sheet');
  else {
    m.style.left = Math.max(8, Math.min(a.right - w, innerWidth - w - 8)) + 'px';
    m.style.top = (a.bottom + 6 + h > innerHeight - 8 ? Math.max(8, a.top - h - 6) : a.bottom + 6) + 'px';
  }
  requestAnimationFrame(() => m.classList.add('open'));
}

// заметки дня: резервная копия и ближайшие дни рождения
function dayNotes() {
  const bdays = state.clients.map((c) => ({ c, b: birthdayInfo(c.birthday) })).filter(({ b }) => b && b.days <= 7).sort((x, y) => x.b.days - y.b.days);
  const backup = backupDue();
  if (!backup && !bdays.length) return '';
  return `<section class="day-notes">
    ${backup ? `<div class="hero-note">💾 ${daysSinceBackup() == null ? 'Резервной копии ещё не было' : `Резервной копии не было ${daysSinceBackup()} дн.`} · <button type="button" data-backup>Сохранить копию</button></div>` : ''}
    ${bdays.length ? `<div class="hero-bdays">🎂 ${bdays.map(({ c, b }) =>
      `<button type="button" data-cl-open="${c.id}">${esc(c.name.replace(/\s*\(.*?\)/g, ''))} — ${b.days === 0 ? 'сегодня' : b.days === 1 ? 'завтра' : esc(b.day + ' ' + b.text.split(' ')[1])}</button>`).join(', ')}</div>` : ''}
  </section>`;
}

function view(app) {
  const q = ui.q.trim().toLowerCase();
  const list = state.requests.filter((r) => !q ||
    [r.summary, clientName(r.client_id), r.original_message, r.category].join(' ').toLowerCase().includes(q));
  const open = state.requests.filter((r) => !isClosed(r.status)).length;
  if (!['day', 'board', 'calendar'].includes(ui.reqView)) ui.reqView = 'day';
  const board = ui.reqView === 'board';
  const cal = ui.reqView === 'calendar';
  const myday = ui.reqView === 'day';
  const toolbar = `<div class="bar toolbar">
      <div class="seg" role="tablist" aria-label="Вид">
        <button type="button" data-view="day" aria-selected="${myday}">Мой день</button>
        <button type="button" data-view="board" aria-selected="${board}">Доска</button>
        <button type="button" data-view="calendar" aria-selected="${cal}">Календарь</button>
      </div>
      ${myday ? '' : `<div class="grow search"><input type="search" id="q" placeholder="Поиск по запросам и гостям" value="${esc(ui.q)}" autocomplete="off"></div>`}
      ${board ? `<span class="count">Открытых: ${open}</span>` : ''}
    </div>`;
  app.innerHTML = myday
    ? `<div class="stack daystack">${dayNotes()}${suggestionsBlock()}${smartBar()}${toolbar}${dayView()}</div>`
    : `<div class="board-top">${smartBar()}${toolbar}</div>${cal ? (cal$ ? cal$.calendarView(list) : (loadCal(), viewSkeleton())) : boardView(list)}`;
  if (myday) refreshSuggestions();
  app.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => {
    ui.reqView = b.dataset.view;
    try { localStorage.setItem('reqView', ui.reqView); } catch {}
    render();
  });
  if (board) enableDrag(app.querySelector('#board'));
  if (cal && cal$) cal$.bindCalendar(app);
  if (myday) bindDay(app);
  bindSmart(app);
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
  // тот же путь, что у «Сделано» в «Моём дне» и в профиле: статус меняется сразу везде
  setStatus(id, status, { position, quiet: status === r.status }).catch(() => {});
}

export { editRequest };


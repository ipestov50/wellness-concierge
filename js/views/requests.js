import { CATEGORIES, URGENCY_LABEL, TZ } from '../const.js';
import { columns, statusLabel, isClosed, doneKey, effectiveStatus, KINDS } from '../statuses.js';
import { esc, fmtDeadline, fmtMoney, toast, avatar, fromParisInput, field, options, openModal } from '../ui.js';
import { state, byId, save, remove, updateWhere } from '../data.js';
import { ui, render, registerView } from '../router.js';
import { editRequest } from '../forms.js';

const isLate = (r) => r.deadline && !isClosed(r.status) && new Date(r.deadline) < new Date();
const clientName = (id) => byId('clients', id)?.name || 'Без клиента';

export function requestCard(r, { showClient = true } = {}) {
  const c = byId('clients', r.client_id);
  const p = byId('partners', r.partner_id);
  const late = isLate(r);
  const allergic = c && (c.allergies?.length || c.diet?.length || c.health?.length);
  return `<div class="card-wrap"><button class="card" data-req="${r.id}" type="button">
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
  </button><button class="card-menu" data-cardmenu="${r.id}" type="button" aria-label="Действия с запросом" aria-haspopup="menu">⋯</button></div>`;
}

// ---------- меню карточки: изменить, статус, удалить ----------
function closeCardMenu() { document.getElementById('cardmenu')?.remove(); }
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
  if (innerWidth <= 520) m.classList.add('sheet');
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
      const before = r.status;
      try {
        await save('requests', id, { status: b.dataset.status });
        toast(`${statusLabel(b.dataset.status)}: ${r.summary}`, '', { label: 'Отменить', fn: () => save('requests', id, { status: before }) });
      } catch (err) { toast('Не удалось: ' + (err.message || err), 'err'); }
    } else if (b.dataset.act === 'delete') {
      if (!armed) { armed = true; b.textContent = 'Точно удалить? Нажмите ещё раз'; b.classList.add('armed'); return; }
      closeCardMenu();
      try { await remove('requests', id); toast('Запрос удалён'); }
      catch (err) { toast('Не удалось удалить: ' + (err.message || err), 'err'); }
    }
  });
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-cardmenu]');
  if (t) { e.stopPropagation(); openCardMenu(t.dataset.cardmenu, t); return; }
  const cm = e.target.closest('[data-colmenu]');
  if (cm) { e.stopPropagation(); openColumnMenu(cm.dataset.colmenu, cm); return; }
  if (e.target.closest('#colAdd')) { editColumn(null); return; }
  if (!e.target.closest('#cardmenu')) closeCardMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCardMenu(); });
addEventListener('resize', closeCardMenu);

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

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7.2 12.4l3.2 3.2 6.4-6.6"/></svg>';

function rowHtml(r, group) {
  const c = byId('clients', r.client_id);
  const warn = c && (c.allergies?.length || c.diet?.length || c.health?.length);
  const when = !r.deadline ? '' : (group === 'today' || group === 'tomorrow')
    ? (fmtTime(r.deadline) === '00:00' ? '' : fmtTime(r.deadline)) : fmtDeadline(r.deadline);
  return `<div class="trow-wrap u-line-${esc(r.urgency)}" data-row="${r.id}">
    <div class="swipe-bg" aria-hidden="true"><span class="sb-done">✓ Сделано</span><span class="sb-later">На завтра →</span></div>
    <div class="swipe-fg">
      <button class="done-btn" data-done="${r.id}" type="button" aria-label="Отметить «${esc(r.summary)}» выполненным" title="Сделано">${CHECK}</button>
      <button class="trow" data-req="${r.id}" type="button">
        ${avatar(c)}
        <span class="tmain"><b>${esc(c?.name || 'Без клиента')}${c?.vip ? ' <span class="vip">★</span>' : ''}${warn ? ' <span class="warn-dot" title="Есть ограничения">⚠</span>' : ''}</b>
          <span class="tsum"><span class="cat">${CATEGORIES[r.category] || '📌'}</span> ${esc(r.summary)}</span></span>
        <span class="tside"><span class="twhen${group === 'late' ? ' late' : ''}">${esc(when)}</span>
          <span class="tstatus">${esc(statusLabel(effectiveStatus(r.status)))}</span></span>
      </button>
    </div>
  </div>`;
}

function summary(today) {
  const open = state.requests.filter((r) => !isClosed(r.status));
  const now = new Date();
  const late = open.filter((r) => r.deadline && new Date(r.deadline) < now).length;
  const todayN = open.filter((r) => r.deadline && parisDay(new Date(r.deadline)) === today && new Date(r.deadline) >= now).length;
  const done = state.requests.filter((r) => r.status === doneKey() && r.updated_at && parisDay(new Date(r.updated_at)) === today).length;
  const hour = +new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(now) % 24;
  const hello = hour >= 5 && hour < 18 ? 'Bonjour' : 'Bonsoir';
  const date = now.toLocaleDateString('ru-RU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
  return `<section class="hero">
    <div class="hero-hello"><h2>${hello}</h2><span>${esc(date)}</span></div>
    <div class="hero-stats">
      <div class="stat${late ? ' s-late' : ''}"><b data-count="${late}">${late}</b><span>просрочено</span></div>
      <div class="stat s-today"><b data-count="${todayN}">${todayN}</b><span>на сегодня</span></div>
      <div class="stat s-done"><b data-count="${done}">${done}</b><span>сделано</span></div>
    </div>
  </section>`;
}

function todayView(list) {
  const now = new Date();
  const today = parisDay(now), tomorrow = parisDay(new Date(+now + 864e5)), weekEnd = parisDay(new Date(+now + 7 * 864e5));
  const open = list.filter((r) => !isClosed(r.status));
  const by = {};
  for (const r of open) (by[groupOf(r, today, tomorrow, weekEnd)] ||= []).push(r);
  const sort = (a, b) => (a.deadline || '9').localeCompare(b.deadline || '9') || URG_ORDER[a.urgency] - URG_ORDER[b.urgency];
  const html = GROUPS.filter(([g]) => by[g]?.length).map(([g, label]) =>
    `<section class="tgroup g-${g}"><h3>${label}<span>${by[g].length}</span></h3>
      <div class="tlist">${by[g].sort(sort).map((r) => rowHtml(r, g)).join('')}</div></section>`).join('');
  return (ui.q ? '' : summary(today)) +
    (html || `<div class="empty calm">${ui.q ? 'Ничего не нашлось.' : 'Открытых запросов нет. Можно выдохнуть.'}</div>`) +
    (html ? '<p class="hint swipe-hint">На телефоне: смахните строку вправо — «Сделано», влево — «На завтра».</p>' : '');
}

function boardView(list) {
  const cols = columns().filter((c) => ui.archive || c.kind === 'active');
  const hidden = columns().length - cols.length;
  return `<div class="board" id="board">${cols.map((c) => {
      const items = list.filter((r) => effectiveStatus(r.status) === c.key).sort((a, b) => a.position - b.position);
      return `<section class="col${c.kind !== 'active' ? ' archived' : ''}" data-status="${esc(c.key)}">
        <h3><span class="col-name">${esc(c.label)}</span><span class="col-count">${items.length}</span>
          <button class="col-menu" data-colmenu="${c.id}" type="button" aria-label="Настроить колонку «${esc(c.label)}»">⋯</button></h3>
        <div class="col-body">${items.map((r) => requestCard(r)).join('') || '<div class="col-empty">Пусто</div>'}</div>
      </section>`;
    }).join('')}
    <button class="col-add" id="colAdd" type="button"><span>＋</span>Новая колонка</button></div>
    <p class="hint board-hint">Карточки перетаскиваются между колонками (на телефоне — нажмите и подержите). Колонки настраиваются кнопкой ⋯ в заголовке.${hidden && !ui.archive ? ` Скрыто колонок: ${hidden} — «Показать архив».` : ''}</p>`;
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
      'Рабочие колонки видны на экране «Сегодня». Колонки «Выполнено» и «Архив» скрыты, пока не нажат «Показать архив».') +
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

function view(app) {
  const q = ui.q.trim().toLowerCase();
  const list = state.requests.filter((r) => !q ||
    [r.summary, clientName(r.client_id), r.original_message, r.category].join(' ').toLowerCase().includes(q));
  const open = state.requests.filter((r) => !isClosed(r.status)).length;
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
  app.querySelectorAll('[data-done]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); markDone(b.dataset.done, b); });
  if (!board) app.querySelectorAll('.trow-wrap').forEach(enableSwipe);
}

// «Сделано»: статус «Выполнено», строка уходит, в уведомлении можно отменить
async function markDone(id, btn) {
  const r = byId('requests', id);
  if (!r) return;
  const before = r.status;
  const done = doneKey();
  if (!done) { toast('Нет колонки типа «Выполнено». Создайте её на доске.', 'err'); return; }
  btn.classList.add('checked');
  btn.closest('.trow-wrap')?.classList.add('leaving');
  await new Promise((ok) => setTimeout(ok, 280));
  try {
    await save('requests', id, { status: done });
    toast(`Выполнено: ${r.summary}`, '', { label: 'Отменить', fn: async () => {
      try { await save('requests', id, { status: before }); toast('Вернул в работу'); }
      catch (err) { toast('Не удалось отменить: ' + (err.message || err), 'err'); }
    } });
  } catch (err) {
    render();
    toast('Не удалось отметить: ' + (err.message || err), 'err');
  }
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
    if (status !== before.status) toast(`«${r.summary}» → ${statusLabel(status)}`);
  } catch (err) {
    Object.assign(r, before); render();
    toast('Не удалось переместить: ' + (err.message || err), 'err');
  }
}

export { editRequest };

// ---------- «На завтра» ----------
async function postpone(id) {
  const r = byId('requests', id);
  if (!r) return;
  const before = r.deadline;
  let next;
  if (r.deadline) next = new Date(+new Date(r.deadline) + 864e5).toISOString();
  else next = fromParisInput(parisDay(new Date(Date.now() + 864e5)) + 'T10:00');
  try {
    await save('requests', id, { deadline: next });
    toast(`На завтра: ${r.summary}`, '', { label: 'Отменить', fn: () => save('requests', id, { deadline: before }) });
  } catch (err) { render(); toast('Не удалось перенести: ' + (err.message || err), 'err'); }
}

// ---------- свайп строки пальцем ----------
function enableSwipe(wrap) {
  const fg = wrap.querySelector('.swipe-fg');
  const id = wrap.dataset.row;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const sx = e.clientX, sy = e.clientY;
    let dx = 0, mode = null; // null → ещё не решили, 'x' → свайп, 'y' → прокрутка
    const W = wrap.offsetWidth, LIMIT = Math.min(110, W * 0.3);
    const move = (ev) => {
      const ddx = ev.clientX - sx, ddy = ev.clientY - sy;
      if (!mode) {
        if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
        mode = Math.abs(ddx) > Math.abs(ddy) * 1.3 ? 'x' : 'y';
        if (mode === 'x') { wrap.classList.add('swiping'); dragActive = true; }
      }
      if (mode !== 'x') return;
      dx = ddx;
      fg.style.transform = `translateX(${dx}px)`;
      wrap.classList.toggle('arm-done', dx > LIMIT);
      wrap.classList.toggle('arm-later', dx < -LIMIT);
      wrap.classList.toggle('dir-right', dx > 0);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      dragActive = false;
      if (mode !== 'x') return;
      suppressClick = true; setTimeout(() => { suppressClick = false; }, 60);
      wrap.classList.remove('swiping');
      if (dx > LIMIT) {
        fg.style.transform = `translateX(${W}px)`;
        markDone(id, wrap.querySelector('.done-btn'));
      } else if (dx < -LIMIT) {
        fg.style.transform = `translateX(${-W}px)`;
        wrap.classList.add('leaving');
        setTimeout(() => postpone(id), 250);
      } else {
        fg.style.transform = '';
        wrap.classList.remove('arm-done', 'arm-later');
      }
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

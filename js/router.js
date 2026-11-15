// Состояние экрана и перерисовка текущего раздела
let savedView = 'today';
try { savedView = localStorage.getItem('reqView') || 'today'; } catch {}
export const ui = { tab: 'requests', reqView: savedView, client: null, archive: false, q: '', ptype: '', pcity: '' };
const views = {};
export const registerView = (name, fn) => { views[name] = fn; };

export function render() {
  const app = document.getElementById('app');
  if (!app) return;
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
  const add = document.getElementById('addBtn');
  if (add) {
    const label = { requests: 'Новый запрос', clients: 'Новый клиент', trips: 'Новая поездка', partners: 'Новый партнёр' }[ui.tab];
    add.innerHTML = `<span class="plus" aria-hidden="true">＋</span><span class="add-text">${label}</span>`;
    add.setAttribute('aria-label', label);
  }
  // не теряем фокус и курсор в поле поиска при перерисовке
  const active = document.activeElement;
  const keepId = active && app.contains(active) && active.id ? active.id : null;
  const caret = keepId && active.selectionStart != null ? active.selectionStart : null;
  const scroll = app.querySelector('.board')?.scrollLeft;
  views[ui.tab]?.(app);
  // плавное появление — только при смене раздела или вида, не при каждом обновлении
  const key = ui.tab + '|' + ui.reqView + '|' + (ui.tab === 'clients' ? ui.client : '') + '|' + (ui.reqView === 'calendar' ? (ui.calMode || '') + (ui.calDate || '') : '');
  if (key !== lastKey) {
    lastKey = key;
    app.classList.remove('enter'); void app.offsetWidth; app.classList.add('enter');
    app.querySelectorAll('.hero, .sg, .db, .wc, .tgroup, .trow-wrap, .card-wrap, .row, .pcard, .panel, .trip, .ev, .ag-day, .mg-cell').forEach((el, i) => el.style.setProperty('--i', Math.min(i, 14)));
    clearTimeout(enterTimer); enterTimer = setTimeout(() => app.classList.remove('enter'), 900);
    countUp(app);
  }
  updateGliders();
  if (scroll != null) { const b = app.querySelector('.board'); if (b) b.scrollLeft = scroll; }
  if (keepId) {
    const el = document.getElementById(keepId);
    if (el) { el.focus(); if (caret != null) try { el.setSelectionRange(caret, caret); } catch {} }
  }
}

let lastKey = '', enterTimer;

// скользящая подложка под выбранной вкладкой
const lastSel = {};
export function updateGliders() {
  document.querySelectorAll('.tabs, .seg').forEach((bar) => {
    let g = bar.querySelector(':scope > .glider');
    const fresh = !g;
    if (fresh) { g = document.createElement('span'); g.className = 'glider'; bar.prepend(g); }
    const sel = bar.querySelector('[aria-selected="true"]');
    if (!sel) { g.style.opacity = 0; return; }
    const type = bar.getAttribute('aria-label') || (bar.classList.contains('seg') ? 'seg' : 'tabs');
    const key = sel.dataset.tab || sel.dataset.view || sel.dataset.calmode || '';
    const prev = lastSel[type];
    lastSel[type] = key;
    const place = (el) => {
      g.style.width = el.offsetWidth + 'px';
      g.style.height = el.offsetHeight + 'px';
      g.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)`;
    };
    const jump = (el) => { g.style.transition = 'none'; place(el); void g.offsetWidth; g.style.transition = ''; };
    g.style.opacity = 1;
    if (prev === key) { jump(sel); return; } // тот же выбор — просто стоим на месте
    // выбор сменился: едем от прежней кнопки к новой (даже если переключатель нарисован заново)
    const old = prev && bar.querySelector(`[data-tab="${prev}"], [data-view="${prev}"], [data-calmode="${prev}"]`);
    if (fresh && old) jump(old);
    else if (fresh) { jump(sel); return; }
    requestAnimationFrame(() => place(sel));
  });
}
addEventListener('resize', updateGliders);

// цифры сводки «набегают»
function countUp(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll('[data-count]').forEach((el) => {
    const to = +el.dataset.count; if (!to) return;
    const t0 = performance.now(), dur = 600;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    el.textContent = '0'; requestAnimationFrame(step);
  });
}

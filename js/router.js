// Состояние экрана и перерисовка текущего раздела
export const ui = { tab: 'requests', client: null, archive: false, q: '', ptype: '', pcity: '' };
const views = {};
export const registerView = (name, fn) => { views[name] = fn; };

export function render() {
  const app = document.getElementById('app');
  if (!app) return;
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
  const add = document.getElementById('addBtn');
  if (add) add.textContent = { requests: '+ Новый запрос', clients: '+ Новый клиент', partners: '+ Новый партнёр' }[ui.tab];
  // не теряем фокус и курсор в поле поиска при перерисовке
  const active = document.activeElement;
  const keepId = active && app.contains(active) && active.id ? active.id : null;
  const caret = keepId && active.selectionStart != null ? active.selectionStart : null;
  const scroll = app.querySelector('.board')?.scrollLeft;
  views[ui.tab]?.(app);
  if (scroll != null) { const b = app.querySelector('.board'); if (b) b.scrollLeft = scroll; }
  if (keepId) {
    const el = document.getElementById(keepId);
    if (el) { el.focus(); if (caret != null) try { el.setSelectionRange(caret, caret); } catch {} }
  }
}

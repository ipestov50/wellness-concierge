// «🗄 Архив»: выполненные и закрытые запросы, убранные с доски. Сгруппированы по гостям —
// это история броней, партнёров и предпочтений каждого гостя. Любой запрос можно вернуть на доску.
import { CATEGORIES, TZ } from '../const.js';
import { esc, avatar, fmtMoney } from '../ui.js';
import { state, byId } from '../data.js';
import { statusLabel } from '../statuses.js';
import { unarchiveRequests } from '../actions.js';

const fmtDay = (iso) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const plural = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'запрос' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'запроса' : 'запросов');
const when = (r) => Date.parse(r.deadline || r.archived_at);

export function archiveView(list) {
  const items = list.filter((r) => r.archived_at);
  const total = state.requests.filter((r) => r.archived_at).length;
  if (!total) {
    return `<section class="arc"><div class="empty calm">🗄 Архив пока пуст.<br><small>На доске в колонках «Выполнено», «Отложен», «Отменён» есть кнопка «🗄 В архив» — карточки уйдут сюда, доска освободится, а история гостя сохранится.</small></div></section>`;
  }
  // группы по гостю: сначала те, у кого последнее событие свежее
  const groups = new Map();
  for (const r of items) {
    const k = r.client_id || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const sorted = [...groups.entries()]
    .map(([k, rs]) => [k, rs.sort((a, b) => when(b) - when(a))])
    .sort((a, b) => when(b[1][0]) - when(a[1][0]));
  return `<section class="arc">
    <header class="arc-head"><h2>🗄 Архив</h2><span class="muted">${items.length}${items.length !== total ? ` из ${total}` : ''} ${plural(items.length)} · гостей: ${sorted.filter(([k]) => k).length}</span></header>
    ${items.length ? sorted.map(([cid, rs]) => {
      const c = byId('clients', cid);
      const cats = [...new Set(rs.map((r) => r.category))].map((k) => CATEGORIES[k] || '📌').join(' ');
      return `<details class="arc-g" open>
        <summary>${c ? avatar(c, 'av-xs') : ''}<b>${esc(c?.name || 'Без гостя')}</b>${c?.vip ? ' <span class="vip">★</span>' : ''}<span class="muted">${rs.length} · ${cats}</span>
          ${c ? `<button type="button" class="link" data-cl-open="${esc(c.id)}">профиль</button>` : ''}</summary>
        <div class="arc-list">${rs.map((r) => {
          const p = byId('partners', r.partner_id);
          return `<div class="arc-i">
            <button type="button" class="arc-main" data-req="${esc(r.id)}">
              <span class="arc-date">${esc(fmtDay(r.deadline || r.archived_at))}</span>
              <span class="arc-t">${CATEGORIES[r.category] || '📌'} ${esc(r.summary)}</span>
              <span class="arc-meta">${esc(statusLabel(r.status))}${p ? ` · ${esc(p.name)}` : ''}${r.budget_amount != null ? ` · ${esc(fmtMoney(r.budget_amount, r.currency))}` : ''}</span>
            </button>
            <button type="button" class="btn small ghostish" data-unarchive="${esc(r.id)}" title="Вернуть карточку на доску">↩ На доску</button>
          </div>`; }).join('')}</div>
      </details>`; }).join('') : '<div class="empty">По этому поиску в архиве ничего нет.</div>'}
  </section>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-unarchive]');
  if (!b) return;
  e.stopPropagation();
  b.disabled = true;
  unarchiveRequests([b.dataset.unarchive]).catch(() => { b.disabled = false; });
});

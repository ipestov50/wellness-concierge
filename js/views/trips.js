// «Кто где»: гости в поездках сейчас, прилёты на неделе, ближайшие поездки
import { esc } from '../ui.js';
import { state } from '../data.js';
import { ui, registerView } from '../router.js';
import { tripState, tripCard, parisToday, editTrip } from '../dossier.js';

function view(app) {
  const today = parisToday();
  const q = ui.q.trim().toLowerCase();
  const name = (t) => state.clients.find((c) => c.id === t.client_id)?.name || '';
  const list = state.trips.filter((t) => !q || [t.city, t.country, t.hotel, name(t)].join(' ').toLowerCase().includes(q));
  const withState = list.map((t) => ({ t, s: tripState(t, today) }));
  const now = withState.filter((x) => x.s.kind === 'now').sort((a, b) => (a.t.end_date || '').localeCompare(b.t.end_date || ''));
  const week = withState.filter((x) => x.s.kind === 'soon' && x.s.days <= 7).sort((a, b) => a.t.start_date.localeCompare(b.t.start_date));
  const later = withState.filter((x) => x.s.kind === 'soon' && x.s.days > 7 && x.s.days <= 90).sort((a, b) => a.t.start_date.localeCompare(b.t.start_date));
  const nodate = withState.filter((x) => x.s.kind === 'unknown');
  // города, где сейчас гости, — для шапки
  const cities = [...new Set(now.map((x) => x.t.city))];
  const sec = (title, cls, items, hint) => items.length ? `<section class="tgroup ${cls}"><h3>${title}<span>${items.length}</span></h3>
      <div class="trip-list">${items.map((x) => tripCard(x.t, { showGuest: true })).join('')}</div>${hint ? `<p class="hint">${hint}</p>` : ''}</section>` : '';
  const body = sec('Сейчас в поездке', 'g-today', now) + sec('Прилетают на этой неделе', 'g-week', week) + sec('Скоро · до 3 месяцев', 'g-later', later) + sec('Даты не указаны', 'g-none', nodate);
  app.innerHTML = `<div class="stack">
    <section class="hero hero-trips">
      <div class="hero-hello"><h2>Кто где</h2><span>${now.length ? `Сейчас в поездке: ${esc(cities.join(', '))}` : 'Сейчас никто не в поездке'}</span></div>
      <div class="hero-stats">
        <div class="stat s-today"><b>${now.length}</b><span>в поездке</span></div>
        <div class="stat"><b>${week.length}</b><span>прилетают</span></div>
        <div class="stat"><b>${later.length}</b><span>скоро</span></div>
      </div>
    </section>
    <div class="bar toolbar"><div class="grow search"><input type="search" id="q" placeholder="Поиск по гостям, городам, отелям" value="${esc(ui.q)}" autocomplete="off"></div></div>
    ${body || `<div class="empty calm">${q ? 'Ничего не нашлось.' : 'Поездок пока нет. Добавьте первую кнопкой «＋» или в профиле гостя.'}</div>`}
  </div>`;
  app.querySelectorAll('[data-trip]').forEach((b) => b.addEventListener('click', () => editTrip(b.dataset.trip)));
}
registerView('trips', view);

import { PARTNER_TYPES, PARTNER_TYPE_LABEL } from '../const.js';
import { esc, options } from '../ui.js';
import { state } from '../data.js';
import { ui, registerView } from '../router.js';

function view(app) {
  const q = ui.q.trim().toLowerCase();
  const cities = [...new Set(state.partners.map((p) => p.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const list = state.partners
    .filter((p) => (!ui.ptype || p.type === ui.ptype) && (!ui.pcity || p.city === ui.pcity) &&
      (!q || [p.name, p.city, p.contact, p.notes, p.terms].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name, 'ru'));
  app.innerHTML = `
    <div class="bar">
      <div class="grow"><input type="search" id="q" placeholder="Поиск по партнёрам" value="${esc(ui.q)}" autocomplete="off"></div>
      <div class="sel"><select id="ptype" aria-label="Тип">${options(PARTNER_TYPES, ui.ptype, 'Все типы')}</select></div>
      <div class="sel"><select id="pcity" aria-label="Город">${options(cities, ui.pcity, 'Все города')}</select></div>
    </div>
    <div class="pgrid">${list.map((p) => `
      <article class="pcard">
        <div class="t">${esc(PARTNER_TYPE_LABEL[p.type] || '')}${p.city ? ' · ' + esc(p.city) : ''}</div>
        <h3>${esc(p.name)}</h3>
        ${p.rating ? `<div class="stars" aria-label="Оценка ${p.rating} из 5">${'★'.repeat(p.rating)}<span>${'★'.repeat(5 - p.rating)}</span></div>` : ''}
        ${p.contact ? `<p>${esc(p.contact)}</p>` : ''}
        ${p.terms || p.commission ? `<p><b>Условия:</b> ${esc([p.terms, p.commission && 'комиссия ' + p.commission].filter(Boolean).join(' · '))}</p>` : ''}
        ${p.notes ? `<p>${esc(p.notes)}</p>` : ''}
        <div class="actions"><button class="btn small" data-editp="${p.id}" type="button">Редактировать</button></div>
      </article>`).join('') || `<div class="empty">${state.partners.length ? 'Ничего не нашлось.' : 'Партнёров пока нет.'}</div>`}</div>`;
}
registerView('partners', view);

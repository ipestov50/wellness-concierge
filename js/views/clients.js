import { ARCHIVE } from '../const.js';
import { esc, fmtDate, avatar } from '../ui.js';
import { state, byId } from '../data.js';
import { ui, render, registerView } from '../router.js';
import { restrictionsBlock } from '../forms.js';
import { requestCard } from './requests.js';

const mobile = () => matchMedia('(max-width: 760px)').matches;

// Кнопки связи: позвонить, WhatsApp, написать, Telegram
function contacts(c) {
  const digits = (c.phone || '').replace(/[^\d+]/g, '');
  const tg = (c.telegram || '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '');
  const items = [];
  if (digits) {
    items.push(`<a class="contact" href="tel:${esc(digits)}"><span>📞</span><b>${esc(c.phone)}</b></a>`);
    items.push(`<a class="contact" href="https://wa.me/${esc(digits.replace('+', ''))}" target="_blank" rel="noopener"><span>💬</span><b>WhatsApp</b></a>`);
  }
  if (c.email) items.push(`<a class="contact" href="mailto:${esc(c.email)}"><span>✉️</span><b>${esc(c.email)}</b></a>`);
  if (tg) items.push(`<a class="contact" href="https://t.me/${esc(tg)}" target="_blank" rel="noopener"><span>✈️</span><b>@${esc(tg)}</b></a>`);
  return items.length ? `<div class="contacts">${items.join('')}</div>`
    : `<div class="contacts"><button class="contact add" data-editcl="${c.id}" type="button"><span>＋</span><b>Добавить телефон или почту</b></button></div>`;
}

function profile(c) {
  if (!c) return '<div class="empty">Выберите клиента слева или добавьте нового.</div>';
  const reqs = state.requests.filter((r) => r.client_id === c.id)
    .sort((a, b) => (ARCHIVE.includes(a.status) - ARCHIVE.includes(b.status)) || b.created_at.localeCompare(a.created_at));
  const prefs = [['Еда', c.pref_food], ['Спа', c.pref_spa], ['Транспорт', c.pref_transport], ['Отели', c.pref_hotels]];
  const trips = (c.travel_history || []).map((t) => { const [place, when, ...note] = t.split('|').map((s) => s.trim()); return { place, when, note: note.join(' | ') }; });
  return `<div class="panel">
    ${mobile() ? '<button class="btn small back" id="back" type="button">← Все клиенты</button>' : ''}
    <div class="phead">${avatar(c, 'av-lg')}<div><h2>${esc(c.name)}${c.vip ? ' <span class="vip">★</span>' : ''}</h2>
    <div class="sub">${[c.language, c.city].filter(Boolean).map(esc).join(' · ')}${c.last_contact ? ` · последний контакт ${esc(fmtDate(c.last_contact))}` : ''}</div></div></div>
    ${contacts(c)}
    ${restrictionsBlock(c)}
    <div class="grid2">${prefs.map(([t, v]) => `<div class="blk"><h4>${t}</h4><p>${v ? esc(v) : '<span class="muted">—</span>'}</p></div>`).join('')}</div>
    <div class="blk sect"><h4>История поездок</h4>${trips.length ? `<ul class="trips">${trips.map((t) =>
      `<li><b>${esc(t.place)}</b> <small>${esc(t.when || '')}</small>${t.note ? `<div>${esc(t.note)}</div>` : ''}</li>`).join('')}</ul>` : '<p class="muted">—</p>'}</div>
    <div class="blk sect"><h4>Заметки консьержа</h4><p>${c.concierge_notes ? esc(c.concierge_notes) : '<span class="muted">—</span>'}</p></div>
    <div class="blk sect"><h4>Запросы клиента · ${reqs.length}</h4>${reqs.length ? `<div class="req-list">${reqs.map((r) => requestCard(r, { showClient: false })).join('')}</div>` : '<p class="muted">Запросов пока нет.</p>'}</div>
    <div class="actions">
      <button class="btn small primary" data-newreq="${c.id}" type="button">+ Запрос для клиента</button>
      <button class="btn small" data-editcl="${c.id}" type="button">Редактировать</button>
    </div>
  </div>`;
}

function view(app) {
  const q = ui.q.trim().toLowerCase();
  const list = state.clients
    .filter((c) => !q || [c.name, c.telegram, c.city, c.phone, c.email].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (b.vip - a.vip) || a.name.localeCompare(b.name, 'ru'));
  if (ui.client && !byId('clients', ui.client)) ui.client = null;
  if (!ui.client && !mobile() && list.length) ui.client = list[0].id;
  const showList = !mobile() || !ui.client;
  const showProfile = !mobile() || ui.client;
  app.innerHTML = `<div class="split">
    ${showList ? `<div>
      <div class="bar"><div class="grow"><input type="search" id="q" placeholder="Найти клиента" value="${esc(ui.q)}" autocomplete="off"></div></div>
      <div class="list">${list.map((c) => {
        const n = state.requests.filter((r) => r.client_id === c.id && !ARCHIVE.includes(r.status)).length;
        const warn = c.allergies?.length || c.diet?.length || c.health?.length;
        return `<button class="row" data-cl="${c.id}" aria-current="${ui.client === c.id}" type="button">${avatar(c)}<span class="row-txt">
          <b>${c.vip ? '<span class="vip">★</span> ' : ''}${esc(c.name)}${warn ? ' <span class="warn-dot" title="Есть ограничения">⚠</span>' : ''}</b>
          <span>${[c.language, c.city].filter(Boolean).map(esc).join(' · ')}${n ? ` · открытых: ${n}` : ''}</span></span></button>`;
      }).join('') || `<div class="empty">${q ? 'Никого не нашлось.' : 'Клиентов пока нет.'}</div>`}</div>
    </div>` : ''}
    ${showProfile ? `<div>${profile(byId('clients', ui.client))}</div>` : ''}
  </div>`;
  app.querySelector('#back')?.addEventListener('click', () => { ui.client = null; render(); scrollTo(0, 0); });
}
registerView('clients', view);

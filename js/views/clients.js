import { esc, fmtDate, avatar } from '../ui.js';
import { state, byId } from '../data.js';
import { ui, render, registerView } from '../router.js';
import { restrictionsBlock } from '../forms.js';
import { isClosed } from '../statuses.js';
import { birthdayLine, birthdayInfo } from '../birthday.js';
import { requestCard } from './requests.js';
import { clientSuggestions } from '../suggest.js';
import { guestClock, flag } from '../tz.js';
import { tripState, tripCard, fmtRange, parisToday, upcomingDates, chipEditor, bindChipEditors, personCard, editTrip, editPerson, editDate } from '../dossier.js';

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

// ---------- профиль: шапка всегда на виду, подробности — во вкладках ----------
const CTABS = [['overview', 'Обзор'], ['trips', 'Поездки'], ['people', 'Окружение'], ['dates', 'Даты'], ['requests', 'Запросы']];

function teaser(c) {
  const today = parisToday();
  const trip = state.trips.filter((t) => t.client_id === c.id && ['now', 'soon'].includes(tripState(t, today).kind))
    .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))[0];
  const date = upcomingDates(c).find((d) => d.info.days <= 30);
  if (!trip && !date) return '';
  return `<div class="teaser">
    ${trip ? `<button type="button" class="tz" data-trip="${trip.id}"><span>✈️</span><span><b>${esc(trip.city)}</b><small>${esc(fmtRange(trip))} · ${esc(tripState(trip, today).label)}</small></span></button>` : ''}
    ${date ? `<button type="button" class="tz" data-ctab-go="dates"><span>${date.kind === 'date' ? '📅' : '🎂'}</span><span><b>${esc(date.title)}${date.kind === 'person' ? ' · ' + esc(date.who.split(' · ')[0]) : ''}</b><small>${esc(date.info.text)} · ${date.info.days === 0 ? 'сегодня' : `через ${date.info.days} дн.`}</small></span></button>` : ''}
  </div>`;
}

function tabOverview(c) {
  const prefs = [['🍽', 'Еда', c.pref_food], ['💆', 'Спа', c.pref_spa], ['🚗', 'Транспорт', c.pref_transport], ['🏨', 'Отели', c.pref_hotels]].filter(([, , v]) => v);
  return `${clientSuggestions(c.id)}${teaser(c)}
    <section class="psec">
      ${chipEditor(c, 'likes', { title: 'Любит', cls: 'likes', placeholder: 'пионы, столик у окна…' })}
      ${chipEditor(c, 'dislikes', { title: 'Избегает', cls: 'dislikes', placeholder: 'лилии, шумные места…' })}
    </section>
    <section class="psec"><h4>Предпочтения</h4>
      ${prefs.length ? `<div class="prefs">${prefs.map(([i, t, v]) => `<div class="pref"><span>${i}</span><div><small>${t}</small><p>${esc(v)}</p></div></div>`).join('')}</div>`
        : `<button type="button" class="link-add" data-editcl="${c.id}">＋ Добавить предпочтения</button>`}
    </section>
    ${c.travel_habits || (c.loyalty || []).length ? `<section class="psec"><h4>В пути</h4>
      ${c.travel_habits ? `<p class="ptext">${esc(c.travel_habits)}</p>` : ''}
      ${(c.loyalty || []).length ? `<div class="loyal">${c.loyalty.map((l) => `<span class="loyal-chip">✦ ${esc(l)}</span>`).join('')}</div>` : ''}
    </section>` : ''}
    ${c.concierge_notes ? `<section class="psec"><h4>Заметки консьержа</h4><p class="ptext">${esc(c.concierge_notes)}</p></section>` : ''}`;
}

function tabTrips(c) {
  const today = parisToday();
  const list = state.trips.filter((t) => t.client_id === c.id);
  const ahead = list.filter((t) => tripState(t, today).kind !== 'past').sort((a, b) => (a.start_date || '9').localeCompare(b.start_date || '9'));
  const past = list.filter((t) => tripState(t, today).kind === 'past').sort((a, b) => b.start_date.localeCompare(a.start_date));
  const legacy = (c.travel_history || []).map((t) => { const [place, when, ...note] = t.split('|').map((x) => x.trim()); return { place, when, note: note.join(' | ') }; });
  return `<div class="tab-head"><span>${ahead.length ? 'Впереди' : 'Поездок впереди нет'}</span><button type="button" class="btn small" data-add-trip="${c.id}">＋ Поездка</button></div>
    ${ahead.length ? `<div class="trip-list">${ahead.map((t) => tripCard(t)).join('')}</div>` : ''}
    ${past.length ? `<details class="past" ${ahead.length ? '' : 'open'}><summary>Прошедшие · ${past.length}</summary><div class="trip-list">${past.map((t) => tripCard(t)).join('')}</div></details>` : ''}
    ${legacy.length ? `<details class="past"><summary>Заметки о прошлых поездках · ${legacy.length}</summary><ul class="trips">${legacy.map((t) =>
      `<li><b>${esc(t.place)}</b> <small>${esc(t.when || '')}</small>${t.note ? `<div>${esc(t.note)}</div>` : ''}</li>`).join('')}</ul></details>` : ''}`;
}

function tabPeople(c) {
  const list = state.people.filter((p) => p.client_id === c.id).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return `<div class="tab-head"><span>${list.length ? 'Семья и помощники' : 'Пока никого'}</span><button type="button" class="btn small" data-add-person="${c.id}">＋ Человек</button></div>
    ${list.length ? `<div class="people">${list.map(personCard).join('')}</div>` : '<p class="muted tab-empty">Супруг, дети, ассистент, водитель — с телефонами, днями рождения и аллергиями.</p>'}`;
}

function tabDates(c) {
  const list = upcomingDates(c);
  return `<div class="tab-head"><span>${list.length ? 'Ближайшие сначала' : 'Дат пока нет'}</span><button type="button" class="btn small" data-add-date="${c.id}">＋ Дата</button></div>
    ${list.length ? `<div class="dates">${list.map((d) => `<button type="button" class="drow${d.info.days <= 7 ? ' soon' : ''}" ${d.kind === 'date' ? `data-date-edit="${d.ref}"` : d.kind === 'person' ? `data-person="${d.ref}"` : `data-editcl="${c.id}"`}>
        <span class="drow-ico">${d.kind === 'date' ? '📅' : '🎂'}</span>
        <span class="drow-main"><b>${esc(d.title)}</b><small>${esc(d.kind === 'bday' ? c.name : d.who)}</small></span>
        <span class="drow-when"><b>${esc(d.info.text.replace(/ \d{4}$/, ''))}</b><small>${d.info.days === 0 ? 'сегодня' : d.info.days === 1 ? 'завтра' : `через ${d.info.days} дн.`}${d.info.turning && d.kind !== 'date' ? ` · исполнится ${d.info.turning}` : d.info.turning && d.kind === 'date' ? ` · ${d.info.turning}-я` : ''}</small></span>
      </button>`).join('')}</div>` : '<p class="muted tab-empty">Годовщины, именины, памятные даты. Дни рождения гостя и близких появятся здесь сами.</p>'}`;
}

function tabRequests(c, reqs) {
  return `<div class="tab-head"><span>${reqs.length ? 'Сначала открытые' : 'Запросов пока нет'}</span><button type="button" class="btn small" data-newreq="${c.id}">＋ Запрос</button></div>
    ${reqs.length ? `<div class="req-list">${reqs.map((r) => requestCard(r, { showClient: false })).join('')}</div>` : ''}`;
}

function profile(c) {
  if (!c) return '<div class="empty">Выберите клиента слева или добавьте нового.</div>';
  const reqs = state.requests.filter((r) => r.client_id === c.id)
    .sort((a, b) => (isClosed(a.status) - isClosed(b.status)) || b.created_at.localeCompare(a.created_at));
  const counts = {
    trips: state.trips.filter((t) => t.client_id === c.id && tripState(t).kind !== 'past').length,
    people: state.people.filter((p) => p.client_id === c.id).length,
    dates: upcomingDates(c).filter((d) => d.info.days <= 30).length,
    requests: reqs.filter((r) => !isClosed(r.status)).length,
  };
  const tab = CTABS.some(([k]) => k === ui.ctab) ? ui.ctab : 'overview';
  const body = { overview: () => tabOverview(c), trips: () => tabTrips(c), people: () => tabPeople(c), dates: () => tabDates(c), requests: () => tabRequests(c, reqs) }[tab]();
  return `<div class="panel profile">
    ${mobile() ? '<button class="btn small back" id="back" type="button">← Все клиенты</button>' : ''}
    <div class="phead">${avatar(c, 'av-lg')}<div class="phead-txt"><h2>${esc(c.name)}${c.vip ? ' <span class="vip">★</span>' : ''}</h2>
      <div class="sub">${[c.language, c.city].filter(Boolean).map(esc).join(' · ')}${c.last_contact ? ` · контакт ${esc(fmtDate(c.last_contact))}` : ''}</div></div>
      <button class="icon-btn edit-btn" data-editcl="${c.id}" type="button" aria-label="Редактировать профиль" title="Редактировать">✎</button></div>
    ${guestClock(c)}
    ${birthdayLine(c.birthday)}
    ${contacts(c)}
    ${restrictionsBlock(c)}
    <nav class="ptabs" role="tablist">${CTABS.map(([k, l]) =>
      `<button type="button" role="tab" data-ctab="${k}" aria-selected="${k === tab}">${l}${counts[k] ? `<span class="pcount">${counts[k]}</span>` : ''}</button>`).join('')}</nav>
    <div class="ptab-body" role="tabpanel">${body}</div>
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
        const n = state.requests.filter((r) => r.client_id === c.id && !isClosed(r.status)).length;
        const warn = c.allergies?.length || c.diet?.length || c.health?.length;
        return `<button class="row" data-cl="${c.id}" aria-current="${ui.client === c.id}" type="button">${avatar(c)}<span class="row-txt">
          <b>${c.vip ? '<span class="vip">★</span> ' : ''}${esc(c.name)}${warn ? ' <span class="warn-dot" title="Есть ограничения">⚠</span>' : ''}${(birthdayInfo(c.birthday)?.days ?? 99) <= 7 ? ' <span title="Скоро день рождения">🎂</span>' : ''}</b>
          <span>${[c.language, c.city].filter(Boolean).map(esc).join(' · ')}${n ? ` · открытых: ${n}` : ''}</span></span></button>`;
      }).join('') || `<div class="empty">${q ? 'Никого не нашлось.' : 'Клиентов пока нет.'}</div>`}</div>
    </div>` : ''}
    ${showProfile ? `<div>${profile(byId('clients', ui.client))}</div>` : ''}
  </div>`;
  app.querySelector('#back')?.addEventListener('click', () => { ui.client = null; render(); scrollTo(0, 0); });
  bindChipEditors(app);
  app.querySelectorAll('[data-ctab],[data-ctab-go]').forEach((b) => b.addEventListener('click', () => { ui.ctab = b.dataset.ctab || b.dataset.ctabGo; render(); }));
  app.querySelectorAll('[data-trip]').forEach((b) => b.addEventListener('click', () => editTrip(b.dataset.trip)));
  app.querySelectorAll('[data-person]').forEach((b) => b.addEventListener('click', () => editPerson(b.dataset.person)));
  app.querySelectorAll('[data-date-edit]').forEach((b) => b.addEventListener('click', () => editDate(b.dataset.dateEdit)));
  app.querySelector('[data-add-trip]')?.addEventListener('click', (e) => editTrip(null, e.currentTarget.dataset.addTrip));
  app.querySelector('[data-add-person]')?.addEventListener('click', (e) => editPerson(null, e.currentTarget.dataset.addPerson));
  app.querySelector('[data-add-date]')?.addEventListener('click', (e) => editDate(null, e.currentTarget.dataset.addDate));
}
registerView('clients', view);

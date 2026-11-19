import { esc, avatar, toast } from '../ui.js';
import { state, byId } from '../data.js';
import { ui, render, registerView } from '../router.js';
import { isClosed } from '../statuses.js';
import { birthdayInfo } from '../birthday.js';
import { requestCard } from './requests.js';
import { clientSuggestions } from '../suggest.js';
import { guestClock, guestWhere, timeIn, diffHours, fmtDiff, isQuiet } from '../tz.js';
import { editClient } from '../lazy.js';
import { hydrateStories, ringClass } from '../stories.js';
import { tripState, tripCard, fmtRange, parisToday, upcomingDates, chipEditor, bindChipEditors, personCard, editTrip, editPerson, editDate } from '../dossier.js';

const mobile = () => matchMedia('(max-width: 760px)').matches;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c; };
const SPRING = CSS.supports?.('animation-timing-function', 'linear(0, 1)')
  ? 'linear(0, .06 2%, .23 5%, .5 9.5%, .77 15%, .93 21%, 1.01 28%, 1.03 34%, 1.015 44%, 1 60%, 1)'
  : 'cubic-bezier(.22, 1, .36, 1)';

try { ui.clMask = localStorage.getItem('clMask') === '1'; } catch { ui.clMask = false; }
ui.cfilter = ui.cfilter || 'all';

// маска фамилий: «Иван Петров» → «Иван П.»
function nm(c) {
  const name = c.name || '';
  if (!ui.clMask) return esc(name);
  const parts = name.replace(/\s*\(.*?\)/g, '').trim().split(/\s+/);
  return esc(parts.length > 1 ? `${parts[0]} ${parts.slice(1).map((p) => p[0] + '.').join(' ')}` : parts[0] || '');
}
const firstName = (c) => (c.name || '').replace(/\s*\(.*?\)/g, '').split(/\s+/)[0] || 'гостя';
const risks = (c) => [['Аллергии', c.allergies], ['Диета', c.diet], ['Здоровье', c.health]].filter(([, l]) => l && l.length);
const openReqs = (c) => state.requests.filter((r) => r.client_id === c.id && !isClosed(r.status)).length;

function nextTrip(c, today = parisToday()) {
  return state.trips.filter((t) => t.client_id === c.id && ['now', 'soon'].includes(tripState(t, today).kind))
    .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))[0] || null;
}
const tripBadge = (st) => (st.kind === 'now' ? 'сейчас там' : st.days === 0 ? 'сегодня' : st.days === 1 ? 'завтра' : `через ${st.days} ${plural(st.days, 'день', 'дня', 'дней')}`);

function prefTags(c) {
  const short = (v) => String(v || '').split(/[,;\n]/)[0].trim().slice(0, 28);
  return [c.pref_food, c.pref_transport, c.pref_hotels, c.pref_spa].map(short).concat(c.likes || []).filter(Boolean);
}

// живое время гостя: «● 14:40 Киев · +1 ч»
function clockPill(c, { long = false } = {}) {
  const w = guestWhere(c);
  if (!w) return '';
  const quiet = isQuiet(w.tz);
  const d = diffHours('Europe/Paris', w.tz);
  return `<span class="cl-clock${quiet ? ' quiet' : ''}" title="${esc(w.tz)}${quiet ? ' · ночь у гостя' : ''}"><i aria-hidden="true"></i>
    <b data-tz-clock="${esc(w.tz)}">${timeIn(w.tz)}</b> ${esc(w.place)}${d ? ` · ${fmtDiff(d)}${long ? ' к Парижу' : ''}` : ''}${long && quiet ? ' · ночь' : ''}</span>`;
}

const matches = (c, q) => !q || [c.name, c.telegram, c.city, c.phone, c.email, c.pref_hotels, c.pref_food, c.pref_transport,
  ...(c.likes || []), ...(c.allergies || []), ...(c.diet || []),
  ...state.trips.filter((t) => t.client_id === c.id).flatMap((t) => [t.city, t.hotel])].join(' ').toLowerCase().includes(q);

const FILTERS = [['all', 'Все'], ['vip', 'VIP ★'], ['soon', 'Скоро вылет'], ['attn', 'Требуют внимания']];
function passes(c, f, today) {
  if (f === 'vip') return !!c.vip;
  if (f === 'soon') { const t = nextTrip(c, today); return !!t && (tripState(t, today).kind === 'now' || tripState(t, today).days <= 14); }
  if (f === 'attn') return openReqs(c) > 0 || upcomingDates(c).some((d) => d.info.days <= 7);
  return true;
}

// ---------- подложка, которая пружиной переезжает к выбранному ----------
const inkAt = {};
function glide(box, name, { line = false } = {}) {
  if (!box) return;
  let ink = box.querySelector(':scope > .cl-ink');
  if (!ink) { ink = document.createElement('span'); ink.className = 'cl-ink'; ink.setAttribute('aria-hidden', 'true'); box.prepend(ink); }
  const sel = box.querySelector('[aria-selected="true"], [aria-current="true"]');
  if (!sel) { ink.style.opacity = 0; inkAt[name] = null; return; }
  const to = { x: sel.offsetLeft, y: line ? sel.offsetTop + sel.offsetHeight - 2 : sel.offsetTop, w: sel.offsetWidth, h: line ? 2 : sel.offsetHeight };
  const from = inkAt[name] || to;
  inkAt[name] = to;
  const frame = (p) => ({ transform: `translate(${p.x}px, ${p.y}px)`, width: p.w + 'px', height: p.h + 'px' });
  Object.assign(ink.style, frame(to), { opacity: 1 });
  if ((from.x !== to.x || from.y !== to.y || from.w !== to.w) && !reduced()) ink.animate([frame(from), frame(to)], { duration: 560, easing: SPRING });
}

// ---------- режим A: галерея ----------
function passport(c, i, today) {
  const r = risks(c);
  const t = nextTrip(c, today);
  const st = t && tripState(t, today);
  const tags = prefTags(c);
  const vt = ui.clBack === c.id ? ' style="view-transition-name: cl-av"' : '';
  return `<article class="pp" data-cl="${c.id}" tabindex="0" role="link" aria-label="Открыть досье: ${nm(c)}" style="--i:${Math.min(i, 10)}">
    <header class="pp-head">
      <span class="pp-avwrap${ringClass(c)}" data-story="${c.id}"${vt}>${avatar(c, 'pp-av')}</span>
      <div class="pp-id"><h3 class="pp-name"${ui.clBack === c.id ? ' style="view-transition-name: cl-name"' : ''}>${nm(c)}${c.vip ? ' <span class="cl-star" title="VIP">★</span>' : ''}</h3>
        <p class="pp-meta">${[c.language, c.city].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</p></div>
      ${clockPill(c)}
    </header>
    ${r.length ? `<div class="pp-risk"><span aria-hidden="true">⚠</span><span><b>Стоп-лист:</b> ${esc(r.flatMap(([, l]) => l).join(', '))}</span></div>` : ''}
    <div class="pp-pass${t ? '' : ' empty'}">
      ${t ? `<span class="pp-plane" aria-hidden="true">✈</span><span class="pp-trip"><small>${st.kind === 'now' ? 'Сейчас в поездке' : 'Ближайший рейс'}</small><b>${esc(t.city)}</b><em>${esc(fmtRange(t))}</em></span>
        <span class="pp-perf" aria-hidden="true"></span><span class="pp-count${st.kind === 'now' ? ' now' : ''}">${tripBadge(st)}</span>`
        : '<span class="pp-none">Ближайшей поездки нет</span>'}
    </div>
    ${tags.length ? `<div class="pp-tags">${tags.slice(0, 3).map((x) => `<span>${esc(x)}</span>`).join('')}${tags.length > 3 ? `<span class="more">+${tags.length - 3}</span>` : ''}</div>` : ''}
    <footer class="pp-foot"><span class="pp-open">Открыть досье</span></footer>
  </article>`;
}

function gallery() {
  const today = parisToday();
  const q = ui.q.trim().toLowerCase();
  const all = state.clients;
  const list = all.filter((c) => matches(c, q) && passes(c, ui.cfilter, today))
    .sort((a, b) => (b.vip - a.vip) || a.name.localeCompare(b.name, 'ru'));
  const away = all.filter((c) => nextTrip(c, today) && tripState(nextTrip(c, today), today).kind === 'now').length;
  const soon = all.filter((c) => { const t = nextTrip(c, today); return t && tripState(t, today).kind === 'soon' && tripState(t, today).days < 14; }).length;
  const stop = all.filter((c) => risks(c).length).length;
  const vip = all.filter((c) => c.vip).length;
  const metric = (n, label, sub = '') => `<div class="cl-m"><b data-count="${n}">${n}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  return `<div class="clv clv-gallery">
    <header class="cl-head">
      <div class="cl-title"><h1>Клиенты</h1><p class="cl-eyebrow">Частное досье и протоколы предпочтений</p></div>
      <div class="cl-head-act">
        <button type="button" class="cl-mask" id="clMask" aria-pressed="${ui.clMask}" title="${ui.clMask ? 'Показать фамилии' : 'Скрыть фамилии — для работы при посторонних'}">${ui.clMask ? '🙈' : '👁'}<span>${ui.clMask ? 'Фамилии скрыты' : 'Маска'}</span></button>
        <button type="button" class="cl-new" id="clNew"><span aria-hidden="true">＋</span> Новый клиент</button>
      </div>
    </header>
    <div class="cl-metrics">${metric(all.length, 'Всего клиентов', vip ? `★ ${vip} VIP` : '')}${metric(away, 'В поездке сейчас')}${metric(soon, 'Вылеты < 14 дней')}${metric(stop, 'Активные стоп-листы')}</div>
    <div class="cl-tools">
      <label class="cl-search"><span class="sr-only">Поиск клиента</span>
        <input type="search" id="q" placeholder="Найти по имени, городу, отелю, тегу или аллергии…" value="${esc(ui.q)}" autocomplete="off">
        ${ui.q ? '<button type="button" class="cl-clear" id="clClear" aria-label="Очистить поиск">×</button>' : '<kbd>⌘K</kbd>'}
      </label>
      <div class="cl-filters" role="tablist" aria-label="Фильтр клиентов">${FILTERS.map(([k, l]) =>
        `<button type="button" role="tab" data-cfilter="${k}" aria-selected="${ui.cfilter === k}">${l}</button>`).join('')}</div>
    </div>
    ${list.length ? `<div class="pp-grid">${list.map((c, i) => passport(c, i, today)).join('')}</div>`
      : `<div class="cl-empty"><p>${q || ui.cfilter !== 'all' ? 'Никого не нашлось.' : 'Клиентов пока нет.'}</p>${q || ui.cfilter !== 'all' ? '<button type="button" class="cl-ghost" id="clReset">Сбросить поиск и фильтр</button>' : ''}</div>`}
  </div>`;
}

// ---------- режим B: досье ----------
const CTABS = [['overview', 'Обзор'], ['trips', 'Поездки'], ['people', 'Окружение'], ['dates', 'Даты'], ['requests', 'Запросы']];

function contactCluster(c) {
  const digits = (c.phone || '').replace(/[^\d+]/g, '');
  const tg = (c.telegram || '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '');
  const out = [];
  if (digits) {
    out.push(`<span class="dc-grp"><a class="dc" href="tel:${esc(digits)}"><span aria-hidden="true">📞</span><b class="tnum">${esc(c.phone)}</b></a><button type="button" class="dc-copy" data-copy="${esc(c.phone)}" aria-label="Скопировать телефон"><i class="cp-ico" aria-hidden="true">⧉</i></button></span>`);
    out.push(`<a class="dc" href="https://wa.me/${esc(digits.replace('+', ''))}" target="_blank" rel="noopener"><span aria-hidden="true">💬</span><b>WhatsApp</b></a>`);
  }
  if (c.email) out.push(`<span class="dc-grp"><a class="dc" href="mailto:${esc(c.email)}"><span aria-hidden="true">✉️</span><b>${esc(c.email)}</b></a><button type="button" class="dc-copy" data-copy="${esc(c.email)}" aria-label="Скопировать почту"><i class="cp-ico" aria-hidden="true">⧉</i></button></span>`);
  if (tg) out.push(`<a class="dc" href="https://t.me/${esc(tg)}" target="_blank" rel="noopener"><span aria-hidden="true">✈️</span><b>@${esc(tg)}</b></a>`);
  if (!out.length) out.push(`<button class="dc add" data-editcl="${c.id}" type="button"><span aria-hidden="true">＋</span><b>Телефон или почта</b></button>`);
  return out.join('');
}

function heroBirthday(c) {
  const b = birthdayInfo(c.birthday);
  if (!b) return '';
  const age = b.age != null ? ` · ${b.age} ${plural(b.age, 'год', 'года', 'лет')}` : '';
  const soon = b.days <= 14 ? ` · <em>${b.days === 0 ? 'сегодня день рождения!' : b.days === 1 ? 'завтра день рождения' : `ДР через ${b.days} ${plural(b.days, 'день', 'дня', 'дней')}`}</em>` : '';
  return `<span class="dh-bday${b.days <= 14 ? ' soon' : ''}">🎂 <span class="tnum">${esc(b.text)}${age}</span>${soon}</span>`;
}

function jarvis(c) {
  const d = upcomingDates(c).find((x) => x.info.days <= 30);
  const n = d?.info.days;
  const sub = d ? `${d.title}${d.kind === 'person' ? ' · ' + d.who.split(' · ')[0] : ''} — ${n === 0 ? 'сегодня' : n === 1 ? 'завтра' : 'через ' + n + ' дн.'}` : 'Jarvis подберёт 3 идеи под вкусы, сезон и прошлые запросы';
  return `<button type="button" class="jv" data-ideas="${c.id}"><span class="jv-spark" aria-hidden="true">✦</span>
    <span class="jv-txt"><small>Jarvis · консьерж-ИИ</small><b>Что предложить ${esc(firstName(c))}?</b><span>${esc(sub)}</span></span>
    <span class="jv-arrow" aria-hidden="true">→</span></button>`;
}

function boardingPass(t) {
  const st = tripState(t);
  return `<button type="button" class="bp" data-trip="${t.id}">
    <span class="bp-main"><small>${st.kind === 'now' ? 'Сейчас в поездке' : 'Ближайшая поездка'}</small>
      <b class="bp-city">${esc(t.city)}${t.country ? `<span>, ${esc(t.country)}</span>` : ''}</b>
      <span class="bp-dates tnum">${esc(fmtRange(t) || 'даты не указаны')}</span>
      ${t.hotel ? `<span class="bp-line">🏨 ${esc(t.hotel)}</span>` : ''}</span>
    <span class="bp-stub"><span class="bp-plane" aria-hidden="true">✈</span><span class="bp-count tnum${st.kind === 'now' ? ' now' : ''}">${tripBadge(st)}</span><span class="bp-more">Детали поездки →</span></span>
  </button>`;
}

function tabOverview(c) {
  const t = nextTrip(c);
  const date = upcomingDates(c).find((d) => d.info.days <= 30);
  const prefs = [['🍽', 'Еда', c.pref_food], ['🚗', 'Транспорт', c.pref_transport], ['🏨', 'Отели', c.pref_hotels], ['💆', 'Спа', c.pref_spa], ['🎵', 'Музыка', c.pref_music]].filter(([, , v]) => v);
  const r = risks(c);
  return `<div class="ov-grid">
    <div class="ov-main">
      ${jarvis(c)}
      ${clientSuggestions(c.id)}
      ${t ? boardingPass(t) : `<button type="button" class="bp-empty" data-add-trip="${c.id}">✈ Ближайшей поездки нет · <b>＋ Поездка</b></button>`}
      ${date ? `<button type="button" class="ov-date" data-ctab-go="dates"><span aria-hidden="true">${date.kind === 'date' ? '📅' : '🎂'}</span><span><b>${esc(date.title)}${date.kind === 'person' ? ' · ' + esc(date.who.split(' · ')[0]) : ''}</b><small class="tnum">${esc(date.info.text)} · ${date.info.days === 0 ? 'сегодня' : `через ${date.info.days} дн.`}</small></span></button>` : ''}
      <section class="ov-sec"><h4 class="cl-label">Предпочтения</h4>
        <div class="pf-grid">${prefs.map(([i, l, v]) => `<button type="button" class="pf" data-editcl="${c.id}"><span class="pf-ico" aria-hidden="true">${i}</span><small class="cl-label">${l}</small><b>${esc(v)}</b><span class="pf-edit" aria-hidden="true">✎</span></button>`).join('')}
          <button type="button" class="pf add" data-editcl="${c.id}"><span aria-hidden="true">＋</span> Добавить</button></div>
      </section>
      ${c.travel_habits || (c.loyalty || []).length ? `<section class="ov-sec"><h4 class="cl-label">В пути</h4>
        ${c.travel_habits ? `<p class="ov-text">${esc(c.travel_habits)}</p>` : ''}
        ${(c.loyalty || []).length ? `<div class="loyal">${c.loyalty.map((l) => `<span class="loyal-chip">✦ ${esc(l)}</span>`).join('')}</div>` : ''}
      </section>` : ''}
      ${c.concierge_notes ? `<section class="ov-sec"><h4 class="cl-label">Заметки консьержа</h4><p class="ov-text">${esc(c.concierge_notes)}</p></section>` : ''}
    </div>
    <aside class="ov-side">
      <section class="sc risk${r.length ? ' on' : ''}"><h4 class="cl-label">⚠ Аллергии, ограничения, стоп-лист</h4>
        ${chipEditor(c, 'allergies', { title: 'Аллергии', cls: 'risk-tags', placeholder: 'цитрус, орехи…' })}
        ${['diet', 'health'].map((f) => (c[f] || []).length ? `<div class="sc-row"><span class="cl-label">${f === 'diet' ? 'Диета' : 'Здоровье'}</span>${c[f].map((x) => `<b class="sc-chip">${esc(x)}</b>`).join('')}</div>` : '').join('')}
      </section>
      <section class="sc taste"><h4 class="cl-label">Вкус гостя</h4>
        ${chipEditor(c, 'likes', { title: 'Любит', cls: 'likes', placeholder: 'вид на море, пионы…' })}
        ${chipEditor(c, 'dislikes', { title: 'Избегает', cls: 'dislikes', placeholder: 'номер от лифта, лилии…' })}
      </section>
    </aside>
  </div>`;
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
  const open = reqs.filter((r) => !isClosed(r.status));
  const closed = reqs.filter((r) => isClosed(r.status));
  return `<div class="tab-head"><span>${!reqs.length ? 'Запросов пока нет' : open.length ? `В работе · ${open.length}` : 'Открытых запросов нет'}</span><button type="button" class="btn small" data-newreq="${c.id}">＋ Запрос</button></div>
    ${open.length ? `<div class="req-list">${open.map((r) => requestCard(r, { showClient: false })).join('')}</div>` : ''}
    ${closed.length ? `<details class="req-closed"${open.length ? '' : ' open'}><summary>✓ Выполненные и архив · ${closed.length}</summary>
      <div class="req-list">${closed.map((r) => requestCard(r, { showClient: false })).join('')}</div></details>` : ''}`;
}

let lastTab = '';
function dossier(c) {
  const q = ui.q.trim().toLowerCase();
  const rail = state.clients.filter((x) => x.id === c.id || matches(x, q))
    .sort((a, b) => (b.vip - a.vip) || a.name.localeCompare(b.name, 'ru'));
  const reqs = state.requests.filter((r) => r.client_id === c.id)
    .sort((a, b) => (isClosed(a.status) - isClosed(b.status)) || b.created_at.localeCompare(a.created_at));
  const counts = {
    trips: state.trips.filter((t) => t.client_id === c.id && tripState(t).kind !== 'past').length,
    people: state.people.filter((p) => p.client_id === c.id).length,
    dates: upcomingDates(c).filter((d) => d.info.days <= 30).length,
    requests: reqs.filter((r) => !isClosed(r.status)).length,
  };
  const tab = CTABS.some(([k]) => k === ui.ctab) ? ui.ctab : 'overview';
  const fresh = tab !== lastTab; lastTab = tab;
  const body = { overview: () => tabOverview(c), trips: () => tabTrips(c), people: () => tabPeople(c), dates: () => tabDates(c), requests: () => tabRequests(c, reqs) }[tab]();
  return `<div class="clv clv-dossier">
    <aside class="cl-rail">
      <button type="button" class="cl-back" id="back"><span aria-hidden="true">←</span> Галерея клиентов</button>
      <label class="cl-search mini"><span class="sr-only">Поиск клиента</span><input type="search" id="q" placeholder="Найти клиента" value="${esc(ui.q)}" autocomplete="off"></label>
      <nav class="rl-list" aria-label="Клиенты">${rail.map((x) => `<button type="button" class="rl" data-cl="${x.id}" aria-current="${x.id === c.id}">
        ${avatar(x, 'rl-av')}<span class="rl-txt"><b>${nm(x)}${x.vip ? ' <span class="cl-star">★</span>' : ''}</b><small>${esc(x.city || x.language || '')}</small></span>
        ${risks(x).length ? '<i class="rl-risk" title="Есть стоп-лист" role="img" aria-label="Есть стоп-лист"></i>' : ''}</button>`).join('')}</nav>
    </aside>
    <section class="cl-dos">
      <header class="dh">
        <span class="dh-avwrap${ringClass(c)}" data-story="${c.id}" style="view-transition-name: cl-av">${avatar(c, 'dh-av')}</span>
        <div class="dh-id">
          <p class="cl-label">Частное досье${c.vip ? ' · VIP' : ''}</p>
          <h2 class="dh-name" style="view-transition-name: cl-name">${nm(c)}${c.vip ? ' <span class="cl-star" title="VIP">★</span>' : ''}</h2>
          <p class="dh-meta">${[c.language, c.city].filter(Boolean).map(esc).join(' · ')}${heroBirthday(c)}</p>
          ${clockPill(c, { long: true }) || guestClock(c)}
        </div>
        <div class="dh-contacts">${contactCluster(c)}
          <button class="dh-edit" data-editcl="${c.id}" type="button" aria-label="Редактировать профиль" title="Редактировать">✎</button></div>
      </header>
      <nav class="dtabs" role="tablist">${CTABS.map(([k, l]) =>
        `<button type="button" role="tab" data-ctab="${k}" aria-selected="${k === tab}">${l}${counts[k] ? `<span class="pcount">${counts[k]}</span>` : ''}</button>`).join('')}</nav>
      <div class="dbody${fresh ? ' fresh' : ''}" role="tabpanel">${body}</div>
    </section>
  </div>`;
}

// ---------- переходы ----------
function transition(update) {
  if (!document.startViewTransition || reduced()) { update(); return; }
  document.startViewTransition(update);
}
function openClient(id, card) {
  if (card) {
    card.querySelector('.pp-avwrap')?.style.setProperty('view-transition-name', 'cl-av');
    card.querySelector('.pp-name')?.style.setProperty('view-transition-name', 'cl-name');
  }
  transition(() => { if (ui.client !== id) ui.ctab = 'overview'; ui.client = id; ui.clBack = null; render(); });
  if (mobile()) scrollTo(0, 0);
}

async function copy(btn) {
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    btn.classList.add('ok');
    const ico = btn.querySelector('.cp-ico'); if (ico) ico.textContent = '✓';
    toast('Скопировано: ' + btn.dataset.copy);
    setTimeout(() => { btn.classList.remove('ok'); if (ico) ico.textContent = '⧉'; }, 1600);
  } catch { toast('Не удалось скопировать', 'err'); }
}

function magnetic(el) {
  if (!el || !matchMedia('(pointer: fine)').matches || reduced()) return;
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.translate = `${(e.clientX - r.left - r.width / 2) * .18}px ${(e.clientY - r.top - r.height / 2) * .25}px`;
  });
  el.addEventListener('pointerleave', () => { el.style.translate = ''; });
}

function view(app) {
  if (ui.client && !byId('clients', ui.client)) ui.client = null;
  const c = ui.client && byId('clients', ui.client);
  app.innerHTML = c ? dossier(c) : gallery();
  ui.clBack = null;

  app.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); copy(b); }));
  app.querySelectorAll('[data-stop]').forEach((b) => b.addEventListener('click', (e) => e.stopPropagation()));
  app.querySelectorAll('.pp').forEach((card) => {
    card.addEventListener('click', (e) => { e.stopPropagation(); openClient(card.dataset.cl, card); });
    card.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); openClient(card.dataset.cl, card); } });
  });
  app.querySelector('#clNew')?.addEventListener('click', () => editClient(null));
  app.querySelector('#clMask')?.addEventListener('click', () => {
    ui.clMask = !ui.clMask;
    try { localStorage.setItem('clMask', ui.clMask ? '1' : '0'); } catch {}
    render();
  });
  app.querySelector('#clClear')?.addEventListener('click', () => { ui.q = ''; render(); app.querySelector('#q')?.focus(); });
  app.querySelector('#clReset')?.addEventListener('click', () => { ui.q = ''; ui.cfilter = 'all'; render(); });
  app.querySelectorAll('[data-cfilter]').forEach((b) => b.addEventListener('click', () => { ui.cfilter = b.dataset.cfilter; render(); }));
  app.querySelector('#back')?.addEventListener('click', () => {
    const id = ui.client;
    transition(() => { ui.client = null; ui.clBack = id; render(); });
    scrollTo(0, 0);
  });
  magnetic(app.querySelector('#clNew'));
  magnetic(app.querySelector('.jv'));

  bindChipEditors(app);
  hydrateStories(app);
  app.querySelectorAll('[data-ctab],[data-ctab-go]').forEach((b) => b.addEventListener('click', () => { ui.ctab = b.dataset.ctab || b.dataset.ctabGo; render(); }));
  app.querySelectorAll('[data-trip]').forEach((b) => b.addEventListener('click', () => editTrip(b.dataset.trip)));
  app.querySelectorAll('[data-person]').forEach((b) => b.addEventListener('click', () => editPerson(b.dataset.person)));
  app.querySelectorAll('[data-date-edit]').forEach((b) => b.addEventListener('click', () => editDate(b.dataset.dateEdit)));
  app.querySelectorAll('[data-add-trip]').forEach((b) => b.addEventListener('click', () => editTrip(null, b.dataset.addTrip)));
  app.querySelector('[data-add-person]')?.addEventListener('click', (e) => editPerson(null, e.currentTarget.dataset.addPerson));
  app.querySelector('[data-add-date]')?.addEventListener('click', (e) => editDate(null, e.currentTarget.dataset.addDate));

  glide(app.querySelector('.cl-filters'), 'filter');
  glide(app.querySelector('.rl-list'), 'rail');
  glide(app.querySelector('.dtabs'), 'dtab', { line: true });
  app.querySelector('.rl-list [aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ⌘K / Ctrl+K — к поиску клиентов
document.addEventListener('keydown', (e) => {
  if (ui.tab !== 'clients' || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k' || document.querySelector('.ov')) return;
  e.preventDefault();
  const q = document.getElementById('q');
  q?.focus(); q?.select();
});
addEventListener('resize', () => {
  if (ui.tab !== 'clients') return;
  ['filter', 'rail', 'dtab'].forEach((k) => { inkAt[k] = null; });
  const app = document.getElementById('app');
  glide(app?.querySelector('.cl-filters'), 'filter');
  glide(app?.querySelector('.rl-list'), 'rail');
  glide(app?.querySelector('.dtabs'), 'dtab', { line: true });
});

registerView('clients', view);

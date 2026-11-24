// «Тихое подтверждение»: за 24 и за 3 часа до события напоминает перепроверить партнёра и держит под рукой «План Б».
// Радар показывается в «Моём дне» и на доске. Всё считается от данных запроса: любой гость, город, категория.
import { state, byId, save } from './data.js';
import { esc, toast } from './ui.js';
import { precheckWindow, countdown, partnerMessage, langFor } from './precheck-core.js';
import { effectiveStatus, statusLabel, isClosed } from './statuses.js';
import { stopList } from './stoplist.js';
import { render } from './router.js';

const BK_CATS = ['Spa & Wellness', 'Dining', 'Transport', 'Activities', 'Health & Fitness'];
const TAG = { T24: 'T-24ч · Реконфирмация', T3: 'T-3ч · Финальный контроль' };
const clean = (n) => String(n || '').replace(/\s*\(.*?\)/g, '').trim();
const isConfirmed = (r) => { const k = effectiveStatus(r.status); return !r.archived && !isClosed(k) && (k === 'confirmed' || /подтвержд|confirm/i.test(statusLabel(k))); };
// срок без времени хранится как 00:00 по Парижу — для такого события часы неизвестны, радар молчит
const dateOnly = (iso) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) === '00:00'; } catch { return false; } };
const tripOf = (r) => {
  if (r.trip_id) return byId('trips', r.trip_id);
  const d = String(r.deadline || '').slice(0, 10);
  return state.trips.find((t) => t.client_id === r.client_id && t.start_date && t.start_date <= d && d <= (t.end_date || t.start_date)) || null;
};

export function precheckRows(now = Date.now()) {
  const out = [];
  for (const r of state.requests) {
    if (!r.deadline || !isConfirmed(r) || dateOnly(r.deadline)) continue;
    const w = precheckWindow(r.deadline, now, r);
    if (!w) continue;
    const c = byId('clients', r.client_id), t = tripOf(r);
    const partner = r.partner_id ? byId('partners', r.partner_id) : null;
    out.push({ r, w, c, t, tz: t?.tz || c?.home_tz || 'Europe/Paris', place: r.venue?.name || partner?.name || '' });
  }
  return out.sort((a, b) => Date.parse(a.r.deadline) - Date.parse(b.r.deadline));
}

function constraint({ r, c }) {
  const people = c ? state.people.filter((p) => p.client_id === c.id) : [];
  const all = c ? stopList(c, people).all : [];
  if (all.length) return `<span class="pc-pill risk" title="${esc(all.join(', '))}">⚠ ${esc(all.slice(0, 2).join(', '))}${all.length > 2 ? ` +${all.length - 2}` : ''}</span>`;
  const note = r.category === 'Spa & Wellness' ? c?.pref_spa : r.category === 'Transport' ? r.transfer?.pickup : '';
  return note ? `<span class="pc-pill">${r.category === 'Transport' ? '📍' : '💆'} ${esc(String(note).slice(0, 28))}</span>` : '';
}
const when = (row) => { try { return new Intl.DateTimeFormat('ru-RU', { timeZone: row.tz, hour: '2-digit', minute: '2-digit' }).format(new Date(row.r.deadline)); } catch { return ''; } };

export function precheckBlock() {
  const rows = precheckRows();
  if (!rows.length) return '';
  const now = Date.now();
  return `<section class="pc" aria-label="Тихое подтверждение">
    <header class="pc-h"><span class="pc-dot" aria-hidden="true"></span><b>Тихое подтверждение</b><span class="pc-n tnum">${rows.length}</span></header>
    <ul class="pc-list">${rows.map((x) => {
      const { r } = x, eligible = BK_CATS.includes(r.category);
      const bk = !eligible ? '' : r.backup_venue ? `<span class="pc-pill bk" title="${esc(r.backup_venue)}">🛡️ План Б готов</span>` : `<button type="button" class="pc-pill bk add" data-pc="bk" data-id="${esc(r.id)}">+ План Б</button>`;
      return `<li class="pc-row ${x.w}" data-id="${esc(r.id)}" data-at="${esc(r.deadline)}" data-w="${x.w}">
        <div class="pc-when"><span class="pc-tag">${esc(TAG[x.w])}</span><span class="pc-cd tnum" aria-label="до события">${countdown(r.deadline, now)}</span></div>
        <div class="pc-main"><b>${esc(clean(x.c?.name) || 'Без гостя')}</b><span><i class="tnum">${esc(when(x))}</i>${x.place || r.summary ? ' · ' + esc(x.place || r.summary) : ''}</span></div>
        <div class="pc-pills">${constraint(x)}${bk}</div>
        <div class="pc-act"><button type="button" class="pc-b" data-pc="msg" data-id="${esc(r.id)}">💬 Проверить партнёра</button><button type="button" class="pc-b ok" data-pc="ok" data-id="${esc(r.id)}">✓ Подтверждено</button></div>
      </li>`;
    }).join('')}</ul></section>`;
}

function messageFor(row) {
  const { r, c, t } = row;
  const people = c ? state.people.filter((p) => p.client_id === c.id) : [];
  return partnerMessage({
    lang: langFor(t?.country_code), whenIso: r.deadline, tz: row.tz, venue: row.place || '', guest: clean(c?.name),
    allergies: c ? stopList(c, people).all : [], pref: r.category === 'Spa & Wellness' ? String(c?.pref_spa || '') : '', pickup: r.category === 'Transport' ? String(r.transfer?.pickup || '') : '',
  });
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-pc]'); if (!b) return;
  const id = b.dataset.id, row = precheckRows().find((x) => x.r.id === id);
  const kind = b.dataset.pc;
  if (kind === 'bk') { e.preventDefault(); import('./lazy.js').then((l) => l.editRequest(id, undefined, {}, { openBackup: true })); return; }
  if (!row) { render(); return; }
  if (kind === 'msg') {
    const text = messageFor(row), label = b.textContent;
    let ok = true; try { await navigator.clipboard.writeText(text); } catch { ok = false; }
    if (!ok) { toast(text); return; }
    b.textContent = 'Скопировано ✓'; b.classList.add('done');
    setTimeout(() => { b.textContent = label; b.classList.remove('done'); }, 2200);
    return;
  }
  if (kind === 'ok') {
    const li = b.closest('.pc-row'), now = new Date().toISOString();
    const patch = row.w === 'T3' ? { precheck3h_done: true, precheck24h_done: true, last_precheck_at: now } : { precheck24h_done: true, last_precheck_at: now };
    b.disabled = true;
    // плавный уход строки идёт параллельно с сохранением — ответ базы не заставляет ждать
    const saving = save('requests', id, patch);
    if (li && !calm()) { li.style.height = li.offsetHeight + 'px'; void li.offsetHeight; li.classList.add('leaving'); }
    toast('Бронь реконфирмирована ✓');
    try { await Promise.all([saving, wait(calm() ? 0 : 420)]); }
    catch (err) {
      li?.classList.remove('leaving'); if (li) li.style.height = ''; b.disabled = false;
      toast(/precheck|last_precheck/.test(String(err.message || err)) ? 'Не сохранилось: нужно обновить базу' : 'Не сохранилось: ' + (err.message || err), 'err');
      return;
    }
    render();
  }
});

// обратный отсчёт тикает сам; когда событие переходит из T-24ч в T-3ч — перерисовываем радар
setInterval(() => {
  const rows = document.querySelectorAll('.pc-row'); if (!rows.length) return;
  const now = Date.now(); let change = false;
  rows.forEach((li) => {
    const w = precheckWindow(li.dataset.at, now, byId('requests', li.dataset.id) || {});
    if (w !== li.dataset.w) { change = true; return; }
    const cd = li.querySelector('.pc-cd'); if (cd) cd.textContent = countdown(li.dataset.at, now);
  });
  if (change) render();
}, 30000);

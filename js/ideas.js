// «✦ Идеи для гостя»: упреждающие услуги консьержа под повод, вкусы и город. Создать запрос в один клик, действие по типу идеи, «Не то» с памятью.
import { api } from './api.js';
import { CATEGORIES } from './const.js';
import { esc, toast, openModal, fromParisInput } from './ui.js';
import { byId, save } from './data.js';
import { getSupabase } from './supabase.js';
import { upcomingDates } from './dossier.js';

const firstName = (c) => (c?.name || '').replace(/\s*\(.*?\)/g, '').split(/\s+/)[0] || 'гостя';
const dayWord = (n) => (n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} дн.`);
const KIND_ICO = { bday: '🎂', person: '🎂', date: '📅', trip: '✈️' };
const SECOND = {
  venue_search: ['🔍 Подобрать места', 'find'],
  whatsapp_pitch: ['💬 Предложить в WhatsApp', 'wa'],
  trip_note: ['✦ В заметку поездки', 'note'],
};

export function openIdeas(clientId) {
  const c = byId('clients', clientId);
  if (!c) return;
  let ideas = [], contexts = [], tripId = null, busy = true, failed = '', filter = 'all';
  const made = new Set(), noted = new Set(), gone = new Set(), dismissedTitles = [];
  const localReasons = upcomingDates(c).filter((d) => d.info.days <= 45).slice(0, 3);
  const m = openModal({ title: `Идеи для ${firstName(c)}`, saveLabel: 'Закрыть', body: '<div class="idea" id="idea"></div>', onSave: async () => {} });
  m.form.classList.add('wide', 'vo-dlg', 'idea-dlg');
  m.form.querySelector('.foot').hidden = true; // закрывает только ✕ вверху: главная кнопка — «Создать запрос»
  const box = m.form.querySelector('#idea');

  const card = (x, i) => {
    const [secLabel, secKey] = SECOND[x.actionType] || SECOND.venue_search;
    const secDone = secKey === 'note' && noted.has(i);
    const ico = CATEGORIES[x.prefillRequest?.category] || '✦';
    return `<article class="idea-card${made.has(i) ? ' made' : ''}" data-i="${i}" data-ref="${esc(x.ref || '')}"${filter !== 'all' && x.ref !== filter ? ' hidden' : ''}>
      <header><span class="idea-ico" aria-hidden="true">${ico}</span>
        <div><h3>${esc(x.title)}</h3>${x.days != null ? `<span class="idea-when tnum">${esc(dayWord(x.days))}</span>` : ''}</div></header>
      <p class="idea-why">${esc(x.why)}</p>
      ${x.serviceTouch ? `<p class="idea-touch"><b>✦ Штрих консьержа</b>${esc(x.serviceTouch)}</p>` : ''}
      <footer>
        ${made.has(i) ? '<span class="vo-btn done">✓ Запрос создан</span>' : `<button type="button" class="idea-go" data-act="make" data-i="${i}">Создать запрос</button>`}
        ${secDone ? '<span class="vo-btn done">✓ В заметке поездки</span>' : `<button type="button" class="vo-btn" data-act="${secKey}" data-i="${i}">${secLabel}</button>`}
        <button type="button" class="idea-hide" data-act="hide" data-i="${i}">не то</button>
      </footer></article>`;
  };
  const chips = () => {
    if (contexts.length) {
      const one = (id, label, days, ico) => `<button type="button" class="idea-chip" data-ref="${esc(id)}" aria-pressed="${filter === id}">${ico ? `<span aria-hidden="true">${ico}</span> ` : ''}${esc(label)}${days != null ? ` <b class="tnum">${esc(dayWord(days))}</b>` : ''}</button>`;
      return `<div class="idea-reasons" role="group" aria-label="Повод">${one('all', 'Все', null, '')}${contexts.map((x) => one(x.id, x.label, x.days, KIND_ICO[x.kind])).join('')}</div>`;
    }
    return localReasons.length ? `<div class="idea-reasons">${localReasons.map((d) => `<span class="idea-chip static">${KIND_ICO[d.kind] || '📅'} ${esc(d.title)}${d.kind === 'person' ? ' · ' + esc(d.who.split(' · ')[0]) : ''} <b class="tnum">${esc(dayWord(d.info.days))}</b></span>`).join('')}</div>` : '';
  };
  const emptyNote = () => {
    const live = ideas.some((x, i) => !gone.has(i) && (filter === 'all' || x.ref === filter));
    return live ? '' : `<p class="idea-lead" id="idea-empty">${esc(failed || (ideas.length ? 'Для этого повода идей нет — нажмите «Другие идеи».' : 'Идеи закончились — нажмите «Другие идеи».'))}</p>`;
  };
  const paint = () => {
    if (busy) { box.innerHTML = `${chips()}<p class="idea-lead">Jarvis изучает вкусы, поводы и город…</p><div class="idea-list">${'<div class="idea-card skel"><i></i><i></i><i></i></div>'.repeat(3)}</div>`; return; }
    box.innerHTML = `${chips()}<div class="idea-list" id="idea-list">${ideas.map((x, i) => (gone.has(i) ? '' : card(x, i))).join('')}</div><div id="idea-note">${emptyNote()}</div>
      <div class="idea-foot"><button type="button" class="vo-btn" id="idea-more">↻ Другие идеи</button></div>`;
  };
  const applyFilter = () => {
    box.querySelectorAll('.idea-chip[data-ref]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ref === filter)));
    box.querySelectorAll('.idea-card[data-i]').forEach((el) => { el.hidden = !(filter === 'all' || el.dataset.ref === filter); });
    const n = box.querySelector('#idea-note'); if (n) n.innerHTML = emptyNote();
  };
  const run = async (force) => {
    busy = true; failed = ''; gone.clear(); made.clear(); noted.clear(); filter = 'all'; paint();
    try {
      const r = await api('ideas', { client_id: clientId, force, exclude: dismissedTitles.slice(-8) }, { signal: m.signal });
      ideas = r.ideas || []; contexts = r.contexts || []; tripId = r.tripId || null;
    } catch (e) { if (e.name === 'AbortError') return; ideas = []; failed = e.message === 'rate_limited' ? 'Лимит Gemini на минуту исчерпан — попробуйте чуть позже.' : 'Не получилось связаться с Jarvis. Попробуйте ещё раз.'; }
    busy = false; paint();
  };

  // «не то»: карточка плавно уходит, Jarvis запоминает и подбирает замену на её место
  const dismiss = async (i, el) => {
    const x = ideas[i];
    gone.add(i); dismissedTitles.push(x.title);
    getSupabase().then((sb) => sb.from('idea_feedback').insert({ client_id: clientId, title: x.title, category: x.category })).catch(() => {});
    const slot = document.createElement('div'); slot.className = 'idea-card skel slot'; slot.innerHTML = '<i></i><i></i>';
    el.style.height = el.offsetHeight + 'px'; void el.offsetHeight; el.classList.add('leaving');
    setTimeout(() => { el.replaceWith(slot); slot.classList.add('slot-in'); }, 360);
    try {
      const shown = ideas.filter((_, k) => !gone.has(k)).map((y) => y.title);
      const r = await api('ideas', { client_id: clientId, count: 1, exclude: [...dismissedTitles, ...shown].slice(-12) }, { signal: m.signal });
      const n = (r.ideas || [])[0];
      await new Promise((ok) => setTimeout(ok, 420));
      if (!slot.isConnected) return;
      if (n) {
        ideas.push(n); const j = ideas.length - 1;
        const t = document.createElement('div'); t.innerHTML = card(n, j);
        const fresh = t.firstElementChild; fresh.classList.add('fresh'); slot.replaceWith(fresh); applyFilter();
      } else { slot.remove(); applyFilter(); }
    } catch (e) { if (e.name !== 'AbortError') { slot.remove(); applyFilter(); } }
  };

  box.addEventListener('click', async (e) => {
    const chip = e.target.closest('.idea-chip[data-ref]');
    if (chip) { filter = chip.dataset.ref; return applyFilter(); }
    const t = e.target.closest('[data-act],#idea-more');
    if (!t) return;
    if (t.id === 'idea-more') return run(true);
    const i = +t.dataset.i, x = ideas[i], act = t.dataset.act;
    if (!x) return;
    if (act === 'hide') return dismiss(i, t.closest('.idea-card'));
    if (act === 'find') { m.close(); import('./search.js').then((s) => s.openSearch({ query: x.query, cid: clientId })); return; }
    if (act === 'wa') {
      const text = String(x.pitch || '').replace(/\{имя\}/gi, firstName(c));
      const digits = String(c.phone || '').replace(/\D/g, '');
      try { await navigator.clipboard.writeText(text); toast('Текст для WhatsApp скопирован'); } catch { toast(text); }
      if (digits) window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      return;
    }
    if (act === 'note') {
      const trip = tripId && byId('trips', tripId);
      if (!trip) { toast('Нет ближайшей поездки'); return; }
      t.disabled = true;
      try {
        const line = `✦ ${x.serviceTouch || x.title}`;
        const cur = String(trip.notes || '');
        if (!cur.includes(line)) await save('trips', tripId, { notes: cur ? `${cur}\n${line}` : line });
        noted.add(i); t.replaceWith(Object.assign(document.createElement('span'), { className: 'vo-btn done', textContent: '✓ В заметке поездки' }));
        toast('Добавлено в заметки поездки');
      } catch (err) { t.disabled = false; toast('Не сохранилось: ' + (err.message || err), 'err'); }
      return;
    }
    if (act === 'make') {
      // заготовка запроса: форма открывается заполненной, остаётся нажать «Сохранить»
      const p = x.prefillRequest || {};
      m.close();
      import('./lazy.js').then((l) => l.editRequest(null, clientId, {
        summary: p.title || x.title, category: p.category || 'Other', urgency: 'normal',
        deadline: p.dueDate ? fromParisInput(`${p.dueDate}T19:00`) : null,
        clarifying_questions: [x.why, p.guestNote, x.serviceTouch && `✦ ${x.serviceTouch}`].filter(Boolean).join('\n'), original_message: 'Jarvis: идея для гостя',
      }));
    }
  });
  paint(); run(false);
}

// «✦ Идеи для гостя»: три упреждающих предложения под повод, вкусы и сезон. Создать запрос или сразу найти места.
import { api } from './api.js';
import { CATEGORIES, TZ } from './const.js';
import { esc, toast, openModal, fromParisInput } from './ui.js';
import { byId, save } from './data.js';
import { firstKey } from './statuses.js';
import { upcomingDates } from './dossier.js';

const firstName = (c) => (c?.name || '').replace(/\s*\(.*?\)/g, '').split(/\s+/)[0] || 'гостя';
const dayWord = (n) => (n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} дн.`);

export function openIdeas(clientId) {
  const c = byId('clients', clientId);
  if (!c) return;
  let ideas = [], busy = true, failed = '';
  const made = new Set(), hidden = new Set();
  const reasons = upcomingDates(c).filter((d) => d.info.days <= 45).slice(0, 3);
  const m = openModal({ title: `Идеи для ${firstName(c)}`, saveLabel: 'Закрыть', body: '<div class="idea" id="idea"></div>', onSave: async () => {} });
  m.form.classList.add('wide', 'vo-dlg', 'idea-dlg');
  m.form.querySelector('#cancel').hidden = true;
  const box = m.form.querySelector('#idea');

  const card = (x, i) => `<article class="idea-card${made.has(i) ? ' made' : ''}" data-i="${i}">
      <header><span class="idea-ico">${CATEGORIES[x.category] || '📌'}</span>
        <div><h3>${esc(x.title)}</h3>${x.days != null ? `<span class="idea-when">${esc(dayWord(x.days))}</span>` : ''}</div></header>
      <p class="idea-why">${esc(x.why)}</p>
      ${x.wow ? `<p class="idea-wow"><span>✦</span>${esc(x.wow)}</p>` : ''}
      <footer>
        ${made.has(i) ? '<span class="vo-btn done">✓ Запрос создан</span>' : `<button type="button" class="idea-go" data-make="${i}">Создать запрос</button>`}
        <button type="button" class="vo-btn" data-find="${i}">🔎 Найти места</button>
        <button type="button" class="idea-hide" data-hide="${i}" title="Не подходит">Не то</button>
      </footer></article>`;
  const paint = () => {
    const chips = reasons.length ? `<div class="idea-reasons">${reasons.map((d) => `<span>${d.kind === 'bday' || d.kind === 'person' ? '🎂' : '📅'} ${esc(d.title)}${d.kind === 'person' ? ' · ' + esc(d.who.split(' · ')[0]) : ''} <b>${esc(dayWord(d.info.days))}</b></span>`).join('')}</div>` : '';
    if (busy) { box.innerHTML = `${chips}<p class="idea-lead">Jarvis изучает вкусы, поводы и сезон…</p><div class="idea-list">${'<div class="idea-card skel"><i></i><i></i><i></i></div>'.repeat(3)}</div>`; return; }
    const shown = ideas.map((x, i) => [x, i]).filter(([, i]) => !hidden.has(i));
    box.innerHTML = `${chips}${shown.length ? `<div class="idea-list">${shown.map(([x, i]) => card(x, i)).join('')}</div>` : `<p class="idea-lead">${esc(failed || 'Идеи закончились — нажмите «Другие идеи».')}</p>`}
      <div class="idea-foot"><button type="button" class="vo-btn" id="idea-more">↻ Другие идеи</button></div>`;
  };
  const run = async (force) => {
    busy = true; failed = ''; hidden.clear(); made.clear(); paint();
    try { ideas = (await api('ideas', { client_id: clientId, force }, { signal: m.signal })).ideas || []; }
    catch (e) { if (e.name === 'AbortError') return; ideas = []; failed = e.message === 'rate_limited' ? 'Лимит Gemini на минуту исчерпан — попробуйте чуть позже.' : 'Не получилось связаться с Jarvis. Попробуйте ещё раз.'; }
    busy = false; paint();
  };
  box.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-make],[data-find],[data-hide],#idea-more');
    if (!t) return;
    if (t.id === 'idea-more') return run(true);
    const i = +(t.dataset.make ?? t.dataset.find ?? t.dataset.hide), x = ideas[i];
    if (!x) return;
    if (t.dataset.hide != null) { hidden.add(i); paint(); }
    else if (t.dataset.find != null) { m.close(); import('./search.js').then((s) => s.openSearch({ query: x.query, cid: clientId })); }
    else if (t.dataset.make != null) {
      t.disabled = true;
      try {
        const ymd = x.days != null ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + x.days * 864e5)) : '';
        await save('requests', null, { client_id: clientId, summary: x.title, category: x.category, urgency: 'normal', status: firstKey(), deadline: ymd ? fromParisInput(`${ymd}T19:00`) : null, clarifying_questions: [x.why, x.wow && `✦ ${x.wow}`].filter(Boolean).join('\n'), original_message: 'Jarvis: идея для гостя' });
        made.add(i); paint(); toast(`Запрос создан — ${firstName(c)}`);
      } catch (err) { t.disabled = false; toast('Не сохранилось: ' + (err.message || err), 'err'); }
    }
  });
  paint(); run(false);
}

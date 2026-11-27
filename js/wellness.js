// «✦ Wellness-маршрут (Gamma)»: живая карточка звонка. Слева — что гость сказал, справа — вопросы, которые стоит задать прямо сейчас.
// В конце — мастер-промпт для Gamma и письмо гостю. Имя гостя в ИИ не уходит (подставляется сервером после ответа).
import { api } from './api.js';
import { esc, toast, openModal } from './ui.js';
import { state, byId } from './data.js';
import { chipField, bindChips } from './chips.js';
import { timeField, bindTimeFields, normTime } from './timefield.js';
import { deadlinePicker, bindDeadlinePicker } from './datepicker.js';

const DURATIONS = [[1, '1 день'], [2, '2 дня'], [3, '3 дня'], [5, '5 дней'], [7, '7 дней']];
const GOALS = ['Deep Rest & Sleep', 'Thermal & Detox', 'Active Recovery', 'Mindful Reset', 'Nature & Sea', 'Culinary & Slow Living'];
const QUICK = ['Да', 'Нет'];
const T = { guest: 'Гость', oneoff: '＋ Разовый / новый гость', oneoffPh: 'Имя гостя', none: '— выберите гостя —', dest: 'Место путешествия', destPh: 'Город, регион или страна', dur: 'Длительность', dates: 'Даты (необязательно)', goals: 'Цель и настроение', stop: 'Аллергии и противопоказания · стоп-лист', stopPh: 'Орехи, моллюски… Enter — добавить', notes: 'Живые заметки со звонка', notesPh: 'Что гость говорит прямо сейчас — как есть, без редактуры', qh: 'Вопросы для персонализации', refresh: '↻ Обновить вопросы', empty: 'Укажите место и срок или цель — Jarvis предложит вопросы для звонка.', build: '✦ Собрать промпт для Gamma', copyP: 'Копировать промпт для Gamma', copied: 'Скопировано ✓', open: 'Открыть Gamma ↗', copyM: 'Копировать письмо гостю', later: 'Уточнить позже', anch: 'Фиксированное время', anchPh: 'Глубокий массаж, встреча в аэропорту, ужин…', anchHint: 'Эти точки Jarvis не сдвинет: всё остальное выстроит вокруг. Время можно и просто вписать в заметки.', ok: '✓ Учтено', ans: 'Ответ гостя', done: 'Готово' };

const firstName = (n) => String(n || '').replace(/\s*\(.*?\)/g, '').trim().split(/\s+/)[0] || '';
const hm = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function openWellness(presetClient) {
  const S = { anchors: [], questions: [], asked: new Set(), goals: new Set(), dur: null, timer: 0, ctrl: null, busy: false, status: 'idle', openId: null, out: null };
  const clients = [...state.clients].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const opts = `<option value="">${esc(T.none)}</option>${clients.map((c) => `<option value="${esc(c.id)}"${c.id === presetClient ? ' selected' : ''}>${c.vip ? '★ ' : ''}${esc(c.name)}</option>`).join('')}`;
  const c0 = byId('clients', presetClient);
  const body = `<div class="cl-scroll wl-body"><div class="wl-grid">
    <div class="wl-left">
      <div class="f"><label for="wl_client">${T.guest}</label>
        <div class="wl-guest"><select id="wl_client" name="wl_client">${opts}</select><button type="button" class="wl-pill" id="wl-oneoff" aria-expanded="false">${T.oneoff}</button></div>
        <input type="text" id="wl_guest" name="wl_guest" class="wl-oneoff-in" placeholder="${esc(T.oneoffPh)}" autocomplete="off" hidden>
        <div class="wl-dossier" id="wl-dossier" aria-live="polite"></div></div>
      <div class="f"><label for="wl_dest">${T.dest}</label><input type="text" id="wl_dest" name="wl_dest" placeholder="${esc(T.destPh)}" autocomplete="off"></div>
      <div class="f"><label id="wl-dur-l">${T.dur}</label><div class="wl-chips" role="group" aria-labelledby="wl-dur-l">${DURATIONS.map(([n, l]) => `<button type="button" class="wl-chip" data-dur="${n}" aria-pressed="false">${l}</button>`).join('')}</div></div>
      <div class="f wl-dates"><label>${T.dates}</label><div class="f2">${deadlinePicker(null, 'wl_from', { dateOnly: true, empty: 'С даты', quick: false })}${deadlinePicker(null, 'wl_to', { dateOnly: true, empty: 'По дату', quick: false })}</div></div>
      <div class="f"><label id="wl-goal-l">${T.goals}</label><div class="wl-chips" role="group" aria-labelledby="wl-goal-l">${GOALS.map((g) => `<button type="button" class="wl-chip" data-goal="${esc(g)}" aria-pressed="false">${esc(g)}</button>`).join('')}</div></div>
      <div class="f"><label for="wl_allergies-in">${T.stop}</label>${chipField('wl_allergies', c0?.allergies || [], { tone: 'risk', placeholder: T.stopPh, label: 'Аллергии' })}</div>
      <div class="f wl-anch"><label for="wl_a_act">${T.anch}</label>
        <div class="wl-arow"><select id="wl_a_day" name="wl_a_day" aria-label="День"></select>${timeField('wl_a_time', '', { chips: false })}<input type="text" id="wl_a_act" name="wl_a_act" placeholder="${esc(T.anchPh)}" autocomplete="off" maxlength="120" enterkeyhint="done"><button type="button" class="wl-add" id="wl-a-add" aria-label="Добавить якорь">＋</button></div>
        <div class="wl-achips" id="wl-achips" aria-live="polite"></div><small class="wl-ahint">${T.anchHint}</small></div>
      <div class="f"><label for="wl_notes">${T.notes}</label><textarea id="wl_notes" name="wl_notes" rows="4" placeholder="${esc(T.notesPh)}"></textarea></div>
    </div>
    <div class="wl-right">
      <div class="wl-qh"><h3>${T.qh}</h3><span class="wl-sync" id="wl-sync" role="status" aria-live="polite"><i aria-hidden="true"></i><span></span></span><button type="button" class="wl-pill" id="wl-refresh">${T.refresh}</button></div>
      <div class="wl-qs" id="wl-qs"></div>
      <div class="wl-build"><button type="button" class="wl-go" id="wl-go">${T.build}</button></div>
    </div>
  </div>
  <section class="wl-out" id="wl-out" hidden aria-live="polite"></section></div>`;
  const m = openModal({ title: 'Wellness-маршрут', saveLabel: 'Закрыть', body, cls: 'tp cl wl', onSave: async () => {} });
  const f = m.form;
  f.querySelector('.foot').hidden = true;
  bindChips(f); bindDeadlinePicker(f); bindTimeFields(f);

  const $ = (s) => f.querySelector(s);
  const val = (n) => (f.elements[n]?.value || '').trim();
  const allergies = () => val('wl_allergies').split('\n').map((x) => x.trim()).filter(Boolean);
  const clientId = () => val('wl_client') || null;
  const range = () => ({ from: val('wl_from').slice(0, 10), to: val('wl_to').slice(0, 10) });
  const days = () => { const r = range(); if (r.from && r.to && r.to >= r.from) return Math.round((Date.parse(r.to) - Date.parse(r.from)) / 864e5) + 1; return S.dur; };
  const answered = () => S.questions.filter((q) => q.state === 'done');

  // ---------- фиксированное время: якоря, которые маршрут не двигает ----------
  const dayOptions = () => {
    const n = Math.min(days() || 3, 14), cur = $('#wl_a_day').value;
    const o = [['Arrival', 'Прилёт'], ...Array.from({ length: n }, (_, i) => [`Day ${i + 1}`, `День ${i + 1}`]), ['Departure', 'Вылет']];
    $('#wl_a_day').innerHTML = o.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    $('#wl_a_day').value = o.some(([v]) => v === cur) ? cur : (o[1] || o[0])[0];
  };
  const dayRu = (d) => (d === 'Arrival' ? 'Прилёт' : d === 'Departure' ? 'Вылет' : d.replace(/^Day /, 'День '));
  const dayKey = (d) => (d === 'Arrival' ? 0 : d === 'Departure' ? 999 : +d.replace(/\D/g, '') || 1);
  const paintAnchors = () => {
    $('#wl-achips').innerHTML = S.anchors.map((a, i) => `<span class="wl-ach"><span class="tnum">${esc(dayRu(a.day))} · ${esc(a.time)}</span> — ${esc(a.activity)}<button type="button" class="wl-ax" data-ax="${i}" aria-label="Убрать: ${esc(a.activity)}">×</button></span>`).join('');
  };
  const addAnchor = () => {
    const act = val('wl_a_act').slice(0, 120), t = normTime(val('wl_a_time'));
    if (!act) { $('#wl_a_act').focus(); return; }
    if (!t) { toast('Укажите время, например 11:00'); $('#f-wl_a_time').focus(); return; }
    S.anchors.push({ day: $('#wl_a_day').value, time: t, activity: act });
    S.anchors.sort((a, b) => dayKey(a.day) - dayKey(b.day) || a.time.localeCompare(b.time));
    f.elements.wl_a_act.value = ''; f.elements.wl_a_time.value = '';
    paintAnchors(); $('#wl_a_act').focus();
  };

  // ---------- состояние синхронизации ----------
  const setStatus = (st, text) => { S.status = st; const el = $('#wl-sync'); el.dataset.s = st; el.querySelector('span').textContent = text || ''; };
  const idleText = () => (!val('wl_dest') ? 'Ждём место' : !days() && !S.goals.size ? 'Ждём срок или цель' : '');

  // ---------- досье гостя ----------
  const paintDossier = () => {
    const c = byId('clients', clientId());
    const bits = c ? [['⚠', c.allergies], ['🥗', c.diet], ['🩺', c.health], ['❤️', c.likes], ['🚫', c.dislikes]].filter(([, a]) => (a || []).length) : [];
    $('#wl-dossier').innerHTML = bits.length ? bits.map(([i, a]) => `<span class="wl-d" title="${esc(a.join(', '))}">${i} ${esc(a.slice(0, 2).join(', '))}${a.length > 2 ? ` +${a.length - 2}` : ''}</span>`).join('') : '';
  };
  const hydrateAllergies = () => {
    const c = byId('clients', clientId());
    const box = $('[data-chips]'), inp = box.querySelector('.chip-in');
    box.querySelectorAll('.chip').forEach((x) => x.remove());
    for (const a of (c?.allergies || [])) { inp.value = a; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
  };

  // ---------- вопросы ----------
  const cardHtml = (q) => {
    const open = S.openId === q.id;
    const chips = [...QUICK, ...(q.chips || []).filter((c) => !QUICK.includes(c))].slice(0, 5);
    return `<article class="wq${open ? ' open' : ''}" data-id="${esc(q.id)}" data-state="${esc(q.state || 'new')}">
      <button type="button" class="wq-head" data-q="${esc(q.id)}" aria-expanded="${open}">
        <span class="wq-cat">${esc(q.category)}</span><span class="wq-text">${esc(q.text)}</span>
        ${q.state === 'done' ? `<span class="wq-st">${T.ok}</span>` : q.state === 'later' ? `<span class="wq-st later">${T.later}</span>` : ''}
        ${q.state === 'done' && !open ? `<span class="wq-a">${esc(q.answer)}</span>` : ''}</button>
      <div class="wq-body"><div class="wq-in"><div class="wq-chips">${chips.map((c) => `<button type="button" class="wq-c" data-a="${esc(c)}" data-q="${esc(q.id)}">${esc(c)}</button>`).join('')}<button type="button" class="wq-c soft" data-later="${esc(q.id)}">${T.later}</button></div>
        <div class="wq-row"><input type="text" class="wq-input" data-q="${esc(q.id)}" value="${esc(q.answer || '')}" placeholder="${esc(T.ans)}" autocomplete="off" aria-label="${esc(T.ans)}"><button type="button" class="wq-save" data-save="${esc(q.id)}">${T.done}</button></div></div></div></article>`;
  };
  const paintQs = () => {
    const box = $('#wl-qs');
    if (!S.questions.length) { box.innerHTML = `<p class="wl-empty">${esc(S.status === 'loading' ? 'Jarvis подбирает вопросы…' : T.empty)}</p>`; return; }
    box.innerHTML = S.questions.map(cardHtml).join('');
  };
  const commit = (id, answer, st = 'done') => {
    const q = S.questions.find((x) => x.id === id); if (!q) return;
    q.answer = String(answer || '').trim().slice(0, 300);
    q.state = st === 'later' ? 'later' : q.answer ? 'done' : 'new';
    S.openId = null; paintQs();
    // следующий неотвеченный вопрос раскрывается сам — фокус не теряется
    const next = S.questions.find((x) => x.state !== 'done' && x.state !== 'later');
    if (next && st !== 'later' && q.state === 'done') { S.openId = next.id; paintQs(); box$(next.id)?.focus(); }
  };
  const box$ = (id) => $(`.wq[data-id="${CSS.escape(id)}"] .wq-input`);

  const load = async (why) => {
    if (!val('wl_dest')) { setStatus('idle', idleText()); return; }
    S.ctrl?.abort(); const ctrl = (S.ctrl = new AbortController());
    setStatus('loading', 'Jarvis подбирает вопросы…'); paintQs();
    try {
      const r = await api('discovery-questions', {
        client_id: clientId(), destination: val('wl_dest'), durationDays: days(), dateRange: range(), wellnessGoals: [...S.goals],
        allergies: allergies(), currentNotes: val('wl_notes'),
        answered: answered().map((q) => ({ question: q.text, answer: q.answer })), asked: [...S.asked],
      }, { signal: ctrl.signal });
      if (ctrl !== S.ctrl) return;
      const keep = S.questions.filter((q) => q.state === 'done' || q.state === 'later');
      const fresh = (r.questions || []).filter((q) => !keep.some((k) => k.text.toLowerCase() === q.text.toLowerCase()));
      fresh.forEach((q) => S.asked.add(q.text));
      S.questions = [...keep, ...fresh];
      S.openId = null; setStatus('ready', `Обновлено · ${hm()}`); paintQs();
    } catch (e) {
      if (e.name === 'AbortError') return;
      setStatus('error', e.message === 'rate_limited' ? 'Лимит Gemini — чуть позже' : 'Не получилось — нажмите «Обновить»'); paintQs();
    }
  };
  const schedule = () => {
    clearTimeout(S.timer); dayOptions();
    if (!val('wl_dest') || (!days() && !S.goals.size)) { setStatus('idle', idleText()); return; }
    setStatus('wait', 'Обновим через мгновение…');
    S.timer = setTimeout(() => load('auto'), 700);
  };

  // ---------- сборка промпта ----------
  const buildOut = async () => {
    if (!val('wl_dest')) { toast('Укажите место путешествия'); $('#wl_dest').focus(); return; }
    const go = $('#wl-go'); if (S.busy) return; S.busy = true; go.disabled = true; const label = go.textContent; go.textContent = 'Jarvis собирает…';
    try {
      const r = await api('gamma-prompt', {
        client_id: clientId(), guestName: val('wl_guest'), destination: val('wl_dest'), durationDays: days(), dateRange: range(), wellnessGoals: [...S.goals],
        allergies: allergies(), currentNotes: val('wl_notes'), liveNotes: val('wl_notes'), fixedAnchors: S.anchors, answers: answered().map((q) => ({ category: q.category, question: q.text, answer: q.answer })),
      }, { signal: m.signal });
      S.out = r; paintOut();
    } catch (e) { if (e.name !== 'AbortError') toast(e.message === 'rate_limited' ? 'Лимит Gemini — попробуйте чуть позже' : 'Не удалось собрать — попробуйте ещё раз', 'err'); }
    finally { S.busy = false; go.disabled = false; go.textContent = label; }
  };
  const paintOut = () => {
    const o = $('#wl-out'), r = S.out; if (!r) { o.hidden = true; return; }
    o.hidden = false;
    o.innerHTML = `<div class="wl-oh"><h3>Для Gamma и письма гостю</h3>${(r.warnings || []).length ? `<p class="wl-warn">⚠ Проверьте вручную: ${esc(r.warnings.join('; '))}</p>` : ''}</div>
      <div class="wl-ocols"><div class="wl-ocol"><span class="wl-ol">Gamma · промпт</span><pre class="wl-pre" id="wl-pre" tabindex="0"></pre>
        <div class="wl-oa"><button type="button" class="wl-pill solid" data-copy="prompt">${T.copyP}</button><a class="wl-pill" href="https://gamma.app" target="_blank" rel="noopener noreferrer">${T.open}</a></div></div>
      <div class="wl-ocol"><span class="wl-ol">Письмо гостю</span><pre class="wl-pre" id="wl-mail" tabindex="0"></pre>
        <div class="wl-oa"><button type="button" class="wl-pill solid" data-copy="mail">${T.copyM}</button></div></div></div>`;
    o.querySelector('#wl-pre').textContent = r.gammaPrompt;
    o.querySelector('#wl-mail').textContent = `${r.emailSubject}\n\n${r.emailBody}`;
    o.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // ---------- события (делегирование на форме) ----------
  let seenDates = '';
  f.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('#wl-a-add')) return addAnchor();
    const ax = t.closest('[data-ax]'); if (ax) { S.anchors.splice(+ax.dataset.ax, 1); paintAnchors(); return; }
    const dur = t.closest('[data-dur]');
    if (dur) { const n = +dur.dataset.dur; S.dur = S.dur === n ? null : n; f.querySelectorAll('[data-dur]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.dur === S.dur))); return schedule(); }
    const g = t.closest('[data-goal]');
    if (g) { const k = g.dataset.goal; S.goals.has(k) ? S.goals.delete(k) : S.goals.add(k); g.setAttribute('aria-pressed', String(S.goals.has(k))); return schedule(); }
    if (t.closest('#wl-oneoff')) {
      const inp = $('#wl_guest'), on = inp.hidden; inp.hidden = !on; $('#wl-oneoff').setAttribute('aria-expanded', String(on));
      if (on) { f.elements.wl_client.value = ''; paintDossier(); hydrateAllergies(); inp.focus(); }
      return;
    }
    if (t.closest('#wl-refresh')) { clearTimeout(S.timer); return load('manual'); }
    if (t.closest('#wl-go')) return buildOut();
    const head = t.closest('.wq-head');
    if (head) { S.openId = S.openId === head.dataset.q ? null : head.dataset.q; paintQs(); if (S.openId) box$(S.openId)?.focus(); return; }
    const ans = t.closest('[data-a]'); if (ans) return commit(ans.dataset.q, ans.dataset.a);
    const later = t.closest('[data-later]'); if (later) return commit(later.dataset.later, '', 'later');
    const sv = t.closest('[data-save]'); if (sv) return commit(sv.dataset.save, box$(sv.dataset.save)?.value || '');
    const cp = t.closest('[data-copy]');
    if (cp && S.out) {
      const text = cp.dataset.copy === 'prompt' ? S.out.gammaPrompt : `Subject: ${S.out.emailSubject}\n\n${S.out.emailBody}`, label = cp.textContent;
      let ok = true; try { await navigator.clipboard.writeText(text); } catch { ok = false; }
      if (!ok) { toast('Не удалось скопировать — выделите текст вручную'); return; }
      cp.textContent = T.copied; cp.classList.add('done'); setTimeout(() => { cp.textContent = label; cp.classList.remove('done'); }, 2200);
      return;
    }
    // даты меняются через собственный выбор — сравниваем после клика
    setTimeout(() => { const k = `${val('wl_from')}|${val('wl_to')}`; if (k !== seenDates) { seenDates = k; schedule(); } });
  });
  f.addEventListener('input', (e) => { if (e.target.id === 'wl_dest') schedule(); });
  f.addEventListener('change', (e) => {
    if (e.target.id === 'wl_client') { if (e.target.value) { $('#wl_guest').hidden = true; $('#wl-oneoff').setAttribute('aria-expanded', 'false'); } paintDossier(); hydrateAllergies(); schedule(); }
  });
  f.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList?.contains('wq-input')) { e.preventDefault(); commit(e.target.dataset.q, e.target.value); }
    else if (e.key === 'Enter' && (e.target.id === 'wl_a_act' || e.target.id === 'f-wl_a_time')) { e.preventDefault(); addAnchor(); }
    else if (e.key === 'Enter' && e.target.id === 'wl_dest') e.preventDefault();
  });
  paintDossier(); dayOptions(); paintAnchors(); setStatus('idle', idleText()); paintQs();
  m.signal.addEventListener?.('abort', () => { clearTimeout(S.timer); S.ctrl?.abort(); });
  void firstName;
}

// «Wellness Itinerary (Gamma)»: live concierge call cockpit. The whole mode is in English so it can be used on a live English call.
// Left: call intake. Right: live trip flow + discovery questions in conversation order. Output: Gamma master prompt + guest email.
// The guest's name never goes to the AI (the server fills it in after the model answers).
import { api } from './api.js';
import { esc, toast, openModal } from './ui.js';
import { state, byId } from './data.js';
import { chipField, bindChips } from './chips.js';
import { timeField, bindTimeFields, normTime } from './timefield.js';

const DURATIONS = [2, 3, 4, 5, 7];
const TAGS = ['Deep Rest', 'Slow Living', 'Detox', 'Active Recovery', 'Culinary'];
const STAGES = ['Arrival & Check-In Bridge', 'Daily Pace & Rhythm', 'Spa, Body & Contraindications', 'Food, Drinks & Allergies', 'Transfers & Privacy'];
const T = {
  title: 'Wellness Itinerary', guest: 'Guest', oneoff: '+ New Guest', oneoffPh: 'Guest name', none: 'Select a guest', dest: 'Destination', destPh: 'City, region or country',
  arr: 'Arrival Date', dep: 'Departure Date', dur: 'Duration', arrT: 'Arrival Time', depT: 'Departure Time', early: 'Early Check-In Confirmed', earlyNote: 'Standard hotel check-in is 15:00–16:00.',
  bridge: 'Pre-Check-In Bridge Needed (Arrival → 15:00 Check-In)', goal: 'Guest’s Goal & Mood', goalPh: 'In the guest’s own words…', stop: 'Allergies & Contraindications (Stop-List)', stopPh: 'Nuts, shellfish… press Enter to add',
  anch: 'Fixed Time Anchors', anchPh: 'Deep tissue massage, dinner…', add: '+ Add', anchHint: 'Locked in the itinerary at exactly this day and time. Everything else is built around them.', notes: 'Spontaneous Call Notes', notesPh: 'What the guest mentions spontaneously during the call…',
  intake: 'Call Intake & Guest Notes', flow: 'Live Trip Flow', flowEmpty: 'Add arrival and departure dates to see the day-by-day flow.', qh: 'Discovery Questions', refresh: '↻ Refresh questions',
  empty: 'Enter the guest’s goal and Jarvis will suggest what to ask next.', build: '✦ Build Gamma Prompt', copyP: 'Copy Gamma Master Prompt', copied: 'Copied ✓', open: 'Open Gamma ↗', copyM: 'Copy Guest Email', save: 'Save to Notes', captured: '✓ Captured', ans: 'Or type the guest’s answer…', outTitle: 'Gamma prompt & guest email',
};
const hm = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => ymd(new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5));
const diff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const mins = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);
const fmtT = (m) => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
const longDate = (s) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export function openWellness(presetClient) {
  const S = { anchors: [], questions: [], asked: new Set(), tags: new Set(), dur: null, timer: 0, ctrl: null, busy: false, status: 'idle', openId: null, out: null };
  const clients = [...state.clients].sort((a, b) => a.name.localeCompare(b.name));
  const opts = `<option value="">${esc(T.none)}</option>${clients.map((c) => `<option value="${esc(c.id)}"${c.id === presetClient ? ' selected' : ''}>${c.vip ? '★ ' : ''}${esc(c.name)}</option>`).join('')}`;
  const c0 = byId('clients', presetClient);
  const body = `<div class="cl-scroll wl-body"><div class="wl-grid">
    <div class="wl-left">
      <h3 class="wl-h">${T.intake}</h3>
      <div class="f"><label for="wl_client">${T.guest}</label>
        <div class="wl-guest"><select id="wl_client" name="wl_client">${opts}</select><button type="button" class="wl-pill" id="wl-oneoff" aria-expanded="false">${T.oneoff}</button></div>
        <input type="text" id="wl_guest" name="wl_guest" class="wl-oneoff-in" placeholder="${esc(T.oneoffPh)}" autocomplete="off" hidden>
        <div class="wl-dossier" id="wl-dossier" aria-live="polite"></div></div>
      <div class="f"><label for="wl_dest">${T.dest}</label><input type="text" id="wl_dest" name="wl_dest" placeholder="${esc(T.destPh)}" autocomplete="off"></div>
      <div class="f2 wl-dates"><div class="f"><label for="wl_from">${T.arr}</label><input type="date" id="wl_from" name="wl_from"></div><div class="f"><label for="wl_to">${T.dep}</label><input type="date" id="wl_to" name="wl_to"></div></div>
      <div class="f"><label id="wl-dur-l">${T.dur}</label><div class="wl-chips" role="group" aria-labelledby="wl-dur-l">${DURATIONS.map((n) => `<button type="button" class="wl-chip" data-dur="${n}" aria-pressed="false">${n} Days</button>`).join('')}</div><small class="wl-dursum tnum" id="wl-dursum" aria-live="polite"></small></div>
      <div class="f2 wl-times"><div class="f"><label for="f-wl_arr_time">${T.arrT}</label>${timeField('wl_arr_time', '', { chips: false })}</div><div class="f"><label for="f-wl_dep_time">${T.depT}</label>${timeField('wl_dep_time', '', { chips: false })}</div></div>
      <label class="wl-toggle"><input type="checkbox" id="wl_early" name="wl_early"><span>${T.early}</span></label><small class="wl-note">${T.earlyNote}</small>
      <div class="wl-bridge" id="wl-bridge" role="status" hidden>${T.bridge}</div>
      <div class="f wl-goal"><label for="wl_goal">${T.goal}</label><input type="text" id="wl_goal" name="wl_goal" placeholder="${esc(T.goalPh)}" autocomplete="off" maxlength="300">
        <div class="wl-chips wl-tags" role="group" aria-label="Quick tags">${TAGS.map((g) => `<button type="button" class="wl-tag" data-tag="${esc(g)}" aria-pressed="false">${esc(g)}</button>`).join('')}</div></div>
      <div class="f"><label for="wl_allergies-in">${T.stop}</label>${chipField('wl_allergies', c0?.allergies || [], { tone: 'risk', placeholder: T.stopPh, label: 'Allergies', remove: 'Remove' })}</div>
      <div class="f wl-anch"><label for="wl_a_act">${T.anch}</label>
        <div class="wl-achips" id="wl-achips" aria-live="polite"></div>
        <div class="wl-arow1"><select id="wl_a_day" name="wl_a_day" aria-label="Day"></select>${timeField('wl_a_time', '', { chips: false })}</div>
        <div class="wl-arow2"><input type="text" id="wl_a_act" name="wl_a_act" placeholder="${esc(T.anchPh)}" autocomplete="off" maxlength="120" enterkeyhint="done"><button type="button" class="wl-addp" id="wl-a-add">${T.add}</button></div>
        <small class="wl-ahint">${T.anchHint}</small></div>
      <div class="f"><label for="wl_notes">${T.notes}</label><textarea id="wl_notes" name="wl_notes" rows="4" placeholder="${esc(T.notesPh)}"></textarea></div>
    </div>
    <div class="wl-right">
      <section class="wl-flow" aria-label="${T.flow}"><div class="wl-fh"><h3>${T.flow}</h3><span class="wl-range tnum" id="wl-range"></span></div><div id="wl-flow"></div></section>
      <div class="wl-qh"><h3>${T.qh}</h3><span class="wl-sync" id="wl-sync" role="status" aria-live="polite"><i aria-hidden="true"></i><span></span></span><button type="button" class="wl-pill" id="wl-refresh">${T.refresh}</button></div>
      <div class="wl-qs" id="wl-qs"></div>
      <div class="wl-build"><button type="button" class="wl-go" id="wl-go">${T.build}</button></div>
    </div>
  </div>
  <section class="wl-out" id="wl-out" hidden aria-live="polite"></section></div>`;
  const m = openModal({ title: T.title, saveLabel: 'Close', body, cls: 'tp cl wl', onSave: async () => {} });
  const f = m.form;
  f.querySelector('.foot').hidden = true;
  f.querySelector('#x')?.setAttribute('aria-label', 'Close');
  bindChips(f); bindTimeFields(f);

  const $ = (s) => f.querySelector(s);
  const val = (n) => (f.elements[n]?.value || '').trim();
  const allergies = () => val('wl_allergies').split('\n').map((x) => x.trim()).filter(Boolean);
  const clientId = () => val('wl_client') || null;
  const arrival = () => val('wl_from'), departure = () => val('wl_to');
  const arrT = () => normTime(val('wl_arr_time')) || '', depT = () => normTime(val('wl_dep_time')) || '';
  const early = () => !!f.elements.wl_early.checked;
  const days = () => (arrival() && departure() && departure() >= arrival() ? diff(arrival(), departure()) + 1 : S.dur);
  const bridge = () => !!arrT() && !early() && mins(arrT()) < 14 * 60;
  const goalOk = () => !!(val('wl_goal') || S.tags.size);
  const answered = () => S.questions.filter((q) => q.state === 'done');

  // ---------- dates ⇄ duration (two-way) ----------
  const paintDur = () => {
    const n = days();
    f.querySelectorAll('[data-dur]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.dur === n)));
    $('#wl-dursum').textContent = n ? `${n} ${n === 1 ? 'Day' : 'Days'} · ${n - 1} ${n - 1 === 1 ? 'Night' : 'Nights'}` : '';
  };
  const datesChanged = () => {
    if (arrival() && departure() && departure() < arrival()) { f.elements.wl_to.value = arrival(); }
    if (arrival() && departure()) S.dur = diff(arrival(), departure()) + 1;
    paintDur();
  };
  const pickDuration = (n) => {
    S.dur = S.dur === n && !(arrival() && departure()) ? null : n;
    if (S.dur) {
      if (!arrival()) f.elements.wl_from.value = ymd(new Date(Date.now() + 864e5)); // empty arrival defaults to tomorrow
      f.elements.wl_to.value = addDays(arrival(), S.dur - 1);
    }
    paintDur();
  };

  // ---------- fixed anchors ----------
  const dayOptions = () => {
    const n = Math.min(days() || 3, 14), cur = $('#wl_a_day').value;
    const o = [['Arrival', 'Arrival day'], ...Array.from({ length: n }, (_, i) => [`Day ${i + 1}`, `Day ${i + 1}`]), ['Departure', 'Departure day']];
    $('#wl_a_day').innerHTML = o.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    $('#wl_a_day').value = o.some(([v]) => v === cur) ? cur : (o[1] || o[0])[0];
  };
  const dayLabel = (d) => (d === 'Arrival' ? 'Arrival day' : d === 'Departure' ? 'Departure day' : d);
  const dayKey = (d) => (d === 'Arrival' ? 0 : d === 'Departure' ? 999 : +d.replace(/\D/g, '') || 1);
  const paintAnchors = () => {
    $('#wl-achips').innerHTML = S.anchors.map((a, i) => `<span class="wl-ach"><span class="tnum">${esc(dayLabel(a.day))} · ${esc(a.time)}</span> — ${esc(a.activity)}<button type="button" class="wl-ax" data-ax="${i}" aria-label="Remove ${esc(a.activity)}">×</button></span>`).join('');
  };
  const addAnchor = () => {
    const act = val('wl_a_act').slice(0, 120), t = normTime(val('wl_a_time'));
    if (!act) { $('#wl_a_act').focus(); return; }
    if (!t) { toast('Add a time, e.g. 11:00'); $('#f-wl_a_time').focus(); return; }
    S.anchors.push({ day: $('#wl_a_day').value, time: t, activity: act });
    S.anchors.sort((a, b) => dayKey(a.day) - dayKey(b.day) || a.time.localeCompare(b.time));
    f.elements.wl_a_act.value = ''; f.elements.wl_a_time.value = '';
    paintAnchors(); paintFlow(); $('#wl_a_act').focus(); schedule();
  };

  // ---------- live trip flow (instant, no network) ----------
  const flowItems = () => {
    const n = days(), rows = [];
    const anchorsOf = (key) => S.anchors.filter((a) => a.day === key).map((a) => [a.time, a.activity, 'anchor']);
    if (!n) return rows;
    for (let d = 1; d <= n; d++) {
      const first = d === 1, last = d === n && n > 1;
      const it = [];
      const title = first && last ? 'Day 1' : first ? `Day 1 · ${bridge() ? 'Arrival & Bridge' : 'Arrival'}` : last ? `Day ${d} · Departure` : `Day ${d}`;
      if (first) {
        if (arrT()) it.push([arrT(), 'Arrival', 'fixed']);
        if (bridge()) it.push([arrT(), 'Bridge → 15:00 check-in', 'bridge']);
        else if (arrT()) it.push([early() ? arrT() : fmtT(Math.max(mins(arrT()), 15 * 60)), early() ? 'Early check-in' : 'Check-in', 'fixed']);
        it.push(...anchorsOf('Arrival'));
      }
      it.push(...anchorsOf(`Day ${d}`));
      if (last || (first && n === 1)) {
        it.push(...anchorsOf('Departure'));
        if (depT()) { it.push([fmtT(mins(depT()) - 180), 'Airport transfer', 'fixed']); it.push([depT(), 'Departure', 'fixed']); }
      }
      it.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      rows.push({ title, it });
    }
    return rows;
  };
  const paintFlow = () => {
    const rows = flowItems(), box = $('#wl-flow');
    $('#wl-range').textContent = arrival() && departure() ? `${longDate(arrival())} → ${longDate(departure())}` : '';
    const goal = [val('wl_goal'), ...S.tags].filter(Boolean).join(' · ');
    const notes = val('wl_notes');
    const caps = answered().length;
    const extra = [goal && `<li class="wl-fx"><b>Goal</b><span>${esc(goal.slice(0, 120))}</span></li>`, notes && `<li class="wl-fx"><b>Notes</b><span>${esc(notes.slice(0, 120))}${notes.length > 120 ? '…' : ''}</span></li>`, caps && `<li class="wl-fx"><b>Captured</b><span class="tnum">${caps} preference${caps === 1 ? '' : 's'}</span></li>`].filter(Boolean).join('');
    box.innerHTML = rows.length || extra ? `<ol class="wl-days">${rows.map((r) => `<li class="wl-day"><b class="wl-dt">${esc(r.title)}</b>${r.it.length ? `<ul>${r.it.map(([t, l, k]) => `<li class="k-${k}"><span class="tnum">${esc(t)}</span>${esc(l)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>${extra ? `<ul class="wl-fxs">${extra}</ul>` : ''}` : `<p class="wl-empty">${esc(T.flowEmpty)}</p>`;
    $('#wl-bridge').hidden = !bridge();
  };

  // ---------- guest dossier ----------
  const paintDossier = () => {
    const c = byId('clients', clientId());
    const bits = c ? [['⚠', c.allergies], ['🥗', c.diet], ['🩺', c.health], ['❤️', c.likes], ['🚫', c.dislikes]].filter(([, a]) => (a || []).length) : [];
    $('#wl-dossier').innerHTML = bits.length ? bits.map(([i, a]) => `<span class="wl-d" title="${esc(a.join(', '))}">${i} ${esc(a.slice(0, 2).join(', '))}${a.length > 2 ? ` +${a.length - 2}` : ''}</span>`).join('') : '';
  };
  const hydrateAllergies = () => {
    const c = byId('clients', clientId()), box = $('[data-chips]'), inp = box.querySelector('.chip-in');
    box.querySelectorAll('.chip').forEach((x) => x.remove());
    for (const a of (c?.allergies || [])) { inp.value = a; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
  };

  // ---------- sync status ----------
  const setStatus = (st, text) => { S.status = st; const el = $('#wl-sync'); el.dataset.s = st; el.querySelector('span').textContent = text || ''; };

  // ---------- questions (grouped in conversation order) ----------
  const card = (q) => {
    const open = S.openId === q.id;
    return `<article class="wq${open ? ' open' : ''}" data-id="${esc(q.id)}" data-state="${esc(q.state || 'new')}">
      <button type="button" class="wq-head" data-q="${esc(q.id)}" aria-expanded="${open}"><span class="wq-text">${esc(q.text)}</span>${q.state === 'done' ? `<span class="wq-st">${T.captured}</span>` : ''}${q.state === 'done' && !open ? `<span class="wq-a">${esc(q.answer)}</span>` : ''}</button>
      <div class="wq-body"><div class="wq-in"><div class="wq-chips">${(q.chips || []).slice(0, 3).map((c) => `<button type="button" class="wq-c" data-a="${esc(c)}" data-q="${esc(q.id)}">${esc(c)}</button>`).join('')}</div>
        <div class="wq-row"><input type="text" class="wq-input" data-q="${esc(q.id)}" value="${esc(q.answer || '')}" placeholder="${esc(T.ans)}" autocomplete="off" aria-label="Guest answer"><button type="button" class="wq-save" data-save="${esc(q.id)}">${T.save}</button></div></div></div></article>`;
  };
  const paintQs = () => {
    const box = $('#wl-qs');
    if (!S.questions.length) { box.innerHTML = `<p class="wl-empty">${esc(S.status === 'loading' ? 'Jarvis is preparing questions…' : T.empty)}</p>`; return; }
    box.innerHTML = STAGES.map((st, i) => {
      const qs = S.questions.filter((q) => q.category === st);
      return qs.length ? `<div class="wq-stage"><div class="wq-sh">${i + 1} · ${esc(st.toUpperCase())}</div>${qs.map(card).join('')}</div>` : '';
    }).join('');
  };
  const box$ = (id) => $(`.wq[data-id="${CSS.escape(id)}"] .wq-input`);
  const commit = (id, answer) => {
    const q = S.questions.find((x) => x.id === id); if (!q) return;
    q.answer = String(answer || '').trim().slice(0, 300); q.state = q.answer ? 'done' : 'new';
    S.openId = null; paintQs(); paintFlow();
    const next = S.questions.find((x) => x.state !== 'done');
    if (next && q.state === 'done') { S.openId = next.id; paintQs(); box$(next.id)?.focus(); }
  };
  const payload = () => ({
    client_id: clientId(), guestName: val('wl_guest'), destination: val('wl_dest'), durationDays: days(), dateRange: { from: arrival(), to: departure() },
    arrivalTime: arrT(), departureTime: depT(), earlyCheckInConfirmed: early(), goalText: val('wl_goal'), wellnessGoals: [...S.tags],
    allergies: allergies(), currentNotes: val('wl_notes'), liveNotes: val('wl_notes'), fixedAnchors: S.anchors,
  });
  const load = async () => {
    if (!goalOk()) { setStatus('idle', 'Waiting for the guest’s goal'); return; }
    S.ctrl?.abort(); const ctrl = (S.ctrl = new AbortController());
    setStatus('loading', 'Jarvis is preparing questions…'); paintQs();
    try {
      const r = await api('discovery-questions', { ...payload(), answered: answered().map((q) => ({ question: q.text, answer: q.answer })), asked: [...S.asked] }, { signal: ctrl.signal });
      if (ctrl !== S.ctrl) return;
      const keep = S.questions.filter((q) => q.state === 'done');
      const fresh = (r.questions || []).filter((q) => !keep.some((k) => k.text.toLowerCase() === q.text.toLowerCase()));
      fresh.forEach((q) => S.asked.add(q.text));
      S.questions = [...keep, ...fresh]; S.openId = null; setStatus('ready', `Updated · ${hm()}`); paintQs();
    } catch (e) {
      if (e.name === 'AbortError') return;
      setStatus('error', e.message === 'rate_limited' ? 'Gemini limit — try again shortly' : 'Could not update — tap Refresh'); paintQs();
    }
  };
  const schedule = (wait = 700) => {
    clearTimeout(S.timer);
    if (!goalOk()) { setStatus('idle', 'Waiting for the guest’s goal'); return; }
    setStatus('wait', 'Updating in a moment…');
    S.timer = setTimeout(load, wait);
  };

  // ---------- output ----------
  const buildOut = async () => {
    if (!val('wl_dest')) { toast('Add a destination first'); $('#wl_dest').focus(); return; }
    const go = $('#wl-go'); if (S.busy) return; S.busy = true; go.disabled = true; const label = go.textContent; go.textContent = 'Jarvis is writing…';
    try { S.out = await api('gamma-prompt', { ...payload(), answers: answered().map((q) => ({ category: q.category, question: q.text, answer: q.answer })) }, { signal: m.signal }); paintOut(); }
    catch (e) { if (e.name !== 'AbortError') toast(e.message === 'rate_limited' ? 'Gemini limit — try again shortly' : 'Could not build it — please retry', 'err'); }
    finally { S.busy = false; go.disabled = false; go.textContent = label; }
  };
  const paintOut = () => {
    const o = $('#wl-out'), r = S.out; if (!r) { o.hidden = true; return; }
    o.hidden = false;
    o.innerHTML = `<div class="wl-oh"><h3>${T.outTitle}</h3>${(r.warnings || []).length ? `<p class="wl-warn">⚠ Please review manually: ${esc(r.warnings.join('; '))}</p>` : ''}</div>
      <div class="wl-ocols"><div class="wl-ocol"><span class="wl-ol">Gamma · master prompt</span><pre class="wl-pre" id="wl-pre" tabindex="0"></pre>
        <div class="wl-oa"><button type="button" class="wl-pill solid" data-copy="prompt">${T.copyP}</button><a class="wl-pill" href="https://gamma.app" target="_blank" rel="noopener noreferrer">${T.open}</a></div></div>
      <div class="wl-ocol"><span class="wl-ol">Guest email</span><pre class="wl-pre" id="wl-mail" tabindex="0"></pre>
        <div class="wl-oa"><button type="button" class="wl-pill solid" data-copy="mail">${T.copyM}</button></div></div></div>`;
    o.querySelector('#wl-pre').textContent = r.gammaPrompt;
    o.querySelector('#wl-mail').textContent = `${r.emailSubject}\n\n${r.emailBody}`;
    o.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // ---------- events (delegated on the form) ----------
  f.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('#wl-a-add')) return addAnchor();
    const ax = t.closest('[data-ax]'); if (ax) { S.anchors.splice(+ax.dataset.ax, 1); paintAnchors(); paintFlow(); return schedule(); }
    const dur = t.closest('[data-dur]'); if (dur) { pickDuration(+dur.dataset.dur); dayOptions(); paintFlow(); return schedule(); }
    const tag = t.closest('[data-tag]'); if (tag) { const k = tag.dataset.tag; S.tags.has(k) ? S.tags.delete(k) : S.tags.add(k); tag.setAttribute('aria-pressed', String(S.tags.has(k))); paintFlow(); return schedule(); }
    if (t.closest('#wl-oneoff')) {
      const inp = $('#wl_guest'), on = inp.hidden; inp.hidden = !on; $('#wl-oneoff').setAttribute('aria-expanded', String(on));
      if (on) { f.elements.wl_client.value = ''; paintDossier(); hydrateAllergies(); inp.focus(); }
      return;
    }
    if (t.closest('#wl-refresh')) { clearTimeout(S.timer); return load(); }
    if (t.closest('#wl-go')) return buildOut();
    const head = t.closest('.wq-head'); if (head) { S.openId = S.openId === head.dataset.q ? null : head.dataset.q; paintQs(); if (S.openId) box$(S.openId)?.focus(); return; }
    const ans = t.closest('[data-a]'); if (ans) return commit(ans.dataset.q, ans.dataset.a);
    const sv = t.closest('[data-save]'); if (sv) return commit(sv.dataset.save, box$(sv.dataset.save)?.value || '');
    const cp = t.closest('[data-copy]');
    if (cp && S.out) {
      const text = cp.dataset.copy === 'prompt' ? S.out.gammaPrompt : `Subject: ${S.out.emailSubject}\n\n${S.out.emailBody}`, label = cp.textContent;
      let ok = true; try { await navigator.clipboard.writeText(text); } catch { ok = false; }
      if (!ok) { toast('Could not copy — select the text manually'); return; }
      cp.textContent = T.copied; cp.classList.add('done'); setTimeout(() => { cp.textContent = label; cp.classList.remove('done'); }, 2200);
    }
  });
  f.addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'wl_goal' || id === 'wl_dest') { paintFlow(); schedule(); }
    else if (id === 'wl_notes') { paintFlow(); schedule(1200); }
  });
  f.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'wl_client') { if (e.target.value) { $('#wl_guest').hidden = true; $('#wl-oneoff').setAttribute('aria-expanded', 'false'); } paintDossier(); hydrateAllergies(); schedule(); }
    else if (id === 'wl_from' || id === 'wl_to') { datesChanged(); dayOptions(); paintFlow(); schedule(); }
    else if (id === 'f-wl_arr_time' || id === 'f-wl_dep_time' || id === 'wl_early') { paintFlow(); schedule(); }
  });
  f.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList?.contains('wq-input')) { e.preventDefault(); commit(e.target.dataset.q, e.target.value); }
    else if (e.key === 'Enter' && (e.target.id === 'wl_a_act' || e.target.id === 'f-wl_a_time')) { e.preventDefault(); addAnchor(); }
    else if (e.key === 'Enter' && (e.target.id === 'wl_dest' || e.target.id === 'wl_goal')) e.preventDefault();
  });
  paintDossier(); dayOptions(); paintAnchors(); paintDur(); paintFlow(); setStatus('idle', 'Waiting for the guest’s goal'); paintQs();
  m.signal.addEventListener?.('abort', () => { clearTimeout(S.timer); S.ctrl?.abort(); });
}

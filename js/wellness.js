// «Wellness Itinerary (Gamma)»: live concierge call cockpit. The whole mode is in English so it can be used on a live English call.
// Left: call intake (party, dates, anchors, notes). Right: live trip flow + discovery questions in conversation order + Captured tab.
// Footer: Gamma prompt, guest email, and 🔗 Live Link (creates client/trip/requests and the guest portal link).
// The guest's name never goes to the AI (the server fills it in after the model answers).
import { api } from './api.js';
import { esc, toast, openModal } from './ui.js';
import { state, byId, save, patchLocal } from './data.js';
import { getSupabase } from './supabase.js';
import { chipField, bindChips } from './chips.js';
import { timeField, bindTimeFields, normTime } from './timefield.js';
import { lookupPlace } from './tz.js';
import { statusOf, firstKey } from './statuses.js';

const DURATIONS = [2, 3, 4, 5, 7];
const TAGS = ['Deep Rest', 'Slow Living', 'Detox', 'Active Recovery', 'Culinary'];
const STAGES = [{ key: 'bridge', label: 'Welcome & Arrival', short: 'Welcome' }, { key: 'pace', label: 'Pace & Rhythm', short: 'Pace' }, { key: 'dining', label: 'Dining & Stop-List', short: 'Dining' }, { key: 'wellness', label: 'Wellness & Family', short: 'Wellness' }, { key: 'transfers', label: 'Departure', short: 'Departure' }];
const DEBOUNCE = 550;
const T = {
  title: 'Wellness Itinerary', guest: 'Guest', oneoff: '+ New Guest', oneoffPh: 'Guest name', none: 'Select a guest', dest: 'Destination', destPh: 'City, region or country',
  dates: 'Trip Dates', arr: 'Arrival', dep: 'Departure', guideMsg: 'Enter Destination, Arrival/Departure times & Guest’s Goal to unlock tailored Jarvis questions…', dur: 'Duration', adults: 'Adults', kids: 'Kids', ages: 'Kids’ Ages', agesPh: 'e.g. 4 & 9 y.o.', arrT: 'Arrival Time', depT: 'Departure Time', early: 'Early Check-In Confirmed', earlyNote: 'Standard hotel check-in is 15:00–16:00.',
  bridge: 'Pre-Check-In Bridge Needed (Arrival → 15:00 Check-In)', goal: 'Guest’s Goal & Mood', goalPh: 'In the guest’s own words…', stop: 'Allergies & Contraindications (Stop-List)', stopPh: 'Nuts, shellfish… press Enter to add',
  anch: 'Fixed Time Anchors', anchPh: 'Deep tissue massage, dinner…', add: '+ Add', anchHint: 'Locked in the itinerary at exactly this date and time. Everything else is built around them.', notes: 'Spontaneous Call Notes', notesPh: 'What the guest mentions spontaneously during the call…',
  intake: 'Call Intake & Guest Notes', flow: 'Live Trip Flow', flowEmpty: 'Add arrival and departure dates to see the day-by-day flow.', qh: 'Discovery Questions', refresh: '↻ Refresh questions',
  empty: 'Jarvis is preparing the next question…', tailoring: 'Jarvis is tailoring follow-ups…', gamma: '✦ Gamma Prompt', mail: '✉ Guest Email', live: '🔗 Live Link',
  copyP: 'Copy Gamma Master Prompt', copied: 'Copied ✓', open: 'Open Gamma ↗', copyM: 'Copy Guest Email', save: 'Save to Notes', captured: '✓ Captured', ans: 'Or type the guest’s answer…', outTitle: 'Gamma prompt & guest email',
};
const hm = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => ymd(new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5));
const diff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const mins = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);
const fmtT = (m) => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
const dateLabel = (s) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDate = (s) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const longDate = (s) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const WEATHER = { rain: ['🌧', 'Rain-safe plan'], cold: ['❄️', 'Cold-weather plan'], heat: ['☀️', 'Heat-smart plan'], snow: ['🌨', 'Snow-ready plan'] };

// local date + time in a time zone → UTC ISO (for request deadlines)
function zonedIso(date, time, tz) {
  const [y, mo, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return new Date(guess - (asUtc - guess)).toISOString();
  } catch { return new Date(guess).toISOString(); }
}
const guessCategory = (t) => (/massage|spa|sauna|hammam|thermal|facial|wellness|treatment|yoga|ritual/i.test(t) ? 'Spa & Wellness' : /dinner|lunch|breakfast|brunch|restaurant|tasting|tea|coffee/i.test(t) ? 'Dining' : /pick ?up|transfer|airport|chauffeur|driver|drive|arriv|depart/i.test(t) ? 'Transport' : /check.?in|hotel|room/i.test(t) ? 'Accommodation' : /doctor|clinic|physio|gym|fitness|trainer/i.test(t) ? 'Health & Fitness' : 'Other');
const mergeCsv = (cur, add) => { const have = String(cur || '').toLowerCase(); const extra = (add || []).filter((x) => x && !have.includes(String(x).toLowerCase())); return extra.length ? [String(cur || '').trim(), ...extra].filter(Boolean).join(', ') : cur || null; };

export function openWellness(presetClient) {
  const S = { sigNotes: '', manual: false, steps: Object.fromEntries(STAGES.map((x) => [x.key, { state: 'open', qs: [], q3Locked: false, q3Busy: false }])), active: '', edit: '', customOpen: false, cur: { items: [], busy: false, auto: false, included: new Set() }, cal: { open: false, field: 'from', month: '' }, trigger: '', anchors: [], tags: new Set(), dur: null, adults: 1, kids: 0, signals: null, timer: 0, ctrl: null, busy: false, status: 'idle', out: null, outKey: '', ids: { client: null, trip: null, items: new Map() }, liveUrl: '' };
  const clients = [...state.clients].sort((a, b) => a.name.localeCompare(b.name));
  const opts = `<option value="">${esc(T.none)}</option>${clients.map((c) => `<option value="${esc(c.id)}"${c.id === presetClient ? ' selected' : ''}>${c.vip ? '★ ' : ''}${esc(c.name)}</option>`).join('')}`;
  const c0 = byId('clients', presetClient);
  const step = (k, label, min) => `<div class="wl-step" data-step="${k}" data-min="${min}"><span class="wl-sl" id="wl-s-${k}">${label}</span><div class="wl-sp" role="group" aria-labelledby="wl-s-${k}"><button type="button" data-d="-1" aria-label="Fewer ${label.toLowerCase()}">−</button><output class="tnum" aria-live="polite">${k === 'adults' ? 1 : 0}</output><button type="button" data-d="1" aria-label="More ${label.toLowerCase()}">+</button></div></div>`;
  const body = `<div class="cl-scroll wl-body"><div class="wl-grid">
    <div class="wl-left">
      <h3 class="wl-h">${T.intake}</h3>
      <div class="f"><label for="wl_client">${T.guest}</label>
        <div class="wl-guest"><select id="wl_client" name="wl_client">${opts}</select><button type="button" class="wl-pill" id="wl-oneoff" aria-expanded="false">${T.oneoff}</button></div>
        <input type="text" id="wl_guest" name="wl_guest" class="wl-oneoff-in" placeholder="${esc(T.oneoffPh)}" autocomplete="off" hidden>
        <div class="wl-dossier" id="wl-dossier" aria-live="polite"></div></div>
      <div class="f"><label for="wl_dest">${T.dest}</label><input type="text" id="wl_dest" name="wl_dest" placeholder="${esc(T.destPh)}" autocomplete="off"></div>
      <div class="f wl-range-f" id="wl-range-f"><label id="wl-rg-l">${T.dates}</label>
        <div class="wl-rbar" role="group" aria-labelledby="wl-rg-l"><button type="button" class="wl-dp" data-pick="from" aria-expanded="false" aria-controls="wl-cal"><span>${T.arr}:</span> <b id="wl-dp-from">Select date</b></button><span class="wl-arrow" aria-hidden="true">→</span><button type="button" class="wl-dp" data-pick="to" aria-expanded="false" aria-controls="wl-cal"><span>${T.dep}:</span> <b id="wl-dp-to">Select date</b></button></div>
        <input type="hidden" id="wl_from" name="wl_from"><input type="hidden" id="wl_to" name="wl_to">
        <div class="wl-cal-fold" id="wl-cal-fold" inert><div><div class="wl-cal" id="wl-cal" role="dialog" aria-label="Choose trip dates"></div></div></div></div>
      <div class="f"><label id="wl-dur-l">${T.dur}</label><div class="wl-chips" role="group" aria-labelledby="wl-dur-l">${DURATIONS.map((n) => `<button type="button" class="wl-chip" data-dur="${n}" aria-pressed="false">${n} Days</button>`).join('')}</div><small class="wl-dursum tnum" id="wl-dursum" aria-live="polite"></small></div>
      <div class="wl-party">${step('adults', T.adults, 1)}${step('kids', T.kids, 0)}</div>
      <div class="wl-fold" id="wl-ages-fold" inert><div><div class="f"><label for="wl_ages">${T.ages}</label><input type="text" id="wl_ages" name="wl_ages" placeholder="${esc(T.agesPh)}" autocomplete="off" maxlength="60"></div></div></div>
      <div class="f2 wl-times"><div class="f"><label for="f-wl_arr_time">${T.arrT}</label>${timeField('wl_arr_time', '', { chips: false })}</div><div class="f"><label for="f-wl_dep_time">${T.depT}</label>${timeField('wl_dep_time', '', { chips: false })}</div></div>
      <label class="wl-toggle"><input type="checkbox" id="wl_early" name="wl_early"><span>${T.early}</span></label><small class="wl-note">${T.earlyNote}</small>
      <div class="wl-bridge" id="wl-bridge" role="status" hidden>${T.bridge}</div>
      <div class="f wl-goal"><label for="wl_goal">${T.goal}</label><input type="text" id="wl_goal" name="wl_goal" placeholder="${esc(T.goalPh)}" autocomplete="off" maxlength="300">
        <div class="wl-chips wl-tags" role="group" aria-label="Quick tags">${TAGS.map((g) => `<button type="button" class="wl-tag" data-tag="${esc(g)}" aria-pressed="false">${esc(g)}</button>`).join('')}</div></div>
      <div class="f"><label for="wl_allergies-in">${T.stop}</label>${chipField('wl_allergies', c0?.allergies || [], { tone: 'risk', placeholder: T.stopPh, label: 'Allergies', remove: 'Remove' })}</div>
      <div class="f wl-anch"><label for="wl_a_act">${T.anch}</label>
        <div class="wl-achips" id="wl-achips" aria-live="polite"></div>
        <div class="wl-arow1"><select id="wl_a_day" name="wl_a_day" aria-label="Date"></select>${timeField('wl_a_time', '', { chips: false })}</div>
        <div class="wl-arow2"><input type="text" id="wl_a_act" name="wl_a_act" placeholder="${esc(T.anchPh)}" autocomplete="off" maxlength="120" enterkeyhint="done"><button type="button" class="wl-addp" id="wl-a-add">${T.add}</button></div>
        <small class="wl-ahint">${T.anchHint}</small></div>
      <div class="f"><label for="wl_notes">${T.notes}</label><textarea id="wl_notes" name="wl_notes" rows="4" placeholder="${esc(T.notesPh)}"></textarea><div class="wl-signals" id="wl-signals" aria-live="polite"></div></div>
    </div>
    <div class="wl-right">
      <section class="wl-flow" aria-label="${T.flow}"><div class="wl-fh"><h3>${T.flow}</h3><span class="wl-range tnum" id="wl-range"></span></div><div id="wl-flow"></div></section>
      <div class="wl-qh"><h3>${T.qh}</h3><span class="wl-sync" id="wl-sync" role="status" aria-live="polite"><i aria-hidden="true"></i><span></span></span></div>
      <div class="wl-stepper" id="wl-stepper" role="group" aria-label="Discovery stages"></div>
      <div class="wl-qs" id="wl-qs"></div>
      <section class="wl-capt" id="wl-capt" aria-label="Captured brief"></section>
      <section class="wl-cur" id="wl-cur" aria-label="Curated suggestions"></section>
      <div class="wl-build"><button type="button" class="wl-go" id="wl-go-gamma">${T.gamma}</button><button type="button" class="wl-go alt" id="wl-go-mail">${T.mail}</button><button type="button" class="wl-go live" id="wl-go-live">${T.live}</button></div>
      <div class="wl-livebar" id="wl-livebar" hidden></div>
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
  const gate = () => [['Destination', !!val('wl_dest')], ['Arrival time', !!arrT()], ['Departure time', !!depT()], ['Guest’s goal', !!(val('wl_goal') || S.tags.size)]];
  const hasBrief = () => gate().every(([, ok]) => ok);
  const stageOf = (k) => STAGES.find((x) => x.key === k);
  const entries = (k) => S.steps[k].qs;
  const answered = () => STAGES.flatMap((x) => entries(x.key).filter((en) => en.done).map((en) => ({ stage: x.key, tier: en.tier, category: x.label, text: en.text, answer: en.answer, custom: !!en.custom, id: en.id })));
  const nextStage = () => STAGES.find((x) => S.steps[x.key].state === 'open')?.key || '';
  // активный этап — первый открытый по порядку, пока консьерж сам не перешёл к другому
  const ensureActive = () => { const ok = S.steps[S.active]?.state === 'open'; if (!ok || !S.manual) S.active = nextStage(); };
  const party = () => ({ adults: S.adults, kids: S.kids, kidsAges: S.kids ? val('wl_ages') : '' });
  const partyText = () => `${S.adults} adult${S.adults === 1 ? '' : 's'}${S.kids ? `, ${S.kids} kid${S.kids === 1 ? '' : 's'}${val('wl_ages') ? ` (${val('wl_ages')})` : ''}` : ''}`;

  // ---------- custom range calendar (Warm Editorial) ----------
  const fmtFull = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const monthName = (ym) => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const paintCal = () => {
    const fold = $('#wl-cal-fold'), open = S.cal.open;
    fold.classList.toggle('open', open); fold.inert = !open;
    f.querySelectorAll('[data-pick]').forEach((b) => { b.setAttribute('aria-expanded', String(open && b.dataset.pick === S.cal.field)); b.classList.toggle('on', open && b.dataset.pick === S.cal.field); });
    if (!open) return;
    const ym = S.cal.month || (arrival() || ymd(new Date())).slice(0, 7), [y, mo] = ym.split('-').map(Number);
    const first = new Date(Date.UTC(y, mo - 1, 1)), lead = (first.getUTCDay() + 6) % 7, dim = new Date(Date.UTC(y, mo, 0)).getUTCDate(), today = ymd(new Date());
    let cells = '<span></span>'.repeat(lead);
    for (let d = 1; d <= dim; d++) {
      const date = `${ym}-${String(d).padStart(2, '0')}`, a = arrival(), b = departure();
      const cls = [date === a && 'from', date === b && 'to', a && b && date > a && date < b && 'mid', date === today && 'today'].filter(Boolean).join(' ');
      cells += `<button type="button" class="wl-cd ${cls}" data-cd="${date}" aria-label="${esc(fmtFull(date))}"${date === a || date === b ? ' aria-pressed="true"' : ''}><span class="tnum">${d}</span></button>`;
    }
    $('#wl-cal').innerHTML = `<div class="wl-ch"><button type="button" class="wl-cn" data-cn="-1" aria-label="Previous month">‹</button><b>${esc(monthName(ym))}</b><button type="button" class="wl-cn" data-cn="1" aria-label="Next month">›</button></div>
      <div class="wl-cw">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => `<span>${w}</span>`).join('')}</div><div class="wl-cg">${cells}</div>
      <div class="wl-cf"><span>${S.cal.field === 'from' ? 'Choose the arrival date' : 'Now choose the departure date'}</span></div>`;
  };
  const paintRange = () => {
    $('#wl-dp-from').textContent = arrival() ? fmtFull(arrival()) : 'Select date';
    $('#wl-dp-to').textContent = departure() ? fmtFull(departure()) : 'Select date';
    paintCal();
  };
  const setRange = (from, to) => {
    f.elements.wl_from.value = from || ''; f.elements.wl_to.value = to || '';
    f.elements.wl_to.dispatchEvent(new Event('change', { bubbles: true })); // runs the same sync as any date change
  };
  const pickDay = (date) => {
    const a = arrival(), b = departure();
    if (S.cal.field === 'from') { setRange(date, b && b >= date ? b : ''); S.cal.field = 'to'; S.cal.month = date.slice(0, 7); }
    else if (!a || date < a) { setRange(date, ''); S.cal.field = 'to'; S.cal.month = date.slice(0, 7); }
    else { setRange(a, date); S.cal.open = false; }
    paintCal();
  };
  const openCal = (field) => { S.cal.field = field; S.cal.open = !(S.cal.open && S.cal.field === field && f.querySelector(`[data-pick="${field}"].on`)); S.cal.month = (field === 'to' ? departure() || arrival() : arrival() || departure() || ymd(new Date())).slice(0, 7); paintCal(); };

  // ---------- dates ⇄ duration (two-way) ----------
  const paintDur = () => {
    paintRange();
    const n = days();
    f.querySelectorAll('[data-dur]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.dur === n)));
    $('#wl-dursum').textContent = n ? `${n} ${n === 1 ? 'Day' : 'Days'} · ${n - 1} ${n - 1 === 1 ? 'Night' : 'Nights'}` : '';
  };
  const datesChanged = () => {
    if (arrival() && departure() && departure() < arrival()) f.elements.wl_to.value = arrival();
    if (arrival() && departure()) S.dur = diff(arrival(), departure()) + 1;
    paintDur();
  };
  const pickDuration = (n) => {
    S.dur = S.dur === n && !(arrival() && departure()) ? null : n;
    if (S.dur) { if (!arrival()) f.elements.wl_from.value = ymd(new Date(Date.now() + 864e5)); f.elements.wl_to.value = addDays(arrival(), S.dur - 1); }
    paintDur();
  };

  // ---------- party steppers ----------
  const paintParty = () => {
    f.querySelectorAll('.wl-step').forEach((el) => { const k = el.dataset.step; el.querySelector('output').textContent = S[k]; el.querySelector('[data-d="-1"]').disabled = S[k] <= +el.dataset.min; });
    const fold = $('#wl-ages-fold'); fold.classList.toggle('open', S.kids > 0); fold.inert = S.kids === 0;
  };

  // ---------- fixed anchors (by calendar date) ----------
  const tripDays = () => {
    if (!(arrival() && departure() && departure() >= arrival())) return [];
    const out = [], n = Math.min(diff(arrival(), departure()) + 1, 30);
    for (let i = 0; i < n; i++) out.push({ date: addDays(arrival(), i), role: i === 0 ? 'Arrival' : i === n - 1 ? 'Departure' : '' });
    return out;
  };
  const dayOptions = () => {
    const sel = $('#wl_a_day'), cur = sel.value, ds = tripDays();
    sel.innerHTML = ds.length ? ds.map((d) => `<option value="${esc(d.date)}">${esc(dateLabel(d.date))}${d.role ? ` (${d.role})` : ''}</option>`).join('') : '<option value="">Set trip dates first</option>';
    sel.value = ds.some((d) => d.date === cur) ? cur : (ds[0]?.date || '');
  };
  const paintAnchors = () => {
    $('#wl-achips').innerHTML = S.anchors.map((a, i) => `<span class="wl-ach"><span class="tnum">${esc(dateLabel(a.date))} · ${esc(a.time)}</span> — ${esc(a.activity)}<button type="button" class="wl-ax" data-ax="${i}" aria-label="Remove ${esc(a.activity)}">×</button></span>`).join('');
  };
  const addAnchor = () => {
    const act = val('wl_a_act').replace(/^\s*\d{1,2}[:.]\d{2}\s*[-–—]?\s*/, '').slice(0, 120), t = normTime(val('wl_a_time')), date = $('#wl_a_day').value;
    if (!date) { toast('Set arrival and departure dates first'); $('[data-pick="from"]').focus(); return; }
    if (!act) { $('#wl_a_act').focus(); return; }
    if (!t) { toast('Add a time, e.g. 11:00'); $('#f-wl_a_time').focus(); return; }
    S.anchors.push({ date, time: t, activity: act });
    S.anchors.sort((x, y) => x.date.localeCompare(y.date) || x.time.localeCompare(y.time));
    f.elements.wl_a_act.value = ''; f.elements.wl_a_time.value = '';
    paintAnchors(); paintFlow(); $('#wl_a_act').focus(); trig(`New fixed anchor on ${dateLabel(date)} at ${t}: ${act}`); schedule();
  };

  // ---------- live trip flow (instant, no network) ----------
  const flowItems = () => {
    const ds = tripDays(), rows = [];
    const anchorsOf = (date) => S.anchors.filter((a) => a.date === date).map((a) => [a.time, a.activity, 'anchor']);
    ds.forEach((d, i) => {
      const first = i === 0, last = i === ds.length - 1 && ds.length > 1, it = [];
      const suffix = first && last ? '' : first ? (bridge() ? ' · Arrival & Bridge' : ' · Arrival') : last ? ' · Departure' : '';
      if (first) {
        if (arrT()) it.push([arrT(), 'Arrival', 'fixed']);
        if (bridge()) it.push([arrT(), 'Bridge → 15:00 check-in', 'bridge']);
        else if (arrT()) it.push([early() ? arrT() : fmtT(Math.max(mins(arrT()), 15 * 60)), early() ? 'Early check-in' : 'Check-in', 'fixed']);
      }
      it.push(...anchorsOf(d.date));
      if (last && depT()) { it.push([fmtT(mins(depT()) - 180), 'Airport transfer', 'fixed']); it.push([depT(), 'Departure', 'fixed']); }
      it.sort((a, c) => String(a[0]).localeCompare(String(c[0])));
      rows.push({ title: `${dateLabel(d.date)}${suffix}`, it });
    });
    return rows;
  };
  const paintFlow = () => {
    const rows = flowItems(), box = $('#wl-flow');
    $('#wl-range').textContent = arrival() && departure() ? `${longDate(arrival())} → ${longDate(departure())}` : '';
    const goal = [val('wl_goal'), ...S.tags].filter(Boolean).join(' · '), notes = val('wl_notes'), caps = answered().length;
    const extra = [`<li class="wl-fx"><b>Party</b><span>${esc(partyText())}</span></li>`, goal && `<li class="wl-fx"><b>Goal</b><span>${esc(goal.slice(0, 120))}</span></li>`, notes && `<li class="wl-fx"><b>Notes</b><span>${esc(notes.slice(0, 120))}${notes.length > 120 ? '…' : ''}</span></li>`, caps && `<li class="wl-fx"><b>Captured</b><span class="tnum">${caps} preference${caps === 1 ? '' : 's'}</span></li>`].filter(Boolean).join('');
    box.innerHTML = rows.length ? `<ol class="wl-days">${rows.map((r) => `<li class="wl-day"><b class="wl-dt">${esc(r.title)}</b>${r.it.length ? `<ul>${r.it.map(([t, l, k]) => `<li class="k-${k}"><span class="tnum">${esc(t)}</span>${esc(l)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol><ul class="wl-fxs">${extra}</ul>` : `<p class="wl-empty">${esc(T.flowEmpty)}</p><ul class="wl-fxs">${extra}</ul>`;
    $('#wl-bridge').hidden = !bridge();
  };

  // ---------- signals from the notes ----------
  const paintSignals = () => {
    const s = S.signals, pills = [];
    if (s) {
      if (s.weather && WEATHER[s.weather]) pills.push(`<span class="wl-sg weather">${WEATHER[s.weather][0]} ${WEATHER[s.weather][1]}</span>`);
      if (s.repeatVisit) pills.push('<span class="wl-sg">🏛 Repeat visitor</span>');
      (s.music || []).forEach((x) => pills.push(`<span class="wl-sg">🎵 ${esc(x)}</span>`));
      (s.dishes || []).forEach((x) => pills.push(`<span class="wl-sg">🍽 ${esc(x)}</span>`));
      (s.drinks || []).forEach((x) => pills.push(`<span class="wl-sg">🥂 ${esc(x)}</span>`));
    }
    $('#wl-signals').innerHTML = pills.join('');
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
  const setStatus = (st, text) => { S.status = st; const el = $('#wl-sync'); el.dataset.s = st; el.querySelector('span').textContent = text || ''; };

  // ---------- 5-stage stepper: 3 progressively deeper questions per stage + own Q&A + captured shelf ----------
  const trig = (x) => { if (!S.trigger.includes(x)) S.trigger = [S.trigger, x].filter(Boolean).join('; ').slice(-400); };
  const payload = () => ({
    client_id: clientId(), guestName: val('wl_guest'), destination: val('wl_dest'), durationDays: days(), dateRange: { from: arrival(), to: departure() },
    arrivalTime: arrT(), departureTime: depT(), earlyCheckInConfirmed: early(), goalText: val('wl_goal'), wellnessGoals: [...S.tags], party: party(),
    allergies: allergies(), currentNotes: val('wl_notes'), liveNotes: val('wl_notes'), fixedAnchors: S.anchors,
  });
  // Q1 and Q2 of every stage are fixed and local: 0 ms, never replaced by a network response
  const coreQs = (k) => {
    const kids = S.kids > 0, dep = depT();
    return ({
      bridge: [
        ['Would you like a private chauffeur waiting at arrivals, and which vehicle class?', ['Mercedes S/V-Class', 'Luxury SUV', 'No transfer needed']],
        bridge() ? [`Since you land at ${arrT()} before 15:00 check-in, how should we spend your morning?`, ['Scenic chauffeur tour', 'Spa lounge & breakfast', 'Request early check-in']]
          : ['Would you like to head straight to the hotel to unwind, or stop first?', ['Straight to hotel', 'Light café stop', 'Direct to dinner']],
      ],
      pace: [
        ['How many planned experiences per day feel ideal for your energy?', ['1 anchor/day (slow)', '2 balanced/day', 'Full curated days']],
        ['Do you prefer starting mornings slowly in-suite, or heading out early?', ['Slow mornings (10:30+)', 'Early start (08:30–09:00)', 'Flexible by day']],
      ],
      dining: [
        ['What dining atmosphere suits your evenings best on this trip?', ['Intimate Michelin', 'Authentic local bistro', 'Light in-suite dining']],
        ['Any allergies, dietary restrictions, or favorite drinks we should prepare ahead?', ['No restrictions', 'See stop-list', 'Wine / sommelier focus']],
      ],
      wellness: [
        ['Which wellness focus would restore you most during this stay?', ['Deep-tissue / massage', 'Thermal & hydrotherapy', 'Light / skip spa']],
        kids ? ['During your spa or dinner time, how should we care for the children?', ['Vetted in-suite nanny', 'Supervised kids’ workshop', 'Staggered parent times']]
          : ['Any preferred treatment timing (morning vs. pre-dinner) or therapist notes?', ['Late afternoon', 'Morning ritual', 'No preference']],
      ],
      transfers: [
        [`For your ${dep || 'departure'} flight, should we request a late check-out?`, ['Request late check-out', 'Standard check-out + lounge', 'Not needed']],
        ['Shall we arrange your private airport transfer, plus Fast Track or VIP lounge?', ['Chauffeur + Fast Track', 'Chauffeur only', 'No transfer needed']],
      ],
    })[k];
  };
  const ensureCore = (k) => {
    coreQs(k).forEach(([text, chips], i) => {
      const id = `${k}-c${i + 1}`; let en = entries(k).find((e) => e.id === id);
      if (!en) { en = { id, tier: i + 1, core: true, text, chips, contextTag: '', answer: '', done: false }; entries(k).push(en); }
      else if (!en.done) { en.text = text; en.chips = chips; } // pure local re-interpolation (times, kids), never from the network
    });
  };
  const std = (k) => { ensureCore(k); return entries(k).filter((en) => !en.custom).sort((a, b) => a.tier - b.tier); };
  const q3Of = (k) => entries(k).find((en) => en.tier === 3 && !en.custom);
  const paintStepper = () => {
    $('#wl-stepper').innerHTML = hasBrief() ? STAGES.map((x, i) => {
      const st = S.steps[x.key], cls = st.state === 'done' ? 'done' : st.state === 'skipped' ? 'skip' : x.key === S.active ? 'on' : '';
      return `<button type="button" class="wl-st ${cls}" data-stage="${x.key}"${x.key === S.active ? ' aria-current="step"' : ''}><i aria-hidden="true">${st.state === 'done' ? '✓' : i + 1}</i><span>${x.short}</span></button>`;
    }).join('') : '';
  };
  const subq = (en, k) => `<div class="wl-sq${en.done ? ' done' : ''}${en.fresh ? ' fresh' : ''}${en.tier === 3 ? ' deep' : ''}" data-id="${esc(en.id)}"><div class="wl-sqh"><span class="wl-sqn">${en.tier}</span><span class="wl-sqt">${en.tier === 3 ? '<em class="wl-dd">✦ Jarvis Deep-Dive</em>' : ''}${esc(en.text)}</span>${en.done ? '<span class="wq-st">✓</span>' : en.tier === 3 ? `<button type="button" class="wl-rf" data-refresh-q3="${k}" aria-label="Refresh this deep-dive question" title="Refresh"${S.steps[k].q3Busy ? ' disabled' : ''}>↻</button>` : ''}</div>
      ${en.contextTag ? `<span class="wq-tag tnum">${esc(en.contextTag)}</span>` : ''}
      <div class="wq-chips">${(en.chips || []).slice(0, 3).map((c) => `<button type="button" class="wq-c" data-ans="${esc(c)}" data-id="${esc(en.id)}" aria-pressed="${en.answer === c}">${esc(c)}</button>`).join('')}</div>
      <input type="text" class="wq-input" data-id="${esc(en.id)}" value="${esc(en.answer && !(en.chips || []).includes(en.answer) ? en.answer : '')}" placeholder="Or note the guest’s exact words…" autocomplete="off" enterkeyhint="done" aria-label="Guest answer"></div>`;
  const q3Slot = (k) => {
    const q3 = q3Of(k), st = S.steps[k];
    if (q3) return subq(q3, k);
    const core = std(k).filter((en) => !en.custom && en.tier < 3), unlocked = core.some((en) => en.done);
    return `<div class="wl-sq deep slot" data-slot="${k}"><div class="wl-sqh"><span class="wl-sqn">3</span><span class="wl-sqt"><em class="wl-dd">✦ Jarvis Deep-Dive</em>${st.q3Busy ? 'Jarvis is writing a personal follow-up…' : unlocked ? 'Preparing your personal follow-up…' : 'Answer question 1 or 2 to unlock a personal follow-up.'}</span>${unlocked && !st.q3Busy ? '<button type="button" class="wl-rf" data-refresh-q3="' + k + '" aria-label="Generate deep-dive question" title="Generate">↻</button>' : ''}</div></div>`;
  };
  const activeCard = () => {
    const x = stageOf(S.active);
    if (!x) return `<div class="wl-doneall"><b>All stages covered ✓</b><span>Everything is captured below. Review Curated Suggestions, then build the Gamma prompt or the Live Link.</span></div>`;
    const list = std(x.key).filter((en) => en.tier < 3), idx = STAGES.indexOf(x) + 1, n = std(x.key).filter((en) => en.done).length;
    const body = list.map((en) => subq(en, x.key)).join('') + q3Slot(x.key);
    const last = idx === STAGES.length;
    return `<article class="wl-act" data-stage="${x.key}"><div class="wl-ah"><span class="wq-sh">${idx} · ${esc(x.label.toUpperCase())}</span><span class="wl-prog tnum">${n} of 3</span></div>${body}
      <div class="wl-own"><button type="button" class="wl-ownb" data-own aria-expanded="${S.customOpen}">+ Ask &amp; log your own question</button>
        <div class="wl-fold${S.customOpen ? ' open' : ''}" ${S.customOpen ? '' : 'inert'}><div><div class="wl-owng"><label for="wl-cq">Your question (optional)</label><input type="text" id="wl-cq" placeholder="e.g. Vintage Champagne or a non-alcoholic welcome?" autocomplete="off" maxlength="160"><label for="wl-ca">Guest’s answer</label><input type="text" id="wl-ca" placeholder="What the guest said…" autocomplete="off" maxlength="300" enterkeyhint="done"><button type="button" class="wq-save" data-own-save>Save to Stage ✓</button></div></div></div></div>
      <div class="wl-nav"><button type="button" class="wl-skip" data-skip-stage>Skip Stage</button><button type="button" class="wl-next" data-next-stage>${last ? 'Finish ✓' : 'Next Stage →'}</button></div></article>`;
  };
  const captured = () => {
    const groups = STAGES.map((x) => [x, entries(x.key).filter((en) => en.done)]).filter(([, l]) => l.length);
    const total = groups.reduce((n, [, l]) => n + l.length, 0);
    if (!total) return `<div class="wl-ch2"><b>Captured Brief</b><span class="tnum">0</span></div><p class="wl-empty small">Answers you capture appear here, grouped by stage.</p>`;
    return `<div class="wl-ch2"><b>Captured Brief</b><span class="tnum">${total}</span></div>${groups.map(([x, l]) => `<div class="wl-cg2"><span class="wq-sh">${esc(x.label.toUpperCase())}</span>${l.map((en) => `<div class="wl-ci" data-id="${esc(en.id)}"><div class="wl-cq">${esc(en.text)}${en.custom ? ' · own question' : ''}</div>
      ${S.edit === en.id ? `<div class="wq-row"><input type="text" class="wq-input" data-id="${esc(en.id)}" data-edit-in value="${esc(en.answer)}" autocomplete="off" aria-label="Edit answer"><button type="button" class="wq-save" data-sv="${esc(en.id)}">Save</button></div>` : `<div class="wl-ca"><span>${esc(en.answer)}</span><button type="button" class="wl-edit" data-edit="${esc(en.id)}">Edit</button></div>`}</div>`).join('')}</div>`).join('')}`;
  };
  const paintQs = () => {
    ensureActive();
    const box = $('#wl-qs');
    paintStepper(); paintCur();
    if (!hasBrief()) { box.innerHTML = `<div class="wl-guide"><p>${esc(T.guideMsg)}</p><ul>${gate().map(([l, ok]) => `<li class="${ok ? 'ok' : 'no'}"><i aria-hidden="true">${ok ? '✓' : '○'}</i>${esc(l)}</li>`).join('')}</ul></div>`; $('#wl-capt').innerHTML = ''; return; }
    box.innerHTML = activeCard();
    $('#wl-capt').innerHTML = captured();
  };
  const find = (id) => { for (const x of STAGES) { const en = entries(x.key).find((e) => e.id === id); if (en) return [x, en]; } return [null, null]; };
  const stageCleanup = () => { S.edit = ''; S.customOpen = false; };
  const closeStage = (key, state) => {
    const st = S.steps[key], act = f.querySelector('#wl-qs .wl-act');
    const finish = () => { st.state = state; stageCleanup(); S.manual = false; paintQs(); paintFlow(); };
    if (act && !matchMedia('(prefers-reduced-motion: reduce)').matches) { act.classList.add('leaving'); setTimeout(finish, 260); } else finish();
  };
  const answer = (id, text) => {
    const [x, en] = find(id); if (!en) return;
    const ans = String(text || '').trim().slice(0, 300); if (!ans) return;
    const wasDone = en.done; en.answer = ans; en.done = true; S.edit = '';
    paintQs(); paintFlow();
    const list = std(x.key);
    if (!wasDone && list.length >= 3 && list.every((e) => e.done) && S.steps[x.key].state === 'open') { setTimeout(() => closeStage(x.key, 'done'), 380); return; }
    if (en.tier < 3 && !q3Of(x.key)) fetchQ3(x.key); // Q3 only after Q1 or Q2 was answered
  };
  const saveOwn = () => {
    const x = stageOf(S.active); if (!x) return;
    const q = ($('#wl-cq')?.value || '').trim(), a = ($('#wl-ca')?.value || '').trim();
    if (!a) { $('#wl-ca')?.focus(); return; }
    entries(x.key).push({ id: `own-${x.key}-${Date.now()}`, tier: 0, custom: true, text: q || 'Guest note', chips: [], contextTag: '', answer: a.slice(0, 300), done: true });
    S.customOpen = false; paintQs(); paintFlow(); toast('Saved to ' + x.label);
  };
  // Q3 deep-dive: one personalised question per stage, only after Q1/Q2; once shown it is LOCKED until the concierge taps ↻
  const fetchQ3 = async (k, force) => {
    const st = S.steps[k]; if (st.q3Busy || (q3Of(k) && !force) || !hasBrief()) return;
    if (!force && !std(k).some((en) => en.tier < 3 && en.done)) return;
    if (force && q3Of(k)?.done) return;
    st.q3Busy = true; setStatus('loading', T.tailoring); paintQs();
    try {
      const r = await api('discovery-questions', { kind: 'discovery', focusStage: k, ...payload(), answered: answered().map((a) => ({ stage: a.stage, tier: a.tier, question: a.text, answer: a.answer })) }, { signal: m.signal });
      if (r.signals) { S.signals = r.signals; paintSignals(); }
      const q = (r.questions || [])[0];
      if (q) { st.qs = st.qs.filter((en) => en.tier !== 3 || en.custom); st.qs.push({ id: `${k}-q3`, tier: 3, text: q.text, chips: q.chips, contextTag: q.contextTag, answer: '', done: false, fresh: true }); st.q3Locked = true; }
      setStatus('ready', `Deep-dive ready · ${hm()}`);
    } catch (e) { if (e.name === 'AbortError') return; setStatus('error', e.message === 'rate_limited' ? 'Gemini limit — try again shortly' : 'Could not load the deep-dive — tap ↻'); }
    finally { st.q3Busy = false; paintQs(); setTimeout(() => { entries(k).forEach((en) => { en.fresh = false; }); f.querySelectorAll('.wl-sq.fresh').forEach((el) => el.classList.remove('fresh')); }, 900); maybeCurate(); }
  };
  // free-form notes → signal pills (weather, repeat visit, music, dishes); the questions themselves are never touched
  const loadSignals = async () => {
    const notes = val('wl_notes'); if (notes === S.sigNotes) return; S.sigNotes = notes;
    if (!notes) { S.signals = null; paintSignals(); return; }
    S.ctrl?.abort(); const ctrl = (S.ctrl = new AbortController());
    try {
      const r = await api('discovery-questions', { kind: 'discovery', signalsOnly: true, currentNotes: val('wl_notes') }, { signal: ctrl.signal });
      if (ctrl === S.ctrl && r.signals) { S.signals = r.signals; paintSignals(); }
    } catch { /* signals are optional */ }
  };
  const schedule = (wait = DEBOUNCE) => { paintQs(); clearTimeout(S.timer); S.timer = setTimeout(loadSignals, wait); }; // core questions re-interpolate locally; notes feed the signal pills

  // ---------- ✦ Curated Suggestions (before the Gamma export) ----------
  const KIND = { bridge: 'Morning bridge', venue: 'Signature venue', touch: 'Service touch' };
  const paintCur = () => {
    const box = $('#wl-cur'), c = S.cur;
    if (!hasBrief()) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="wl-curh"><b>✦ Curated Suggestions</b><button type="button" class="wl-pill" data-curate ${c.busy ? 'disabled' : ''}>${c.busy ? 'Jarvis is curating…' : c.items.length ? '↻ Re-curate' : '✦ Suggest Venues &amp; Service Touches'}</button></div>
      ${c.items.length ? `<div class="wl-curl">${c.items.map((x) => { const inc = c.included.has(x.id); return `<article class="wl-cc${inc ? ' inc' : ''}"><div class="wl-cck"><span class="wq-tag">${esc(KIND[x.kind] || 'Idea')}</span></div><h5>${esc(x.title)}</h5>${x.venueName ? `<div class="wl-cv">${esc(x.venueName)}</div>` : ''}<p>${esc(x.why)}</p><button type="button" class="wl-inc" data-inc="${esc(x.id)}" aria-pressed="${inc}">${inc ? '✓ Included' : '+ Add to Proposal'}</button></article>`; }).join('')}</div>` : '<p class="wl-empty small">Approve what you like — only included ideas go into the Gamma proposal.</p>'}`;
  };
  const curate = async () => {
    if (S.cur.busy || !val('wl_dest')) return;
    S.cur.busy = true; S.cur.auto = true; paintCur();
    try {
      const r = await api('ideas', { kind: 'curate', ...payload(), signals: S.signals, answers: answered().map((a) => ({ category: a.category, question: a.text, answer: a.answer })) }, { signal: m.signal });
      S.cur.items = r.suggestions || []; S.cur.included = new Set([...S.cur.included].filter((id) => S.cur.items.some((x) => x.id === id)));
    } catch (e) { if (e.name !== 'AbortError') toast(e.message === 'rate_limited' ? 'Gemini limit — try again shortly' : 'Could not curate suggestions — please retry', 'err'); }
    finally { S.cur.busy = false; paintCur(); }
  };
  const maybeCurate = () => { // automatically once at least two stages have captured answers
    if (S.cur.auto || S.cur.items.length) return;
    if (STAGES.filter((x) => entries(x.key).some((en) => en.done)).length >= 2) curate();
  };

  // ---------- Gamma prompt / guest email ----------
  const emailText = () => {
    const r = S.out; if (!r) return '';
    let body = r.emailBody;
    if (S.liveUrl) { const line = `Your live itinerary: ${S.liveUrl}`; body = /Warm regards,?/i.test(body) ? body.replace(/(\n*)(Warm regards,?)/i, `\n\n${line}\n\n$2`) : `${body}\n\n${line}`; }
    return `Subject: ${r.emailSubject}\n\n${body}`;
  };
  const buildOut = async (focus) => {
    if (!val('wl_dest')) { toast('Add a destination first'); $('#wl_dest').focus(); return false; }
    if (S.busy) return false;
    const approved = S.cur.items.filter((x) => S.cur.included.has(x.id)).map(({ kind, title, venueName, why }) => ({ kind, title, venueName, why }));
    const key = JSON.stringify([payload(), answered().map((q) => q.answer), S.signals, approved]);
    if (S.out && S.outKey === key) { paintOut(focus); return true; }
    S.busy = true; f.querySelectorAll('.wl-go').forEach((b) => (b.disabled = true));
    const labels = ['gamma', 'mail', 'live'].map((k) => { const b = $(`#wl-go-${k}`); const l = b.textContent; if (k === focus || (k === 'live' && focus === 'live')) b.textContent = 'Jarvis is writing…'; return l; });
    try { S.out = await api('gamma-prompt', { kind: 'gamma', ...payload(), signals: S.signals, approvedSuggestions: approved, answers: answered().map((q) => ({ category: q.category, question: q.text, answer: q.answer })) }, { signal: m.signal }); S.outKey = key; paintOut(focus); return true; }
    catch (e) { if (e.name !== 'AbortError') toast(e.message === 'rate_limited' ? 'Gemini limit — try again shortly' : 'Could not build it — please retry', 'err'); return false; }
    finally { S.busy = false; f.querySelectorAll('.wl-go').forEach((b) => (b.disabled = false)); ['gamma', 'mail', 'live'].forEach((k, i) => { $(`#wl-go-${k}`).textContent = labels[i]; }); }
  };
  const paintOut = (focus) => {
    const o = $('#wl-out'), r = S.out; if (!r) { o.hidden = true; return; }
    o.hidden = false;
    o.innerHTML = `<div class="wl-oh"><h3>${T.outTitle}</h3>${(r.warnings || []).length ? `<p class="wl-warn">⚠ Please review manually: ${esc(r.warnings.join('; '))}</p>` : ''}</div>
      <div class="wl-ocols"><div class="wl-ocol" id="wl-oc-prompt"><span class="wl-ol">Gamma · master prompt</span><pre class="wl-pre" id="wl-pre" tabindex="0"></pre>
        <div class="wl-oa"><button type="button" class="wl-pill solid" data-copy="prompt">${T.copyP}</button><a class="wl-pill" href="https://gamma.app" target="_blank" rel="noopener noreferrer">${T.open}</a></div></div>
      <div class="wl-ocol" id="wl-oc-mail"><span class="wl-ol">Guest email</span><pre class="wl-pre" id="wl-mail" tabindex="0"></pre>
        <div class="wl-oa"><button type="button" class="wl-pill solid" data-copy="mail">${T.copyM}</button></div></div></div>`;
    o.querySelector('#wl-pre').textContent = r.gammaPrompt;
    o.querySelector('#wl-mail').textContent = emailText();
    if (focus !== 'live') (o.querySelector(focus === 'mail' ? '#wl-oc-mail' : '#wl-oc-prompt') || o).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // ---------- 🔗 Live Link: client → trip → portal link → requests ----------
  const confirmedKey = () => (statusOf('confirmed') ? 'confirmed' : (state.statuses.find((s) => /подтвержд|confirm/i.test(s.label))?.key || firstKey()));
  const liveLink = async () => {
    if (S.busy) return;
    if (!val('wl_dest')) { toast('Add a destination first'); $('#wl_dest').focus(); return; }
    if (!(arrival() && departure())) { toast('Set arrival and departure dates first'); $('[data-pick="from"]').focus(); return; }
    if (!clientId() && !val('wl_guest')) { toast('Choose a guest or add a new one'); $('#wl_client').focus(); return; }
    if (!(await buildOut('live')) || !S.out) return;
    const btn = $('#wl-go-live'), label = btn.textContent; S.busy = true; f.querySelectorAll('.wl-go').forEach((b) => (b.disabled = true)); btn.textContent = 'Creating live itinerary…';
    try {
      const sb = await getSupabase();
      // 1) client
      const sg = S.signals || {};
      const patch = { allergies: allergies() };
      const cur = byId('clients', S.ids.client || clientId());
      if (cur) {
        const music = mergeCsv(cur.pref_music, [...(sg.music || [])]), food = mergeCsv(cur.pref_food, [...(sg.dishes || []), ...(sg.drinks || [])]);
        Object.assign(patch, music && music !== cur.pref_music ? { pref_music: music } : {}, food && food !== cur.pref_food ? { pref_food: food } : {});
        const row = await save('clients', cur.id, patch); S.ids.client = row.id;
      } else {
        const row = await save('clients', null, { name: val('wl_guest'), language: 'EN', allergies: allergies(), ...(sg.music?.length ? { pref_music: sg.music.join(', ') } : {}), ...(sg.dishes?.length || sg.drinks?.length ? { pref_food: [...(sg.dishes || []), ...(sg.drinks || [])].join(', ') } : {}) });
        S.ids.client = row.id;
      }
      const cid = S.ids.client, client = byId('clients', cid);
      // 2) trip
      const place = await lookupPlace(val('wl_dest')), tz = place?.tz || client?.home_tz || 'Europe/Paris';
      const tripRow = await save('trips', S.ids.trip, {
        client_id: cid, city: val('wl_dest'), country: place?.country || null, country_code: place?.cc || null, start_date: arrival(), end_date: departure(), tz,
        flight_in_at: arrT() ? zonedIso(arrival(), arrT(), tz) : null, flight_out_at: depT() ? zonedIso(departure(), depT(), tz) : null, lat: place?.lat ?? null, lon: place?.lon ?? null,
        companions: partyText(), notes: val('wl_notes') || null,
      });
      S.ids.trip = tripRow.id;
      // 3) portal link (the guest portal is per guest)
      let token = client?.portal_token;
      if (!token) { const { data, error } = await sb.rpc('client_portal_share', { p_client: cid, p_mode: 'on' }); if (error) throw error; token = data; patchLocal('clients', cid, { portal_token: token || null }); }
      if (!token) throw new Error('no portal link');
      // 4) requests: every anchor and itinerary item
      const status = confirmedKey(), items = new Map();
      // ONLY what the concierge confirmed with the guest: fixed anchors + bookings the model found stated in the notes/answers. Creative suggestions stay in the Gamma proposal.
      for (const i of (S.out.confirmedBookings || [])) items.set(`${i.date}|${i.time}|${i.title.toLowerCase()}`, { date: i.date, time: i.time, title: i.title, category: i.category, venueName: i.venueName, address: i.address, guestNotes: i.guestNotes });
      for (const a of S.anchors) { // anchors are authoritative: replace a booking at the same slot
        for (const [k, v] of items) if (v.date === a.date && v.time === a.time) items.delete(k);
        items.set(`${a.date}|${a.time}|${a.activity.toLowerCase()}`, { date: a.date, time: a.time, title: a.activity, category: guessCategory(a.activity), venueName: '', address: '', guestNotes: '' });
      }
      let n = 0;
      for (const [k, it] of items) {
        const data = { client_id: cid, trip_id: S.ids.trip, summary: it.title, category: it.category || 'Other', status, urgency: 'normal', deadline: zonedIso(it.date, it.time, tz), guest_visible: true,
          venue: it.venueName ? { name: it.venueName, address: it.address || '' } : null, guest_note: it.guestNotes || null, original_message: 'Jarvis: Wellness itinerary' };
        const row = await save('requests', S.ids.items.get(k) || null, data); S.ids.items.set(k, row.id); n++;
      }
      // 5) link: clipboard + portal pill + into the guest email
      S.liveUrl = `${location.origin}/t/${token}`;
      let ok = true; try { await navigator.clipboard.writeText(S.liveUrl); } catch { ok = false; }
      $('#wl-livebar').hidden = false;
      $('#wl-livebar').innerHTML = `<span class="wl-ok">${ok ? 'Live Link Copied ✓' : 'Live Link ready'}</span><a class="wl-pill" href="${esc(S.liveUrl)}" target="_blank" rel="noopener noreferrer">Open Portal ↗</a><span class="wl-lm tnum">${n} confirmed item${n === 1 ? '' : 's'} on the Board, Calendar and portal</span>`;
      paintOut('live');
      toast(n ? `Live itinerary created · ${n} confirmed item${n === 1 ? '' : 's'}` : 'Live link ready · no confirmed items yet (add Fixed Time Anchors)');
    } catch (e) {
      toast('Could not create the live link: ' + (e.message || e), 'err');
    } finally { S.busy = false; f.querySelectorAll('.wl-go').forEach((b) => (b.disabled = false)); btn.textContent = label; }
  };

  // ---------- events (delegated on the form) ----------
  f.addEventListener('click', async (e) => {
    const t = e.target;
    const pk = t.closest('[data-pick]'); if (pk) return openCal(pk.dataset.pick);
    const cd = t.closest('[data-cd]'); if (cd) return pickDay(cd.dataset.cd);
    const cn = t.closest('[data-cn]'); if (cn) { const [y, mo] = (S.cal.month || ymd(new Date()).slice(0, 7)).split('-').map(Number); S.cal.month = new Date(Date.UTC(y, mo - 1 + +cn.dataset.cn, 1)).toISOString().slice(0, 7); return paintCal(); }
    if (S.cal.open && !t.closest('.wl-range-f')) { S.cal.open = false; paintCal(); }
    if (t.closest('#wl-a-add')) return addAnchor();
    const st = t.closest('.wl-step [data-d]');
    if (st) { const k = st.closest('.wl-step').dataset.step, min = +st.closest('.wl-step').dataset.min; S[k] = Math.min(20, Math.max(min, S[k] + +st.dataset.d)); paintParty(); paintFlow(); if (k === 'kids' && S.kids) setTimeout(() => $('#wl_ages').focus({ preventScroll: true }), 450); trig(`Party changed: ${partyText()}`); return schedule(); }
    const stp = t.closest('.wl-st');
    if (stp) {
      const k = stp.dataset.stage, st = S.steps[k];
      if (st.state !== 'open') st.state = 'open'; // reopen a finished or skipped stage
      S.active = k; S.manual = true; stageCleanup(); paintQs();
      if (!q3Of(k) && std(k).some((en) => en.tier < 3 && en.done)) fetchQ3(k);
      return;
    }
    const ax = t.closest('[data-ax]'); if (ax) { const gone = S.anchors.splice(+ax.dataset.ax, 1)[0]; paintAnchors(); paintFlow(); trig(`Anchor removed: ${gone.activity}`); return schedule(); }
    const dur = t.closest('[data-dur]'); if (dur) { pickDuration(+dur.dataset.dur); dayOptions(); paintFlow(); return schedule(); }
    const tag = t.closest('[data-tag]'); if (tag) { const k = tag.dataset.tag; S.tags.has(k) ? S.tags.delete(k) : S.tags.add(k); tag.setAttribute('aria-pressed', String(S.tags.has(k))); paintFlow(); return schedule(); }
    if (t.closest('#wl-oneoff')) {
      const inp = $('#wl_guest'), on = inp.hidden; inp.hidden = !on; $('#wl-oneoff').setAttribute('aria-expanded', String(on));
      if (on) { f.elements.wl_client.value = ''; paintDossier(); hydrateAllergies(); inp.focus(); }
      return;
    }
    if (t.closest('#wl-go-gamma')) return buildOut('gamma');
    if (t.closest('#wl-go-mail')) return buildOut('mail');
    if (t.closest('#wl-go-live')) return liveLink();
    const ans = t.closest('[data-ans]'); if (ans) return answer(ans.dataset.id, ans.dataset.ans);
    const sv = t.closest('[data-sv]'); if (sv) return answer(sv.dataset.sv, f.querySelector(`#wl-capt .wq-input[data-id="${CSS.escape(sv.dataset.sv)}"]`)?.value || '');
    const ed = t.closest('[data-edit]'); if (ed) { S.edit = ed.dataset.edit; paintQs(); f.querySelector('#wl-capt .wq-input')?.focus(); return; }
    const rq = t.closest('[data-refresh-q3]'); if (rq) return fetchQ3(rq.dataset.refreshQ3, true);
    if (t.closest('[data-own]')) { S.customOpen = !S.customOpen; paintQs(); if (S.customOpen) setTimeout(() => $('#wl-cq')?.focus({ preventScroll: true }), 400); return; }
    if (t.closest('[data-own-save]')) return saveOwn();
    if (t.closest('[data-skip-stage]')) return closeStage(S.active, 'skipped');
    if (t.closest('[data-next-stage]')) { const st = S.steps[S.active]; return closeStage(S.active, entries(S.active).some((en) => en.done) ? 'done' : 'skipped'); }
    if (t.closest('[data-curate]')) return curate();
    const inc = t.closest('[data-inc]'); if (inc) { const id = inc.dataset.inc; S.cur.included.has(id) ? S.cur.included.delete(id) : S.cur.included.add(id); paintCur(); return; }
    const cp = t.closest('[data-copy]');
    if (cp && S.out) {
      const text = cp.dataset.copy === 'prompt' ? S.out.gammaPrompt : emailText(), label = cp.textContent;
      let ok = true; try { await navigator.clipboard.writeText(text); } catch { ok = false; }
      if (!ok) { toast('Could not copy — select the text manually'); return; }
      cp.textContent = T.copied; cp.classList.add('done'); setTimeout(() => { cp.textContent = label; cp.classList.remove('done'); }, 2200);
    }
  });
  f.addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'wl_goal' || id === 'wl_dest' || id === 'wl_notes' || id === 'wl_ages') { paintFlow(); trig(id === 'wl_notes' ? 'New spontaneous call notes' : id === 'wl_ages' ? 'Kids ages changed' : id === 'wl_goal' ? 'Goal changed' : 'Destination changed'); schedule(); }
  });
  f.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'wl_client') { if (e.target.value) { $('#wl_guest').hidden = true; $('#wl-oneoff').setAttribute('aria-expanded', 'false'); } paintDossier(); hydrateAllergies(); schedule(); }
    else if (id === 'wl_from' || id === 'wl_to') { datesChanged(); dayOptions(); paintFlow(); trig(`Trip dates changed to ${arrival()} - ${departure()}`); schedule(); }
    else if (id === 'f-wl_arr_time' || id === 'f-wl_dep_time' || id === 'wl_early') { paintFlow(); schedule(); }
  });
  f.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.cal.open) { e.stopPropagation(); e.preventDefault(); S.cal.open = false; paintCal(); f.querySelector(`[data-pick="${S.cal.field}"]`)?.focus(); return; }
    if (e.key === 'Enter' && e.target.classList?.contains('wq-input')) { e.preventDefault(); answer(e.target.dataset.id, e.target.value); }
    else if (e.key === 'Enter' && (e.target.id === 'wl-ca' || e.target.id === 'wl-cq')) { e.preventDefault(); saveOwn(); }
    else if (e.key === 'Enter' && (e.target.id === 'wl_a_act' || e.target.id === 'f-wl_a_time')) { e.preventDefault(); addAnchor(); }
    else if (e.key === 'Enter' && (e.target.id === 'wl_dest' || e.target.id === 'wl_goal' || e.target.id === 'wl_ages')) e.preventDefault();
  });
  paintDossier(); dayOptions(); paintAnchors(); paintDur(); paintParty(); paintFlow(); setStatus('idle', 'Waiting for the call brief'); paintQs();
  m.signal.addEventListener?.('abort', () => { clearTimeout(S.timer); S.ctrl?.abort(); });
}

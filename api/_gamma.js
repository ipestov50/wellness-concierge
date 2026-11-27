// «Мастер-промпт для Gamma» и письмо гостю: из данных звонка, досье и ответов чек-листа. Только для владельца.
// Имя гостя в ИИ не отправляется: в тексте стоит {{GUEST}}, имя подставляется здесь уже после ответа модели.
import { gfetch, FLASH, LITE } from './_cache.js';
import { owner, askJSON, norm } from './_owner.js';
import { parseTrip, dossier, list, str, firstName, parseAnchors, bridgeNeeded } from './_wellness.js';

const SECTIONS = ['A personalised wellness experience', 'Your personalised itinerary', 'Selected experiences', 'A few final details'];
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    gammaPrompt: { type: 'STRING', description: 'Slide-structured master prompt for Gamma.app, slides separated by a line with ---' },
    emailSubject: { type: 'STRING', description: 'Warm, short email subject line in English' },
    emailBody: { type: 'STRING', description: 'Ready-to-send guest email in refined hospitality English' },
  },
  required: ['gammaPrompt', 'emailSubject', 'emailBody'],
};
const missing = (p) => SECTIONS.filter((s) => !p.toLowerCase().includes(s.toLowerCase()));
const lostAnchors = (p, anchors) => anchors.filter((a) => !p.includes(a.time)).map((a) => `${a.day} ${a.time}`);
const leaks = (text, stop) => stop.map(norm).filter((w) => w.length >= 4 && norm(text).includes(w));

export default async function handler(req, res) {
  const auth = await owner(req, res); if (!auth) return;
  const b = req.body || {};
  const t = parseTrip(b);
  if (!t.destination) return res.status(400).json({ error: 'no_destination' });
  try {
    const d = await dossier(auth, b.client_id, list(b.allergies, 20));
    const answers = (Array.isArray(b.answers) ? b.answers : []).slice(0, 20).map((x) => ({ category: str(x?.category, 40), question: str(x?.question, 200), answer: str(x?.answer, 300) })).filter((x) => x.question && x.answer);
    const anchors = parseAnchors(b.fixedAnchors), liveNotes = str(b.liveNotes, 1500) || t.notes;
    const first = firstName(d.client?.name || str(b.guestName, 80));
    const ctx = {
      destination: t.destination, durationDays: t.durationDays, nights: t.durationDays ? t.durationDays - 1 : null, arrivalTime: t.arrivalTime || null, departureTime: t.departureTime || null, earlyCheckInConfirmed: t.earlyCheckIn, preCheckInBridgeNeeded: bridgeNeeded(t), guestGoalInTheirWords: t.goalText || null, dates: t.from ? `${t.from}${t.to ? ' to ' + t.to : ''}` : null, wellnessGoals: t.goals,
      stopList_mustNeverAppearAsRecommendation: d.stop, guestProfile: d.profile, liveNotes, fixedAnchors: anchors, discoveryAnswers: answers,
    };
    const system = `You are a senior Les Clefs d'Or concierge preparing a bespoke wellness journey proposal.
Return three things:
1) gammaPrompt — a master prompt for Gamma.app. Slides are separated by a line containing only ---. It MUST contain exactly these four sections, each as the title of its own slide (or group of slides), in this order, spelled exactly: "${SECTIONS.join('", "')}". Under each, give precise instructions and the real content: a day-by-day itinerary adapted to the destination's geography, season and the stated duration; selected experiences matched to the goals; practical details (timing, privacy, logistics). Add design directives at the top: Aman / Kinfolk minimalist editorial, generous white space, warm neutral parchment palette with deep green accent, elegant serif headings, restrained photography, no stock clichés, no clutter.
2) emailSubject and emailBody — a warm, discreet guest email in refined hospitality English: greeting "Dear {{GUEST}},", a brief personal introduction to the proposal, three highlights, and a soft call to action; sign off "Warm regards,".
SCHEDULE LOCK (non-negotiable): every item in fixedAnchors AND every explicit day or time the guest or concierge mentions in liveNotes is a HARD SCHEDULE ANCHOR. It MUST appear in the slide titled "Your personalised itinerary" on exactly that day and at exactly that HH:MM, written like "11:00 — <activity>", without moving, merging or renaming the commitment. Build everything else (spa rituals, meals, transfers with realistic buffers before and after each anchor, rest) around the anchors, and never schedule two things at the same time. Days are numbered from Day 1 of the trip; Arrival and Departure are the first and last day.
QUALITY RULES (strict):
- ARRIVAL AND DEPARTURE TIMES. arrivalTime and departureTime (when given) are fixed: nothing may happen before arrivalTime on Day 1 and nothing after the airport transfer on the last day. Standard hotel check-in is 15:00-16:00. If preCheckInBridgeNeeded is true, build a "pre-check-in bridge" from arrival until about 15:00 that suits the guest's goal (for example a scenic private chauffeur drive, a quiet private gallery visit, or thermal lounge access) and keep it light; if earlyCheckInConfirmed is true, go straight to the room.
- LESS IS MORE. Never invent busy excursions the guest did not ask for (food markets, private chefs, Michelin tours, galleries, sightseeing). For Deep Rest, Slow Living or any restorative goal keep every day spacious: at most 2-3 intentional touchpoints per day (one core wellness ritual, one restorative meal, unhurried quiet time), each tied to the stated goals, discoveryAnswers or anchors.
- CAUSAL CHRONOLOGY. Translate anchor labels into natural hospitality English (e.g. an arrival becomes "Arrival at the airport", a massage becomes "Restorative full-body massage"). If an Arrival time is anchored, NOTHING (airport pickup, check-in, activities) may be scheduled before it: private chauffeur pickup at that time, check-in about 45 minutes later, then a light in-suite dinner roughly 90 minutes after pickup. If a Departure time is anchored, schedule the airport transfer 2.5-3 hours before that flight, with nothing after it.
- PURE ENGLISH. gammaPrompt and emailBody must contain zero Cyrillic characters: translate every Russian note, answer, goal and stop-list item into English yourself, and treat the English equivalents of stopList items as forbidden too.
- REAL VENUES. In "Selected experiences" recommend real, specific luxury wellness, spa and dining venues in or near the destination (only ones you are confident exist; otherwise name the exact type of place and area), compatible with the stop-list, and for each explain in one sentence WHY it fits this guest's stated preferences. No generic hotel clichés (pillow menus, welcome tea).
Hard rules: NEVER recommend, mention as an option, or include anything from stopList_mustNeverAppearAsRecommendation (allergies, dietary and medical restrictions of the guest and family). Honour guestProfile and every item in discoveryAnswers. Use {{GUEST}} wherever the guest's first name belongs. Do not invent facts about the guest; real places only when you are confident, otherwise describe the type of place.`;
    let out = await askJSON(gfetch, auth, [FLASH, LITE], system, ctx, SCHEMA, { temperature: 0.7, budget: 0 });
    const CYR = /[А-Яа-яЁё]/;
const lostTimes = (p, t) => [t.arrivalTime, t.departureTime].filter((x) => x && !p.includes(x));
const problems = (o) => [...(lostTimes(o.gammaPrompt || '', t).length ? [`missing arrival/departure times: ${lostTimes(o.gammaPrompt || '', t).join(', ')}`] : []), ...(CYR.test(`${o.gammaPrompt || ''} ${o.emailBody || ''} ${o.emailSubject || ''}`) ? ['contains Cyrillic characters - rewrite everything in English'] : []), ...(lostAnchors(o.gammaPrompt || '', anchors).length ? [`missing fixed anchors at: ${lostAnchors(o.gammaPrompt || '', anchors).join(', ')}`] : []), ...(missing(o.gammaPrompt || '').length ? [`missing sections: ${missing(o.gammaPrompt).join(', ')}`] : []), ...(leaks(`${o.gammaPrompt} ${o.emailBody}`, d.stop).length ? [`mentions stop-list items: ${leaks(`${o.gammaPrompt} ${o.emailBody}`, d.stop).join(', ')}`] : [])];
    let bad = problems(out);
    if (bad.length) { // один повтор с явной поправкой
      out = await askJSON(gfetch, auth, [FLASH, LITE], system + `\nYour previous answer was rejected: ${bad.join('; ')}. Fix exactly that.`, ctx, SCHEMA, { temperature: 0.4, budget: 0 });
      bad = problems(out);
    }
    // имя на кириллице в английском тексте — латиницей
    const RU = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
    const latin = (n) => String(n || '').split('').map((ch) => { const l = RU[ch.toLowerCase()]; return l === undefined ? ch : ch === ch.toLowerCase() ? l : l.charAt(0).toUpperCase() + l.slice(1); }).join('');
    const fill = (s) => String(s || '').replace(/\{\{\s*GUEST\s*\}\}/gi, latin(first) || 'there');
    return res.status(200).json({
      gammaPrompt: fill(out.gammaPrompt).slice(0, 12000), emailSubject: fill(out.emailSubject).slice(0, 200), emailBody: fill(out.emailBody).slice(0, 5000),
      warnings: bad,
    });
  } catch (e) {
    return res.status(e.message === 'rate_limited' ? 502 : 500).json({ error: String(e.message || e), tried: e.tried });
  }
}

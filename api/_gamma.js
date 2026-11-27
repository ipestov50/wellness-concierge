// «Мастер-промпт для Gamma» и письмо гостю: из данных звонка, досье и ответов чек-листа. Только для владельца.
// Имя гостя в ИИ не отправляется: в тексте стоит {{GUEST}}, имя подставляется здесь уже после ответа модели.
import { gfetch, FLASH, LITE } from './_cache.js';
import { owner, askJSON, norm } from './_owner.js';
import { parseTrip, dossier, list, str, firstName, parseAnchors } from './_wellness.js';

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
      destination: t.destination, durationDays: t.durationDays, dates: t.from ? `${t.from}${t.to ? ' to ' + t.to : ''}` : null, wellnessGoals: t.goals,
      stopList_mustNeverAppearAsRecommendation: d.stop, guestProfile: d.profile, liveNotes, fixedAnchors: anchors, discoveryAnswers: answers,
    };
    const system = `You are a senior Les Clefs d'Or concierge preparing a bespoke wellness journey proposal.
Return three things:
1) gammaPrompt — a master prompt for Gamma.app. Slides are separated by a line containing only ---. It MUST contain exactly these four sections, each as the title of its own slide (or group of slides), in this order, spelled exactly: "${SECTIONS.join('", "')}". Under each, give precise instructions and the real content: a day-by-day itinerary adapted to the destination's geography, season and the stated duration; selected experiences matched to the goals; practical details (timing, privacy, logistics). Add design directives at the top: Aman / Kinfolk minimalist editorial, generous white space, warm neutral parchment palette with deep green accent, elegant serif headings, restrained photography, no stock clichés, no clutter.
2) emailSubject and emailBody — a warm, discreet guest email in refined hospitality English: greeting "Dear {{GUEST}},", a brief personal introduction to the proposal, three highlights, and a soft call to action; sign off "Warm regards,".
SCHEDULE LOCK (non-negotiable): every item in fixedAnchors AND every explicit day or time the guest or concierge mentions in liveNotes is a HARD SCHEDULE ANCHOR. It MUST appear in the slide titled "Your personalised itinerary" on exactly that day and at exactly that HH:MM, written like "11:00 — <activity>", without moving, merging or renaming the commitment. Build everything else (spa rituals, meals, transfers with realistic buffers before and after each anchor, rest) around the anchors, and never schedule two things at the same time. Days are numbered from Day 1 of the trip; Arrival and Departure are the first and last day.
Hard rules: NEVER recommend, mention as an option, or include anything from stopList_mustNeverAppearAsRecommendation (allergies, dietary and medical restrictions of the guest and family). Honour guestProfile and every item in discoveryAnswers. Use {{GUEST}} wherever the guest's first name belongs. Do not invent facts about the guest; real places only when you are confident, otherwise describe the type of place.`;
    let out = await askJSON(gfetch, auth, [FLASH, LITE], system, ctx, SCHEMA, { temperature: 0.7, budget: 0 });
    const problems = (o) => [...(lostAnchors(o.gammaPrompt || '', anchors).length ? [`missing fixed anchors at: ${lostAnchors(o.gammaPrompt || '', anchors).join(', ')}`] : []), ...(missing(o.gammaPrompt || '').length ? [`missing sections: ${missing(o.gammaPrompt).join(', ')}`] : []), ...(leaks(`${o.gammaPrompt} ${o.emailBody}`, d.stop).length ? [`mentions stop-list items: ${leaks(`${o.gammaPrompt} ${o.emailBody}`, d.stop).join(', ')}`] : [])];
    let bad = problems(out);
    if (bad.length) { // один повтор с явной поправкой
      out = await askJSON(gfetch, auth, [FLASH, LITE], system + `\nYour previous answer was rejected: ${bad.join('; ')}. Fix exactly that.`, ctx, SCHEMA, { temperature: 0.4, budget: 0 });
      bad = problems(out);
    }
    const fill = (s) => String(s || '').replace(/\{\{\s*GUEST\s*\}\}/gi, first || 'there');
    return res.status(200).json({
      gammaPrompt: fill(out.gammaPrompt).slice(0, 12000), emailSubject: fill(out.emailSubject).slice(0, 200), emailBody: fill(out.emailBody).slice(0, 5000),
      warnings: bad,
    });
  } catch (e) {
    return res.status(e.message === 'rate_limited' ? 502 : 500).json({ error: String(e.message || e), tried: e.tried });
  }
}

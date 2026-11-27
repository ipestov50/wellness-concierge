// Discovery questions for a live English call: 5–7 short spoken questions in strict concierge conversation order.
// Owner only. The guest's name is never sent to the AI.
import { gfetch, FLASH, LITE } from './_cache.js';
import { owner, askJSON } from './_owner.js';
import { parseTrip, parseAnchors, bridgeNeeded, dossier, list, str } from './_wellness.js';

export const STAGES = ['Arrival & Check-In Bridge', 'Daily Pace & Rhythm', 'Spa, Body & Contraindications', 'Food, Drinks & Allergies', 'Transfers & Privacy'];
const SCHEMA = {
  type: 'OBJECT',
  properties: { questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    category: { type: 'STRING', enum: STAGES },
    text: { type: 'STRING', description: 'One natural spoken English question, 10 to 13 words, warm and effortless, never survey language' },
    chips: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Exactly 3 short tailored quick answers in English, up to 24 characters each' },
  }, required: ['category', 'text', 'chips'] } } },
  required: ['questions'],
};
const words = (s) => String(s).trim().split(/\s+/).length;

export default async function handler(req, res) {
  const auth = await owner(req, res); if (!auth) return;
  const b = req.body || {};
  const t = parseTrip(b);
  if (!t.destination && !t.goalText && !t.goals.length) return res.status(400).json({ error: 'no_context' });
  try {
    const d = await dossier(auth, b.client_id, list(b.allergies, 20));
    const answered = (Array.isArray(b.answered) ? b.answered : []).slice(0, 20).map((x) => ({ question: str(x?.question, 160), answer: str(x?.answer, 200) })).filter((x) => x.question && x.answer);
    const asked = list(b.asked, 24, 160);
    const bridge = bridgeNeeded(t);
    const ctx = {
      destination: t.destination || null, nights: t.durationDays ? t.durationDays - 1 : null, dates: t.from ? `${t.from}${t.to ? ' to ' + t.to : ''}` : null,
      arrivalTime: t.arrivalTime || null, departureTime: t.departureTime || null, earlyCheckInConfirmed: t.earlyCheckIn, preCheckInBridgeNeeded: bridge,
      guestGoalInTheirWords: t.goalText || null, goalTags: t.goals, fixedAnchors: parseAnchors(b.fixedAnchors),
      stopListNeverMention: d.stop, guestProfile: d.profile, spontaneousCallNotes: t.notes, alreadyAnswered: answered, alreadyAsked: asked,
    };
    const out = await askJSON(gfetch, auth, [FLASH, LITE],
      `You are a senior Les Clefs d'Or concierge on a LIVE English call with a guest planning a wellness trip. Write 5 to 7 questions the concierge can say out loud right now.
Rules:
- Strict conversation order by category: 1 Arrival & Check-In Bridge, 2 Daily Pace & Rhythm, 3 Spa, Body & Contraindications, 4 Food, Drinks & Allergies, 5 Transfers & Privacy. Use every stage at most twice; skip a stage only if it is already covered.
- If preCheckInBridgeNeeded is true, the FIRST question must address the early arrival before the standard 15:00-16:00 hotel check-in (what the guest would enjoy until the room is ready). If arrival is late or early check-in is confirmed, ask about the first evening instead.
- Natural spoken English, 10 to 13 words each, one idea per question, no jargon, no "and/or" chains.
- Tailor to the destination's geography and season, the guest's goal in their own words, the trip length and any fixed anchors. Never ask what is already in guestProfile, spontaneousCallNotes, alreadyAnswered or alreadyAsked.
- Exactly 3 short, genuinely different quick answers per question.
- Never use the guest's name; never invent facts about the guest.`,
      ctx, SCHEMA, { temperature: 0.6, budget: 0 });
    const seen = new Set(asked.map((x) => x.toLowerCase()));
    const questions = (out.questions || []).filter((q) => q?.text && !seen.has(String(q.text).toLowerCase()) && words(q.text) <= 16)
      .map((q, i) => ({ id: 'q' + Date.now().toString(36) + i, category: STAGES.includes(q.category) ? q.category : STAGES[1], text: String(q.text).slice(0, 160), chips: list(q.chips, 3, 24) }))
      .sort((a, c) => STAGES.indexOf(a.category) - STAGES.indexOf(c.category)).slice(0, 7);
    return res.status(200).json({ questions, bridge });
  } catch (e) {
    return res.status(e.message === 'rate_limited' ? 502 : 500).json({ error: String(e.message || e), tried: e.tried });
  }
}

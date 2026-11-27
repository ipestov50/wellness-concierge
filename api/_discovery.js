// Discovery questions for a live English call. Each question carries the date/anchor that triggered it (contextTag + dayDate).
// New questions are only ever APPENDED: the client keeps everything already shown. Owner only; the guest's name never reaches the AI.
import { gfetch, FLASH, LITE } from './_cache.js';
import { owner, askJSON, norm } from './_owner.js';
import { parseTrip, parseAnchors, tripDates, bridgeNeeded, dossier, list, str, cleanSignals } from './_wellness.js';

export const STAGES = ['Arrival & Check-In Bridge', 'Daily Pace & Rhythm', 'Spa, Body & Contraindications', 'Food, Drinks & Allergies', 'Transfers & Privacy'];
const MAX_OPEN = 14; // всего открытых на экране; за один раз добавляем немного, чтобы список не разрастался
const SCHEMA = {
  type: 'OBJECT',
  properties: { questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    category: { type: 'STRING', enum: STAGES },
    text: { type: 'STRING', description: 'One natural spoken English question, 10 to 13 words, warm and effortless, never survey language' },
    chips: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Exactly 3 short tailored quick answers in English, up to 24 characters each' },
    topic: { type: 'STRING', description: 'The single topic this question is about in 2-3 lowercase words, e.g. "pre-spa beverage"' },
    contextTag: { type: 'STRING', description: 'Uppercase badge saying what triggered the question, starting with "RE: ": "RE: DEC 1 · EARLY ARRIVAL", "RE: DEC 3 · NEW DAY", "RE: FAMILY · KIDS", "RE: RAIN FORECAST", "RE: REPEAT VISITOR", "RE: GOAL · <GOAL>", max 34 characters' },
    dayDate: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD of the trip date this question is about, from tripDates, or null if it is about the whole trip' },
  }, required: ['category', 'text', 'chips', 'topic', 'contextTag'] } } },
  required: ['questions'],
};
const SIGNALS = { type: 'OBJECT', properties: { weather: { type: 'STRING', description: 'One of rain, cold, heat, snow, or an empty string' }, repeatVisit: { type: 'BOOLEAN' }, music: { type: 'ARRAY', items: { type: 'STRING' } }, dishes: { type: 'ARRAY', items: { type: 'STRING' } }, drinks: { type: 'ARRAY', items: { type: 'STRING' } } } };
SCHEMA.properties.signals = SIGNALS;
const words = (s) => String(s).trim().split(/\s+/).length;
const stems = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 3).map((w) => w.slice(0, 5)));
const similar = (a, b) => { const A = stems(a), B = stems(b); if (!A.size || !B.size) return false; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n) >= 0.5; };

export default async function handler(req, res) {
  const auth = await owner(req, res); if (!auth) return;
  const b = req.body || {};
  const t = parseTrip(b);
  if (!t.destination && !t.goalText && !t.goals.length && !t.notes) return res.status(400).json({ error: 'no_context' });
  try {
    const d = await dossier(auth, b.client_id, list(b.allergies, 20));
    const answered = (Array.isArray(b.answered) ? b.answered : []).slice(0, 20).map((x) => ({ question: str(x?.question, 160), answer: str(x?.answer, 200) })).filter((x) => x.question && x.answer);
    const open = list(b.open, 20, 160), asked = [...new Set([...list(b.asked, 40, 160), ...open])];
    const room = Math.min(MAX_OPEN - open.length, open.length ? 4 : 7), trigger = str(b.trigger, 200);
    if (room <= 0) return res.status(200).json({ questions: [], bridge: bridgeNeeded(t), signals: null });
    const bridge = bridgeNeeded(t), dates = tripDates(t);
    const ctx = {
      destination: t.destination || null, nights: t.durationDays ? t.durationDays - 1 : null, tripDates: dates,
      arrivalTime: t.arrivalTime || null, departureTime: t.departureTime || null, earlyCheckInConfirmed: t.earlyCheckIn, preCheckInBridgeNeeded: bridge,
      guestGoalInTheirWords: t.goalText || null, goalTags: t.goals, fixedAnchors: parseAnchors(b.fixedAnchors, { from: t.from, to: t.to }),
      party: t.party, stopListNeverMention: d.stop, guestProfile: d.profile, spontaneousCallNotes: t.notes, alreadyAnswered: answered, questionsAlreadyOnScreen: asked, whatJustChanged: trigger || null, howManyToWrite: room,
    };
    const out = await askJSON(gfetch, auth, [FLASH, LITE],
      `You are a senior Les Clefs d'Or concierge on a LIVE English call with a guest planning a wellness trip. Write the NEXT questions the concierge can say out loud (howManyToWrite at most; fewer if nothing important is left).
Rules:
- Conversation order by category: 1 Arrival & Check-In Bridge, 2 Daily Pace & Rhythm, 3 Spa, Body & Contraindications, 4 Food, Drinks & Allergies, 5 Transfers & Privacy.
- If whatJustChanged is set (for example a new fixed anchor, a change of party, dates or notes), write 1 to 3 NEW questions that react to exactly that change and tag them "RE: <that change>" - unless the topic is already on screen.
- NEVER repeat or rephrase anything in questionsAlreadyOnScreen or alreadyAnswered, and never ask about the same topic twice (for example only one question about pre-spa drinks). Each question must add a genuinely new, high-impact angle. Fewer, sharper questions beat more.
- If preCheckInBridgeNeeded is true and nothing about the early arrival is on screen yet, include a question about what the guest would enjoy until the room is ready (standard check-in is 15:00-16:00).
- Natural spoken English, 10 to 13 words each, one idea per question, no jargon, no "and/or" chains. Exactly 3 short, different quick answers.
- Tailor to the destination's geography and season, the guest's goal, trip length and every fixed anchor (an anchor on a date deserves a question that fits that moment, e.g. dinner or a chauffeur drive).
- For each question give a topic, a contextTag (uppercase badge: the date plus what triggered it, or GOAL · ...) and dayDate from tripDates when it belongs to one date, otherwise null.
- FAMILY: if party.kids > 0, include proactive, refined questions about children (vetted in-suite nanny or kids' workshop while the parents enjoy a spa ritual, ISOFIX/booster seats in the transfer car, family-friendly dining times, ages in party.kidsAges), tagged "RE: FAMILY · KIDS".
- SIGNALS: read spontaneousCallNotes (any language, mixed languages allowed) and fill the signals field: weather (rain/cold/heat/snow if the guest mentions it or the forecast concern is clear), repeatVisit (true if they have been to the destination before), music genres or artists they like, favourite dishes and drinks. If weather is set, add one weather-adapted question (indoor thermal, gallery or spa alternatives to outdoor plans) tagged "RE: RAIN FORECAST" (or the matching weather); if repeatVisit, add one question that skips tourist clichés and asks about hidden gems, tagged "RE: REPEAT VISITOR".
- Never use the guest's name; never invent facts about the guest.`,
      ctx, SCHEMA, { temperature: 0.6, budget: 0 });
    const valid = new Set(dates.map((x) => x.date)), topics = list(b.openTopics, 30, 60).map((x) => norm(x)).filter(Boolean);
    const questions = [];
    for (const q of (out.questions || [])) {
      if (!q?.text || words(q.text) > 16) continue;
      if (asked.some((a) => similar(a, q.text) || a.toLowerCase() === String(q.text).toLowerCase())) continue;
      const tp = norm(q.topic || '');
      if (tp && topics.some((x) => x === tp || similar(x, tp))) continue;
      if (tp) topics.push(tp);
      questions.push({
        id: 'q' + Date.now().toString(36) + questions.length, category: STAGES.includes(q.category) ? q.category : STAGES[1], text: String(q.text).slice(0, 160),
        chips: list(q.chips, 3, 24), topic: tp, contextTag: str(q.contextTag, 40).toUpperCase(), dayDate: valid.has(q.dayDate) ? q.dayDate : null,
      });
      if (questions.length >= room) break;
    }
    return res.status(200).json({ questions, bridge, signals: cleanSignals(out.signals) });
  } catch (e) {
    return res.status(e.message === 'rate_limited' ? 502 : 500).json({ error: String(e.message || e), tried: e.tried });
  }
}

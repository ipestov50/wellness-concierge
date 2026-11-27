// Deterministic 5-stage discovery funnel for a LIVE English call.
// The CODE decides which stage is next (fixed order, skips, answers); the AI only words one question + 3 quick answers per stage.
// It returns the next unanswered stage AND the one after it, so the UI can move on instantly. Owner only; the guest's name never reaches the AI.
import { gfetch, FLASH, LITE } from './_cache.js';
import { owner, askJSON } from './_owner.js';
import { parseTrip, parseAnchors, tripDates, bridgeNeeded, dossier, list, str, cleanSignals } from './_wellness.js';

export const STAGES = [
  { key: 'bridge', label: 'Arrival & Check-In Bridge', brief: 'What the guest would love to do between landing and the standard 15:00-16:00 hotel check-in (arrival is early). Reference the real arrivalTime.' },
  { key: 'pace', label: 'Goal & Daily Pace', brief: 'Tailor to the guest goal in their words and the trip length: guided versus self-paced days and how full each day should feel.' },
  { key: 'dining', label: 'Food, Drinks & Allergies', brief: 'Dining style, favourite dishes and drinks, and a gentle confirmation that the stop-list is complete. Always asked.' },
  { key: 'wellness', label: 'Wellness, Spa & Family', brief: 'If party.kids > 0: childcare or kids activities while the adults enjoy spa or dining (mention party.kidsAges if given). If adults only: preferred spa or recovery focus and any contraindications.' },
  { key: 'transfers', label: 'Transfers & Departure', brief: 'Private airport transfers aligned with the real arrivalTime and departureTime, preferred vehicle class and how relaxed the departure day should be.' },
];
const KEYS = STAGES.map((s) => s.key);
const SIGNALS = { type: 'OBJECT', properties: { weather: { type: 'STRING', description: 'One of rain, cold, heat, snow, or an empty string' }, repeatVisit: { type: 'BOOLEAN' }, music: { type: 'ARRAY', items: { type: 'STRING' } }, dishes: { type: 'ARRAY', items: { type: 'STRING' } }, drinks: { type: 'ARRAY', items: { type: 'STRING' } } } };
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      stage: { type: 'STRING', enum: KEYS },
      text: { type: 'STRING', description: 'ONE natural spoken English question, 8 to 12 words, warm, zero fluff, never survey language' },
      chips: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Exactly 3 short tailored quick answers in English, up to 24 characters each' },
      contextTag: { type: 'STRING', description: 'Uppercase badge starting with "RE: " saying what shaped the question, e.g. "RE: 08:00 ARRIVAL", "RE: FAMILY · KIDS", "RE: RAIN FORECAST", max 34 characters' },
    }, required: ['stage', 'text', 'chips', 'contextTag'] } },
    signals: SIGNALS,
  },
  required: ['questions'],
};
const words = (s) => String(s).trim().split(/\s+/).length;
const briefReady = (t) => !!(t.destination && t.arrivalTime && t.departureTime && (t.goalText || t.goals.length));

export default async function handler(req, res) {
  const auth = await owner(req, res); if (!auth) return;
  const b = req.body || {};
  const t = parseTrip(b);
  if (!briefReady(t)) return res.status(400).json({ error: 'brief_incomplete' });
  try {
    const bridge = bridgeNeeded(t);
    const applicable = STAGES.filter((s) => s.key !== 'bridge' || bridge);
    const answeredIn = (Array.isArray(b.answered) ? b.answered : []).slice(0, 20).map((x) => ({ stage: str(x?.stage, 20), question: str(x?.question, 160), answer: str(x?.answer, 200) })).filter((x) => KEYS.includes(x.stage) && x.answer);
    const done = new Set(answeredIn.map((x) => x.stage)), skipped = new Set(list(b.skippedStages, 6, 20).filter((k) => KEYS.includes(k)));
    const todo = applicable.filter((s) => !done.has(s.key) && !skipped.has(s.key));
    if (!todo.length) return res.status(200).json({ questions: [], complete: true, bridge, signals: null });
    // focus: если консьерж перешёл на конкретный этап — готовим его и следующий за ним; иначе два ближайших по порядку
    const fi = todo.findIndex((s) => s.key === b.focusStage);
    const targets = fi >= 0 ? todo.slice(fi, fi + 2) : todo.slice(0, 2);
    const d = await dossier(auth, b.client_id, list(b.allergies, 20));
    const ctx = {
      destination: t.destination, nights: t.durationDays ? t.durationDays - 1 : null, tripDates: tripDates(t),
      arrivalTime: t.arrivalTime, departureTime: t.departureTime, earlyCheckInConfirmed: t.earlyCheckIn, preCheckInBridgeNeeded: bridge,
      party: t.party, guestGoalInTheirWords: t.goalText || null, goalTags: t.goals, fixedAnchors: parseAnchors(b.fixedAnchors, { from: t.from, to: t.to }),
      stopListNeverMention: d.stop, guestProfile: d.profile, spontaneousCallNotes: t.notes, alreadyAnswered: answeredIn.map(({ stage, question, answer }) => ({ stage, question, answer })),
      whatJustChanged: str(b.trigger, 200) || null, stagesToWrite: targets.map((s) => ({ stage: s.key, title: s.label, guidance: s.brief })),
    };
    const out = await askJSON(gfetch, auth, [FLASH, LITE],
      `You are a senior Les Clefs d'Or concierge on a LIVE English call with a guest planning a wellness trip. The app walks the concierge through a fixed funnel; you only word the questions for the stages in stagesToWrite.
Write EXACTLY one question per entry of stagesToWrite (same stage keys), in that order.
Rules:
- Ultra-crisp spoken English, 8 to 12 words, one idea, no jargon, no "and/or" chains. Exactly 3 short, genuinely different quick answers per question.
- Use the real details: destination geography and season, the exact arrivalTime and departureTime, party, the guest's goal in their own words, every fixed anchor, and spontaneousCallNotes (any language). Adapt to whatJustChanged if set.
- Never ask what alreadyAnswered, guestProfile or spontaneousCallNotes already tell you; ask the next useful thing for that stage instead.
- contextTag: uppercase badge starting "RE: " naming what shaped the question.
- SIGNALS: read spontaneousCallNotes and fill the signals field: weather (rain/cold/heat/snow), repeatVisit (true if they have visited the destination before), music genres or artists, favourite dishes and drinks. Reflect weather or a repeat visit in the wording where it fits (indoor alternatives; skip tourist clichés).
- Never use the guest's name; never invent facts about the guest.`,
      ctx, SCHEMA, { temperature: 0.6, budget: 0 });
    const byStage = new Map();
    for (const q of (out.questions || [])) { if (q?.text && targets.some((s) => s.key === q.stage) && !byStage.has(q.stage) && words(q.text) <= 14) byStage.set(q.stage, q); }
    const questions = targets.filter((s) => byStage.has(s.key)).map((s) => {
      const q = byStage.get(s.key);
      return { stage: s.key, text: String(q.text).slice(0, 160), chips: list(q.chips, 3, 24), contextTag: str(q.contextTag, 40).toUpperCase() };
    });
    return res.status(200).json({ questions, complete: false, bridge, signals: cleanSignals(out.signals) });
  } catch (e) {
    return res.status(e.message === 'rate_limited' ? 502 : 500).json({ error: String(e.message || e), tried: e.tried });
  }
}

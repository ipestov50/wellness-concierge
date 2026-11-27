// Deterministic 5-stage discovery funnel for a LIVE English call, 3 progressively deeper questions per stage.
// The CODE decides which stages are next (fixed order, completed/skipped); the AI only words the questions and 3 quick answers each.
// It returns the next two open stages (3 questions each) so the UI can move on instantly and refine on every new answer. Owner only.
import { gfetch, FLASH, LITE } from './_cache.js';
import { owner, askJSON } from './_owner.js';
import { parseTrip, parseAnchors, tripDates, bridgeNeeded, dossier, list, str, cleanSignals } from './_wellness.js';

export const STAGES = [
  { key: 'bridge', label: 'Arrival & Welcome', brief: 'Q1 vector: early-arrival bridge before the 15:00-16:00 check-in (only if preCheckInBridgeNeeded) versus the welcome in the suite; also any hidden occasion. Q2 sensory detail building on Q1 (welcome drink, aroma, flowers, light snack, temperature). Q3 signature finishing touch (a personal detail that makes the arrival feel effortless).' },
  { key: 'pace', label: 'Goal & Daily Pace', brief: 'Q1 vector and occasion: pure reset versus a milestone or celebration, guided versus self-paced. Q2 how full each day should feel and what a perfect morning looks like, building on Q1. Q3 the one thing that must never happen on this trip.' },
  { key: 'dining', label: 'Dining & Stop-List', brief: 'Q1 dining style (intimate tasting versus discreet local bistro, in-suite). Q2 favourite dishes, drinks and rituals, building on Q1. Q3 finishing touch (seating privacy, table timing) and a gentle confirmation that the stop-list is complete.' },
  { key: 'wellness', label: 'Spa, Wellness & Family', brief: 'If party.kids > 0: Q1 how children are looked after while adults enjoy spa or dining, Q2 the kids detail (private workshop, nanny, ages in party.kidsAges), Q3 the adults\' signature spa touch. If adults only: Q1 preferred spa or recovery focus, Q2 treatments and contraindications, Q3 therapist, pressure and scent preferences.' },
  { key: 'transfers', label: 'Transfers & Privacy', brief: 'Q1 private airport transfers matched to the real arrivalTime and departureTime. Q2 vehicle class and chauffeur details (child seats if kids). Q3 privacy and the pace of the departure day.' },
];
const KEYS = STAGES.map((s) => s.key);
const SIGNALS = { type: 'OBJECT', properties: { weather: { type: 'STRING', description: 'One of rain, cold, heat, snow, or an empty string' }, repeatVisit: { type: 'BOOLEAN' }, music: { type: 'ARRAY', items: { type: 'STRING' } }, dishes: { type: 'ARRAY', items: { type: 'STRING' } }, drinks: { type: 'ARRAY', items: { type: 'STRING' } } } };
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      stage: { type: 'STRING', enum: KEYS }, tier: { type: 'INTEGER', description: '1, 2 or 3: the depth inside the stage' },
      text: { type: 'STRING', description: 'ONE natural spoken English question, 8 to 12 words, warm, zero fluff, never survey language' },
      chips: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Exactly 3 short tailored quick answers in English, up to 24 characters each' },
      contextTag: { type: 'STRING', description: 'Uppercase badge starting with "RE: " saying what shaped the question, max 34 characters' },
    }, required: ['stage', 'tier', 'text', 'chips', 'contextTag'] } },
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
    const answeredIn = (Array.isArray(b.answered) ? b.answered : []).slice(0, 40).map((x) => ({ stage: str(x?.stage, 20), tier: Number(x?.tier) || 0, question: str(x?.question, 160), answer: str(x?.answer, 240), custom: x?.custom === true })).filter((x) => KEYS.includes(x.stage) && x.answer);
    const closed = new Set([...list(b.doneStages, 6, 20), ...list(b.skippedStages, 6, 20)].filter((k) => KEYS.includes(k)));
    const todo = STAGES.filter((s) => !closed.has(s.key));
    if (!todo.length) return res.status(200).json({ questions: [], complete: true, bridge, signals: null });
    const fi = todo.findIndex((s) => s.key === b.focusStage);
    const targets = fi >= 0 ? todo.slice(fi, fi + 2) : todo.slice(0, 2);
    const d = await dossier(auth, b.client_id, list(b.allergies, 20));
    const ctx = {
      destination: t.destination, nights: t.durationDays ? t.durationDays - 1 : null, tripDates: tripDates(t),
      arrivalTime: t.arrivalTime, departureTime: t.departureTime, earlyCheckInConfirmed: t.earlyCheckIn, preCheckInBridgeNeeded: bridge,
      party: t.party, guestGoalInTheirWords: t.goalText || null, goalTags: t.goals, fixedAnchors: parseAnchors(b.fixedAnchors, { from: t.from, to: t.to }),
      stopListNeverMention: d.stop, guestProfile: d.profile, spontaneousCallNotes: t.notes, alreadyAnswered: answeredIn.map(({ stage, tier, question, answer }) => ({ stage, tier, question, answer })),
      whatJustChanged: str(b.trigger, 200) || null, stagesToWrite: targets.map((s) => ({ stage: s.key, title: s.label, threeQuestionPlan: s.brief })),
    };
    const out = await askJSON(gfetch, auth, [FLASH, LITE],
      `You are a senior Les Clefs d'Or concierge on a LIVE English call with a guest planning a wellness trip. The app walks the concierge through a fixed funnel of 5 stages; you only word the questions for the stages in stagesToWrite.
For EACH stage in stagesToWrite write EXACTLY 3 questions, tier 1, 2 and 3, following its threeQuestionPlan. They get progressively deeper: tier 2 must build directly on the guest's tier-1 answer when it is in alreadyAnswered, tier 3 on tiers 1 and 2. If a tier is already in alreadyAnswered, still write the tier but make it a fresh angle (it will be ignored when answered).
Rules:
- Razor-sharp spoken English, 8 to 12 words, one idea, no jargon, no "and/or" chains. Exactly 3 short, genuinely different quick answers per question.
- Use the real details: destination geography and season, exact arrivalTime and departureTime, party, the goal in the guest's words, fixed anchors and spontaneousCallNotes (any language). Adapt to whatJustChanged if set.
- Never ask what alreadyAnswered, guestProfile or spontaneousCallNotes already tell you; ask the next useful thing instead.
- contextTag: uppercase badge starting "RE: " naming what shaped the question.
- SIGNALS: read spontaneousCallNotes and fill the signals field: weather (rain/cold/heat/snow), repeatVisit (true if they have visited the destination before), music genres or artists, favourite dishes and drinks.
- Never use the guest's name; never invent facts about the guest.`,
      ctx, SCHEMA, { temperature: 0.6, budget: 0 });
    const seen = new Set(), questions = [];
    for (const q of (out.questions || [])) {
      const tier = Number(q?.tier);
      if (!q?.text || !targets.some((s) => s.key === q.stage) || ![1, 2, 3].includes(tier) || words(q.text) > 14) continue;
      const id = `${q.stage}:${tier}`; if (seen.has(id)) continue; seen.add(id);
      questions.push({ stage: q.stage, tier, text: String(q.text).slice(0, 160), chips: list(q.chips, 3, 24), contextTag: str(q.contextTag, 40).toUpperCase() });
    }
    questions.sort((a, c) => KEYS.indexOf(a.stage) - KEYS.indexOf(c.stage) || a.tier - c.tier);
    return res.status(200).json({ questions, complete: false, bridge, signals: cleanSignals(out.signals) });
  } catch (e) {
    return res.status(e.message === 'rate_limited' ? 502 : 500).json({ error: String(e.message || e), tried: e.tried });
  }
}

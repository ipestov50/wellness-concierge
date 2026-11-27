// Stage deep-dive for a LIVE English call. Questions 1 and 2 of every stage are fixed in the browser (instant, never replaced);
// this endpoint writes ONLY the third, personalised "Jarvis Deep-Dive" question for one stage, once BOTH Q1 and Q2 were answered,
// carrying every earlier stage forward (Stage N → N+1). Flight times are optional.
// It also reads the free-form call notes for signals (weather, repeat visit, music, dishes). Owner only; the guest's name never reaches the AI.
import { gfetch, FLASH, LITE } from './_cache.js';
import { owner, askJSON } from './_owner.js';
import { parseTrip, parseAnchors, tripDates, bridgeNeeded, dossier, list, str, cleanSignals } from './_wellness.js';

export const STAGES = [
  { key: 'bridge', label: 'Arrival & First Hours', plan: 'Probe the special occasion and the in-suite welcome amenities (still or sparkling water, herbal infusions, Champagne, flowers, a child welcome treat when party.kids > 0), building on the transfer and first-hours answers.' },
  { key: 'culture', label: 'City & Cultural Discovery', plan: 'Tailor to the destination plus the pace (Q1) and the draw (Q2) answers and any Stage 1 occasion: for example private after-hours gallery access versus a neighbourhood design walk. An indoor pivot if rain or cold is noted.' },
  { key: 'wellness', label: 'Body, Spa & Recovery', plan: 'Sensory and safety nuance: aroma or scent sensitivities, pressure preference, a private couple\'s suite, or an injury and contraindication check. Respect the Stage 1 thermal-lounge choice and the Stage 2 walking intensity.' },
  { key: 'dining', label: 'Dining & Stop-List', plan: 'Culinary nuance carrying the occasion, neighbourhood and wellness vibe from earlier stages: seating privacy, tasting menu versus a la carte, or a neighbourhood pairing. Respect the stop-list.' },
  { key: 'transfers', label: 'Departure & Seamless Exit', plan: 'The final departure-day touch: in-suite breakfast, gourmet gifts or souvenirs to pack, or luggage assistance. If departureTime is empty, do not assume a flight time.' },
];
const KEYS = STAGES.map((s) => s.key);
const SIGNALS = { type: 'OBJECT', properties: { weather: { type: 'STRING', description: 'One of rain, cold, heat, snow, or an empty string' }, repeatVisit: { type: 'BOOLEAN' }, music: { type: 'ARRAY', items: { type: 'STRING' } }, dishes: { type: 'ARRAY', items: { type: 'STRING' } }, drinks: { type: 'ARRAY', items: { type: 'STRING' } } } };
const Q_SCHEMA = {
  type: 'OBJECT',
  properties: {
    text: { type: 'STRING', description: 'ONE natural spoken English question, 8 to 12 words, razor-sharp, warm, zero fluff' },
    chips: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Exactly 3 short tailored quick answers in English, up to 24 characters each' },
    contextTag: { type: 'STRING', description: 'Uppercase badge starting with "RE: " saying what shaped the question, max 34 characters' },
    signals: SIGNALS,
  },
  required: ['text', 'chips', 'contextTag'],
};
const SIG_SCHEMA = { type: 'OBJECT', properties: { signals: SIGNALS }, required: ['signals'] };
const words = (s) => String(s).trim().split(/\s+/).length;
const briefReady = (t) => !!(t.destination && t.from && t.to && (t.goalText || t.goals.length)); // destination + dates + goal; arrival/departure times may follow later

export default async function handler(req, res) {
  const auth = await owner(req, res); if (!auth) return;
  const b = req.body || {};
  const t = parseTrip(b);
  try {
    // only the notes: cheap signal extraction, no gate needed
    if (b.signalsOnly) {
      if (!t.notes) return res.status(200).json({ questions: [], signals: null });
      const out = await askJSON(gfetch, auth, [LITE, FLASH], 'Read the free-form notes from a concierge call (any language, mixed languages allowed) and fill the signals: weather (rain/cold/heat/snow or empty), repeatVisit (true if the guest has visited the destination before), music genres or artists, favourite dishes, favourite drinks. Return only what the notes literally say.', { notes: t.notes }, SIG_SCHEMA, { temperature: 0.1, budget: 0 });
      return res.status(200).json({ questions: [], signals: cleanSignals(out.signals) });
    }
    if (!briefReady(t)) return res.status(400).json({ error: 'brief_incomplete' });
    const stage = STAGES.find((s) => s.key === (b.stageId || b.focusStage));
    if (!stage) return res.status(400).json({ error: 'no_stage' });
    const answeredIn = (Array.isArray(b.answered) ? b.answered : []).slice(0, 40).map((x) => ({ stage: str(x?.stage, 20), tier: Number(x?.tier) || 0, question: str(x?.question, 160), answer: str(x?.answer, 240) })).filter((x) => KEYS.includes(x.stage) && x.answer);
    const q1 = str(b.stageQ1Answer, 240) || answeredIn.find((x) => x.stage === stage.key && x.tier === 1)?.answer || '';
    const q2 = str(b.stageQ2Answer, 240) || answeredIn.find((x) => x.stage === stage.key && x.tier === 2)?.answer || '';
    if (!q1 || !q2) return res.status(400).json({ error: 'core_incomplete' }); // Q3 is generated only after Q1 and Q2
    const order = KEYS.indexOf(stage.key);
    const prior = (Array.isArray(b.priorStagesCaptured) ? b.priorStagesCaptured : []).slice(0, 5).filter((g) => KEYS.indexOf(g?.stage) > -1 && KEYS.indexOf(g.stage) < order)
      .map((g) => ({ stage: str(g.label, 40) || g.stage, answers: (Array.isArray(g.answers) ? g.answers : []).slice(0, 8).map((x) => ({ question: str(x?.question, 160), answer: str(x?.answer, 240) })).filter((x) => x.answer) })).filter((g) => g.answers.length);
    const d = await dossier(auth, b.client_id, list(b.allergies, 20));
    const ctx = {
      stage: { key: stage.key, title: stage.label, deepDivePlan: stage.plan },
      destination: t.destination, nights: t.durationDays ? t.durationDays - 1 : null, tripDates: tripDates(t),
      arrivalTime: t.arrivalTime || null, departureTime: t.departureTime || null, earlyCheckInConfirmed: t.earlyCheckIn, preCheckInBridgeNeeded: bridgeNeeded(t),
      party: t.party, guestGoalInTheirWords: t.goalText || null, goalTags: t.goals, fixedAnchors: parseAnchors(b.fixedAnchors, { from: t.from, to: t.to }),
      stopListNeverMention: d.stop, guestProfile: d.profile, spontaneousCallNotes: t.notes,
      stageQ1Answer: q1, stageQ2Answer: q2, priorStagesCaptured: prior,
      thisStageAnswersSoFar: answeredIn.filter((x) => x.stage === stage.key).map(({ tier, question, answer }) => ({ tier, question, answer })),
      otherStageAnswers: answeredIn.filter((x) => x.stage !== stage.key).map(({ stage: s, question, answer }) => ({ stage: s, question, answer })),
    };
    const out = await askJSON(gfetch, auth, [FLASH, LITE],
      `You are a senior Les Clefs d'Or concierge on a LIVE English call with a guest planning a wellness trip. The first two questions of this stage were fixed and have been answered (stageQ1Answer, stageQ2Answer). Write ONE deeper, personalised follow-up question: the stage's third "Jarvis Deep-Dive", following ctx.stage.deepDivePlan and building directly on BOTH answers plus the cascade in priorStagesCaptured (what the guest chose in earlier stages: occasion, arrival bridge, city pace, spa choices).
Rules:
- Razor-sharp spoken English, 8 to 12 words, one idea, no jargon. Exactly 3 short, genuinely different quick answers.
- Use the real details: destination geography and season, arrivalTime and departureTime (either may be null: never assume a time), party, the goal in the guest's words, fixed anchors and spontaneousCallNotes (any language).
- Never ask what thisStageAnswersSoFar, otherStageAnswers, guestProfile or the notes already tell you.
- contextTag: uppercase badge starting "RE: " naming what shaped the question.
- Also fill signals from spontaneousCallNotes (weather rain/cold/heat/snow, repeatVisit, music, dishes, drinks) when the notes say so.
- Never use the guest's name; never invent facts about the guest.`,
      ctx, Q_SCHEMA, { temperature: 0.6, budget: 0 });
    const ok = out?.text && words(out.text) <= 14;
    const questions = ok ? [{ stage: stage.key, tier: 3, text: String(out.text).slice(0, 160), chips: list(out.chips, 3, 24), contextTag: str(out.contextTag, 40).toUpperCase() }] : [];
    return res.status(200).json({ questions, signals: cleanSignals(out?.signals) });
  } catch (e) {
    return res.status(e.message === 'rate_limited' ? 502 : 500).json({ error: String(e.message || e), tried: e.tried });
  }
}

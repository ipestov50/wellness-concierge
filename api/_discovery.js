// Discovery questions for a live English call. Each question carries the date/anchor that triggered it (contextTag + dayDate).
// New questions are only ever APPENDED: the client keeps everything already shown. Owner only; the guest's name never reaches the AI.
import { gfetch, FLASH, LITE } from './_cache.js';
import { owner, askJSON, norm } from './_owner.js';
import { parseTrip, parseAnchors, tripDates, bridgeNeeded, dossier, list, str, cleanSignals } from './_wellness.js';

export const STAGES = ['Arrival & Check-In Bridge', 'Daily Pace & Rhythm', 'Spa, Body & Contraindications', 'Food, Drinks & Allergies', 'Transfers & Privacy'];
const MAX_OPEN = 3; // на экране одновременно не больше трёх открытых вопросов: следующий шаг разговора, не анкета
const SCHEMA = {
  type: 'OBJECT',
  properties: { questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    category: { type: 'STRING', enum: STAGES },
    text: { type: 'STRING', description: 'One natural spoken English question, 8 to 12 words, warm and effortless, zero fluff, never survey language' },
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
const briefReady = (t) => !!(t.destination && t.arrivalTime && t.departureTime && (t.goalText || t.goals.length));
const stems = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 3).map((w) => w.slice(0, 5)));
const similar = (a, b) => { const A = stems(a), B = stems(b); if (!A.size || !B.size) return false; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n) >= 0.5; };

export default async function handler(req, res) {
  const auth = await owner(req, res); if (!auth) return;
  const b = req.body || {};
  const t = parseTrip(b);
  if (!briefReady(t)) return res.status(400).json({ error: 'brief_incomplete' });
  try {
    const d = await dossier(auth, b.client_id, list(b.allergies, 20));
    const answered = (Array.isArray(b.answered) ? b.answered : []).slice(0, 20).map((x) => ({ question: str(x?.question, 160), answer: str(x?.answer, 200) })).filter((x) => x.question && x.answer);
    // открытые вопросы (без ответа) можно заменить свежими; блокируют повторы только уже отвеченные и когда-то заданные и снятые
    const open = list(b.open, 20, 160), openSet = new Set(open.map((x) => x.toLowerCase()));
    const asked = list(b.asked, 60, 160).filter((x) => !openSet.has(x.toLowerCase()));
    const room = MAX_OPEN, trigger = str(b.trigger, 200);
    const bridge = bridgeNeeded(t), dates = tripDates(t);
    const ctx = {
      destination: t.destination || null, nights: t.durationDays ? t.durationDays - 1 : null, tripDates: dates,
      arrivalTime: t.arrivalTime || null, departureTime: t.departureTime || null, earlyCheckInConfirmed: t.earlyCheckIn, preCheckInBridgeNeeded: bridge,
      guestGoalInTheirWords: t.goalText || null, goalTags: t.goals, fixedAnchors: parseAnchors(b.fixedAnchors, { from: t.from, to: t.to }),
      party: t.party, stopListNeverMention: d.stop, guestProfile: d.profile, spontaneousCallNotes: t.notes, alreadyAnswered: answered, questionsAskedBefore: asked, currentOpenQuestions: open, whatJustChanged: trigger || null, howManyToWrite: '2 or 3',
    };
    const out = await askJSON(gfetch, auth, [FLASH, LITE],
      `You are a senior Les Clefs d'Or concierge on a LIVE English call with a guest planning a wellness trip. Write the NEXT 2 or 3 questions (never more than 3) the concierge should say out loud right now: only the next most logical decision, based on what the guest just said in the goal, anchors or notes.
Rules:
- Logical progression, pick the earliest stage that is still unresolved: 1 Arrival & Check-In Bridge (only if preCheckInBridgeNeeded is true: what the guest would enjoy until the room is ready, standard check-in is 15:00-16:00), 2 Daily Pace & Rhythm (the goal and daily rhythm), 3 Spa, Body & Contraindications (also family and kids logistics if party.kids > 0), 4 Food, Drinks & Allergies, 5 Transfers & Privacy (private transfers, departure logistics).
- currentOpenQuestions are on screen right now and unanswered. Keep any of them verbatim if it is still the best next step; replace stale ones with fresh, context-adapted questions. Never repeat anything in questionsAskedBefore or alreadyAnswered, and never ask about the same topic twice.
- Ultra-crisp spoken English, 8 to 12 words each, one idea, no jargon, no "and/or" chains. Exactly 3 short, different quick answers.
- Tailor to the destination's geography and season, the goal, trip length, party and every fixed anchor.
- If whatJustChanged is set, make sure the questions react to exactly that change and tag them "RE: <that change>".
- FAMILY: if party.kids > 0, include a refined question about the children (vetted in-suite nanny or kids' workshop during the parents' spa ritual, ISOFIX/booster seats, family dining times, ages in party.kidsAges), tagged "RE: FAMILY · KIDS".
- SIGNALS: read spontaneousCallNotes (any language) and fill the signals field: weather (rain/cold/heat/snow), repeatVisit (true if they have been to the destination before), music genres or artists, favourite dishes and drinks. If weather is set, one question should adapt to indoor alternatives (tag "RE: RAIN FORECAST" or the matching weather); if repeatVisit, one question should skip tourist clichés and ask about hidden gems (tag "RE: REPEAT VISITOR").
- For each question give a topic, a contextTag (uppercase badge starting with "RE: ") and dayDate from tripDates when it belongs to one date, otherwise null.
- Never use the guest's name; never invent facts about the guest.`,
      ctx, SCHEMA, { temperature: 0.6, budget: 0 });
    const valid = new Set(dates.map((x) => x.date)), topics = list(b.openTopics, 30, 60).map((x) => norm(x)).filter(Boolean);
    const questions = [];
    for (const q of (out.questions || [])) {
      if (!q?.text || words(q.text) > 14) continue;
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

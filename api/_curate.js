// ✦ Curated Suggestions: 3-4 real, destination-accurate venues and service touches the concierge can approve before the Gamma export.
// Owner only. The guest's name never reaches the AI. Suggestions are proposals only: they never create bookings.
import { gfetch, FLASH, LITE } from './_cache.js';
import { owner, askJSON, norm } from './_owner.js';
import { parseTrip, parseAnchors, tripDates, bridgeNeeded, dossier, list, str, cleanSignals } from './_wellness.js';

const KINDS = ['bridge', 'venue', 'touch'];
const SCHEMA = {
  type: 'OBJECT',
  properties: { suggestions: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    kind: { type: 'STRING', enum: KINDS },
    title: { type: 'STRING', description: 'Short guest-facing title in English, up to 60 characters' },
    venueName: { type: 'STRING', nullable: true, description: 'Real venue name in the destination, only if you are confident it exists; null for a service touch or when unsure' },
    why: { type: 'STRING', description: 'One Les Clefs d\'Or sentence (up to 170 characters) on why this fits THIS guest' },
  }, required: ['kind', 'title', 'why'] } } },
  required: ['suggestions'],
};

export default async function handler(req, res) {
  const auth = await owner(req, res); if (!auth) return;
  const b = req.body || {};
  const t = parseTrip(b);
  if (!t.destination) return res.status(400).json({ error: 'no_destination' });
  try {
    const d = await dossier(auth, b.client_id, list(b.allergies, 20));
    const answers = (Array.isArray(b.answers) ? b.answers : []).slice(0, 40).map((x) => ({ stage: str(x?.category, 40), question: str(x?.question, 200), answer: str(x?.answer, 300) })).filter((x) => x.answer);
    const bridge = bridgeNeeded(t);
    const ctx = {
      destination: t.destination, tripDates: tripDates(t), arrivalTime: t.arrivalTime || null, departureTime: t.departureTime || null, earlyCheckInConfirmed: t.earlyCheckIn, preCheckInBridgeNeeded: bridge,
      party: t.party, guestGoalInTheirWords: t.goalText || null, goalTags: t.goals, fixedAnchors: parseAnchors(b.fixedAnchors, { from: t.from, to: t.to }),
      stopListNeverRecommend: d.stop, guestProfile: d.profile, spontaneousCallNotes: t.notes, signalsFromNotes: b.signals && typeof b.signals === 'object' ? cleanSignals(b.signals) : null, capturedAnswers: answers,
    };
    const out = await askJSON(gfetch, auth, [FLASH, LITE],
      `You are a senior Les Clefs d'Or concierge preparing 3 to 4 curated recommendations for a guest's wellness trip, to be approved by the concierge before the proposal is written.
Return exactly this mix:
${bridge ? '- 1 "bridge" idea: a pre-check-in morning experience from the arrival time until about 15:00 (for example a scenic private chauffeur drive, a quiet private gallery visit, or thermal lounge access).\n' : ''}- 1 or 2 "venue" picks: signature spa, dining or cultural venues that really exist in the destination city, matched to the goal.
- 1 "touch": a proactive, unrequested VIP service detail (for example hypoallergenic suite preparation, a sommelier note, or a child amenity when party.kids > 0).
Rules:
- Real places only, in or very near the destination, and only if you are confident they exist; otherwise leave venueName null and describe the exact type of place. Never invent venues.
- Strictly respect stopListNeverRecommend (guest and family allergies, diet, health) and everything in capturedAnswers and spontaneousCallNotes (weather, repeat visit: choose insider gems then, favourite music and dishes).
- Keep it spacious and on-goal: no tourist clutter, no generic hotel clichés.
- Every "why" is one concrete sentence tied to this guest's own words, party or answers.
- Natural hospitality English. Never use the guest's name.`,
      ctx, SCHEMA, { temperature: 0.7, budget: 0 });
    const guard = d.stop.map(norm).filter((w) => w.length >= 4), seen = new Set();
    const suggestions = (out.suggestions || []).filter((x) => x?.title && x?.why).map((x) => ({
      kind: KINDS.includes(x.kind) ? x.kind : 'venue', title: str(x.title, 80), venueName: str(x.venueName, 120), why: str(x.why, 220),
    })).filter((x) => !/[А-Яа-яЁё]/.test(`${x.title}${x.why}${x.venueName}`) && !guard.some((w) => norm(`${x.title} ${x.why} ${x.venueName}`).includes(w)) && !seen.has(norm(x.title)) && seen.add(norm(x.title)))
      .slice(0, 4).map((x, i) => ({ ...x, id: `s${Date.now().toString(36)}${i}` }));
    return res.status(200).json({ suggestions });
  } catch (e) {
    return res.status(e.message === 'rate_limited' ? 502 : 500).json({ error: String(e.message || e), tried: e.tried });
  }
}

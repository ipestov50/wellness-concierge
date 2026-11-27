// ✦ Curated Suggestions: up to 5 balanced, destination-accurate ideas across the whole trip (bridge, city & culture, wellness, dining, service touch) the concierge can approve before the Gamma export.
// Owner only. The guest's name never reaches the AI. Suggestions are proposals only: they never create bookings.
import { gfetch, FLASH, LITE } from './_cache.js';
import { owner, askJSON, norm } from './_owner.js';
import { parseTrip, parseAnchors, tripDates, bridgeNeeded, dossier, list, str, cleanSignals } from './_wellness.js';

const KINDS = ['bridge', 'culture', 'wellness', 'dining', 'touch'];
const FOCUS = { culture: 'City & culture: an insider museum, architectural walk, private atelier or neighbourhood gem', wellness: 'Signature wellness: a spa, thermal or treatment experience', dining: 'Culinary gem: a restaurant, tasting or market experience', touch: 'Service touch or morning bridge: an in-suite, chauffeur or arrival VIP detail' };
const SCHEMA = {
  type: 'OBJECT',
  properties: { suggestions: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    kind: { type: 'STRING', enum: KINDS },
    title: { type: 'STRING', description: 'Short guest-facing title in English, up to 60 characters' },
    venueName: { type: 'STRING', nullable: true, description: 'Real venue name in the destination, only if you are confident it exists; null for a service touch or when unsure' },
    address: { type: 'STRING', nullable: true, description: 'Real street address with city, only if you are confident, else null' },
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
    const focus = typeof b.focusCategory === 'string' && Object.hasOwn(FOCUS, b.focusCategory) ? b.focusCategory : '';
    const exclude = list(b.exclude, 12, 80);
    const ctx = {
      destination: t.destination, tripDates: tripDates(t), arrivalTime: t.arrivalTime || null, departureTime: t.departureTime || null, earlyCheckInConfirmed: t.earlyCheckIn, preCheckInBridgeNeeded: bridge,
      party: t.party, guestGoalInTheirWords: t.goalText || null, goalTags: t.goals, fixedAnchors: parseAnchors(b.fixedAnchors, { from: t.from, to: t.to }),
      stopListNeverRecommend: d.stop, guestProfile: d.profile, spontaneousCallNotes: t.notes, signalsFromNotes: b.signals && typeof b.signals === 'object' ? cleanSignals(b.signals) : null, capturedAnswers: answers, alreadySuggestedNeverRepeat: exclude,
    };
    const out = await askJSON(gfetch, auth, [FLASH, LITE],
      `You are a senior Les Clefs d'Or concierge curating a 360° wellness trip (city, culture, wellness, dining and service), to be approved by the concierge before the proposal is written.
${focus ? `Return exactly 2 fresh alternatives, ALL in this one category: ${FOCUS[focus]}. Use kind "${focus}"${focus === 'touch' && bridge ? ' (or "bridge" for a pre-check-in morning experience)' : ''}. Never repeat anything in alreadySuggestedNeverRepeat.\n` : `Return up to 5 diverse, destination-authentic recommendations spanning the full trip, one per kind:
${bridge ? '- "bridge": a pre-check-in morning experience from the arrival time until about 15:00 (scenic private chauffeur orientation, a quiet private gallery, or thermal lounge & breakfast), matching the Arrival & First Hours answers.\n' : ''}- "culture": an insider museum, architectural walk, private atelier or neighbourhood gem tailored to the City & Cultural Discovery answers (if the guest chose pure rest, make it a very gentle, short neighbourhood moment).
- "wellness": a signature spa, thermal or treatment experience tailored to the Body, Spa & Recovery answers (pressure, timing, children's care).
- "dining": a culinary gem tailored to the Dining & Stop-List answers.
- "touch": a proactive, unrequested VIP service detail (in-suite welcome, chauffeur detail, sommelier note, or a child amenity when party.kids > 0).
`}Rules:
- Real places only, in or very near the destination, and only if you are confident they exist; otherwise leave venueName null and describe the exact type of place. Never invent venues.
- Strictly respect stopListNeverRecommend (guest and family allergies, diet, health) and everything in capturedAnswers and spontaneousCallNotes (weather, repeat visit: choose insider gems then, favourite music and dishes).
- Keep it spacious and on-goal: no tourist clutter, no generic hotel clichés.
- Every "why" is one concrete sentence tied to this guest's own words, party or answers.
- Natural hospitality English. Never use the guest's name.`,
      ctx, SCHEMA, { temperature: 0.7, budget: 0 });
    const guard = d.stop.map(norm).filter((w) => w.length >= 4), seen = new Set();
    const suggestions = (out.suggestions || []).filter((x) => x?.title && x?.why).map((x) => ({
      kind: KINDS.includes(x.kind) ? x.kind : focus || 'culture', title: str(x.title, 80), venueName: str(x.venueName, 120), address: x.venueName ? str(x.address, 200) : '', why: str(x.why, 220),
    })).filter((x) => !/[А-Яа-яЁё]/.test(`${x.title}${x.why}${x.venueName}${x.address}`) && !guard.some((w) => norm(`${x.title} ${x.why} ${x.venueName}`).includes(w)) && !seen.has(norm(x.title)) && seen.add(norm(x.title)))
      .filter((x) => !focus || x.kind === focus || (focus === 'touch' && x.kind === 'bridge')).filter((x) => !exclude.some((e) => norm(e) === norm(x.title))).slice(0, focus ? 2 : 5).map((x, i) => ({ ...x, id: `s${Date.now().toString(36)}${i}` }));
    return res.status(200).json({ suggestions });
  } catch (e) {
    return res.status(e.message === 'rate_limited' ? 502 : 500).json({ error: String(e.message || e), tried: e.tried });
  }
}

// ✦ Gamma presentation via the Gamma Generate API (v1.0, Classic /generations): the master prompt becomes a deck + PDF without copy-paste.
// Owner only. The key lives only in the hosting settings (GAMMA_API_KEY) and never reaches the browser.
// action "start" creates the generation; action "status" is polled by the browser every ~5 s (jobs take minutes, functions stay short).
import { owner } from './_owner.js';
import { str } from './_wellness.js';

const BASE = 'https://public-api.gamma.app/v1.0';
const head = () => ({ 'X-API-KEY': process.env.GAMMA_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' });
const fail = (res, r, out) => res.status(r.status === 401 ? 502 : r.status === 403 ? 402 : r.status === 429 ? 429 : 502)
  .json({ error: r.status === 401 ? 'gamma_bad_key' : r.status === 403 ? 'gamma_no_credits' : r.status === 429 ? 'gamma_busy' : 'gamma_error', detail: str(out?.message || out?.error?.message || out?.error, 200) });

export default async function handler(req, res) {
  const auth = await owner(req, res); if (!auth) return;
  if (!process.env.GAMMA_API_KEY) return res.status(503).json({ error: 'no_gamma_key' });
  const b = req.body || {};
  try {
    if (b.action === 'status') {
      const id = String(b.id || '');
      if (!/^[\w-]{1,100}$/.test(id)) return res.status(400).json({ error: 'bad_id' });
      const r = await fetch(`${BASE}/generations/${encodeURIComponent(id)}`, { headers: head(), signal: AbortSignal.timeout(15000) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) return fail(res, r, out);
      const okUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : '');
      return res.status(200).json({
        status: ['pending', 'completed', 'failed'].includes(out.status) ? out.status : 'pending',
        gammaUrl: okUrl(out.gammaUrl), exportUrl: okUrl(out.exportUrl),
        error: out.status === 'failed' ? str(out.error?.message, 200) || 'failed' : '',
        credits: out.credits && Number.isFinite(out.credits.remaining) ? { deducted: out.credits.deducted, remaining: out.credits.remaining } : null,
      });
    }
    // start: the master prompt already has one slide per "---" block with instructions + real content
    const inputText = str(b.prompt, 12000);
    if (inputText.length < 40) return res.status(400).json({ error: 'no_prompt' });
    const body = {
      inputText, title: str(b.title, 120) || 'Your Wellness Journey', format: 'presentation', textMode: 'generate', cardSplit: 'inputTextBreaks', exportAs: 'pdf',
      additionalInstructions: 'Keep every HH:MM time, date, venue name and stop-list rule exactly as given. Never add timed bookings, venues or activities that are not in the input; open space stays open. Refined, calm Les Clefs d\'Or hospitality English, generous white space.',
      textOptions: { amount: 'medium', tone: 'Warm, discreet, refined luxury hospitality', audience: 'A private guest planning a wellness trip', language: 'en' },
      imageOptions: { source: 'aiGenerated', style: 'Editorial, serene, natural light, warm neutral tones, no text in images, no people facing the camera' },
      cardOptions: { dimensions: '16x9' },
    };
    const r = await fetch(`${BASE}/generations`, { method: 'POST', headers: head(), body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || !out.generationId) return fail(res, r.ok ? { status: 502 } : r, out);
    return res.status(200).json({ generationId: String(out.generationId), warnings: Array.isArray(out.warnings) ? out.warnings.slice(0, 5).map((w) => str(typeof w === 'string' ? w : w?.message, 160)) : [] });
  } catch (e) {
    return res.status(e.name === 'TimeoutError' ? 504 : 500).json({ error: e.name === 'TimeoutError' ? 'gamma_timeout' : 'gamma_error' });
  }
}

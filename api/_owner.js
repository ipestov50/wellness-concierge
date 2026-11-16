// Общая проверка владельца и чтение данных его токеном (RLS). Файл с «_» — не адрес /api.
export async function owner(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return null; }
  const auth = req.headers.authorization || '';
  const u = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth } });
  if (!u.ok) { res.status(401).json({ error: 'unauthorized' }); return null; }
  const user = await u.json();
  const who = (process.env.OWNER_EMAIL || '').toLowerCase();
  if (who && (user.email || '').toLowerCase() !== who) { res.status(401).json({ error: 'unauthorized' }); return null; }
  if (!process.env.GEMINI_API_KEY) { res.status(503).json({ error: 'no_key' }); return null; }
  return auth;
}
export async function rest(path, auth) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('db_' + r.status);
  return r.json();
}
export const isId = (s) => /^[0-9a-f-]{36}$/.test(String(s || ''));
export const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
export const askJSON = async (gfetch, auth, models, system, payload, schema, { temperature = 0.3, budget } = {}) => {
  const g = await gfetch(auth, models, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload) }] }],
      generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema, ...(budget != null ? { thinkingConfig: { thinkingBudget: budget } } : {}) },
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!g.ok) { const e = new Error(g.status === 429 ? 'rate_limited' : 'gemini_error'); e.tried = g.tried; throw e; }
  const data = await g.json();
  try { return JSON.parse(data?.candidates?.[0]?.content?.parts?.map((x) => x.text || '').join('') || ''); } catch { throw new Error('bad_json'); }
};

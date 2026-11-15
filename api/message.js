// Черновик сообщения для блока «Моего дня»: гостю — на его языке, партнёру — на языке страны.
// Только для владельца. Имена в ИИ не отправляются: {имя} — обращение к гостю, {гость} — имя на брони.

const MODEL = 'gemini-2.5-flash';
const TZ = 'Europe/Paris';
const LANG_BY_CC = { FR: ['fr', 'французском'], MC: ['fr', 'французском'], IT: ['it', 'итальянском'], ES: ['es', 'испанском'], DE: ['de', 'немецком'], AT: ['de', 'немецком'], CH: ['fr', 'французском'], PT: ['pt', 'португальском'] };
const GUEST_LANG = { RU: ['ru', 'русском'], EN: ['en', 'английском'], FR: ['fr', 'французском'] };

async function rest(path, auth) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth } });
  if (!r.ok) throw new Error('db_' + r.status);
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const auth = req.headers.authorization || '';
  const u = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth } });
  if (!u.ok) return res.status(401).json({ error: 'unauthorized' });
  const user = await u.json();
  const owner = (process.env.OWNER_EMAIL || '').toLowerCase();
  if (owner && (user.email || '').toLowerCase() !== owner) return res.status(401).json({ error: 'unauthorized' });
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'no_key' });
  const b = req.body || {};
  const isId = (x) => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x);
  try {
    const [r] = isId(b.request_id) ? await rest(`requests?id=eq.${b.request_id}&select=*`, auth) : [null];
    const cid = r?.client_id || (isId(b.client_id) ? b.client_id : null);
    const [c] = cid ? await rest(`clients?id=eq.${cid}&select=*`, auth) : [null];
    const [p] = r?.partner_id ? await rest(`partners?id=eq.${r.partner_id}&select=name,type,city,terms`, auth) : [null];
    const day = r?.deadline ? r.deadline.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const trips = cid ? await rest(`trips?client_id=eq.${cid}&select=city,country_code,hotel,start_date,end_date&order=start_date.desc&limit=5`, auth) : [];
    const trip = trips.find((t) => t.start_date && t.start_date <= day && day <= (t.end_date || t.start_date)) || trips[0];
    const toPartner = b.kind === 'partner';
    const [lang, langLabel] = toPartner ? LANG_BY_CC[trip?.country_code] || ['en', 'английском'] : GUEST_LANG[c?.language] || GUEST_LANG.RU;
    const when = r?.deadline ? new Date(r.deadline).toLocaleString('ru-RU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null;
    const ctx = {
      действие: b.title, детали: b.detail, запрос: r && { суть: r.summary, категория: r.category, когда_по_Парижу: when, бюджет: r.budget_amount ? `${r.budget_amount} ${r.currency || ''}` : null, что_уточнить: r.clarifying_questions },
      партнёр: p && { название: p.name, тип: p.type, город: p.city },
      гость: c && { vip: c.vip, аллергии: c.allergies, диета: c.diet, избегает: c.dislikes, любит: c.likes },
      поездка: trip && { город: trip.city, отель: trip.hotel },
    };
    const prompt = toPartner
      ? `Ты консьерж люксового сервиса. Напиши короткое деловое сообщение партнёру (${p?.type || 'заведение'}) на ${langLabel} языке для действия ниже: вежливо, конкретно (дата, время, число гостей если известно, пожелания, аллергии — обязательно, если есть). Бронь на имя «{гость}». Без лишних слов, 3–6 предложений, подпись «Concierge». Только текст сообщения. Данные: ${JSON.stringify(ctx)}`
      : `Ты личный консьерж люксового сервиса. Напиши короткое тёплое сообщение гостю на ${langLabel} языке для действия ниже. Обращайся «{имя}». Конкретно и без воды, 2–4 предложения, на «вы», без смайликов (максимум один уместный). Если нужно уточнить детали — задай 1–3 чётких вопроса. Не упоминай медицинские данные. Только текст сообщения. Данные: ${JSON.stringify(ctx)}`;
    const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5, thinkingConfig: { thinkingBudget: 0 } } }),
      signal: AbortSignal.timeout(30000),
    });
    if (!g.ok) return res.status(502).json({ error: g.status === 429 ? 'rate_limited' : 'gemini_error' });
    const j = await g.json();
    const text = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
    return res.status(200).json({ text, lang, lang_label: `на ${langLabel} языке` });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

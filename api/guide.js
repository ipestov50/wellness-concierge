// «📘 Путеводитель» для гостя: Jarvis собирает персональный черновик по городу поездки
// (рестораны, спа, прогулки, шопинг, транспорт, полезное) с живым поиском Google и указаниями консьержа.
// Только для владельца, данные — с его токеном (RLS). Имена гостя и близких в ИИ не отправляются.

const MODEL = 'gemini-2.5-flash';
const SECTIONS = {
  dining: 'Рестораны и кафе', wellness: 'Спа и велнес', places: 'Прогулки и места', shopping: 'Шопинг',
  kids: 'С детьми', nightlife: 'Вечером', transport: 'Как передвигаться', useful: 'Полезно знать',
};

async function rest(path, auth, init = {}) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!r.ok) throw new Error('db_' + r.status);
  return r.status === 204 ? null : r.json();
}
function extractJSON(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('bad_json');
  return JSON.parse(text.slice(a, b + 1));
}
const str = (x, n = 300) => (typeof x === 'string' ? x.slice(0, n) : '');

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
  const id = String(b.id || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: 'bad_id' });
  const sections = (Array.isArray(b.sections) ? b.sections : Object.keys(SECTIONS)).filter((k) => SECTIONS[k]);
  const notes = str(b.notes, 1500);
  try {
    const [t] = await rest(`trips?id=eq.${id}&select=*`, auth);
    if (!t) return res.status(404).json({ error: 'not_found' });
    const [c] = await rest(`clients?id=eq.${t.client_id}&select=*`, auth);
    const people = await rest(`people?client_id=eq.${t.client_id}&select=role,allergies`, auth);
    // свои партнёры в этом городе — их стоит предложить в первую очередь
    const partners = t.city ? await rest(`partners?city=ilike.${encodeURIComponent('*' + t.city + '*')}&select=name,type,notes,rating&order=rating.desc.nullslast&limit=15`, auth).catch(() => []) : [];
    // что гость уже делал у нас (из выполненных и архива) — понять вкусы
    const past = await rest(`requests?client_id=eq.${t.client_id}&select=summary,category&order=created_at.desc&limit=20`, auth).catch(() => []);
    const kids = people.some((p) => /сын|доч|реб|дет/i.test(p.role || '')) || /дет|сын|доч|реб/i.test(t.companions || '');
    const ctx = {
      город: t.city, страна: t.country, отель: t.hotel || null, даты: [t.start_date, t.end_date], с_кем: t.companions || null, есть_дети: kids,
      гость: c && {
        язык: c.language || 'RU', vip: !!c.vip, аллергии: c.allergies, диета: c.diet, не_любит: c.dislikes, любит: c.likes,
        кухня: c.pref_food, спа: c.pref_spa, транспорт: c.pref_transport, отели: c.pref_hotels,
      },
      аллергии_близких: people.flatMap((p) => p.allergies || []),
      наши_партнёры_в_городе: partners.map((p) => ({ название: p.name, тип: p.type, заметки: p.notes, оценка: p.rating })),
      что_гость_заказывал_раньше: past.map((r) => `${r.category}: ${r.summary}`).slice(0, 15),
      брифинг_jarvis: t.brief ? { транспорт: t.brief.transport, оплата: t.brief.money, связь: t.brief.connect, этикет: t.brief.etiquette, безопасность: t.brief.safety } : null,
    };
    const prompt = `Ты Jarvis — консьерж люксового сервиса для гостей из стран СНГ. Составь ПЕРСОНАЛЬНЫЙ путеводитель для гостя по городу поездки.
Найди АКТУАЛЬНЫЕ места через поиск Google: работают сейчас, хорошие отзывы, уровень люкс/премиум, подходят именно этому гостю (кухня, диета, аллергии, дети, что любит и не любит).
Партнёров консьержа из списка «наши_партнёры_в_городе» ставь первыми, если подходят (отметь partner: true).
${notes ? `ГЛАВНОЕ — указания консьержа, выполни их точно: «${notes}»\n` : ''}Разделы (только эти, по порядку): ${sections.map((k) => `${k} — ${SECTIONS[k]}`).join('; ')}.
Обращение к гостю — «{имя}» (подставим сами). Пиши по-русски, тепло и коротко, без воды, на «вы».
Ответь ТОЛЬКО JSON:
{
 "title": "Путеводитель: <город>",
 "intro": "2–3 предложения для гостя: настроение города в эти даты и как мы всё продумали",
 "sections": [ { "key": "dining", "title": "название раздела", "items": [
   { "name": "название места", "what": "что это и чем хорошо — 1 предложение", "why": "почему именно для этого гостя (учесть предпочтения/аллергии/детей)", "area": "район или адрес", "tip": "совет: что заказать, когда приходить, дресс-код, бронь", "partner": false }
 ] } ],
 "tips": ["3–6 коротких полезных советов на поездку"]
}
В каждом разделе 3–6 мест; для «transport» и «useful» items — это способы/советы (name — заголовок). Не выдумывай: если не уверен, что место работает, не включай его.
Данные: ${JSON.stringify(ctx)}`;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.4 } }),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) return res.status(r.status === 429 ? 429 : 502).json({ error: r.status === 429 ? 'rate_limited' : 'gemini_error' });
    const j = await r.json();
    const cand = j.candidates?.[0];
    const data = extractJSON((cand?.content?.parts || []).map((p) => p.text || '').join(''));
    // приводим к безопасной форме: только строки нужной длины
    const guide = {
      title: str(data.title, 120) || `Путеводитель: ${t.city}`,
      intro: str(data.intro, 800),
      sections: (data.sections || []).filter((s) => s && Array.isArray(s.items)).slice(0, 10).map((s) => ({
        key: str(s.key, 30), title: str(s.title, 80),
        items: s.items.slice(0, 8).map((x) => ({ name: str(x.name, 120), what: str(x.what), why: str(x.why), area: str(x.area, 160), tip: str(x.tip), partner: !!x.partner })),
      })),
      tips: (data.tips || []).slice(0, 8).map((x) => str(x, 240)).filter(Boolean),
      sources: (cand?.groundingMetadata?.groundingChunks || []).map((x) => x.web).filter(Boolean).slice(0, 8).map((w) => ({ title: str(w.title, 120), uri: str(w.uri, 500) })),
      notes, sections_req: sections, generated_at: new Date().toISOString(),
    };
    await rest(`trips?id=eq.${id}`, auth, { method: 'PATCH', body: JSON.stringify({ guide }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ guide });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

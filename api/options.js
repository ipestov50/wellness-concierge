// «✦ Варианты для гостя»: 3 места под запрос (сначала ваши партнёры), каждое сверено с картой.
// Jarvis (Gemini + поиск Google) предлагает, затем каждое место ищем в OpenStreetMap (Photon):
// совпало название и место рядом с городом → «адрес подтверждён»; иначе — «проверьте».
// Только для владельца, данные — с его токеном (RLS). Имена гостя и близких в ИИ не отправляются.

const MODEL = 'gemini-2.5-flash';
const UA = { 'User-Agent': 'WellnessConciergeOptions/1.0' };
const LANG = { RU: 'русском', EN: 'английском', FR: 'французском' };
const CAT_TYPES = { Dining: ['restaurant'], 'Spa & Wellness': ['spa'], Activities: ['activity'], 'Health & Fitness': ['spa', 'activity'], Transport: ['transport'], Accommodation: ['hotel'], 'Gifts & Events': ['activity', 'other'] };

async function rest(path, auth) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth } });
  if (!r.ok) throw new Error('db_' + r.status);
  return r.json();
}
function extractJSON(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('bad_json');
  return JSON.parse(text.slice(a, b + 1));
}
const str = (x, n = 300) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9а-яё ]+/g, ' ').replace(/\b(le|la|les|l|the|de|du|des|restaurant|hotel|spa|cafe|bar)\b/g, ' ').replace(/\s+/g, ' ').trim();
const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos((a.lat * Math.PI) / 180));
const mapsUrl = (name, address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, address].filter(Boolean).join(', '))}`;

async function photon(q, near, limit = 5) {
  try {
    const u = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${limit}${near ? `&lat=${near.lat}&lon=${near.lon}` : ''}`;
    return (await (await fetch(u, { headers: UA, signal: AbortSignal.timeout(7000) })).json()).features || [];
  } catch { return []; }
}
const osmAddress = (p) => [[p.housenumber, p.street].filter(Boolean).join(' '), [p.postcode, p.city || p.town || p.village].filter(Boolean).join(' ')].filter(Boolean).join(', ');

// сверка с картой: ищем место по названию рядом с городом, сравниваем название и улицу
async function verify(o, near) {
  const want = norm(o.name);
  const feats = await photon(`${o.name}${o.city ? ', ' + o.city : ''}`, near);
  let best = null;
  for (const f of feats) {
    const p = f.properties || {};
    const [lon, lat] = f.geometry?.coordinates || [];
    if (lat == null || (near && km({ lat, lon }, near) > 40)) continue;
    const got = norm(p.name);
    if (!got) continue;
    const wt = want.split(' ').filter((w) => w.length > 2), gt = new Set(got.split(' '));
    const overlap = wt.length ? wt.filter((w) => gt.has(w)).length / wt.length : 0;
    if (got === want || got.includes(want) || want.includes(got) || overlap >= 0.6) { best = { p, lat, lon }; break; }
  }
  if (!best) return { status: 'unverified' };
  const addr = osmAddress(best.p);
  const street = norm(best.p.street);
  const sameStreet = street && norm(o.address).includes(street);
  return { status: sameStreet || !o.address ? 'verified' : 'corrected', osm_address: addr, lat: best.lat, lon: best.lon };
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
  const id = String(b.id || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: 'bad_id' });
  const notes = str(b.notes, 800);
  const exclude = (Array.isArray(b.exclude) ? b.exclude : []).slice(0, 12).map((x) => str(x, 80)).filter(Boolean);
  try {
    const [r] = await rest(`requests?id=eq.${id}&select=*`, auth);
    if (!r) return res.status(404).json({ error: 'not_found' });
    const [c] = r.client_id ? await rest(`clients?id=eq.${r.client_id}&select=*`, auth) : [null];
    const people = c ? await rest(`people?client_id=eq.${c.id}&select=name,role,allergies`, auth) : [];
    const day = (r.deadline || new Date().toISOString()).slice(0, 10);
    const trips = c ? await rest(`trips?client_id=eq.${c.id}&select=city,country,hotel,lat,lon,start_date,end_date&order=start_date.desc&limit=6`, auth) : [];
    const trip = trips.find((t) => t.start_date && t.start_date <= day && day <= (t.end_date || t.start_date));
    const city = trip?.city || c?.city || '';
    // партнёры этого города и нужного типа — первыми
    const types = CAT_TYPES[r.category] || [];
    const partners = city ? (await rest(`partners?city=ilike.${encodeURIComponent('*' + city + '*')}&select=id,name,type,address,notes,terms,rating&order=rating.desc.nullslast&limit=30`, auth).catch(() => []))
      .filter((p) => !types.length || types.includes(p.type)) : [];
    // что гость выбирал раньше в этой категории — понять вкус
    const past = c ? (await rest(`requests?client_id=eq.${c.id}&category=eq.${encodeURIComponent(r.category)}&options=not.is.null&select=options&order=created_at.desc&limit=10`, auth).catch(() => []))
      .map((x) => x.options?.chosen != null ? x.options.items?.[x.options.chosen]?.name : null).filter(Boolean) : [];
    const names = [c?.name, ...people.map((p) => p.name)].filter(Boolean).flatMap((n) => n.replace(/\(.*?\)/g, '').split(/\s+/)).filter((x) => x.length > 2);
    const scrub = (s) => names.reduce((acc, n) => acc.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'гость'), String(s || ''));
    const lang = c?.language && LANG[c.language] ? c.language : 'RU';
    const when = r.deadline ? new Date(r.deadline).toLocaleString('ru-RU', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + ' (по Парижу)' : null;
    const ctx = {
      запрос: scrub(r.summary), исходное_сообщение: scrub(r.original_message), категория: r.category, когда: when,
      бюджет: r.budget_amount ? `${r.budget_amount} ${r.currency || ''}` : null, город: city, страна: trip?.country || null, отель_гостя: trip?.hotel || null,
      гость: c && { vip: !!c.vip, аллергии: c.allergies, диета: c.diet, не_любит: c.dislikes, любит: c.likes, кухня: c.pref_food, спа: c.pref_spa },
      аллергии_близких: people.flatMap((p) => p.allergies || []),
      раньше_выбирал: past,
      наши_партнёры: partners.map((p) => ({ название: p.name, тип: p.type, адрес: p.address, заметки: scrub(p.notes), условия: p.terms, оценка: p.rating })),
      не_предлагать: exclude,
    };
    const prompt = `Ты Jarvis — консьерж люксового сервиса. Подбери РОВНО 3 варианта под запрос гостя.
ПРАВИЛА ДОСТОВЕРНОСТИ (важнее всего): только реально существующие и РАБОТАЮЩИЕ сейчас места; название и адрес — точно как на официальном сайте или в Google Maps (улица, номер дома, индекс, город). Проверь через поиск Google. Не уверен — не предлагай. Закрытые навсегда — исключи.
Партнёров из «наши_партнёры» ставь первыми, если подходят (partner: true, адрес бери из данных).
Учитывай аллергии, диету, «не любит», бюджет, район отеля и время запроса. Не предлагай места из «не_предлагать».
${notes ? `Указания консьержа (выполни точно): «${notes}»\n` : ''}Ответь ТОЛЬКО JSON:
{ "options": [ {
  "name": "точное название",
  "kind": "тип и кухня/формат, 2–4 слова по-русски",
  "address": "полный адрес: номер, улица, индекс, город",
  "area": "район, по-русски",
  "price": "€ | €€ | €€€ | €€€€",
  "why": "почему подходит именно этому гостю — 1 предложение по-русски",
  "why_guest": "то же для гостя на ${LANG[lang]} языке, тепло и коротко",
  "note": "важное для брони по-русски: часы, дресс-код, бронь заранее (или пусто)",
  "website": "официальный сайт или пусто",
  "partner": false
} ] }
Данные: ${JSON.stringify(ctx)}`;
    const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } } }),
      signal: AbortSignal.timeout(60000),
    });
    if (!g.ok) return res.status(g.status === 429 ? 429 : 502).json({ error: g.status === 429 ? 'rate_limited' : 'gemini_error' });
    const j = await g.json();
    const cand = j.candidates?.[0];
    const d = extractJSON((cand?.content?.parts || []).map((p) => p.text || '').join(''));
    // центр города для сверки
    let near = trip?.lat != null ? { lat: +trip.lat, lon: +trip.lon } : null;
    if (!near && city) { const [f] = await photon(city, null, 1); if (f) near = { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }; }
    const items = (d.options || []).slice(0, 3).map((o) => {
      const partner = partners.find((p) => norm(p.name) === norm(o.name));
      return {
        name: str(o.name, 100), kind: str(o.kind, 60), address: str(partner?.address || o.address, 200), area: str(o.area, 60), price: str(o.price, 8),
        why: str(o.why, 260), why_guest: str(o.why_guest, 300), note: str(o.note, 200), website: /^https?:\/\//.test(o.website || '') ? str(o.website, 300) : '',
        partner: !!partner, partner_id: partner?.id || null, city,
      };
    });
    // сверяем каждое место с картой (параллельно)
    await Promise.all(items.map(async (o) => {
      const v = await verify(o, near);
      o.check = v.status;                                   // verified | corrected | unverified
      if (v.status === 'corrected' && v.osm_address) { o.address_ai = o.address; o.address = v.osm_address; }
      if (v.lat != null) { o.lat = v.lat; o.lon = v.lon; }
      if (o.partner && v.status === 'unverified') o.check = 'partner'; // ваш партнёр — адрес из вашей базы
      o.maps = mapsUrl(o.name, o.address);
      delete o.city;
    }));
    return res.status(200).json({
      items, lang, city,
      sources: (cand?.groundingMetadata?.groundingChunks || []).map((x) => x.web).filter(Boolean).slice(0, 6).map((w) => ({ title: str(w.title, 100), uri: str(w.uri, 400) })),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
export { verify, norm }; // для проверки

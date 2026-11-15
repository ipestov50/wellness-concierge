// «📘 Путеводитель-лукбук» для гостя: Jarvis собирает содержимое книги (обложка, вступление, письмо,
// план по дням с вашими запросами, карта, отель и велнес, рекомендации) с живым поиском Google и вашими указаниями.
// Фото — Wikimedia Commons (бесплатно, без ключа), координаты мест — Photon/OpenStreetMap (бесплатно, без ключа).
// Только для владельца, данные — с его токеном (RLS). Имена гостя и близких в ИИ не отправляются.

const MODEL = 'gemini-2.5-flash';
const UA = { 'User-Agent': 'WellnessConciergeGuide/1.0 (travel lookbook builder)' };
const PAGES = ['cover', 'intro', 'welcome', 'days', 'map', 'hotels', 'recs', 'back'];

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
const str = (x, n = 400) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
const arr = (x, n) => (Array.isArray(x) ? x.slice(0, n) : []);
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const partsIn = (tz, ms) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));

// ---------- фото: Wikimedia Commons, только горизонтальные JPEG ≥ 1200 px ----------
// не больше 2 запросов одновременно и один повтор после паузы — у Commons есть лимит частоты
let active = 0;
const waiting = [];
const slot = () => (active < 2 ? (active++, Promise.resolve()) : new Promise((r) => waiting.push(r)));
const release = () => { const next = waiting.shift(); if (next) next(); else active--; };
const memo = new Map();
function commons(q, n = 4) {
  if (!q) return Promise.resolve([]);
  const key = q.toLowerCase() + '|' + n;
  if (!memo.has(key)) {
    if (memo.size > 300) memo.clear();
    const p = commonsRaw(q, n).then((list) => { if (!list.length) memo.delete(key); return list; });
    memo.set(key, p);
  }
  return memo.get(key);
}
async function commonsRaw(q, n, retry = true) {
  await slot();
  let rateLimited = false;
  try {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent('filetype:bitmap ' + q)}&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1600&format=json`;
    const resp = await fetch(url, { headers: UA, signal: AbortSignal.timeout(9000) });
    const body = await resp.text();
    if (!resp.ok || !body.startsWith('{')) { rateLimited = true; return []; }
    const j = JSON.parse(body);
    return Object.values(j.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0))
      .map((p) => p.imageinfo?.[0]).filter((i) => i && /\.jpe?g(\?|$)/i.test(i.url) && i.thumbwidth >= 1200 && i.thumbwidth >= i.thumbheight * 1.15)
      .slice(0, n).map((i) => ({ url: i.thumburl, credit: str(String(i.extmetadata?.Artist?.value || '').replace(/<[^>]+>/g, ''), 80), page: i.descriptionurl }));
  } catch { return []; }
  finally {
    release();
    if (rateLimited && retry) { await new Promise((r) => setTimeout(r, 2500)); return commonsRaw(q, n, false); } // eslint-disable-line no-unsafe-finally
  }
}
// ---------- координаты места рядом с городом: Photon (OpenStreetMap) ----------
async function geocode(q, near) {
  try {
    const u = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1${near ? `&lat=${near.lat}&lon=${near.lon}` : ''}`;
    const f = (await (await fetch(u, { headers: UA, signal: AbortSignal.timeout(7000) })).json()).features?.[0];
    if (!f) return null;
    const [lon, lat] = f.geometry.coordinates;
    if (near && Math.hypot((lat - near.lat) * 111, (lon - near.lon) * 111 * Math.cos(lat * Math.PI / 180)) > 60) return null; // не в этом городе
    return { lat, lon };
  } catch { return null; }
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
  const b = req.body || {};
  const id = String(b.id || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: 'bad_id' });
  // замена одного фото: подборка вариантов по запросу консьержа
  if (b.mode === 'photos') return res.status(200).json({ photos: await commons(str(b.q, 120), 8) });
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'no_key' });
  const notes = str(b.notes, 1500);
  const pages = arr(b.pages, 10).filter((p) => PAGES.includes(p));
  try {
    const [t] = await rest(`trips?id=eq.${id}&select=*`, auth);
    if (!t) return res.status(404).json({ error: 'not_found' });
    const [c] = await rest(`clients?id=eq.${t.client_id}&select=*`, auth);
    const people = await rest(`people?client_id=eq.${t.client_id}&select=name,role,allergies`, auth);
    const partners = t.city ? await rest(`partners?city=ilike.${encodeURIComponent('*' + t.city + '*')}&select=id,name,type,notes,terms,rating&order=rating.desc.nullslast&limit=20`, auth).catch(() => []) : [];
    const reqs = await rest(`requests?client_id=eq.${t.client_id}&select=summary,category,deadline,status,partner_id&order=deadline.asc.nullslast&limit=80`, auth).catch(() => []);
    // имена гостя и близких убираем из любых текстов, которые уходят в ИИ
    const names = [c?.name, ...people.map((p) => p.name)].filter(Boolean).flatMap((n) => n.replace(/\(.*?\)/g, '').split(/\s+/)).filter((x) => x.length > 2);
    const scrub = (s) => names.reduce((acc, n) => acc.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'гость'), String(s || ''));
    const tz = t.tz || 'Europe/Paris';
    const start = t.start_date || new Date().toISOString().slice(0, 10);
    const nDays = Math.min(7, Math.max(1, t.end_date ? Math.round((Date.parse(t.end_date) - Date.parse(start)) / 864e5) + 1 : 3));
    const dayList = Array.from({ length: nDays }, (_, i) => addDays(start, i));
    // запросы на даты поездки — «якоря» плана по дням (время местное)
    const fixed = reqs.filter((r) => r.deadline && r.status !== 'cancelled').map((r) => {
      const p = partsIn(tz, Date.parse(r.deadline));
      return { день: `${p.year}-${p.month}-${p.day}`, время: `${p.hour}:${p.minute}`, что: scrub(r.summary), категория: r.category, партнёр: partners.find((x) => x.id === r.partner_id)?.name || null };
    }).filter((x) => dayList.includes(x.день));
    const kids = people.some((p) => /сын|доч|реб|дет/i.test(p.role || '')) || /дет|сын|доч|реб/i.test(t.companions || '');
    const ctx = {
      город: t.city, страна: t.country, отель: t.hotel || null, даты: [start, t.end_date || null], дни: dayList, с_кем: scrub(t.companions) || null, есть_дети: kids,
      гость: c && { vip: !!c.vip, аллергии: c.allergies, диета: c.diet, не_любит: c.dislikes, любит: c.likes, кухня: c.pref_food, спа: c.pref_spa, транспорт: c.pref_transport, отели: c.pref_hotels },
      аллергии_близких: people.flatMap((p) => p.allergies || []),
      уже_запланировано: fixed,
      наши_партнёры_в_городе: partners.map((p) => ({ название: p.name, тип: p.type, заметки: scrub(p.notes), условия: p.terms, оценка: p.rating })),
      заказывал_раньше: reqs.slice(-20).map((r) => `${r.category}: ${scrub(r.summary)}`),
      брифинг: t.brief ? { транспорт: t.brief.transport?.summary, оплата: t.brief.money, этикет: t.brief.etiquette } : null,
    };
    const prompt = `Ты Jarvis — консьерж люксового сервиса для гостей из стран СНГ. Собери содержимое персонального ЛУКБУКА-путеводителя (как в бутик-тревел-агентстве) по городу поездки.
Найди АКТУАЛЬНЫЕ места через поиск Google: работают сейчас, уровень люкс/премиум, подходят ИМЕННО этому гостю (кухня, диета, аллергии, дети, что любит/не любит). Не выдумывай: не уверен — не включай.
Партнёров консьержа ставь первыми, если подходят (partner: true). «уже_запланировано» — обязательно в плане по дням, в своё время и слот.
${notes ? `ГЛАВНОЕ — указания консьержа, выполни точно: «${notes}»\n` : ''}Обращение к гостю — «{имя}». Пиши по-русски, тепло, изящно и коротко, на «вы», без воды и штампов.
Для каждого фото дай photo — короткий запрос на АНГЛИЙСКОМ для поиска снимка в Wikimedia Commons (конкретное место/вид: "Nice Promenade des Anglais sunset", "Negresco hotel Nice facade").
Ответь ТОЛЬКО JSON:
{
 "cover": { "title": "город одним-двумя словами", "subtitle": "изящный подзаголовок, напр. «Лазурный берег в ноябре»", "photo": "..." },
 "intro": { "heading": "2–4 слова", "lead": "1 строка", "text": "3–4 предложения: идея путешествия", "photo": "природа/пальмы/море этого места" },
 "welcome": { "title": "напр. «Путешествие к морю»", "text": "письмо консьержа гостю, 4–6 предложений, от первого лица", "photo": "..." },
 "days": [ { "date": "YYYY-MM-DD", "title": "тема дня, 2–4 слова",
   "morning": { "time": "09:30", "title": "...", "text": "1–2 предложения", "photo": "..." },
   "afternoon": { "time": "13:00", "title": "...", "text": "...", "photo": "..." },
   "evening": { "time": "20:00", "title": "...", "text": "...", "photo": "..." } } ],
 "map": { "title": "напр. «Ницца: главное»", "text": "1–2 предложения", "points": [ { "name": "место", "text": "1 предложение", "geo": "точный поисковый запрос: название, город" } ] },
 "hotels": [ { "kind": "hotel" | "wellness", "name": "...", "address": "полный адрес", "text": "3–4 предложения", "perks": ["4–6 привилегий/удобств"], "price": "ориентир цены за ночь или «по запросу»", "photos": ["...", "...", "..."] } ],
 "recs": { "title": "напр. «Рекомендации»", "photo": "...", "items": [ { "badge": "Ресторан | Спа | Бар | Кафе | Пляж | Бутик", "name": "...", "address": "...", "text": "1 короткое предложение", "partner": false } ] },
 "tips": ["3–5 коротких советов"]
}
Дни — ровно по списку «дни». hotels: 1) отель гостя (если указан), 2) лучший велнес/спа-курорт или спа для этого гостя. points: 4–6, recs.items: 6–9.
Данные: ${JSON.stringify(ctx)}`;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.5 } }),
      signal: AbortSignal.timeout(150000),
    });
    if (!r.ok) return res.status(r.status === 429 ? 429 : 502).json({ error: r.status === 429 ? 'rate_limited' : 'gemini_error' });
    const j = await r.json();
    const cand = j.candidates?.[0];
    const d = extractJSON((cand?.content?.parts || []).map((p) => p.text || '').join(''));

    // ---------- фото и координаты: параллельно ----------
    const city = [t.city, t.country].filter(Boolean).join(' ');
    // фото: один поиск даёт несколько снимков — так запросов к Commons в ~3 раза меньше (у него лимит частоты)
    const pool = [];
    const used = new Set();
    const take = (list, k = 1) => { const out = []; for (const p of list) { if (!pool.some((x) => x.url === p.url)) pool.push(p); if (!used.has(p.url) && out.length < k) { used.add(p.url); out.push(p.url); } } return out; };
    const search = async (q, fallback, k = 1, n = 6) => { let list = await commons(q, n); if (!list.length && fallback) list = await commons(fallback, n); return take(list, k); };
    const fromPool = () => { const p = pool.find((x) => !used.has(x.url)); if (p) { used.add(p.url); return p.url; } return pool[0]?.url || ''; };
    const daySlot = (s = {}) => ({ time: str(s.time, 5), title: str(s.title, 90), text: str(s.text, 320), photo: '', q: str(s.photo, 100) });
    const book = {
      v: 2,
      cover: { title: str(d.cover?.title, 40) || t.city, subtitle: str(d.cover?.subtitle, 80), photo: '', q: str(d.cover?.photo, 100) },
      intro: { heading: str(d.intro?.heading, 50), lead: str(d.intro?.lead, 120), text: str(d.intro?.text, 900), photo: '', q: str(d.intro?.photo, 100) },
      welcome: { title: str(d.welcome?.title, 60), text: str(d.welcome?.text, 1200), photo: '', q: str(d.welcome?.photo, 100) },
      days: arr(d.days, 7).map((x) => ({ date: str(x.date, 10), title: str(x.title, 60), morning: daySlot(x.morning), afternoon: daySlot(x.afternoon), evening: daySlot(x.evening) })),
      map: { title: str(d.map?.title, 60), text: str(d.map?.text, 300), points: arr(d.map?.points, 6).map((p) => ({ name: str(p.name, 80), text: str(p.text, 200), geo: str(p.geo, 120) })) },
      hotels: arr(d.hotels, 2).map((h) => ({ kind: h.kind === 'wellness' ? 'wellness' : 'hotel', name: str(h.name, 80), address: str(h.address, 160), text: str(h.text, 900), perks: arr(h.perks, 7).map((x) => str(x, 120)).filter(Boolean), price: str(h.price, 160), photos: ['', '', ''], qs: arr(h.photos, 3).map((x) => str(x, 100)) })),
      recs: { title: str(d.recs?.title, 60) || 'Рекомендации', photo: '', q: str(d.recs?.photo, 100), items: arr(d.recs?.items, 9).map((x) => ({ badge: str(x.badge, 20), name: str(x.name, 80), address: str(x.address, 140), text: str(x.text, 160), partner: !!x.partner })) },
      tips: arr(d.tips, 6).map((x) => str(x, 200)).filter(Boolean),
      pages: pages.length ? pages : PAGES,
      notes, generated_at: new Date().toISOString(),
      sources: (cand?.groundingMetadata?.groundingChunks || []).map((x) => x.web).filter(Boolean).slice(0, 8).map((w) => ({ title: str(w.title, 120), uri: str(w.uri, 500) })),
    };
    const near = t.lat != null ? { lat: +t.lat, lon: +t.lon } : null;
    const jobs = [
      search(book.cover.q, `${city} panorama`).then(([u]) => { book.cover.photo = u || ''; }),
      search(book.intro.q, `${city} nature`).then(([u]) => { book.intro.photo = u || ''; }),
      search(book.welcome.q, `${city} view`).then(([u]) => { book.welcome.photo = u || ''; }),
      search(book.recs.q, `${city} restaurant terrace`).then(([u]) => { book.recs.photo = u || ''; }),
      search(`${city} coast aerial`, city).then(([u]) => { book.back = { photo: u || '' }; }),
      // день: одним поиском по теме дня — 3 снимка на утро/день/вечер
      ...book.days.map((x) => search(`${x.morning.q || x.title} `.trim(), `${city} landmarks`, 3, 10).then((us) => { ['morning', 'afternoon', 'evening'].forEach((k, i) => { x[k].photo = us[i] || ''; }); })),
      // отель: по названию — 3 снимка
      ...book.hotels.map((h) => search(h.qs[0] || `${h.name} ${t.city}`, `${city} ${h.kind === 'wellness' ? 'spa' : 'hotel'}`, 3, 10).then((us) => { h.photos = [0, 1, 2].map((i) => us[i] || ''); })),
      ...book.map.points.map((p) => geocode(p.geo || `${p.name} ${t.city}`, near).then((g) => { if (g) Object.assign(p, g); })),
    ];
    if (!near && t.city) jobs.push(geocode(city).then((g) => { book.map.center = g; }));
    await Promise.allSettled(jobs);
    book.map.center = book.map.center || near;
    // пустые места заполняем снимками города из общей подборки
    for (const x of book.days) for (const k of ['morning', 'afternoon', 'evening']) if (!x[k].photo) x[k].photo = fromPool();
    for (const h of book.hotels) h.photos = h.photos.map((u) => u || fromPool());
    for (const o of [book.cover, book.intro, book.welcome, book.recs, book.back]) if (o && !o.photo) o.photo = fromPool();
    book.days.forEach((x) => ['morning', 'afternoon', 'evening'].forEach((k) => delete x[k].q));
    [book.cover, book.intro, book.welcome, book.recs].forEach((o) => delete o.q);
    book.hotels.forEach((h) => delete h.qs);
    book.photos = pool.slice(0, 40); // для быстрой замены фото в конструкторе
    await rest(`trips?id=eq.${id}`, auth, { method: 'PATCH', body: JSON.stringify({ guide: book }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ guide: book });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

export { commons, geocode }; // для проверки

// «🔎 Поиск Jarvis»: инсайдерский поиск мест и событий с цепочкой поставщиков и запасом по лимитам.
//   события:  ваши партнёры → Ticketmaster Discovery → Tavily → Gemini (поиск Google)
//   места/исследование: ваши партнёры → Tavily → Gemini (поиск Google)
// Ключи — только на сервере (Vercel): TAVILY_API_KEYS, TICKETMASTER_API_KEYS (через запятую — пул с ротацией).
// Только для владельца, данные — с его токеном (RLS). Имена гостя в поиск не уходят.
import { cacheKey, getCache, setCache } from './_cache.js';

const SMART = 'gemini-2.5-flash';
const LITE = 'gemini-2.5-flash-lite';
const EVENT_RX = /концерт|билет|матч|игр[аы]|театр|опер|балет|мюзикл|шоу|фестивал|выставк|спектакл|ложа|vip.?box|ticket|concert|game|match|show|festival|opera|ballet|theat/i;
const str = (x, n = 300) => (typeof x === 'string' ? x.trim().slice(0, n) : '');

// ---------- пул ключей с «остыванием» исчерпанных (в памяти экземпляра) ----------
const cooldown = new Map(); // key -> until
const pool = (env) => (process.env[env] || '').split(',').map((k) => k.trim()).filter(Boolean);
async function withKeys(env, fn) {
  const keys = pool(env).filter((k) => (cooldown.get(k) || 0) < Date.now());
  if (!keys.length) return { skipped: pool(env).length ? 'cooldown' : 'no_key' };
  for (const k of keys) {
    try {
      const out = await fn(k);
      if (out?.status && [401, 402, 403, 429, 432, 433].includes(out.status)) { cooldown.set(k, Date.now() + (out.status === 429 ? 60e3 : 3600e3)); continue; }
      return out;
    } catch (e) { cooldown.set(k, Date.now() + 30e3); if (keys.length === 1) return { error: String(e.message || e) }; }
  }
  return { skipped: 'exhausted' };
}

async function rest(path, auth) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth } });
  if (!r.ok) throw new Error('db_' + r.status);
  return r.json();
}
// город на английском + страна + пояс (для Ticketmaster и точного поиска)
async function place(city) {
  if (!city) return null;
  try {
    const s = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru`, { signal: AbortSignal.timeout(6000) })).json();
    const id = s.results?.[0]?.id;
    if (!id) return null;
    const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/get?id=${id}&language=en`, { signal: AbortSignal.timeout(6000) })).json();
    return { en: g.name, cc: g.country_code, tz: g.timezone, lat: g.latitude, lon: g.longitude };
  } catch { return null; }
}
function extractJSON(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('bad_json');
  return JSON.parse(text.slice(a, b + 1));
}
async function gemini(model, prompt, tools) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], ...(tools ? { tools } : {}), generationConfig: { temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } } }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) return { status: r.status };
  const j = await r.json();
  const cand = j.candidates?.[0];
  return { text: (cand?.content?.parts || []).map((p) => p.text || '').join(''), chunks: cand?.groundingMetadata?.groundingChunks || [] };
}

// ---------- поставщики ----------
async function ticketmaster(q, loc, from, to) {
  return withKeys('TICKETMASTER_API_KEYS', async (key) => {
    const p = new URLSearchParams({ apikey: key, keyword: q, size: '12', sort: 'date,asc', locale: '*' });
    if (loc?.en) p.set('city', loc.en);
    if (loc?.cc) p.set('countryCode', loc.cc);
    if (from) p.set('startDateTime', `${from}T00:00:00Z`);
    if (to) p.set('endDateTime', `${to}T23:59:59Z`);
    const r = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${p}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { status: r.status };
    const j = await r.json();
    const events = j._embedded?.events || [];
    return { results: events.map((e) => {
      const v = e._embedded?.venues?.[0];
      const pr = e.priceRanges?.[0];
      return {
        kind: 'event', title: str(e.name, 140), date: e.dates?.start?.localDate || '', time: (e.dates?.start?.localTime || '').slice(0, 5), tz: e.dates?.timezone || v?.timezone || loc?.tz || '',
        addressOrVenue: [v?.name, v?.address?.line1, v?.city?.name].filter(Boolean).join(', '), url: e.url || '',
        image: (e.images || []).sort((a, b) => b.width - a.width).find((i) => i.ratio === '16_9')?.url || '',
        price: pr ? `${pr.min ?? ''}–${pr.max ?? ''} ${pr.currency || ''}`.trim() : '', status: e.dates?.status?.code || '',
        summary: str([e.classifications?.[0]?.segment?.name, e.classifications?.[0]?.genre?.name].filter((x) => x && x !== 'Undefined').join(' · '), 120),
        sourceProvider: 'ticketmaster',
      };
    }) };
  });
}
async function tavily(q) {
  return withKeys('TAVILY_API_KEYS', async (key) => {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: q, search_depth: 'advanced', include_answer: true, max_results: 8 }), signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return { status: r.status };
    const j = await r.json();
    return { answer: str(j.answer, 1200), sources: (j.results || []).map((x) => ({ title: str(x.title, 160), url: str(x.url, 500), content: str(x.content, 900) })) };
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store'); // ответы персональные — кэш в базе, не в общем CDN
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const auth = req.headers.authorization || '';
  const u = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth } });
  if (!u.ok) return res.status(401).json({ error: 'unauthorized' });
  const user = await u.json();
  const owner = (process.env.OWNER_EMAIL || '').toLowerCase();
  if (owner && (user.email || '').toLowerCase() !== owner) return res.status(401).json({ error: 'unauthorized' });
  const b = req.body || {};
  const isId = (x) => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x);
  const q = str(b.query, 300);
  if (!q) return res.status(400).json({ error: 'empty' });
  const category = ['events', 'venues', 'general'].includes(b.category) ? b.category : EVENT_RX.test(q) ? 'events' : 'venues';
  const ymd = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x : '');
  try {
    // ---------- контекст гостя (без имён) ----------
    const [c] = isId(b.client_id) ? await rest(`clients?id=eq.${b.client_id}&select=id,name,city,allergies,diet,dislikes,likes,pref_food,pref_spa,vip`, auth) : [null];
    let city = str(b.city, 80), from = ymd(b.date_from), to = ymd(b.date_to) || from;
    if (c && (!city || !from)) {
      const day = from || new Date().toISOString().slice(0, 10);
      const trips = await rest(`trips?client_id=eq.${c.id}&select=city,start_date,end_date&order=start_date.desc&limit=6`, auth).catch(() => []);
      const t = trips.find((x) => x.start_date && (x.end_date || x.start_date) >= day) || null;
      if (!city) city = t?.city || c.city || '';
      if (!from && t) { from = t.start_date > day ? t.start_date : day; to = t.end_date || from; }
    }
    const prefs = c ? [c.diet?.length && `диета: ${c.diet.join(', ')}`, c.allergies?.length && `аллергии: ${c.allergies.join(', ')}`, c.dislikes?.length && `не любит: ${c.dislikes.join(', ')}`, c.likes?.length && `любит: ${c.likes.join(', ')}`].filter(Boolean).join('; ') : '';
    const ck = cacheKey('cs', q, category, city, from, to, c?.id || '');
    if (!b.force) { const hit = await getCache(auth, ck, category === 'events' ? 30 * 60e3 : 6 * 3600e3); if (hit) return res.status(200).json({ ...hit, cached: true }); }
    const loc = await place(city);
    const tried = [];
    let results = [], answer = '', sources = [];

    // ---------- 0) ваша база партнёров — бесплатно ----------
    const words = q.toLowerCase().split(/[^a-zа-яё0-9]+/i).filter((w) => w.length > 3);
    const partners = city ? await rest(`partners?city=ilike.${encodeURIComponent('*' + city + '*')}&select=id,name,type,address,contact,notes,rating&limit=60`, auth).catch(() => []) : [];
    const own = partners.filter((p) => words.some((w) => `${p.name} ${p.notes || ''} ${p.type}`.toLowerCase().includes(w))).slice(0, 3)
      .map((p) => ({ kind: 'venue', title: p.name, summary: str(p.notes, 200), addressOrVenue: p.address || city, url: '', contact: p.contact || '', partner_id: p.id, sourceProvider: 'black_book' }));

    // ---------- 1) события: Ticketmaster ----------
    if (category === 'events') {
      const tm = await ticketmaster(q, loc, from, to);
      tried.push({ provider: 'ticketmaster', status: tm.results ? (tm.results.length ? 'ok' : 'empty') : tm.skipped || tm.error || tm.status });
      if (tm.results?.length) results = tm.results;
    }
    // ---------- 2) Tavily + сборка карточек лёгкой моделью ----------
    const where = [loc?.en || city, loc?.cc].filter(Boolean).join(', ');
    const when = from ? (to && to !== from ? `${from} – ${to}` : from) : '';
    if (!results.length) {
      const tq = `${q}${where ? ` in ${where}` : ''}${when ? ` ${when}` : ''}${category === 'venues' ? ' authentic local insider recommendations, opening hours' : ''}`;
      const tv = await tavily(tq);
      tried.push({ provider: 'tavily', status: tv.sources ? (tv.sources.length ? 'ok' : 'empty') : tv.skipped || tv.error || tv.status });
      if (tv.sources?.length) {
        answer = tv.answer; sources = tv.sources.map(({ title, url }) => ({ title, url }));
        const prompt = `Ты консьерж уровня Les Clefs d'Or. По ИСТОЧНИКАМ ниже (и только по ним) собери до 6 карточек под запрос: «${q}»${where ? `, город: ${where}` : ''}${when ? `, даты: ${when}` : ''}${prefs ? `, гость: ${prefs}` : ''}.
Только аутентичные, не туристические места или реальные события. Ничего не выдумывай: адрес/дата — только если есть в источниках, url — только из списка источников.
Ответь ТОЛЬКО JSON: { "results": [ { "kind": "venue|event", "title": "", "summary": "1–2 предложения по-русски: что это и почему подходит", "addressOrVenue": "", "date": "YYYY-MM-DD или пусто", "time": "HH:MM или пусто", "url": "", "holiday": "часы в праздники/особые дни, если указаны, иначе пусто", "red_flags": ["по-русски, если есть"] } ] }
ИСТОЧНИКИ: ${JSON.stringify(tv.sources)}`;
        const g = await gemini(LITE, prompt);
        if (g.text) { try { results = (extractJSON(g.text).results || []).map((x) => ({ ...x, sourceProvider: 'tavily' })); } catch {} }
        // Gemini недоступен — отдаём найденное Tavily как есть (с источниками)
        if (!results.length) results = tv.sources.slice(0, 6).map((s) => ({ kind: category === 'events' ? 'event' : 'venue', title: s.title, summary: str(s.content, 240), addressOrVenue: '', url: s.url, sourceProvider: 'tavily' }));
      }
    }
    // ---------- 3) последний запас: Gemini с поиском Google ----------
    if (!results.length && process.env.GEMINI_API_KEY) {
      const prompt = `Ты консьерж уровня Les Clefs d'Or. Найди через поиск Google до 6 ${category === 'events' ? 'реальных событий (с датой, временем, площадкой и ссылкой на билеты)' : 'аутентичных, НЕ туристических мест (с точным адресом и часами)'} под запрос: «${q}»${where ? `, город: ${where}` : ''}${when ? `, даты: ${when}` : ''}${prefs ? `, гость: ${prefs}` : ''}. Учитывай праздничные часы на эти даты. Не уверен — не включай.
Ответь ТОЛЬКО JSON: { "results": [ { "kind": "venue|event", "title": "", "summary": "1–2 предложения по-русски", "addressOrVenue": "", "date": "", "time": "", "url": "официальный сайт или страница билетов", "holiday": "", "red_flags": [] } ] }`;
      const g = await gemini(SMART, prompt, [{ google_search: {} }]);
      tried.push({ provider: 'gemini', status: g.text ? 'ok' : g.status || 'error' });
      if (g.text) { try { results = (extractJSON(g.text).results || []).map((x) => ({ ...x, sourceProvider: 'gemini' })); } catch {} }
      sources = g.chunks?.map((x) => x.web).filter(Boolean).slice(0, 6).map((w) => ({ title: str(w.title, 120), url: str(w.uri, 500) })) || [];
    }
    if (!results.length && !own.length) {
      const limited = tried.some((t) => [429, 'exhausted', 'cooldown'].includes(t.status));
      return res.status(limited ? 429 : 200).json(limited ? { error: 'rate_limited', tried } : { results: [], tried, category, city, from, to });
    }
    // нормализация
    const clean = (x) => ({
      kind: x.kind === 'event' ? 'event' : 'venue', title: str(x.title, 140), summary: str(x.summary, 400), addressOrVenue: str(x.addressOrVenue, 200),
      date: ymd(x.date), time: /^\d{2}:\d{2}$/.test(x.time || '') ? x.time : '', tz: str(x.tz, 60) || loc?.tz || '', url: /^https?:\/\//.test(x.url || '') ? str(x.url, 500) : '',
      image: /^https:\/\//.test(x.image || '') ? str(x.image, 500) : '', price: str(x.price, 60), status: str(x.status, 20), holiday: str(x.holiday, 160),
      red_flags: (Array.isArray(x.red_flags) ? x.red_flags : []).map((f) => str(f, 120)).filter(Boolean).slice(0, 3),
      contact: str(x.contact, 120), partner_id: x.partner_id || null, sourceProvider: x.sourceProvider,
      maps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([x.title, x.addressOrVenue || city].filter(Boolean).join(', '))}`,
    });
    const out = { results: [...own, ...results].filter((x) => x.title).slice(0, 9).map(clean), answer, sources, tried, category, city, city_en: loc?.en || '', tz: loc?.tz || '', from, to };
    await setCache(auth, ck, out);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

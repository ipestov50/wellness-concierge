// «🔎 Поиск Jarvis»: инсайдерский поиск мест и событий с цепочкой поставщиков и запасом по лимитам.
//   события:  ваши партнёры → Ticketmaster Discovery → Tavily → Gemini (поиск Google)
//   места/исследование: ваши партнёры → Tavily → Gemini (поиск Google)
// Ключи — только на сервере (Vercel): TAVILY_API_KEYS, TICKETMASTER_API_KEYS (через запятую — пул с ротацией).
// Только для владельца, данные — с его токеном (RLS). Имена гостя в поиск не уходят.
import { cacheKey, getCache, setCache } from './_cache.js';
import { EXCLUDE_DOMAINS, GUIDES, domainOf, isOfficial, mentions, isBlocked, isResale, isPrimaryTicket, trustOf } from './_trust.js';
import { verify } from './options.js';

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

// ---------- разбор запроса: город из текста, язык страны, тип, переводы (лёгкая модель ~1 с) ----------
const COUNTRY_EN = { DE: 'germany', AT: 'austria', CH: 'switzerland', FR: 'france', MC: 'monaco', BE: 'belgium', NL: 'netherlands', LU: 'luxembourg', IT: 'italy', ES: 'spain', PT: 'portugal',
  GB: 'united kingdom', IE: 'ireland', US: 'united states', AE: 'united arab emirates', QA: 'qatar', SA: 'saudi arabia', TR: 'turkey', GR: 'greece', CY: 'cyprus', MT: 'malta', HR: 'croatia',
  ME: 'montenegro', CZ: 'czech republic', PL: 'poland', HU: 'hungary', DK: 'denmark', SE: 'sweden', NO: 'norway', FI: 'finland', JP: 'japan', TH: 'thailand', SG: 'singapore', MV: 'maldives',
  IL: 'israel', EG: 'egypt', MA: 'morocco', RU: 'russia', KZ: 'kazakhstan', GE: 'georgia', AM: 'armenia', AZ: 'azerbaijan', UZ: 'uzbekistan' };
async function planQuery(q, cityHint) {
  const prompt = `Разбери запрос консьержа для поиска в интернете. Запрос: «${q}».${cityHint ? ` Если город в запросе не указан — город: ${cityHint}.` : ''}
Верни ТОЛЬКО JSON: {"city":"город по-английски в именительном падеже или пусто","city_local":"название города на местном языке","cc":"ISO2 страны","lang":"ISO 639-1 основного языка этого города","kind":"dining|wellness|hotel|nightlife|service|event|shopping|other","must":["1–4 обязательных ключевых слова по-английски (бренд, вид услуги)"],"q_local":"короткая поисковая фраза на местном языке, как искал бы местный житель, с городом","q_en":"короткая поисковая фраза на английском с городом"}`;
  let why = '';
  try {
    let g = await gemini(LITE, prompt);
    if (!g.text) { why = `lite:${g.status}`; g = await gemini(SMART, prompt); if (!g.text) why += `/smart:${g.status}`; }
    if (g.text) {
      const j = extractJSON(g.text);
      const cc = str(j.cc, 2).toUpperCase();
      return { city: str(j.city, 60) || cityHint, city_local: str(j.city_local, 60), cc, country: COUNTRY_EN[cc] || '', lang: str(j.lang, 5).toLowerCase(),
        kind: str(j.kind, 20), must: (Array.isArray(j.must) ? j.must : []).map((x) => str(x, 40)).filter(Boolean).slice(0, 4), q_local: str(j.q_local, 200), q_en: str(j.q_en, 200), ai: true };
    }
  } catch {}
  // запасной разбор без ИИ: «… в Берлине» → «Берлин»
  let city = cityHint;
  if (!city) {
    const m = q.match(/(?:^|\s)(?:в|во|in)\s+([А-ЯЁA-Z][\p{L}-]+(?:[\s-][А-ЯЁA-Z][\p{L}-]+)?)/u);
    if (m) {
      const w = m[1];
      for (const cand of [w, w.replace(/[еиу]$/u, ''), w.replace(/[еиу]$/u, 'а'), w.replace(/е$/u, 'ь')]) { if (await place(cand)) { city = cand; break; } }
    }
  }
  return { city, kind: '', must: [], q_local: '', q_en: '', lang: '', why };
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
async function tavily(q, exclude = [], { depth = 'basic', include = null, max = 10, country = '' } = {}) {
  return withKeys('TAVILY_API_KEYS', async (key) => {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: q, search_depth: depth, include_answer: !include, max_results: max, ...(include ? { include_domains: include } : { exclude_domains: [...new Set([...EXCLUDE_DOMAINS, ...exclude])].slice(0, 100) }), ...(country && !include ? { country } : {}) }), signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return { status: r.status };
    const j = await r.json();
    return { answer: str(j.answer, 1200), sources: (j.results || []).map((x) => ({ title: str(x.title, 160), url: str(x.url, 500), content: str(x.content, 900) })) };
  });
}

// официальный сайт из OpenStreetMap (Nominatim): 1 запрос/сек по правилам сервиса, кэш на 30 дней
const nm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
async function osmSites(names, city, auth) {
  const out = {};
  let first = true;
  for (const name of names) {
    const ck = cacheKey('osm', nm(name), nm(city));
    const hit = await getCache(auth, ck, 30 * 864e5);
    if (hit) { out[name] = hit; continue; }
    if (!first) await new Promise((r) => setTimeout(r, 1050));
    first = false;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${name}, ${city}`)}&format=jsonv2&extratags=1&addressdetails=1&limit=1`,
        { headers: { 'User-Agent': 'WellnessConciergeSearch/1.0', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(5000) });
      const [e] = await r.json();
      const ok = e && (nm(e.name).includes(nm(name)) || nm(name).includes(nm(e.name)));
      const site = ok ? (e.extratags?.website || e.extratags?.['contact:website'] || '') : '';
      const a = e?.address || {};
      const res = ok ? { website: /^https?:\/\//.test(site) ? site.replace(/^http:/, 'https:') : '', address: [[a.road, a.house_number].filter(Boolean).join(' '), [a.postcode, a.city || a.town].filter(Boolean).join(' ')].filter(Boolean).join(', ') } : { website: '', address: '' };
      out[name] = res;
      await setCache(auth, ck, res);
    } catch { out[name] = { website: '', address: '' }; }
  }
  return out;
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
    const ck = cacheKey('cs2', q, b.category || '', city, from, to, c?.id || '');
    if (!b.force) {
      const hit = await getCache(auth, ck, 6 * 3600e3);
      if (hit && (hit.category !== 'events' || Date.now() - Date.parse(hit.at || 0) < 30 * 60e3)) {
        const bl = await rest('search_blocks?select=kind,value', auth).catch(() => []);
        const kv = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9а-яё]+/g, ' ').trim();
        const vs = new Set(bl.filter((x) => x.kind === 'venue').map((x) => x.value)), ds = bl.filter((x) => x.kind === 'domain').map((x) => x.value);
        return res.status(200).json({ ...hit, results: hit.results.filter((x) => !vs.has(kv(x.title)) && !(x.url && ds.includes(domainOf(x.url)))), cached: true });
      }
    }

    // ---------- 1) разбор запроса: город из текста («в Берлине»), язык страны, тип, переводы ----------
    const pl = await planQuery(q, city);
    if (!city && pl.city) city = pl.city;
    const category = ['events', 'venues', 'general'].includes(b.category) ? b.category : pl.kind === 'event' || EVENT_RX.test(q) ? 'events' : pl.kind === 'other' ? 'general' : 'venues';

    // параллельно: город, ваш чёрный список, ваши партнёры
    const [loc, blocks, partners] = await Promise.all([
      place(city),
      rest('search_blocks?select=kind,value', auth).catch(() => []),
      city ? rest(`partners?city=ilike.${encodeURIComponent('*' + city + '*')}&select=id,name,type,address,contact,notes,rating&limit=60`, auth).catch(() => []) : [],
    ]);
    const tried = [];
    let results = [], answer = '', sources = [], rawSources = [];
    const ownDomains = blocks.filter((x) => x.kind === 'domain').map((x) => x.value);
    const cityNames = [...new Set([city, loc?.en, pl.city, pl.city_local].filter(Boolean))];
    const country = pl.country || COUNTRY_EN[loc?.cc] || '';

    // ---------- 0) ваша база партнёров — бесплатно ----------
    const words = [...new Set([...q.toLowerCase().split(/[^a-zа-яё0-9]+/i), ...(pl.must || []).map((w) => w.toLowerCase())])].filter((w) => w.length > 3);
    const own = partners.filter((p) => words.some((w) => `${p.name} ${p.notes || ''} ${p.type}`.toLowerCase().includes(w))).slice(0, 3)
      .map((p) => ({ kind: 'venue', title: p.name, summary: str(p.notes, 200), addressOrVenue: p.address || city, url: '', contact: p.contact || '', partner_id: p.id, sourceProvider: 'black_book' }));

    // ---------- 2) события: Ticketmaster ----------
    if (category === 'events') {
      const tm = await ticketmaster(pl.q_en || q, loc, from, to);
      tried.push({ provider: 'ticketmaster', status: tm.results ? (tm.results.length ? 'ok' : 'empty') : tm.skipped || tm.error || tm.status });
      if (tm.results?.length) results = tm.results;
    }
    // ---------- 3) Tavily на нескольких языках параллельно + гиды ----------
    const where = [loc?.en || city, loc?.cc].filter(Boolean).join(', ');
    const when = from ? (to && to !== from ? `${from} – ${to}` : from) : '';
    const queries = [];
    const addQ = (lang, text) => { const t = str(text, 250); if (t && !queries.some((x) => x.q.toLowerCase() === t.toLowerCase())) queries.push({ lang, q: t }); };
    if (pl.lang && pl.lang !== 'ru' && pl.lang !== 'en') addQ(pl.lang, pl.q_local);
    addQ('en', pl.q_en || (where ? `${q} ${where}` : q));
    addQ('ru', /[а-яё]/i.test(q) ? `${q}${city && !q.toLowerCase().includes(city.toLowerCase().slice(0, 5)) ? ` ${city}` : ''}` : '');
    if (!results.length) {
      const guideKinds = ['dining', 'wellness', 'hotel', 'nightlife'];
      const runs = await Promise.all([
        ...queries.slice(0, 3).map((x) => tavily(x.q, ownDomains, { country }).then((r) => ({ ...r, lang: x.lang }))),
        guideKinds.includes(pl.kind) ? tavily(pl.q_en || `${q} ${where}`, [], { include: Object.keys(GUIDES), max: 6 }).then((r) => ({ ...r, lang: 'guide' })) : Promise.resolve({}),
      ]);
      const seen = new Set();
      for (const r of runs) for (const s0 of r.sources || []) if (!seen.has(s0.url)) { seen.add(s0.url); rawSources.push({ ...s0, lang: r.lang }); }
      // краткий ответ Tavily показываем, только если он про нужный город
      answer = runs.map((r) => r.answer).find((t) => t && cityNames.some((n) => t.toLowerCase().includes(n.toLowerCase()))) || '';
      const okRuns = runs.filter((r) => r.sources);
      tried.push({ provider: 'tavily', status: okRuns.length ? (rawSources.length ? 'ok' : 'empty') : runs[0]?.skipped || runs[0]?.error || runs[0]?.status });
      rawSources = rawSources.filter((s0) => !isBlocked(s0.url, ownDomains));
      if (rawSources.length) {
        sources = rawSources.map(({ title, url }) => ({ title, url }));
        const prompt = `Ты консьерж уровня Les Clefs d'Or. Запрос гостя: «${q}». ГОРОД: ${cityNames.join(' / ') || 'не указан'}${country ? ` (${country})` : ''}${when ? `, даты: ${when}` : ''}${prefs ? `, гость: ${prefs}` : ''}.
${(pl.must || []).length ? `ОБЯЗАТЕЛЬНО должно совпадать: ${pl.must.join(', ')}.\n` : ''}По ИСТОЧНИКАМ ниже (они на разных языках — это нормально) собери до 6 карточек.
СТРОГО: только то, что находится в этом городе (или рядом, до 30 км). Всё в других городах и странах — исключи. Только то, что точно отвечает запросу (например, если просят Ferrari — именно Ferrari, а не любые авто).
Лучшие, проверенные, не туристические варианты. Ничего не выдумывай: адрес/дата/цена — только если есть в источниках, url — только из списка источников, лучше официальный сайт. Перепродавцов и сомнительные сайты не используй. Упоминание в признанном гиде — укажи в summary.
Ответь ТОЛЬКО JSON: { "results": [ { "kind": "venue|event|service", "title": "название", "summary": "1–2 предложения по-русски: что это и почему подходит", "addressOrVenue": "", "date": "YYYY-MM-DD или пусто", "time": "HH:MM или пусто", "price": "если указана", "url": "", "lang": "язык сайта: de|fr|it|es|en|ru…", "holiday": "", "red_flags": ["по-русски, если есть"] } ] }
ИСТОЧНИКИ: ${JSON.stringify(rawSources.map(({ title, url, content }) => ({ title, url, content })))}`;
        let g = await gemini(LITE, prompt), synth = LITE;
        if (!g.text) { const st1 = g.status; g = await gemini(SMART, prompt); synth = g.text ? SMART : `lite:${st1}/smart:${g.status}`; }
        if (g.text) { try { results = (extractJSON(g.text).results || []).map((x) => ({ ...x, sourceProvider: 'tavily' })); } catch { synth = 'bad_json'; } }
        tried.push({ provider: 'cards', status: results.length ? 'ok' : synth });
        if (!results.length && synth !== LITE && synth !== SMART) results = rawSources.slice(0, 6).map((s0) => ({ kind: category === 'events' ? 'event' : 'venue', title: s0.title, summary: str(s0.content, 240), addressOrVenue: '', url: s0.url, sourceProvider: 'tavily' }));
      }
    }
    // ---------- 4) последний запас: Gemini с поиском Google (тоже на местном языке) ----------
    if (!results.length && process.env.GEMINI_API_KEY) {
      const prompt = `Ты консьерж уровня Les Clefs d'Or. Найди через поиск Google до 6 ${category === 'events' ? 'реальных событий (с датой, временем, площадкой и ссылкой на первичную продажу билетов)' : 'лучших, аутентичных, НЕ туристических вариантов (с точным адресом)'} под запрос: «${q}». ГОРОД: ${cityNames.join(' / ') || 'не указан'}${country ? ` (${country})` : ''} — строго в этом городе${when ? `, даты: ${when}` : ''}${prefs ? `, гость: ${prefs}` : ''}.
Ищи также на местном языке${pl.q_local ? ` («${pl.q_local}»)` : ''} и на английском. ${(pl.must || []).length ? `Обязательно: ${pl.must.join(', ')}. ` : ''}Учитывай праздничные часы на эти даты. Не уверен — не включай.
Ответь ТОЛЬКО JSON: { "results": [ { "kind": "venue|event|service", "title": "", "summary": "1–2 предложения по-русски", "addressOrVenue": "", "date": "", "time": "", "price": "", "url": "официальный сайт или страница билетов", "lang": "", "holiday": "", "red_flags": [] } ] }`;
      const g = await gemini(SMART, prompt, [{ google_search: {} }]);
      tried.push({ provider: 'gemini', status: g.text ? 'ok' : g.status || 'error' });
      if (g.text) { try { results = (extractJSON(g.text).results || []).map((x) => ({ ...x, sourceProvider: 'gemini' })); } catch {} }
      sources = g.chunks?.map((x) => x.web).filter(Boolean).slice(0, 6).map((w) => ({ title: str(w.title, 120), url: str(w.uri, 500) })) || [];
      rawSources = (g.chunks || []).map((x) => x.web).filter(Boolean).map((w) => ({ title: w.title || '', url: `https://${w.title || ''}`, content: '' }));
    }
    if (!results.length && !own.length) {
      const limited = tried.some((t) => [429, 'exhausted', 'cooldown'].includes(t.status));
      return res.status(limited ? 429 : 200).json(limited ? { error: 'rate_limited', tried } : { results: [], tried, category, city, from, to });
    }
    // нормализация
    const clean = (x) => ({
      kind: ['event', 'service'].includes(x.kind) ? x.kind : 'venue', lang: str(x.lang, 5).toLowerCase(), title: str(x.title, 140), summary: str(x.summary, 400), addressOrVenue: str(x.addressOrVenue, 200),
      date: ymd(x.date), time: /^\d{2}:\d{2}$/.test(x.time || '') ? x.time : '', tz: str(x.tz, 60) || loc?.tz || '', url: /^https?:\/\//.test(x.url || '') ? str(x.url, 500) : '',
      image: /^https:\/\//.test(x.image || '') ? str(x.image, 500) : '', price: str(x.price, 60), status: str(x.status, 20), holiday: str(x.holiday, 160),
      red_flags: (Array.isArray(x.red_flags) ? x.red_flags : []).map((f) => str(f, 120)).filter(Boolean).slice(0, 3),
      contact: str(x.contact, 120), partner_id: x.partner_id || null, sourceProvider: x.sourceProvider,
      maps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([x.title, x.addressOrVenue || city].filter(Boolean).join(', '))}`,
    });
    // ---------- проверка достоверности: ссылки, перепродажа, карта, независимые подтверждения ----------
    const near = loc ? { lat: loc.lat, lon: loc.lon } : null;
    let list = [...own, ...results].filter((x) => x.title).slice(0, 10).map(clean);
    for (const x of list) {
      if (x.url && isResale(x.url)) { x.resale = true; x.url = ''; x.red_flags.unshift('Билеты только у перепродавцов — высокий риск'); }
      else if (x.url && isBlocked(x.url, ownDomains)) x.url = '';
      // «Сайт» — только официальный сайт места (или первичная продажа билетов); остальное — просто «источник»
      if (x.url && x.kind !== 'event' && !isOfficial(x.url, x.title)) { x.source_url = x.url; x.url = ''; }
      // официальный сайт нашёлся среди источников — ставим его
      if (!x.url && x.kind !== 'event') { const off = rawSources.find((s) => isOfficial(s.url, x.title)); if (off) x.url = off.url; }
      if (x.url && x.kind === 'event' && !isPrimaryTicket(x.url) && !isOfficial(x.url, x.title) && x.sourceProvider !== 'ticketmaster') { x.source_url = x.url; x.url = ''; }
      if (x.kind === 'event' && x.url && isPrimaryTicket(x.url)) x.primary = true;
    }
    // официальные сайты из OpenStreetMap для 4 главных мест без сайта — параллельно со сверкой адресов
    const needSite = list.filter((x) => x.kind !== 'event' && !x.url && x.sourceProvider !== 'black_book').slice(0, 4);
    const sitesP = needSite.length ? osmSites(needSite.map((x) => x.title), loc?.en || city, auth).catch(() => ({})) : Promise.resolve({});
    const [sites] = await Promise.all([sitesP, Promise.all(list.map(async (x) => {
      if (x.sourceProvider === 'black_book' || x.sourceProvider === 'ticketmaster') return;
      x._v = x.kind !== 'event' ? await verify({ name: x.title, address: x.addressOrVenue, city: loc?.en || city }, near).catch(() => ({ status: 'unverified' })) : { status: 'unverified' };
    }))]);
    for (const x of needSite) {
      const s = sites[x.title];
      if (s?.website && !isBlocked(s.website, ownDomains)) { x.url = s.website; x.osm_official = true; }
      if (s?.address && !x.addressOrVenue) x.addressOrVenue = s.address;
    }
    await Promise.all(list.map(async (x) => {
      if (x.sourceProvider === 'black_book') { x.trust = { level: 'own' }; return; }
      if (x.sourceProvider === 'ticketmaster') { x.trust = { level: 'high', official: true, primary: true, sources: 1 }; return; }
      const v = x._v || { status: 'unverified' };
      delete x._v;
      if (v.status === 'corrected' && v.osm_address && !x.addressOrVenue) x.addressOrVenue = v.osm_address;
      x.trust = { ...trustOf(x, rawSources, v.status === 'verified' || v.status === 'corrected' || !!x.osm_official), primary: !!x.primary };
      if (x.osm_official) { x.trust.official = true; x.trust.level = x.trust.sources >= 2 ? 'high' : 'medium'; delete x.osm_official; }
      if (x.trust.level === 'low') x.trust.missing = [!x.trust.official && 'официальный сайт', !x.trust.map && 'место на карте', x.trust.sources < 2 && 'второй источник'].filter(Boolean);
    }));
    // строго в нужном городе: подтверждено картой рядом с городом, или адрес/источники называют этот город
    if (cityNames.length) {
      const cn = cityNames.map((n) => n.toLowerCase());
      const inCity = (x) => {
        if (x.sourceProvider === 'black_book' || x.sourceProvider === 'ticketmaster') return true;
        if (x.trust?.map) return true;
        if (cn.some((n) => (x.addressOrVenue || '').toLowerCase().includes(n))) return true;
        return rawSources.some((s0) => mentions(s0, x.title) && cn.some((n) => `${s0.title} ${s0.content || ''} ${s0.url}`.toLowerCase().includes(n)));
      };
      list = list.filter(inCity);
    }
    // ваш чёрный список мест
    const bannedVenue = new Set(blocks.filter((b) => b.kind === 'venue').map((b) => b.value));
    const keyOf = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9а-яё]+/g, ' ').trim();
    list = list.filter((x) => !bannedVenue.has(keyOf(x.title)) && !(x.url && ownDomains.includes(domainOf(x.url))));
    const RANK = { own: 0, high: 1, medium: 2, low: 3 };
    list.sort((a, b) => (RANK[a.trust?.level] ?? 3) - (RANK[b.trust?.level] ?? 3) || (b.trust?.guides?.length || 0) - (a.trust?.guides?.length || 0));
    const out = { at: new Date().toISOString(), queries, plan: { city: pl.city, kind: pl.kind, lang: pl.lang, must: pl.must, ai: !!pl.ai, why: pl.why || '' }, results: list.slice(0, 9), answer, sources: sources.filter((s) => !isBlocked(s.url, ownDomains) || /vertexaisearch/.test(s.url)), tried, category, city, city_en: loc?.en || '', tz: loc?.tz || '', from, to };
    await setCache(auth, ck, out);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

// «🔎 Поиск Jarvis»: инсайдерский поиск мест и событий с цепочкой поставщиков и запасом по лимитам.
//   события:  ваши партнёры → Ticketmaster Discovery → Tavily → Gemini (поиск Google)
//   места/исследование: ваши партнёры → Tavily → Gemini (поиск Google)
// Ключи — только на сервере (Vercel): TAVILY_API_KEYS, TICKETMASTER_API_KEYS (через запятую — пул с ротацией).
// Только для владельца, данные — с его токеном (RLS). Имена гостя в поиск не уходят.
import { cacheKey, getCache, setCache } from './_cache.js';
import { EXCLUDE_DOMAINS, GUIDES, domainOf, isOfficial, isBlocked, isResale, isPrimaryTicket, trustOf } from './_trust.js';
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
async function tavily(q, exclude = [], { depth = 'basic', include = null, max = 10 } = {}) {
  return withKeys('TAVILY_API_KEYS', async (key) => {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: q, search_depth: depth, include_answer: !include, max_results: max, ...(include ? { include_domains: include } : { exclude_domains: [...new Set([...EXCLUDE_DOMAINS, ...exclude])].slice(0, 100) }) }), signal: AbortSignal.timeout(20000),
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
    if (!b.force) {
      const hit = await getCache(auth, ck, category === 'events' ? 30 * 60e3 : 6 * 3600e3);
      if (hit) {
        const bl = await rest('search_blocks?select=kind,value', auth).catch(() => []);
        const kv = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9а-яё]+/g, ' ').trim();
        const vs = new Set(bl.filter((x) => x.kind === 'venue').map((x) => x.value)), ds = bl.filter((x) => x.kind === 'domain').map((x) => x.value);
        return res.status(200).json({ ...hit, results: hit.results.filter((x) => !vs.has(kv(x.title)) && !(x.url && ds.includes(domainOf(x.url)))), cached: true });
      }
    }
    // параллельно: город, ваш чёрный список, ваши партнёры
    const [loc, blocks, partners] = await Promise.all([
      place(city),
      rest('search_blocks?select=kind,value', auth).catch(() => []),
      city ? rest(`partners?city=ilike.${encodeURIComponent('*' + city + '*')}&select=id,name,type,address,contact,notes,rating&limit=60`, auth).catch(() => []) : [],
    ]);
    const tried = [];
    let results = [], answer = '', sources = [], rawSources = [];
    const ownDomains = blocks.filter((x) => x.kind === 'domain').map((x) => x.value);

    // ---------- 0) ваша база партнёров — бесплатно ----------
    const words = q.toLowerCase().split(/[^a-zа-яё0-9]+/i).filter((w) => w.length > 3);
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
      // параллельно: общий поиск и поиск только по признанным гидам (быстрый режим — оба вместе ~2 кредита)
      const [tv, tg] = await Promise.all([
        tavily(tq, ownDomains),
        category !== 'events' ? tavily(`${q}${where ? ` ${where}` : ''}`, [], { include: Object.keys(GUIDES), max: 6 }) : Promise.resolve({}),
      ]);
      if (tg.sources?.length) tv.sources = [...(tv.sources || []), ...tg.sources.filter((g) => !(tv.sources || []).some((s) => s.url === g.url))];
      tried.push({ provider: 'tavily', status: tv.sources ? (tv.sources.length ? 'ok' : 'empty') : tv.skipped || tv.error || tv.status });
      if (tv.sources?.length) {
        rawSources = tv.sources.filter((s) => !isBlocked(s.url, ownDomains));
        answer = tv.answer; sources = rawSources.map(({ title, url }) => ({ title, url }));
        const prompt = `Ты консьерж уровня Les Clefs d'Or. По ИСТОЧНИКАМ ниже (и только по ним) собери до 6 карточек под запрос: «${q}»${where ? `, город: ${where}` : ''}${when ? `, даты: ${when}` : ''}${prefs ? `, гость: ${prefs}` : ''}.
Только аутентичные, не туристические, по-настоящему лучшие места или реальные события. Ничего не выдумывай: адрес/дата — только если есть в источниках, url — только из списка источников, ЛУЧШЕ официальный сайт заведения или первичная продажа билетов; перепродавцов и сомнительные сайты не используй. Если место упомянуто в признанном гиде (Michelin, Gault&Millau, Falstaff, Time Out и т.п.) — укажи это в summary.
Ответь ТОЛЬКО JSON: { "results": [ { "kind": "venue|event", "title": "", "summary": "1–2 предложения по-русски: что это и почему подходит", "addressOrVenue": "", "date": "YYYY-MM-DD или пусто", "time": "HH:MM или пусто", "url": "", "holiday": "часы в праздники/особые дни, если указаны, иначе пусто", "red_flags": ["по-русски, если есть"] } ] }
ИСТОЧНИКИ: ${JSON.stringify(rawSources)}`;
        // собираем карточки: лёгкая модель (свой лимит), если она недоступна — основная
        let g = await gemini(LITE, prompt), synth = LITE;
        if (!g.text) { const st1 = g.status; g = await gemini(SMART, prompt); synth = g.text ? SMART : `lite:${st1}/smart:${g.status}`; }
        if (g.text) { try { results = (extractJSON(g.text).results || []).map((x) => ({ ...x, sourceProvider: 'tavily' })); } catch { synth = 'bad_json'; } }
        tried.push({ provider: 'cards', status: results.length ? 'ok' : synth });
        // Gemini недоступен — отдаём найденное Tavily как есть (с источниками)
        if (!results.length) results = rawSources.slice(0, 6).map((s) => ({ kind: category === 'events' ? 'event' : 'venue', title: s.title, summary: str(s.content, 240), addressOrVenue: '', url: s.url, sourceProvider: 'tavily' }));
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
      // у Google в источниках только домен — проверяем по нему
      rawSources = (g.chunks || []).map((x) => x.web).filter(Boolean).map((w) => ({ title: w.title || '', url: `https://${w.title || ''}`, content: '' }));
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
    // ---------- проверка достоверности: ссылки, перепродажа, карта, независимые подтверждения ----------
    const near = loc ? { lat: loc.lat, lon: loc.lon } : null;
    let list = [...own, ...results].filter((x) => x.title).slice(0, 10).map(clean);
    for (const x of list) {
      if (x.url && isResale(x.url)) { x.resale = true; x.url = ''; x.red_flags.unshift('Билеты только у перепродавцов — высокий риск'); }
      else if (x.url && isBlocked(x.url, ownDomains)) x.url = '';
      // «Сайт» — только официальный сайт места (или первичная продажа билетов); остальное — просто «источник»
      if (x.url && x.kind === 'venue' && !isOfficial(x.url, x.title)) { x.source_url = x.url; x.url = ''; }
      // официальный сайт нашёлся среди источников — ставим его
      if (!x.url && x.kind === 'venue') { const off = rawSources.find((s) => isOfficial(s.url, x.title)); if (off) x.url = off.url; }
      if (x.url && x.kind === 'event' && !isPrimaryTicket(x.url) && !isOfficial(x.url, x.title) && x.sourceProvider !== 'ticketmaster') { x.source_url = x.url; x.url = ''; }
      if (x.kind === 'event' && x.url && isPrimaryTicket(x.url)) x.primary = true;
    }
    // официальные сайты из OpenStreetMap для 4 главных мест без сайта — параллельно со сверкой адресов
    const needSite = list.filter((x) => x.kind === 'venue' && !x.url && x.sourceProvider !== 'black_book').slice(0, 4);
    const sitesP = needSite.length ? osmSites(needSite.map((x) => x.title), loc?.en || city, auth).catch(() => ({})) : Promise.resolve({});
    const [sites] = await Promise.all([sitesP, Promise.all(list.map(async (x) => {
      if (x.sourceProvider === 'black_book' || x.sourceProvider === 'ticketmaster') return;
      x._v = x.kind === 'venue' ? await verify({ name: x.title, address: x.addressOrVenue, city: loc?.en || city }, near).catch(() => ({ status: 'unverified' })) : { status: 'unverified' };
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
    // ваш чёрный список мест
    const bannedVenue = new Set(blocks.filter((b) => b.kind === 'venue').map((b) => b.value));
    const keyOf = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9а-яё]+/g, ' ').trim();
    list = list.filter((x) => !bannedVenue.has(keyOf(x.title)) && !(x.url && ownDomains.includes(domainOf(x.url))));
    const RANK = { own: 0, high: 1, medium: 2, low: 3 };
    list.sort((a, b) => (RANK[a.trust?.level] ?? 3) - (RANK[b.trust?.level] ?? 3) || (b.trust?.guides?.length || 0) - (a.trust?.guides?.length || 0));
    const out = { results: list.slice(0, 9), answer, sources: sources.filter((s) => !isBlocked(s.url, ownDomains) || /vertexaisearch/.test(s.url)), tried, category, city, city_en: loc?.en || '', tz: loc?.tz || '', from, to };
    await setCache(auth, ck, out);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

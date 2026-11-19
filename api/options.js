// «✦ Варианты для гостя»: 3 места под запрос (сначала ваши партнёры), каждое сверено с картой.
// Jarvis (Gemini + поиск Google) предлагает, затем каждое место ищем в OpenStreetMap (Photon):
// совпало название и место рядом с городом → «адрес подтверждён»; иначе — «проверьте».
// Только для владельца, данные — с его токеном (RLS). Имена гостя и близких в ИИ не отправляются.

import { getCache, setCache, gfetch, FLASH, LITE } from './_cache.js';
import { isOwner } from './_owner.js';

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

// поиск по Google Картам доступен не на всех тарифах Gemini: если отказ — временно работаем через поиск Google
let mapsOffUntil = 0;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const auth = req.headers.authorization || '';
  const u = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth } });
  if (!u.ok) return res.status(401).json({ error: 'unauthorized' });
  const user = await u.json();
  if (!isOwner(user)) return res.status(403).json({ error: 'forbidden' });
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'no_key' });
  const b = req.body || {};
  // диагностика: доступен ли поиск по Google Картам для этого ключа (ничего не сохраняет)
  if (b.mode === 'probe') {
    const t0 = Date.now();
    const body = (tools) => JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Назови 3 кафе рядом с Place Masséna в Ницце с рейтингом и числом отзывов в Google Картах. Коротко.' }] }], tools, generationConfig: { thinkingConfig: { thinkingBudget: 0 } } });
    const call = (tools) => gfetch(auth, FLASH, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: body(tools), signal: AbortSignal.timeout(40000) });
    const g = await call([{ googleMaps: {} }]);
    const j = await g.json().catch(() => ({}));
    const chunks = j.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    return res.status(200).json({ maps_ok: g.ok, status: g.status, error: g.ok ? null : str(j.error?.message, 300), places: chunks.filter((x) => x.maps).length,
      sample: chunks.filter((x) => x.maps).slice(0, 3).map((x) => ({ title: x.maps.title, placeId: !!x.maps.placeId })), text: str((j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''), 400), ms: Date.now() - t0 });
  }
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
    const trips = c ? await rest(`trips?client_id=eq.${c.id}&select=city,country,country_code,hotel,lat,lon,start_date,end_date&order=start_date.desc&limit=6`, auth) : [];
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
    // ---------- кэш: тот же поиск для того же гостя в течение суток — без Gemini ----------
    const query = scrub([r.summary, notes].filter(Boolean).join('. '));
    const key = [city, norm(query), day, c?.id || '', lang, exclude.map(norm).sort().join(',')].join('|').slice(0, 500);
    const hit = await rest(`search_cache?key=eq.${encodeURIComponent(key)}&created_at=gt.${new Date(Date.now() - 864e5).toISOString()}&select=result&limit=1`, auth).catch(() => []);
    if (hit[0]?.result?.items?.length) return res.status(200).json({ ...hit[0].result, cached: true });

    // ---------- праздник на дату брони (Nager.Date, бесплатно) ----------
    const cc = trip?.country_code || null;
    let holiday = null;
    if (cc) {
      try {
        const hs = await (await fetch(`https://date.nager.at/api/v3/PublicHolidays/${day.slice(0, 4)}/${cc}`, { signal: AbortSignal.timeout(6000) })).json();
        const h = hs.find((x) => x.date === day);
        if (h) holiday = h.localName || h.name;
      } catch {}
    }
    let near = trip?.lat != null ? { lat: +trip.lat, lon: +trip.lon } : null;
    if (!near && city) { const [f] = await photon(city, null, 1); if (f) near = { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }; }

    const prompt = `Ты Jarvis — консьерж люксового сервиса. Найди УНИКАЛЬНЫЕ, аутентичные, НЕ туристические места под точный запрос гостя.
ЭТАП 1 — кандидаты: найди в Google Картах до 10 мест в городе «${city}», которые подходят под запрос: «${query}». У каждого посмотри рейтинг и число отзывов в Google Картах, часы работы и отзывы.
ЭТАП 2 — фильтр «скрытые жемчужины»: оставь только рейтинг от 4.4 до 4.9 и от 80 до 1500 отзывов (без туристических ловушек и без непроверенных мест). Партнёры консьержа из «наши_партнёры» могут проходить без фильтра — ставь их первыми, если подходят (partner: true).
ЭТАП 3 — отбор: выбери РОВНО 3 самых аутентичных места, точно отвечающих запросу (конкретное пиво, кухня, диета, атмосфера). ПРОВЕРЬ заявления по отзывам: если гость хочет конкретное (напр. «бельгийское пиво на кране», «без глютена») — подтверди отзывами, иначе не предлагай.
Дата визита: ${day}${when ? ` (${when})` : ''}${holiday ? ` — это ГОСУДАРСТВЕННЫЙ ПРАЗДНИК: «${holiday}»` : ''}. Для каждого места определи holiday: "confirmed_open" (часы на эту дату подтверждены), "unconfirmed_holiday" (праздник/особый день и часы не подтверждены), "closed" (в этот день закрыто — тогда лучше не предлагай).
Учитывай аллергии, диету, «не любит», бюджет, район отеля. Не предлагай места из «не_предлагать». Название и адрес — точно как в Google Картах.
Ответь ТОЛЬКО JSON:
{ "considered": число_кандидатов, "options": [ {
  "name": "точное название как в Google Картах",
  "kind": "формат и кухня, 2–4 слова по-русски",
  "address": "полный адрес: номер, улица, индекс, город",
  "area": "район по-русски",
  "price": "€ | €€ | €€€ | €€€€",
  "rating": 4.6, "reviews": 420,
  "phone": "международный формат или пусто",
  "website": "официальный сайт или пусто",
  "why": "почему это точное попадание в запрос — 1 предложение по-русски",
  "evidence": "что подтверждают отзывы — коротко по-русски",
  "why_guest": "почему стоит пойти — для гостя на ${LANG[lang]} языке, тепло, 1 предложение",
  "red_flags": ["предупреждения по-русски: шумно, только наличные, бронь за неделю, нет столиков на улице… или пусто"],
  "holiday": "confirmed_open | unconfirmed_holiday | closed",
  "hours": "часы в этот день по-русски, коротко",
  "partner": false
} ] }
Данные: ${JSON.stringify(ctx)}`;
    // Google Карты через Gemini (реальные места с рейтингом); если инструмент недоступен — поиск Google
    const ask = (tools, extra = {}) => gfetch(auth, FLASH, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools, ...extra, generationConfig: { temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } } }),
      signal: AbortSignal.timeout(70000),
    });
    let source = 'maps', g = null;
    // Карт нет в тарифе ключа — запоминаем на сутки (в базе, а не в памяти сервера), чтобы не тратить обращение каждый раз
    const mapsOff = Date.now() < mapsOffUntil || !!(await getCache(auth, 'flag|maps_off', 864e5));
    if (!mapsOff) {
      g = await ask([{ googleMaps: {} }], near ? { toolConfig: { retrievalConfig: { latLng: { latitude: near.lat, longitude: near.lon } } } } : {});
      if (!g.ok) { mapsOffUntil = Date.now() + 6 * 3600e3; await setCache(auth, 'flag|maps_off', { at: Date.now(), status: g.status }); }
    }
    if (!g?.ok) { source = 'search'; g = await ask([{ google_search: {} }]); }
    if (!g.ok) return res.status(g.status === 429 ? 429 : 502).json({ error: g.status === 429 ? 'rate_limited' : 'gemini_error' });
    const j = await g.json();
    const cand = j.candidates?.[0];
    const d = extractJSON((cand?.content?.parts || []).map((p) => p.text || '').join(''));
    const chunks = cand?.groundingMetadata?.groundingChunks || [];
    const mapsChunks = chunks.map((x) => x.maps).filter(Boolean);
    const num = (x, lo, hi) => { const n = Number(x); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
    const items = (d.options || []).slice(0, 3).map((o) => {
      const partner = partners.find((p) => norm(p.name) === norm(o.name));
      const place = mapsChunks.find((m) => norm(m.title) === norm(o.name) || norm(m.title).includes(norm(o.name)) || norm(o.name).includes(norm(m.title)));
      const rating = num(o.rating, 1, 5), reviews = num(o.reviews, 0, 1e6);
      const flags = (Array.isArray(o.red_flags) ? o.red_flags : []).map((x) => str(x, 120)).filter(Boolean).slice(0, 4);
      if (!partner && rating != null && reviews != null && (rating < 4.4 || reviews > 1500)) flags.unshift(reviews > 1500 ? 'Очень популярное место — возможно много туристов' : 'Рейтинг ниже 4.4');
      const holidayStatus = ['confirmed_open', 'unconfirmed_holiday', 'closed'].includes(o.holiday) ? o.holiday : (holiday ? 'unconfirmed_holiday' : null);
      return {
        name: str(o.name, 100), kind: str(o.kind, 60), address: str(partner?.address || o.address, 200), area: str(o.area, 60), price: str(o.price, 8),
        rating, reviews, phone: str(o.phone, 40), website: /^https?:\/\//.test(o.website || '') ? str(o.website, 300) : '',
        why: str(o.why, 260), evidence: str(o.evidence, 260), why_guest: str(o.why_guest, 300), red_flags: flags,
        holiday: holidayStatus, hours: str(o.hours, 120), note: str(o.hours, 120),
        place_id: place?.placeId ? str(place.placeId.replace(/^places\//, ''), 200) : null,
        partner: !!partner, partner_id: partner?.id || null, city,
      };
    });
    // ваш список «Не предлагать» действует и здесь
    const bl = await rest('search_blocks?select=kind,value', auth).catch(() => []);
    const kv = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9а-яё]+/g, ' ').trim();
    const bannedV = new Set(bl.filter((x) => x.kind === 'venue').map((x) => x.value)), bannedD = bl.filter((x) => x.kind === 'domain').map((x) => x.value);
    for (let k = items.length - 1; k >= 0; k--) if (bannedV.has(kv(items[k].name))) items.splice(k, 1);
    for (const o of items) { try { if (o.website && bannedD.includes(new URL(o.website).hostname.replace(/^www\./, ''))) o.website = ''; } catch {} }
    // сверяем каждое место с картой (OpenStreetMap), ссылка — точно на место в Google Картах
    await Promise.all(items.map(async (o) => {
      const v = await verify(o, near);
      o.check = o.place_id ? 'google' : v.status;          // google | verified | corrected | unverified
      if (!o.place_id && v.status === 'corrected' && v.osm_address) { o.address_ai = o.address; o.address = v.osm_address; }
      if (v.lat != null) { o.lat = v.lat; o.lon = v.lon; }
      if (o.partner && o.check === 'unverified') o.check = 'partner';
      o.maps = o.place_id ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.name)}&query_place_id=${encodeURIComponent(o.place_id)}` : mapsUrl(o.name, o.address);
      delete o.city;
    }));
    const result = {
      items, lang, city, holiday, day, source, considered: Number(d.considered) || null,
      sources: chunks.map((x) => x.web).filter(Boolean).slice(0, 6).map((w) => ({ title: str(w.title, 100), uri: str(w.uri, 400) })),
    };
    // в кэш (RLS: только владелец)
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/search_cache?on_conflict=owner_id,key`, {
      method: 'POST', headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key, result, created_at: new Date().toISOString() }),
    }).catch(() => {});
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
export { verify, norm }; // для проверки

// «Перед вылетом» для поездки. Только для владельца; данные — с его токеном (RLS).
// mode=facts  — погода (Open-Meteo), праздники (Nager.Date), курсы (open.er-api) — без ИИ, бесплатно
// mode=jarvis — въезд, платежи, связь, этикет, фразы, что предусмотреть: Gemini + живой поиск Google, с источниками.
// Имя гостя в ИИ не отправляется.

const MODEL = 'gemini-2.5-flash';
const CUR = { FR: 'EUR', MC: 'EUR', IT: 'EUR', ES: 'EUR', DE: 'EUR', AT: 'EUR', PT: 'EUR', GR: 'EUR', CY: 'EUR', NL: 'EUR', BE: 'EUR', ME: 'EUR', HR: 'EUR', FI: 'EUR', IE: 'EUR', MT: 'EUR', LV: 'EUR', LT: 'EUR', EE: 'EUR', SK: 'EUR', SI: 'EUR', LU: 'EUR',
  CH: 'CHF', GB: 'GBP', AE: 'AED', TR: 'TRY', TH: 'THB', MV: 'USD', US: 'USD', GE: 'GEL', AM: 'AMD', AZ: 'AZN', KZ: 'KZT', UZ: 'UZS', RU: 'RUB', RS: 'RSD', CZ: 'CZK', HU: 'HUF', PL: 'PLN', IL: 'ILS', SC: 'SCR', MU: 'MUR', ID: 'IDR', JP: 'JPY', SG: 'SGD', QA: 'QAR', SA: 'SAR', EG: 'EGP', MA: 'MAD' };
const HOME_CUR = { RU: 'RUB', KZ: 'KZT', UZ: 'UZS', AZ: 'AZN', AM: 'AMD', GE: 'GEL', BY: 'BYN', KG: 'KGS', TJ: 'TJS', TM: 'TMT', MD: 'MDL', UA: 'UAH', AE: 'AED', IL: 'ILS', GB: 'GBP', US: 'USD', CY: 'EUR', FR: 'EUR' };

async function rest(path, auth, init = {}) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!r.ok) throw new Error('db_' + r.status);
  return r.status === 204 ? null : r.json();
}
const getJSON = async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error(url.split('/')[2] + '_' + r.status); return r.json(); };
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function facts(t, c) {
  let { lat, lon, tz, country_code: cc } = t;
  if (lat == null || !tz) {
    const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(t.city)}&count=1&language=ru${t.country_code ? '&countryCode=' + t.country_code : ''}`);
    const x = g.results?.[0];
    if (x) ({ latitude: lat, longitude: lon, timezone: tz, country_code: cc } = x);
  }
  const out = { tz, cc, lat, lon };
  const today = new Date().toISOString().slice(0, 10);
  const start = t.start_date || today;
  const end = t.end_date || start;
  // погода: «сейчас» + 5 дней. Значок дня — по ДНЕВНЫМ часам (от рассвета до заката), а не «худшее за сутки»:
  // иначе ночной дождь превращает солнечный день в «дождь».
  if (lat != null) {
    const tzq = encodeURIComponent(tz || 'auto');
    const ahead = (Date.parse(start) - Date.parse(today)) / 864e5;
    try {
      if (ahead <= 11) {
        const from = start <= today ? today : start;
        const to = addDays(from, 4);
        const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=${tzq}&start_date=${from}&end_date=${to}`
          + '&current=temperature_2m,apparent_temperature,weather_code,cloud_cover,wind_speed_10m,relative_humidity_2m,is_day,precipitation'
          + '&hourly=weather_code,cloud_cover,precipitation_probability,precipitation,temperature_2m'
          + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,wind_speed_10m_max,uv_index_max');
        const H = w.hourly, D = w.daily;
        const days = D.time.map((d, i) => {
          const sr = D.sunrise[i].slice(11, 13) | 0, ss = D.sunset[i].slice(11, 13) | 0;
          const idx = H.time.map((t, k) => (t.startsWith(d) ? k : -1)).filter((k) => k >= 0);
          const day = idx.filter((k) => { const h = +H.time[k].slice(11, 13); return h >= Math.max(8, sr) && h <= Math.min(19, ss); });
          const night = idx.filter((k) => !day.includes(k));
          const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
          const cloud = Math.round(avg(day.map((k) => H.cloud_cover[k])));
          const rainDay = Math.max(0, ...day.map((k) => H.precipitation_probability[k] ?? 0));
          const wetHours = day.filter((k) => (H.precipitation[k] ?? 0) >= 0.2 || (H.precipitation_probability[k] ?? 0) >= 60);
          const codes = day.map((k) => H.weather_code[k]);
          const snow = codes.filter((c) => (c >= 71 && c <= 77) || c === 85 || c === 86).length;
          const storm = codes.filter((c) => c >= 95).length;
          const fog = codes.filter((c) => c === 45 || c === 48).length;
          // представительное состояние дня
          let code;
          if (storm >= 1) code = 95;
          else if (snow >= 2) code = 73;
          else if (wetHours.length >= 3) code = 63;
          else if (wetHours.length >= 1) code = 80;          // кратковременный дождь
          else if (fog >= day.length / 2) code = 45;
          else code = cloud < 20 ? 0 : cloud < 45 ? 1 : cloud < 75 ? 2 : 3;
          const nightRain = night.some((k) => (H.precipitation[k] ?? 0) >= 0.3);
          return { date: d, code, cloud, tmax: D.temperature_2m_max[i], tmin: D.temperature_2m_min[i], rain: rainDay, mm: D.precipitation_sum[i],
            wind: D.wind_speed_10m_max[i], uv: D.uv_index_max?.[i] ?? null, sunrise: D.sunrise[i].slice(11), sunset: D.sunset[i].slice(11), nightRain, wetFrom: wetHours.length ? H.time[wetHours[0]].slice(11) : null };
        });
        const c = w.current;
        out.weather = { mode: 'forecast', place: { lat, lon }, now: { t: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code, cloud: c.cloud_cover, wind: c.wind_speed_10m, hum: c.relative_humidity_2m, day: !!c.is_day, at: c.time }, days };
      } else {
        const shift = (d) => `${+d.slice(0, 4) - 1}${d.slice(4)}`;
        const to = addDays(start, 4);
        const w = await getJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&timezone=${tzq}&start_date=${shift(start)}&end_date=${shift(to)}`
          + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,sunshine_duration,daylight_duration');
        const D = w.daily;
        out.weather = { mode: 'lastyear', days: D.time.map((d, i) => {
          const sun = D.daylight_duration[i] ? D.sunshine_duration[i] / D.daylight_duration[i] : 0;
          const mm = D.precipitation_sum[i];
          return { date: `${+d.slice(0, 4) + 1}${d.slice(4)}`, code: mm >= 3 ? 63 : mm >= 0.5 ? 80 : sun > 0.7 ? 0 : sun > 0.45 ? 1 : sun > 0.2 ? 2 : 3,
            tmax: D.temperature_2m_max[i], tmin: D.temperature_2m_min[i], mm, wind: D.wind_speed_10m_max[i] };
        }) };
      }
    } catch (e) { out.weather = { error: String(e.message) }; }
  }
  // праздники в стране поездки (± 2 дня вокруг дат)
  if (cc) {
    try {
      const years = [...new Set([start.slice(0, 4), end.slice(0, 4)])];
      const all = (await Promise.all(years.map((y) => getJSON(`https://date.nager.at/api/v3/PublicHolidays/${y}/${cc}`)))).flat();
      out.holidays = all.filter((h) => h.date >= addDays(start, -2) && h.date <= addDays(end, 2)).map((h) => ({ date: h.date, name: h.localName, en: h.name, global: h.global }));
    } catch { out.holidays = []; }
  }
  // курсы: местная валюта ↔ валюта гостя
  const local = CUR[cc] || null;
  const home = HOME_CUR[c?.citizenship] || 'RUB';
  if (local) {
    try {
      const r = await getJSON(`https://open.er-api.com/v6/latest/${local}`);
      out.money = { local, home, rate: r.rates?.[home] ?? null, eur: local === 'EUR' ? 1 : r.rates?.EUR ?? null, at: r.time_last_update_utc };
    } catch { out.money = { local, home }; }
  }
  return out;
}

function extractJSON(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('bad_json');
  return JSON.parse(text.slice(a, b + 1));
}

async function jarvis(t, c, people) {
  const kids = people.some((p) => /сын|доч|реб|дет/i.test(p.role || '')) || /дет|сын|доч|реб/i.test(t.companions || '');
  const ctx = {
    гражданство_гостя: c?.citizenship || 'не указано (скорее всего RU)',
    откуда: c?.city || null, язык: c?.language || 'RU', vip: !!c?.vip,
    куда: { город: t.city, страна: t.country, код_страны: t.country_code }, даты: [t.start_date, t.end_date],
    с_кем: t.companions || null, есть_дети: kids,
    особенности_здоровья: c?.health?.length ? 'есть (учесть аптечку/клиники)' : null, аллергии: c?.allergies?.length ? 'есть (подготовить перевод на местный язык)' : null,
  };
  const prompt = `Ты Jarvis — консьерж люксового сервиса для гостей из стран СНГ. Подготовь брифинг «Перед вылетом» для поездки ниже.
Обязательно найди АКТУАЛЬНУЮ информацию в поиске (правила въезда и оплаты меняются). Учитывай гражданство гостя.
Ответь ТОЛЬКО JSON без пояснений, по-русски, коротко и конкретно:
{
 "entry": { "status": "visa_free" | "visa_required" | "evisa" | "unknown", "title": "одна строка: нужна ли виза", "details": ["2–4 пункта: срок пребывания, паспорт, ETIAS/анкеты, особые требования"] },
 "money": { "cards": "работают ли карты, выпущенные в стране гражданства гостя", "cash": "наличные: сколько и в какой валюте разумно", "tips": "чаевые: принято ли и сколько" },
 "connect": { "sim": "связь: eSIM, роуминг", "plugs": "розетки и напряжение" },
 "etiquette": ["2–3 пункта: дресс-код, поведение, что важно знать"],
 "safety": ["0–3 пункта: безопасность, здоровье, сезонные риски"],
 "transport": {
   "summary": "одна строка: как удобнее всего передвигаться по городу",
   "lines": [ { "name": "линия метро/автобуса/трамвая с номером и цветом, напр. «Метро 1 (жёлтая)»", "to": "главные места, куда по ней удобно добраться" } ],
   "fares": [ { "what": "билет или проездной", "price": "цена в местной валюте" } ],
   "taxi": "такси и приложения: какие работают, примерная цена поездки по центру и до аэропорта",
   "airport": "как добраться из аэропорта в центр: варианты, время, цена",
   "tips": "1–2 полезных совета (оплата картой/телефоном у турникета, час пик, безопасность в метро)"
 },
 "phrases": [ { "ru": "фраза по-русски", "local": "на местном языке", "say": "как произнести" } ],
 "actions": [ { "t": "что консьержу сделать заранее (действие)", "why": "почему именно этому гостю", "days_before": 7 } ],
 "confidence": "high" | "medium" | "low"
}
Транспорт — актуальные цены и линии на ${new Date().getFullYear()} год по официальным сайтам перевозчика: 3–6 самых полезных линий для туриста (до главных достопримечательностей, торговых улиц, вокзалов, аэропорта), 2–4 тарифа. Если в городе нет метро — автобусы, трамваи, такси, лодки.
Фразы — 3 штуки (такси до отеля, «у меня аллергия на…», «спасибо»). Действия — 3–6, конкретные (например: «Договориться об оплате брони через консьержа — российские карты не работают»).
Если не уверен — так и напиши в details и поставь confidence low. Данные: ${JSON.stringify(ctx)}`;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.2 } }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) throw new Error(r.status === 429 ? 'rate_limited' : 'gemini_' + r.status);
  const j = await r.json();
  const cand = j.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text || '').join('') || '';
  const data = extractJSON(text);
  const sources = (cand?.groundingMetadata?.groundingChunks || []).map((x) => x.web).filter(Boolean).slice(0, 6).map((w) => ({ title: w.title, uri: w.uri }));
  return { ...data, sources, generated_at: new Date().toISOString(), for: { citizenship: c?.citizenship || null, city: t.city, start: t.start_date } };
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
  const id = String(req.body?.id || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: 'bad_id' });
  try {
    const [t] = await rest(`trips?id=eq.${id}&select=*`, auth);
    if (!t) return res.status(404).json({ error: 'not_found' });
    const [c] = await rest(`clients?id=eq.${t.client_id}&select=*`, auth);
    if (req.body?.mode === 'jarvis') {
      if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'no_key' });
      const people = await rest(`people?client_id=eq.${t.client_id}&select=role`, auth);
      const brief = await jarvis(t, c, people);
      await rest(`trips?id=eq.${id}`, auth, { method: 'PATCH', body: JSON.stringify({ brief }), headers: { Prefer: 'return=minimal' } });
      return res.status(200).json({ brief });
    }
    const f = await facts(t, c);
    // заодно сохраняем пояс и координаты поездки, если их не было
    if ((!t.tz && f.tz) || (t.lat == null && f.lat != null)) await rest(`trips?id=eq.${id}`, auth, { method: 'PATCH', body: JSON.stringify({ tz: f.tz, country_code: f.cc, lat: f.lat, lon: f.lon }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    return res.status(200).json(f);
  } catch (e) {
    return res.status(e.message === 'rate_limited' ? 429 : 500).json({ error: String(e.message || e) });
  }
}
export { facts }; // для проверки

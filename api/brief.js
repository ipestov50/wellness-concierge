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
    const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(t.city)}&count=1&language=ru`);
    const x = g.results?.[0];
    if (x) ({ latitude: lat, longitude: lon, timezone: tz, country_code: cc } = x);
  }
  const out = { tz, cc, lat, lon };
  const today = new Date().toISOString().slice(0, 10);
  const start = t.start_date || today;
  const end = t.end_date || start;
  // погода: прогноз на 16 дней, дальше — как было в эти даты год назад
  if (lat != null) {
    const ahead = (Date.parse(start) - Date.parse(today)) / 864e5;
    const last = addDays(end, 0) > addDays(start, 13) ? addDays(start, 13) : end; // не больше 14 дней
    const daily = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max';
    try {
      if (ahead <= 14 && Date.parse(end) >= Date.parse(today)) {
        const from = start < today ? today : start;
        const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${daily}&timezone=${encodeURIComponent(tz || 'auto')}&start_date=${from}&end_date=${last < from ? from : last}`);
        out.weather = { mode: 'forecast', days: w.daily.time.map((d, i) => ({ date: d, code: w.daily.weather_code[i], tmax: w.daily.temperature_2m_max[i], tmin: w.daily.temperature_2m_min[i], rain: w.daily.precipitation_probability_max[i], mm: w.daily.precipitation_sum[i], wind: w.daily.wind_speed_10m_max[i] })) };
      } else {
        const shift = (d) => `${+d.slice(0, 4) - 1}${d.slice(4)}`;
        const w = await getJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=${encodeURIComponent(tz || 'auto')}&start_date=${shift(start)}&end_date=${shift(last)}`);
        out.weather = { mode: 'lastyear', days: w.daily.time.map((d, i) => ({ date: `${+d.slice(0, 4) + 1}${d.slice(4)}`, code: w.daily.weather_code[i], tmax: w.daily.temperature_2m_max[i], tmin: w.daily.temperature_2m_min[i], mm: w.daily.precipitation_sum[i], wind: w.daily.wind_speed_10m_max[i] })) };
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
 "phrases": [ { "ru": "фраза по-русски", "local": "на местном языке", "say": "как произнести" } ],
 "actions": [ { "t": "что консьержу сделать заранее (действие)", "why": "почему именно этому гостю", "days_before": 7 } ],
 "confidence": "high" | "medium" | "low"
}
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

// Публичный путеводитель гостя по секретной ссылке. Без входа владельца: данные отдаёт только функция trip_portal (очищенный JSON).
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const str = (v, n = 300) => (typeof v === 'string' && v ? v.slice(0, n) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function wmo(c) {
  if (c === 0 || c === 1) return 'Ясно';
  if (c === 2 || c === 3) return 'Облачно';
  if (c === 45 || c === 48) return 'Туман';
  if (c >= 95) return 'Гроза';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'Снег';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'Дождь';
  return 'Облачно';
}

async function weather(lat, lon) {
  if (num(lat) == null || num(lon) == null) return null;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const c = (await r.json())?.current;
    if (!c || num(c.temperature_2m) == null) return null;
    return { tempC: Math.round(c.temperature_2m), code: num(c.weather_code), text: wmo(c.weather_code), windKmh: num(c.wind_speed_10m) == null ? null : Math.round(c.wind_speed_10m) };
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Cache-Control', 'no-store'); return res.status(405).json({ error: 'method_not_allowed' }); }
  const token = String(req.query?.token || '');
  if (!TOKEN.test(token)) { res.setHeader('Cache-Control', 'no-store'); return res.status(400).json({ error: 'bad_token' }); }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) { res.setHeader('Cache-Control', 'no-store'); return res.status(500).json({ error: 'not_configured' }); }
  let d;
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/trip_portal`, {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error('db_' + r.status);
    d = await r.json();
  } catch { res.setHeader('Cache-Control', 'no-store'); return res.status(502).json({ error: 'upstream' }); }
  if (!d || typeof d !== 'object') { res.setHeader('Cache-Control', 'public, s-maxage=60'); return res.status(404).json({ error: 'not_found' }); }

  const t = d.trip || {};
  const wx = await weather(t.lat, t.lon);
  const out = {
    guest: { firstName: str(d.guest?.firstName, 80) },
    trip: { title: str(t.title, 120), city: str(t.city, 120), country: str(t.country, 120), start: str(t.start, 10), end: str(t.end, 10), tz: str(t.tz, 64), hotel: str(t.hotel, 160), lat: num(t.lat), lon: num(t.lon) },
    days: (Array.isArray(d.days) ? d.days : []).map((day) => ({
      date: str(day?.date, 10),
      items: (Array.isArray(day?.items) ? day.items : []).map((i) => ({
        time: str(i?.time, 5), title: str(i?.title, 200), category: str(i?.category, 40),
        kind: ['request', 'flight', 'hotel'].includes(i?.kind) ? i.kind : 'request',
        venueName: str(i?.venueName, 160), address: str(i?.address, 240), bookingReference: str(i?.bookingReference, 80),
        dressCode: str(i?.dressCode, 120), guestNotes: str(i?.guestNotes, 600),
      })),
    })),
    concierge: { whatsapp: /^\d{8,15}$/.test(String(d.concierge?.whatsapp || '')) ? d.concierge.whatsapp : null },
    weather: wx,
    updatedAt: str(d.updatedAt, 30),
  };
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json(out);
}

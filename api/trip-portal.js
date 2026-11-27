// Публичный путеводитель гостя по секретной ссылке. Без входа владельца: данные отдаёт только функция trip_portal (очищенный JSON).
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const str = (v, n = 300) => (typeof v === 'string' && v ? v.slice(0, n) : null);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const iso = (v) => (typeof v === 'string' && ISO.test(v) ? v : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function wmo(c) {
  if (c === 0 || c === 1) return { kind: 'clear', text: 'Clear' };
  if (c === 2 || c === 3) return { kind: 'cloud', text: 'Cloudy' };
  if (c === 45 || c === 48) return { kind: 'fog', text: 'Fog' };
  if (c >= 95) return { kind: 'storm', text: 'Storm' };
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { kind: 'snow', text: 'Snow' };
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return { kind: 'rain', text: 'Rain' };
  return { kind: 'cloud', text: 'Cloudy' };
}

async function weather(lat, lon) {
  if (num(lat) == null || num(lon) == null) return null;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=10`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const j = await r.json();
    const c = j?.current;
    if (!c || num(c.temperature_2m) == null) return null;
    const w = wmo(c.weather_code);
    const dl = j?.daily || {};
    const daily = [];
    if (Array.isArray(dl.time)) {
      for (let k = 0; k < Math.min(dl.time.length, 10); k++) {
        const date = str(dl.time[k], 10);
        const hi = num(dl.temperature_2m_max?.[k]), lo = num(dl.temperature_2m_min?.[k]);
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || hi == null || lo == null) continue;
        const dw = wmo(dl.weather_code?.[k]);
        daily.push({ date, kind: dw.kind, text: dw.text, tMax: Math.round(hi), tMin: Math.round(lo) });
      }
    }
    return { tempC: Math.round(c.temperature_2m), code: num(c.weather_code), text: w.text, kind: w.kind, windKmh: num(c.wind_speed_10m) == null ? null : Math.round(c.wind_speed_10m), daily };
  } catch { return null; }
}

const intIn = (v, lo, hi) => { const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d{1,3}$/.test(v.trim()) ? Number(v) : NaN); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
function stay(x) {
  if (!x || typeof x !== 'object') return null;
  const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const g = Number(x.guests);
  const name = str(x.name, 160);
  if (!name) return null;
  return {
    name, address: str(x.address, 240),
    guests: Number.isInteger(g) && g >= 1 && g <= 99 ? g : null,
    checkInTime: /^[0-2]\d:[0-5]\d$/.test(String(x.checkInTime)) ? x.checkInTime : null,
    roomType: str(x.roomType, 80), bookingReference: str(x.bookingReference, 80), note: str(x.note, 600),
    checkIn: day(x.checkIn), checkOut: day(x.checkOut),
  };
}
function transfer(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = { pickup: str(x.pickup, 200), dropoff: str(x.dropoff, 200), passengers: intIn(x.passengers, 1, 99), luggage: intIn(x.luggage, 0, 99), driver: str(x.driver, 80) };
  return Object.values(o).some((v) => v !== null && v !== '') ? o : null;
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
  if (!d || typeof d !== 'object') { res.setHeader('Cache-Control', 'no-store'); return res.status(404).json({ error: 'not_found' }); }

  const t = d.trip || {};
  const wx = await weather(t.lat, t.lon);
  const out = {
    guest: { firstName: str(d.guest?.firstName, 80) },
    trip: { title: str(t.title, 120), city: str(t.city, 120), country: str(t.country, 120), start: str(t.start, 10), end: str(t.end, 10), tz: str(t.tz, 64), hotel: str(t.hotel, 160), hotelAddress: str(t.hotelAddress, 240), lat: num(t.lat), lon: num(t.lon) },
    stay: stay(d.stay),
    days: (Array.isArray(d.days) ? d.days : []).slice(0, 60).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day?.date))).map((day) => ({
      date: str(day?.date, 10),
      items: (Array.isArray(day?.items) ? day.items : []).slice(0, 40).map((i) => ({
        time: /^\d{2}:\d{2}$/.test(String(i?.time)) ? i.time : null, title: str(i?.title, 200), category: str(i?.category, 40),
        kind: ['request', 'flight', 'hotel'].includes(i?.kind) ? i.kind : 'request',
        venueName: str(i?.venueName, 160), address: str(i?.address, 240), bookingReference: str(i?.bookingReference, 80),
        dressCode: str(i?.dressCode, 120), guestNotes: str(i?.guestNotes, 600), transfer: transfer(i?.transfer), updatedAt: iso(i?.updatedAt),
      })),
    })),
    concierge: { whatsapp: /^\d{8,15}$/.test(String(d.concierge?.whatsapp || '')) ? d.concierge.whatsapp : null },
    weather: wx,
    updatedAt: iso(d.updatedAt),
  };
  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
  return res.status(200).json(out);
}

// Дороги через TomTom: где гость (отель), куда едет (партнёр или аэропорт), пробки и инциденты на пути.
// Бесплатный тариф TomTom ~2 500 запросов в день: координаты кэшируются, проверка — только перед выездом.

const KEY = Deno.env.get('TOMTOM_API_KEY') || '';
const TZ = 'Europe/Paris';
const MIN = 60e3;
export const tomtomReady = () => !!KEY;

const CAT: Record<string, string> = { JAM: 'пробка', ROAD_WORK: 'дорожные работы', ROAD_CLOSURE: 'перекрытие дороги', OTHER: 'инцидент' };
const ICON: Record<number, string> = { 1: 'авария', 6: 'пробка', 7: 'перекрыта полоса', 8: 'дорога перекрыта', 9: 'дорожные работы', 14: 'сломанная машина', 11: 'подтопление', 3: 'опасные условия' };

// ---------- поиск места (с кэшем) ----------
// near — искать только рядом с этой точкой (в 80 км от отеля гостя), чтобы «Le Jules Verne» нашёлся в Париже, а не в Тулузе
// poi — сначала искать заведения (ресторан «Le Jules Verne», а не улицу Жюля Верна)
export async function geocode(db: any, query: string, near?: { lat: number; lon: number } | null, poi = false) {
  const base = query.trim().toLowerCase();
  if (!base) return null;
  const q = (near ? `${base}@${near.lat.toFixed(1)},${near.lon.toFixed(1)}` : base) + (poi ? '#poi' : '');
  const { data: hit } = await db.from('geo_cache').select('*').eq('query', q).maybeSingle();
  if (hit) return hit.lat != null ? hit : null;
  const bias = near ? `&lat=${near.lat}&lon=${near.lon}&radius=80000` : '';
  const find = async (extra: string) => {
    const r = await fetch(`https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json?key=${KEY}&limit=1&language=ru-RU${bias}${extra}`);
    if (!r.ok) throw new Error('tomtom_search_' + r.status);
    return (await r.json()).results?.[0];
  };
  const top = (poi ? await find('&idxSet=POI') : null) || await find('');
  const row = { query: q, lat: top?.position?.lat ?? null, lon: top?.position?.lon ?? null, label: top ? (top.poi?.name ? top.poi.name + ', ' : '') + (top.address?.freeformAddress || '') : null };
  await db.from('geo_cache').upsert(row);
  return row.lat != null ? row : null;
}

// ---------- маршрут с пробками ----------
export async function route(from: any, to: any) {
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${from.lat},${from.lon}:${to.lat},${to.lon}/json?key=${KEY}` +
    '&traffic=true&travelMode=car&routeType=fastest&departAt=now&computeTravelTimeFor=all&sectionType=traffic';
  const r = await fetch(url);
  if (!r.ok) throw new Error('tomtom_route_' + r.status);
  const j = await r.json();
  const rt = j.routes?.[0];
  if (!rt) return null;
  const s = rt.summary;
  const issues = (rt.sections || []).filter((x: any) => x.sectionType === 'TRAFFIC' && (x.delayInSeconds || 0) >= 120 || x.simpleCategory === 'ROAD_CLOSURE')
    .map((x: any) => ({ kind: x.simpleCategory, label: CAT[x.simpleCategory] || 'инцидент', delay: Math.round((x.delayInSeconds || 0) / 60), magnitude: x.magnitudeOfDelay || 0 }));
  return {
    minutes: Math.round(s.travelTimeInSeconds / 60),
    free: Math.round((s.noTrafficTravelTimeInSeconds ?? s.travelTimeInSeconds - (s.trafficDelayInSeconds || 0)) / 60),
    delay: Math.round((s.trafficDelayInSeconds || 0) / 60),
    km: Math.round(s.lengthInMeters / 100) / 10,
    issues,
  };
}

// ---------- инциденты рядом с местом назначения (перекрытия, мероприятия, аварии) ----------
const distM = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLon = (bLon - aLon) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
// в большом городе перекрытия есть всегда — считаем только те, что у самого места:
// перекрытие дороги — до 400 м, авария или сильная пробка — до 700 м
export async function incidentsNear(p: any, radiusKm = 1) {
  const dLat = radiusKm / 111, dLon = radiusKm / (111 * Math.cos((p.lat * Math.PI) / 180));
  const bbox = [p.lon - dLon, p.lat - dLat, p.lon + dLon, p.lat + dLat].map((x) => x.toFixed(5)).join(',');
  const fields = '{incidents{geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description},from,to,roadNumbers,delay}}}';
  const r = await fetch(`https://api.tomtom.com/traffic/services/5/incidentDetails?key=${KEY}&bbox=${bbox}&fields=${encodeURIComponent(fields)}&language=ru-RU&timeValidityFilter=present`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.incidents || []).map((i: any) => {
    const g = i.geometry || {};
    const pts: number[][] = g.type === 'Point' ? [g.coordinates] : (g.coordinates || []);
    const d = pts.length ? Math.min(...pts.map(([lon, lat]) => distM(p.lat, p.lon, lat, lon))) : Infinity;
    return { ...i.properties, d };
  }).filter((x: any) => (x.iconCategory === 8 && x.d <= 400) || ((x.iconCategory === 1 || (x.magnitudeOfDelay || 0) >= 3) && x.d <= 700))
    .sort((a: any, b: any) => a.d - b.d).slice(0, 3).map((x: any) => ({
      label: x.events?.[0]?.description || ICON[x.iconCategory] || 'инцидент',
      where: [x.from, x.to].filter(Boolean).join(' → ') || (x.roadNumbers || []).join(', '),
      closed: x.iconCategory === 8, meters: Math.round(x.d),
    }));
}

// откуда и куда едет гость по запросу
const AIRPORT_POS: Record<string, [number, number]> = {
  CDG: [49.0097, 2.5479], ORY: [48.7262, 2.3652], NCE: [43.6584, 7.2159], GVA: [46.2381, 6.109], LHR: [51.47, -0.4543],
  DXB: [25.2532, 55.3657], LBG: [48.9694, 2.4414], MRS: [43.4393, 5.2214], PMI: [39.5517, 2.7388], MCM: [43.7258, 7.4196],
};
const AIRPORTS: Record<string, string> = { CDG: 'Charles de Gaulle Airport', ORY: 'Orly Airport', NCE: "Nice Côte d'Azur Airport", GVA: 'Geneva Airport', LHR: 'Heathrow Airport', DXB: 'Dubai International Airport', LBG: 'Paris Le Bourget Airport', MRS: 'Marseille Provence Airport', PMI: 'Palma de Mallorca Airport', MCM: 'Monaco Heliport' };
export function endpoints(r: any, D: any) {
  const day = r.deadline.slice(0, 10);
  const trip = D.trips.find((t: any) => t.client_id === r.client_id && t.start_date && t.start_date <= day && day <= (t.end_date || t.start_date));
  const p = r.partner_id ? D.partnersFull.get(r.partner_id) : null;
  const text = `${r.summary || ''} ${r.original_message || ''}`;
  let to: string | null = null, toName = '';
  const iata = text.match(/\b(CDG|ORY|NCE|GVA|LHR|DXB|LBG|MRS|PMI|MCM)\b/i)?.[1]?.toUpperCase();
  if (r.category === 'Transport' && /аэропорт|вылет|airport|aéroport/i.test(text) && (iata || trip?.city)) {
    to = iata ? AIRPORTS[iata] : `airport ${trip.city}`; toName = iata ? `аэропорт ${iata}` : 'аэропорт';
  } else if (p) {
    to = p.address ? p.address : `${p.name}, ${p.city || trip?.city || ''}`; toName = p.name;
  }
  const from = trip?.hotel ? `${trip.hotel}, ${trip.city}` : null;
  const fixed = iata && AIRPORT_POS[iata] ? { lat: AIRPORT_POS[iata][0], lon: AIRPORT_POS[iata][1], label: toName } : null;
  return from && to ? { from, fromName: trip.hotel, to, toName, fixed, poi: !!p && !p.address, airport: !!iata || /^airport /.test(to) } : null;
}

const hm = (ms: number) => new Date(ms).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const LEAVE: Record<string, (t: string, place: string, d: number) => string> = {
  RU: (t, place, d) => `Здравствуйте! На дорогах сейчас пробки${d ? `, путь до ${place} займёт на ${d} минут дольше обычного` : ''}. Советую выехать в ${t} — так вы приедете вовремя и без спешки.`,
  EN: (t, place, d) => `Hello! Traffic is heavy right now${d ? ` — the drive to ${place} will take about ${d} minutes longer than usual` : ''}. I'd suggest leaving at ${t} so you arrive relaxed and on time.`,
  FR: (t, place, d) => `Bonjour ! La circulation est dense en ce moment${d ? ` : le trajet jusqu'à ${place} prendra environ ${d} minutes de plus` : ''}. Je vous conseille de partir à ${t} pour arriver sereinement et à l'heure.`,
};

// проверка одного запроса: вернёт сводку или null, если ехать неоткуда/некуда
export async function checkRequest(db: any, r: any, D: any) {
  const e = endpoints(r, D);
  if (!e) return null;
  const a = await geocode(db, e.from, null, true);
  const b = !a ? null : e.fixed ? e.fixed : await geocode(db, e.to, e.airport ? null : a, e.poi);
  if (!a || !b) return { ...e, error: 'not_found' };
  const rt = await route(a, b);
  if (!rt) return { ...e, error: 'no_route' };
  const near = await incidentsNear(b);
  const at = new Date(r.deadline).getTime();
  const buffer = r.category === 'Transport' ? 0 : 10;          // к ресторану — с запасом 10 минут
  const leaveBy = at - (rt.minutes + buffer) * MIN;
  const level = near.some((x: any) => x.closed) || rt.issues.some((x: any) => x.kind === 'ROAD_CLOSURE') ? 3
    : rt.delay >= 20 || (rt.delay >= 10 && rt.delay >= rt.free * 0.25) ? 2
    : rt.delay >= 8 ? 1 : 0;
  const c = D.clients.get(r.client_id);
  const msg = (LEAVE[c?.language] || LEAVE.RU)(hm(leaveBy), e.toName, rt.delay);
  return { ...e, ...rt, near, leaveBy, level, guestText: msg, toLabel: b.label || e.to, guessed: e.poi };
}

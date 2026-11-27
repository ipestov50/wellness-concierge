// Общее для «Wellness-маршрута»: досье гостя из базы + разовые данные звонка, единый стоп-лист. Файл с «_» — не адрес /api.
import { rest, isId } from './_owner.js';
import { stopList } from '../js/stoplist.js';

export const str = (x, n = 300) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
export const list = (x, n = 12, m = 80) => (Array.isArray(x) ? x.map((v) => str(v, m)).filter(Boolean).slice(0, n) : []);
export const firstName = (n) => String(n || '').replace(/\s*\(.*?\)/g, '').trim().split(/\s+/)[0] || '';

// Разбор общих полей запроса: направление, срок, цели, заметки, ответы. Всё обрезается и проверяется.
export function parseTrip(b) {
  const dur = parseInt(b.durationDays, 10);
  const ymd = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x : '');
  return {
    destination: str(b.destination, 120), durationDays: Number.isInteger(dur) && dur >= 1 && dur <= 60 ? dur : null,
    from: ymd(b.dateRange?.from), to: ymd(b.dateRange?.to),
    goals: list(b.wellnessGoals, 8, 60), goalText: str(b.goalText, 300), notes: str(b.currentNotes, 1500),
    arrivalTime: /^\d{2}:\d{2}$/.test(b.arrivalTime || '') ? b.arrivalTime : '', departureTime: /^\d{2}:\d{2}$/.test(b.departureTime || '') ? b.departureTime : '',
    earlyCheckIn: b.earlyCheckInConfirmed === true,
    party: { adults: Math.max(1, Math.min(20, parseInt(b.party?.adults, 10) || 1)), kids: Math.max(0, Math.min(20, parseInt(b.party?.kids, 10) || 0)), kidsAges: str(b.party?.kidsAges, 60) },
  };
}

// досье из базы (если гость выбран) + стоп-лист (база + разовые аллергии со звонка). Имена в ИИ не уходят.
export async function dossier(auth, clientId, extraAllergies = []) {
  const id = isId(clientId) ? clientId : null;
  const [c] = id ? await rest(`clients?id=eq.${id}&select=*`, auth) : [null];
  const people = id ? await rest(`people?client_id=eq.${id}&select=id,role,allergies&limit=50`, auth) : [];
  const sl = stopList(c, people);
  const all = [...new Set([...sl.all, ...extraAllergies].map((x) => String(x).trim()).filter(Boolean))];
  return {
    client: c || null, stop: all, family: sl.family,
    profile: c ? { язык: c.language, vip: c.vip, диета: c.diet, здоровье: c.health, любит: c.likes, избегает: c.dislikes, еда: c.pref_food, музыка_атмосфера: c.pref_music, спа: c.pref_spa, транспорт: c.pref_transport, отели: c.pref_hotels, в_пути: c.travel_habits } : null,
  };
}

// Фиксированное время: якоря маршрута «дата · ЧЧ:ММ · что». Дата — из диапазона поездки; день (Day N / Arrival / Departure) считаем здесь.
export function parseAnchors(x, range = {}) {
  const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
  const diff = (p, q) => Math.round((Date.parse(q + 'T00:00:00Z') - Date.parse(p + 'T00:00:00Z')) / 864e5);
  return (Array.isArray(x) ? x : []).slice(0, 20).map((a) => {
    const date = ymd(a?.date);
    let day = str(a?.day, 24);
    if (date && range.from) { const n = diff(range.from, date) + 1; day = date === range.from ? 'Arrival' : range.to && date === range.to ? 'Departure' : n >= 1 ? `Day ${n}` : ''; }
    return { date, day, time: /^\d{2}:\d{2}$/.test(a?.time || '') ? a.time : '', activity: str(a?.activity, 120).replace(/^\s*\d{1,2}[:.]\d{2}\s*[-–—]?\s*/, '') };
  }).filter((a) => a.time && a.activity && /^(Arrival|Departure|Day \d{1,2})$/.test(a.day));
}
// Даты поездки списком — модель привязывает вопросы к дням
export function tripDates(t) {
  if (!t.from || !t.to || t.to < t.from) return [];
  const out = [];
  for (let d = t.from, i = 0; d <= t.to && i < 14; i++) { out.push({ date: d, role: d === t.from ? 'Arrival' : d === t.to ? 'Departure' : '' }); d = new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10); }
  return out;
}

// Нужен ли «мост до заселения»: прилёт раньше 14:00 без подтверждённого раннего заселения (стандартное заселение 15:00–16:00)
export const bridgeNeeded = (t) => !!t.arrivalTime && !t.earlyCheckIn && Number(t.arrivalTime.slice(0, 2)) * 60 + Number(t.arrivalTime.slice(3)) < 14 * 60;

// Сигналы из свободных заметок (их извлекает модель на любом языке): погода, повторный визит, вкусы
export function cleanSignals(x) {
  const o = x && typeof x === 'object' ? x : {};
  return {
    weather: ['rain', 'cold', 'heat', 'snow'].includes(o.weather) ? o.weather : null,
    repeatVisit: o.repeatVisit === true,
    music: list(o.music, 6, 40), dishes: list(o.dishes, 6, 60), drinks: list(o.drinks, 6, 60),
  };
}

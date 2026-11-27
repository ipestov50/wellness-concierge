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
    goals: list(b.wellnessGoals, 8, 60), notes: str(b.currentNotes, 1500),
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

// Фиксированное время: якоря маршрута «день · ЧЧ:ММ · что». Всё проверяется и обрезается.
export function parseAnchors(x) {
  return (Array.isArray(x) ? x : []).slice(0, 20).map((a) => ({ day: str(a?.day, 24), time: /^\d{2}:\d{2}$/.test(a?.time || '') ? a.time : '', activity: str(a?.activity, 120) }))
    .filter((a) => a.day && a.time && a.activity && /^(Arrival|Departure|Day \d{1,2})$/.test(a.day));
}

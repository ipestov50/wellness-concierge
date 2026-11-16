// «✦ Идеи»: 3 упреждающих предложения для гостя — повод, вкусы, сезон, прошлые запросы. Имя гостя в ИИ не отправляется.
import { gfetch, FLASH, LITE, cacheKey, getCache, setCache } from './_cache.js';
import { owner, rest, isId, askJSON } from './_owner.js';

const CATS = ['Spa & Wellness', 'Dining', 'Transport', 'Accommodation', 'Activities', 'Health & Fitness', 'Gifts & Events', 'Other'];
const SCHEMA = {
  type: 'OBJECT',
  properties: { ideas: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    title: { type: 'STRING', description: 'Суть идеи для запроса, по-русски, до 70 символов, начинается с действия' },
    why: { type: 'STRING', description: 'Почему именно этому гостю и именно сейчас — 1–2 коротких предложения' },
    category: { type: 'STRING', enum: CATS },
    days: { type: 'INTEGER', nullable: true, description: 'Через сколько дней от сегодня лучше предложить/провести; null — без срока' },
    query: { type: 'STRING', description: 'Поисковая фраза для поиска мест на местном языке города, без имени гостя' },
    wow: { type: 'STRING', nullable: true, description: 'Маленькая деталь, которая удивит гостя' },
  }, required: ['title', 'why', 'category', 'query'] } } },
  required: ['ideas'],
};
const dd = (iso, today) => { const d = new Date(iso + 'T00:00:00Z'); const t = new Date(today + 'T00:00:00Z'); const n = new Date(Date.UTC(t.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); if (n < t) n.setUTCFullYear(n.getUTCFullYear() + 1); return Math.round((n - t) / 864e5); };

export default async function handler(req, res) {
  const auth = await owner(req, res); if (!auth) return;
  const id = String(req.body?.client_id || '');
  if (!isId(id)) return res.status(400).json({ error: 'bad_id' });
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
    const [c] = await rest(`clients?id=eq.${id}&select=*`, auth);
    if (!c) return res.status(404).json({ error: 'not_found' });
    const [people, dates, trips, past] = await Promise.all([
      rest(`people?client_id=eq.${id}&select=role,birthday,allergies,notes`, auth),
      rest(`client_dates?client_id=eq.${id}&select=title,date,notes`, auth),
      rest(`trips?client_id=eq.${id}&select=city,country,hotel,start_date,end_date,companions&order=start_date.desc&limit=4`, auth),
      rest(`requests?client_id=eq.${id}&select=summary,category,status,created_at&order=created_at.desc&limit=25`, auth),
    ]);
    const ck = cacheKey('idea', id, c.updated_at, today, past.length, trips.length);
    if (!req.body?.force) { const hit = await getCache(auth, ck, 12 * 3600e3); if (hit) return res.status(200).json({ ...hit, cached: true }); }
    const upcoming = [
      c.birthday && { что: 'день рождения гостя', через_дней: dd(c.birthday, today) },
      ...people.filter((p) => p.birthday).map((p) => ({ что: `день рождения: ${p.role || 'близкий'}`, через_дней: dd(p.birthday, today) })),
      ...dates.map((d) => ({ что: d.title, заметка: d.notes, через_дней: dd(d.date, today) })),
    ].filter((x) => x && x.через_дней <= 60).sort((a, b) => a.через_дней - b.через_дней);
    const ctx = {
      сегодня: today,
      гость: { язык: c.language, vip: c.vip, город: c.city, аллергии: c.allergies, диета: c.diet, здоровье: c.health, любит: c.likes, избегает: c.dislikes, еда: c.pref_food, спа: c.pref_spa, транспорт: c.pref_transport, отели: c.pref_hotels, в_пути: c.travel_habits, заметки: c.concierge_notes },
      ближайшие_поводы: upcoming,
      окружение: people.map((p) => ({ роль: p.role, аллергии: p.allergies, заметки: p.notes })),
      поездки: trips.map((t) => ({ город: t.city, страна: t.country, отель: t.hotel, с: t.start_date, по: t.end_date, с_кем: t.companions })),
      уже_делали: past.map((r) => ({ что: r.summary, категория: r.category, итог: r.status })),
    };
    const out = await askJSON(gfetch, auth, [FLASH, LITE],
      `Ты Jarvis — старший консьерж люксового сервиса. Предложи ровно 3 идеи, которые стоит предложить этому гостю САМИ, пока он не попросил.
Правила:
- Опирайся на ближайшие поводы (если есть), вкусы, сезон, поездки и окружение гостя. Если повода нет — предложи то, что точно в его вкусе.
- Строго соблюдай аллергии, диету, здоровье и всё, что гость избегает. Не предлагай то, что он уже заказывал («уже_делали»), если это не регулярная привычка.
- Идеи разные по категориям, конкретные, исполнимые, без общих слов («устроить приятный вечер» — плохо; «тихий ужин на террасе с видом на воду в день рождения жены, столик на 20:30» — хорошо).
- query — короткая фраза для поиска мест в городе гостя или поездки, на языке города.
- wow — одна маленькая деталь, которая удивит (например, любимые цветы, поздравление от шефа).
- Не придумывай факты о госте, которых нет в данных.`,
      ctx, SCHEMA, { temperature: 0.7, budget: 0 });
    const ideas = (out.ideas || []).filter((x) => x?.title).slice(0, 3).map((x) => ({
      title: String(x.title).slice(0, 110), why: String(x.why || '').slice(0, 260), category: CATS.includes(x.category) ? x.category : 'Other',
      days: Number.isInteger(x.days) ? Math.max(0, Math.min(90, x.days)) : null, query: String(x.query || x.title).slice(0, 140), wow: x.wow ? String(x.wow).slice(0, 160) : null,
    }));
    const result = { ideas, at: Date.now() };
    await setCache(auth, ck, result);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(e.message === 'rate_limited' ? 502 : 500).json({ error: String(e.message || e), tried: e.tried });
  }
}

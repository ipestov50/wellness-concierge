// «✦ Идеи»: 3 упреждающих предложения для гостя — повод, вкусы, сезон, прошлые запросы. Имя гостя в ИИ не отправляется.
import { gfetch, FLASH, LITE, cacheKey, getCache, setCache } from './_cache.js';
import { owner, rest, isId, askJSON, norm } from './_owner.js';
import { stopList } from '../js/stoplist.js';
import discovery from './_discovery.js';
import gamma from './_gamma.js';
import curate from './_curate.js';
import gammaDeck from './_gammaDeck.js';

// Категории идеи (для гостя и фильтров) и категории запросов приложения (для заготовки запроса)
const IDEA_CATS = ['Dining', 'Gifts & Events', 'Transport', 'Spa & Wellness', 'Activities', 'Trip Touch'];
const APP_CAT = { 'Trip Touch': 'Accommodation' };
const ACTIONS = ['venue_search', 'whatsapp_pitch', 'trip_note'];
const SCHEMA = {
  type: 'OBJECT',
  properties: { ideas: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    title: { type: 'STRING', description: 'Услуга, которую выполняет консьерж, по-русски, до 70 символов, начинается с действия' },
    why: { type: 'STRING', description: 'Почему именно этому гостю и именно сейчас — 1–2 коротких предложения' },
    category: { type: 'STRING', enum: IDEA_CATS },
    actionType: { type: 'STRING', enum: ACTIONS, description: 'venue_search — нужно подобрать место; whatsapp_pitch — сначала предложить гостю в WhatsApp; trip_note — учесть в поездке (трансфер, отель)' },
    serviceTouch: { type: 'STRING', description: 'Штрих консьержа: одна конкретная деталь исполнения, которая удивит (по-русски, 1 предложение)' },
    pitch: { type: 'STRING', nullable: true, description: 'Только для whatsapp_pitch: готовое сообщение гостю, 2–3 предложения, на языке гостя, начинается с «{имя}», без имени гостя в тексте, мягкий вопрос в конце' },
    ref: { type: 'STRING', nullable: true, description: 'id повода или поездки из входных данных, к которому относится идея; null — общая' },
    days: { type: 'INTEGER', nullable: true, description: 'Через сколько дней от сегодня лучше предложить/провести; null — без срока' },
    query: { type: 'STRING', description: 'Поисковая фраза для поиска мест на местном языке города, без имени гостя' },
    guestNote: { type: 'STRING', description: 'Заметка в запрос: пожелания и условия исполнения, 1–2 предложения' },
  }, required: ['title', 'why', 'category', 'actionType', 'serviceTouch', 'query', 'guestNote'] } } },
  required: ['ideas'],
};
const dd = (iso, today) => { const d = new Date(iso + 'T00:00:00Z'); const t = new Date(today + 'T00:00:00Z'); const n = new Date(Date.UTC(t.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); if (n < t) n.setUTCFullYear(n.getUTCFullYear() + 1); return Math.round((n - t) / 864e5); };
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const stems = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 3).map((w) => w.slice(0, 5)));
const similar = (a, b) => { const A = stems(a), B = stems(b); if (!A.size || !B.size) return false; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n) >= 0.5; };
const firstWord = (n) => String(n || '').replace(/\s*\(.*?\)/g, '').trim().split(/\s+/)[0] || '';

export default async function handler(req, res) {
  // Vercel Hobby: не больше 12 функций, поэтому «вопросы для звонка» и «промпт для Gamma» живут за этим же адресом (см. rewrites в vercel.json)
  // тип запроса берём из адреса, из тела и из исходного пути: rewrite на Vercel может не донести ?kind
  const kind = req.query?.kind || req.body?.kind || (/discovery-questions/.test(req.url || '') ? 'discovery' : /gamma-prompt/.test(req.url || '') ? 'gamma' : '');
  if (kind === 'discovery') return discovery(req, res);
  if (kind === 'gamma') return gamma(req, res);
  if (kind === 'curate') return curate(req, res);
  if (kind === 'gamma-deck' || /gamma-deck/.test(req.url || '')) return gammaDeck(req, res);
  const auth = await owner(req, res); if (!auth) return;
  const id = String(req.body?.client_id || '');
  if (!isId(id)) return res.status(400).json({ error: 'bad_id' });
  const count = Math.max(1, Math.min(3, parseInt(req.body?.count, 10) || 3));
  const exclude = Array.isArray(req.body?.exclude) ? req.body.exclude.slice(0, 12).map((x) => String(x).slice(0, 140)) : [];
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
    const [c] = await rest(`clients?id=eq.${id}&select=*`, auth);
    if (!c) return res.status(404).json({ error: 'not_found' });
    const [people, dates, trips, past, fb] = await Promise.all([
      rest(`people?client_id=eq.${id}&select=id,name,role,birthday,allergies,notes`, auth),
      rest(`client_dates?client_id=eq.${id}&select=title,date,notes`, auth),
      rest(`trips?client_id=eq.${id}&select=id,city,country,hotel,start_date,end_date,companions&order=start_date.desc&limit=6`, auth),
      rest(`requests?client_id=eq.${id}&select=summary,category,status,created_at&order=created_at.desc&limit=25`, auth),
      rest(`idea_feedback?client_id=eq.${id}&select=title,category&order=created_at.desc&limit=60`, auth).catch(() => []),
    ]);
    const trip = trips.filter((t) => (t.end_date || t.start_date || '') >= today).sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))[0] || null;
    const upcoming = [
      c.birthday && { id: 'e0', label: 'День рождения', kind: 'bday', что: 'день рождения гостя', через_дней: dd(c.birthday, today) },
      ...people.filter((p) => p.birthday).map((p, i) => ({ id: 'p' + i, label: `День рождения · ${firstWord(p.name) || p.role || 'близкий'}`, kind: 'person', что: `день рождения: ${p.role || 'близкий'}`, через_дней: dd(p.birthday, today) })),
      ...dates.map((d, i) => ({ id: 'd' + i, label: d.title, kind: 'date', что: d.title, заметка: d.notes, через_дней: dd(d.date, today) })),
    ].filter((x) => x && x.через_дней <= 60).sort((a, b) => a.через_дней - b.через_дней);
    const contexts = [
      ...(trip ? [{ id: 'trip', label: `Поездка · ${trip.city}`, kind: 'trip', days: Math.max(0, Math.round((Date.parse(trip.start_date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 864e5)) }] : []),
      ...upcoming.slice(0, 6).map((u) => ({ id: u.id, label: u.label, kind: u.kind, days: u.через_дней })),
    ];
    const sl = stopList(c, people);
    const banned = [...fb.map((x) => x.title), ...exclude];
    const ck = cacheKey('idea2', id, c.updated_at, today, past.length, trips.length, fb.length);
    const keep = (arr) => arr.filter((x) => !banned.some((b) => similar(x.title, b)) && !past.some((r) => similar(x.title, r.summary)));
    if (count === 3 && !req.body?.force) {
      const hit = await getCache(auth, ck, 12 * 3600e3);
      if (hit?.ideas) { const k = keep(hit.ideas); if (k.length === hit.ideas.length) return res.status(200).json({ ...hit, cached: true }); }
    }
    const ctx = {
      сегодня: today,
      гость: { язык: c.language, vip: c.vip, основной_город: c.city, аллергии: c.allergies, диета: c.diet, здоровье: c.health, любит: c.likes, избегает: c.dislikes, еда: c.pref_food, спа: c.pref_spa, музыка_атмосфера: c.pref_music, транспорт: c.pref_transport, отели: c.pref_hotels, в_пути: c.travel_habits, заметки: c.concierge_notes },
      стоп_лист_всех: sl.all, близкие_с_аллергиями: sl.family,
      ближайшие_поводы: upcoming.map(({ id: i, что, через_дней, заметка }) => ({ id: i, что, через_дней, заметка })),
      ближайшая_поездка: trip ? { id: 'trip', город: trip.city, страна: trip.country, отель: trip.hotel, с: trip.start_date, по: trip.end_date, с_кем: trip.companions } : null,
      окружение: people.map((p) => ({ роль: p.role, аллергии: p.allergies, заметки: p.notes })),
      уже_создавали_запросы: past.map((r) => ({ что: r.summary, категория: r.category, итог: r.status })),
      гость_отклонил_похожее: banned.slice(0, 30),
    };
    const out = await askJSON(gfetch, auth, [FLASH, LITE],
      `Ты Jarvis — старший консьерж уровня Les Clefs d'Or. Предложи ровно ${count} ${count === 1 ? 'идею' : 'идеи'}, которые стоит предложить этому гостю САМИ, пока он не попросил.
Главное правило: каждая идея — услуга, которую выполняет консьерж руками и связями: бронь столика, улучшение приватного трансфера, доставка подарка, запись в спа/wellness, VIP-доступ, организация события. ЗАПРЕЩЕНЫ пассивные советы «сделай сам» (плейлист, книга, фильм, «прогуляйтесь», «отдохните») и общие слова.
География: идея привязана к городу — «основной_город» гостя или городу «ближайшей_поездки» (если идея про поездку). Учитывай реальную географию и сезон: никакого моря/пляжа в городе вдали от воды, никакого катка летом. Не называй вымышленных заведений.
Стоп-лист: строго соблюдай «стоп_лист_всех» (гость и близкие), «избегает» и диету. Не повторяй то, что есть в «уже_создавали_запросы» и «гость_отклонил_похожее» (и смысловые повторы тоже). Идеи разные по категориям.
Для каждой идеи выбери actionType: venue_search — нужно подобрать конкретное место (ужин, спа, активность); whatsapp_pitch — подарки, события и проактивные предложения: сначала предложить гостю (заполни pitch); trip_note — штрих к поездке (трансфер, отель): допустим ТОЛЬКО если есть «ближайшая_поездка», иначе не используй.
serviceTouch — «штрих консьержа»: одна конкретная деталь исполнения, которая удивит (например, поданное к столу любимое пиво гостя, музыка в авто под вкус гостя).
ref — id повода или поездки, к которому идея относится (или null). query — фраза для поиска мест на языке города, без имени гостя. guestNote — заметка в запрос с условиями исполнения.
Имя гостя не используй нигде; в pitch начинай с «{имя}». Не придумывай факты о госте, которых нет в данных.`,
      ctx, SCHEMA, { temperature: 0.7, budget: 0 });
    const guard = sl.all.map(norm).filter((w) => w.length >= 4);
    const safe = (x) => { const t = norm([x.title, x.why, x.serviceTouch, x.guestNote, x.query].join(' ')); return !guard.some((w) => t.includes(w)); };
    const refs = new Set(contexts.map((x) => x.id));
    const ideas = keep((out.ideas || []).filter((x) => x?.title && safe(x)).map((x) => {
      const category = IDEA_CATS.includes(x.category) ? x.category : 'Activities';
      let actionType = ACTIONS.includes(x.actionType) ? x.actionType : 'venue_search';
      if (actionType === 'trip_note' && !trip) actionType = 'venue_search';
      if (actionType === 'whatsapp_pitch' && !String(x.pitch || '').trim()) actionType = 'venue_search';
      const days = Number.isInteger(x.days) ? Math.max(0, Math.min(90, x.days)) : null;
      const title = String(x.title).slice(0, 110);
      return {
        title, why: String(x.why || '').slice(0, 260), category, actionType,
        serviceTouch: String(x.serviceTouch || '').slice(0, 200), pitch: actionType === 'whatsapp_pitch' ? String(x.pitch).slice(0, 500) : null,
        ref: refs.has(x.ref) ? x.ref : null, days, query: String(x.query || x.title).slice(0, 140),
        prefillRequest: { title, category: APP_CAT[category] || category, dueDate: days != null ? addDays(today, days) : null, guestNote: String(x.guestNote || '').slice(0, 300) },
      };
    })).slice(0, count);
    const result = { ideas, contexts, tripId: trip ? trip.id : null, at: Date.now() };
    if (count === 3) await setCache(auth, ck, result);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(e.message === 'rate_limited' ? 502 : 500).json({ error: String(e.message || e), tried: e.tried });
  }
}

// «✦ Запомнить»: что из выполненного запроса стоит сохранить в профиле гостя (вкусы, запреты, привычки).
// Имя гостя в ИИ не отправляется. Предложения — только факты, подтверждённые самим запросом.
import { gfetch, FLASH, LITE, cacheKey, getCache, setCache } from './_cache.js';
import { owner, rest, isId, norm, askJSON } from './_owner.js';

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      kind: { type: 'STRING', enum: ['like', 'dislike', 'allergy', 'diet', 'health', 'habit', 'note'] },
      text: { type: 'STRING', description: 'Коротко, по-русски, до 60 символов, без имени гостя' },
      why: { type: 'STRING', nullable: true, description: 'На чём основано — до 70 символов' },
    }, required: ['kind', 'text'] } },
  },
  required: ['items'],
};
const FIELD = { like: 'likes', dislike: 'dislikes', allergy: 'allergies', diet: 'diet', health: 'health' };

export default async function handler(req, res) {
  const auth = await owner(req, res); if (!auth) return;
  const id = String(req.body?.id || '');
  if (!isId(id)) return res.status(400).json({ error: 'bad_id' });
  try {
    const [r] = await rest(`requests?id=eq.${id}&select=*`, auth);
    if (!r) return res.status(404).json({ error: 'not_found' });
    const [c] = r.client_id ? await rest(`clients?id=eq.${r.client_id}&select=likes,dislikes,allergies,diet,health,travel_habits,concierge_notes,pref_food,pref_spa,pref_transport,pref_hotels`, auth) : [null];
    const [p] = r.partner_id ? await rest(`partners?id=eq.${r.partner_id}&select=name,type`, auth) : [null];
    const ck = cacheKey('mem', id, r.updated_at, c?.likes, c?.dislikes);
    if (!req.body?.force) { const hit = await getCache(auth, ck, 7 * 864e5); if (hit) return res.status(200).json({ ...hit, cached: true }); }
    const o = r.options || {};
    const chosen = o.chosen != null ? o.items?.[o.chosen] : null;
    const ctx = {
      запрос: { суть: r.summary, категория: r.category, итог: r.status, детали: r.clarifying_questions, исходное_сообщение: r.original_message, бюджет: r.budget_amount ? `${r.budget_amount} ${r.currency || ''}` : null },
      выбор_гостя: chosen ? { название: chosen.name, почему: chosen.why || chosen.description } : null,
      варианты_которые_не_выбрал: (o.items || []).filter((_, i) => i !== o.chosen).map((x) => x.name).slice(0, 4),
      партнёр: p && { тип: p.type },
      уже_в_профиле: c && { любит: c.likes, избегает: c.dislikes, аллергии: c.allergies, диета: c.diet, здоровье: c.health, привычки: c.travel_habits, заметки: c.concierge_notes, еда: c.pref_food, спа: c.pref_spa, транспорт: c.pref_transport, отели: c.pref_hotels },
    };
    const out = await askJSON(gfetch, auth, [LITE, FLASH],
      `Ты Jarvis — консьерж люксового сервиса. По итогам выполненного запроса предложи 0–5 фактов о госте, которые стоит запомнить для будущих запросов.
Правила: только то, что прямо следует из запроса, выбора гостя или его слов; ничего не выдумывай. Не повторяй то, что уже есть в профиле (даже другими словами).
like — что понравилось/выбрал (кухня, тип места, атмосфера); dislike — что отверг или явно не любит; allergy/diet/health — только если названо прямо; habit — привычки в поездках и сервисе (время, формат, как общаться); note — важный нюанс, не подходящий выше.
Формулируй коротко и обобщённо («тихие места с видом», «ужин не раньше 21:00»), а не «ресторан X». Если запомнить нечего, верни пустой список.`,
      ctx, SCHEMA, { temperature: 0.2 });
    const have = new Set([...(c?.likes || []), ...(c?.dislikes || []), ...(c?.allergies || []), ...(c?.diet || []), ...(c?.health || [])].map(norm));
    const seen = new Set();
    const items = (out.items || []).filter((x) => x?.text && x.kind).map((x) => ({ kind: x.kind, text: String(x.text).trim().slice(0, 80), why: x.why ? String(x.why).slice(0, 100) : null }))
      .filter((x) => { const k = norm(x.text); if (!k || have.has(k) || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 5);
    const result = { items, field: FIELD };
    await setCache(auth, ck, result);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(e.message === 'rate_limited' ? 502 : 500).json({ error: String(e.message || e), tried: e.tried });
  }
}

// «✦ Jarvis дополнит»: 2–4 неочевидных пункта чек-листа под конкретного гостя и запрос.
// Только для владельца; данные читаются с его токеном (RLS). Имя гостя в ИИ не отправляется.

const MODEL = 'gemini-2.5-flash';
const TZ = 'Europe/Paris';

async function rest(path, auth) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth } });
  if (!r.ok) throw new Error('db_' + r.status);
  return r.json();
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          t: { type: 'STRING', description: 'Пункт чек-листа, по-русски, до 70 символов, начинается с действия' },
          hint: { type: 'STRING', nullable: true, description: 'Почему это важно именно этому гостю — коротко' },
          section: { type: 'STRING', enum: ['urgent', 'prep', 'details', 'after'], description: 'urgent — критично и срочно (безопасность, сорвёт визит); prep — подготовка; details — детали впечатления; after — после визита' },
          prio: { type: 'STRING', enum: ['high', 'med', 'normal'] },
        },
        required: ['t', 'section', 'prio'],
      },
    },
  },
  required: ['items'],
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const auth = req.headers.authorization || '';
  const u = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth } });
  if (!u.ok) return res.status(401).json({ error: 'unauthorized' });
  const user = await u.json();
  const owner = (process.env.OWNER_EMAIL || '').toLowerCase();
  if (owner && (user.email || '').toLowerCase() !== owner) return res.status(401).json({ error: 'unauthorized' });
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'no_key' });
  const id = String(req.body?.id || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: 'bad_id' });

  try {
    const [r] = await rest(`requests?id=eq.${id}&select=*`, auth);
    if (!r) return res.status(404).json({ error: 'not_found' });
    const [c] = r.client_id ? await rest(`clients?id=eq.${r.client_id}&select=*`, auth) : [null];
    const people = c ? await rest(`people?client_id=eq.${c.id}&select=role,birthday,allergies,notes`, auth) : [];
    const trips = c ? await rest(`trips?client_id=eq.${c.id}&select=city,hotel,start_date,end_date,companions,flight_in,flight_in_at,flight_out,flight_out_at&order=start_date.desc&limit=5`, auth) : [];
    const [p] = r.partner_id ? await rest(`partners?id=eq.${r.partner_id}&select=name,type,city,terms,notes`, auth) : [null];
    const when = r.deadline ? new Date(r.deadline).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16) : null;

    const ctx = {
      запрос: { суть: r.summary, категория: r.category, когда: when, бюджет: r.budget_amount ? `${r.budget_amount} ${r.currency || ''}` : null, детали: r.clarifying_questions, исходное: r.original_message },
      партнёр: p && { тип: p.type, город: p.city, условия: p.terms, заметки: p.notes },
      гость: c && { язык: c.language, vip: c.vip, аллергии: c.allergies, диета: c.diet, здоровье: c.health, любит: c.likes, избегает: c.dislikes,
        еда: c.pref_food, спа: c.pref_spa, транспорт: c.pref_transport, отели: c.pref_hotels, в_пути: c.travel_habits, заметки: c.concierge_notes },
      окружение: people.map((x) => ({ роль: x.role, день_рождения: x.birthday?.slice(5), аллергии: x.allergies, заметки: x.notes })),
      поездки: trips,
      уже_в_чек_листе: (r.checklist?.items || []).map((i) => i.t),
    };

    const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `Ты Jarvis — старший консьерж люксового сервиса. Дополни чек-лист запроса 2–4 пунктами, о которых сам гость не подумал бы, а профессионал — подумал заранее.
Правила:
- Только то, чего ещё нет в «уже_в_чек_листе» (не перефразируй существующее).
- Строго из данных: вкусы, аллергии гостя и близких, привычки, дети, поездка, время суток, сезон, усталость после перелёта, условия партнёра. Ничего не выдумывай о госте.
- Каждый пункт — конкретное действие, коротко, по-русски. В hint — почему это важно именно этому гостю.
- Если добавить нечего по-настоящему ценного, верни пустой список. Лучше 2 точных пункта, чем 4 общих.` }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(ctx) }] }],
        generationConfig: { temperature: 0.4, responseMimeType: 'application/json', responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 512 } },
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!g.ok) return res.status(502).json({ error: g.status === 429 ? 'rate_limited' : 'gemini_error' });
    const data = await g.json();
    let out;
    try { out = JSON.parse(data?.candidates?.[0]?.content?.parts?.map((x) => x.text || '').join('') || ''); } catch { return res.status(502).json({ error: 'bad_json' }); }
    const items = (out.items || []).filter((x) => x && x.t).slice(0, 4).map((x) => ({
      t: String(x.t).slice(0, 120), hint: x.hint ? String(x.hint).slice(0, 200) : null,
      section: ['urgent', 'prep', 'details', 'after'].includes(x.section) ? x.section : 'details', prio: ['high', 'med', 'normal'].includes(x.prio) ? x.prio : 'med',
    }));
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

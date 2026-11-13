// Черновик плана для предложения Jarvis (Gemini). Только для владельца.
// Данные читаются с токеном владельца — база сама проверяет доступ (RLS).
// Имя гостя в ИИ не отправляется: только вкусы, ограничения и детали поездки.

const MODEL = 'gemini-2.5-flash';
const TZ = 'Europe/Paris';
const CATEGORIES = ['Spa & Wellness', 'Dining', 'Transport', 'Accommodation', 'Activities', 'Health & Fitness', 'Gifts & Events', 'Other'];

async function rest(path, auth, init = {}) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error('db_' + r.status);
  return r.status === 204 ? null : r.json();
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    tasks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          summary: { type: 'STRING', description: 'Что сделать, по-русски, коротко, до 80 символов' },
          category: { type: 'STRING', enum: CATEGORIES },
          when_local: { type: 'STRING', nullable: true, description: 'Дата и время по Парижу YYYY-MM-DDTHH:MM' },
          partner_id: { type: 'STRING', nullable: true, description: 'id партнёра из списка или null' },
          note: { type: 'STRING', description: 'Что учесть: аллергии, вкусы, детали — по-русски, коротко' },
        },
        required: ['summary', 'category', 'note'],
      },
    },
    warnings: {
      type: 'ARRAY',
      description: 'Что консьерж обязан знать: конфликты вкусов и аллергий между гостем и близкими, накладки по времени, сроки бронирования партнёров, стоп-лист. По-русски, каждая — одно предложение.',
      items: { type: 'OBJECT', properties: { text: { type: 'STRING' }, level: { type: 'STRING', enum: ['critical', 'important', 'info'] } }, required: ['text', 'level'] },
    },
    touches: { type: 'ARRAY', items: { type: 'STRING' }, description: '2–4 ультраперсональные детали, которые удивят гостя, строго из его данных. По-русски.' },
    message: { type: 'STRING', description: 'Короткое тёплое сообщение гостю на его языке. Обращение — {имя}.' },
    insight: { type: 'STRING', description: 'Одна фраза по-русски: на какие факты о госте опирался план' },
  },
  required: ['tasks', 'warnings', 'touches', 'message', 'insight'],
};

const GOAL = {
  pre_arrival: 'Гость скоро приезжает, под поездку ещё ничего не заказано. Составь 3–5 задач на первые дни: трансфер под рейс (если есть), то, что гость любит (спа, ресторан и т.п.), приятная деталь к заезду (цветы, которые любит, и т.п.). Расставь по времени разумно, с учётом прилёта.',
  close_date: 'Скоро важная дата (день рождения или годовщина). Составь 1–3 задачи: подарок или цветы с учётом вкусов, при необходимости — бронь ресторана или поздравление. Срок — за 1–2 дня до даты, доставка — в день даты утром.',
  reconnect: 'С VIP-гостем давно не было контакта. Предложи 1–2 задачи: связаться и предложить что-то полезное по его вкусам или под ближайший повод. Сообщение — главное: тёплое, ненавязчивое, с конкретным предложением.',
  transfer: 'Нужен трансфер под рейс. Одна задача с точным временем.',
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
    const [s] = await rest(`suggestions?id=eq.${id}&select=*`, auth);
    if (!s) return res.status(404).json({ error: 'not_found' });
    const [c] = s.client_id ? await rest(`clients?id=eq.${s.client_id}&select=*`, auth) : [null];
    const [t] = s.trip_id ? await rest(`trips?id=eq.${s.trip_id}&select=*`, auth) : [null];
    const people = c ? await rest(`people?client_id=eq.${c.id}&select=role,birthday,allergies,notes`, auth) : [];
    const past = c ? await rest(`requests?client_id=eq.${c.id}&select=summary,category,partner_id,status,deadline,clarifying_questions&order=created_at.desc&limit=25`, auth) : [];
    const cdates = c ? await rest(`client_dates?client_id=eq.${c.id}&select=title,date,notes`, auth) : [];
    const trips = c ? await rest(`trips?client_id=eq.${c.id}&select=id,city,country,hotel,start_date,end_date,companions,notes&order=start_date.desc&limit=10`, auth) : [];
    const statuses = await rest('statuses?select=key,label,kind', auth);
    const closed = new Set(statuses.filter((x) => x.kind !== 'active').map((x) => x.key));
    const city = t?.city || c?.city || '';
    let partners = await rest(`partners?select=id,name,type,city,rating,notes,terms&order=rating.desc.nullslast&limit=60`, auth);
    if (city) { const local = partners.filter((p) => (p.city || '').toLowerCase().includes(city.toLowerCase())); if (local.length) partners = local; }
    partners = partners.slice(0, 25);
    const pname = Object.fromEntries(partners.map((p) => [p.id, p.name]));

    const now = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' }).format(new Date());
    const ctx = {
      сейчас_по_Парижу: now,
      повод: { тип: s.kind, суть: s.reason, к_дате: s.due_at ? new Date(s.due_at).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16) : null },
      гость: c && {
        язык: c.language, vip: c.vip, город: c.city,
        аллергии: c.allergies, диета: c.diet, здоровье: c.health, любит: c.likes, избегает: c.dislikes,
        еда: c.pref_food, спа: c.pref_spa, транспорт: c.pref_transport, отели: c.pref_hotels, в_пути: c.travel_habits,
      },
      поездка: t && {
        город: t.city, страна: t.country, отель: t.hotel, заезд: t.start_date, выезд: t.end_date, с_кем: t.companions,
        прилёт: t.flight_in_at ? new Date(t.flight_in_at).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16) + (t.flight_in ? ' ' + t.flight_in : '') : null,
        вылет: t.flight_out_at ? new Date(t.flight_out_at).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16) + (t.flight_out ? ' ' + t.flight_out : '') : null,
      },
      заметки_консьержа: c?.concierge_notes || null,
      программы_лояльности: c?.loyalty || [],
      важные_даты: cdates.map((d) => ({ что: d.title, дата: d.date?.slice(5), заметка: d.notes })),
      окружение: people.map((p) => ({ роль: p.role, день_рождения: p.birthday?.slice(5), аллергии: p.allergies, заметки: p.notes })),
      другие_поездки: trips.filter((x) => x.id !== t?.id).map((x) => ({ город: x.city, отель: x.hotel, даты: [x.start_date, x.end_date], с_кем: x.companions, заметки: x.notes })),
      заметки_о_прошлых_поездках: c?.travel_history || [],
      уже_запланировано: past.filter((r) => !closed.has(r.status) && r.deadline && new Date(r.deadline) > new Date())
        .map((r) => ({ что: r.summary, когда: new Date(r.deadline).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16), категория: r.category })),
      прошлые_запросы: past.map((r) => ({ что: r.summary, категория: r.category, партнёр: r.partner_id ? pname[r.partner_id] || null : null, выполнен: closed.has(r.status), детали: r.clarifying_questions })),
      партнёры: partners.map((p) => ({ id: p.id, название: p.name, тип: p.type, город: p.city, оценка: p.rating, заметки: p.notes, условия: p.terms })),
    };

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `Ты Jarvis — старший консьерж люксового wellness-сервиса с 20-летним опытом. Твои гости очень обеспеченные и замечают каждую мелочь. ${GOAL[s.kind] || ''}

Думай как профессионал, прежде чем предлагать:
1. Изучи ВСЁ о госте: вкусы, «любит/избегает», аллергии, диету, здоровье, привычки в пути, программы лояльности, заметки консьержа, прошлые запросы и поездки, важные даты.
2. Изучи окружение: кто едет вместе («с_кем»), роли близких, их аллергии и заметки. Подарок, ужин, торт, цветы, спа могут коснуться и их.
3. Перекрёстная проверка — главное. Ищи конфликты и пиши их в warnings:
   - вкус гостя противоречит аллергии близкого (гость любит клубнику, а у сына аллергия на клубнику → в общем торте клубники нет, клубника — отдельно для гостя);
   - аллергия/диета гостя vs меню партнёра, масла в спа, цветы с запахом и т.п.;
   - «избегает» vs то, что обычно предлагают (лилии в букетах, шумные залы);
   - накладки с тем, что «уже_запланировано», с рейсами, со сменой часовых поясов и усталостью после перелёта;
   - сроки бронирования партнёров из их «условий» (бронь за 48 ч — значит, бронировать уже сегодня).
   level: critical — здоровье и аллергии, important — риск сорвать или расстроить, info — полезно знать.
4. Детали (touches): 2–4 ультраперсональных штриха строго из данных (любимые цветы в номер, место у окна, любимый десерт без аллергенов для всех). Ничего не выдумывай о госте — только факты из данных; если данных мало, честно скажи об этом в warnings (level info) и предложи, что уточнить.
5. Задачи: конкретные, со временем по Парижу (реалистично, в будущем), с партнёром из списка (его id), если подходит. В note — что учесть именно этому гостю и его близким.

Задачи, предупреждения и детали — по-русски. Сообщение гостю — на его языке (RU/EN/FR), 2–4 предложения, тепло и без навязчивости, без смайликов, обращение {имя}. В сообщении не упоминай чужие медицинские данные.` }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(ctx) }] }],
        generationConfig: { temperature: 0.35, responseMimeType: 'application/json', responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 3072 } },
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) return res.status(502).json({ error: r.status === 429 ? 'rate_limited' : 'gemini_error' });
    const data = await r.json();
    let out;
    try { out = JSON.parse(data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''); } catch { return res.status(502).json({ error: 'bad_json' }); }
    const ids = new Set(partners.map((p) => p.id));
    const payload = {
      tasks: (out.tasks || []).slice(0, 6).map((x) => ({
        summary: String(x.summary || '').slice(0, 160), category: CATEGORIES.includes(x.category) ? x.category : 'Other',
        when_local: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x.when_local || '') ? x.when_local.slice(0, 16) : null,
        partner_id: ids.has(x.partner_id) ? x.partner_id : null, note: String(x.note || '').slice(0, 300),
      })),
      warnings: (out.warnings || []).filter((w) => w && w.text).slice(0, 8).map((w) => ({ text: String(w.text).slice(0, 300), level: ['critical', 'important', 'info'].includes(w.level) ? w.level : 'info' }))
        .sort((a, b) => ['critical', 'important', 'info'].indexOf(a.level) - ['critical', 'important', 'info'].indexOf(b.level)),
      touches: (out.touches || []).filter((x) => typeof x === 'string').slice(0, 5).map((x) => x.slice(0, 200)),
      message: String(out.message || '').slice(0, 1200),
      insight: String(out.insight || '').slice(0, 300),
      source: 'ai', drafted_at: new Date().toISOString(),
    };
    await rest(`suggestions?id=eq.${id}`, auth, { method: 'PATCH', body: JSON.stringify({ payload }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ payload });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

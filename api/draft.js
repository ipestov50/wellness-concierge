import { gfetch, FLASH, LITE } from './_cache.js';
// Черновик плана для предложения Jarvis (Gemini). Только для владельца.
// Данные читаются с токеном владельца — база сама проверяет доступ (RLS).
// Имена гостя и близких в ИИ не отправляются: только роли, вкусы, ограничения и детали поездки.

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
      description: 'Конкретные шаги консьержа. Каждый — отдельное действие, без повторов.',
      items: {
        type: 'OBJECT',
        properties: {
          summary: { type: 'STRING', description: 'Действие с объектом, по-русски, до 70 символов: «Заказать букет нежных тюльпанов»' },
          category: { type: 'STRING', enum: CATEGORIES },
          when_local: { type: 'STRING', nullable: true, description: 'Дата и время по Парижу YYYY-MM-DDTHH:MM' },
          partner_id: { type: 'STRING', nullable: true, description: 'id партнёра из списка или null' },
          note: { type: 'STRING', description: 'Одна короткая деталь исполнения (до 90 символов), не повторяет summary' },
        },
        required: ['summary', 'category', 'note'],
      },
    },
    alerts: {
      type: 'ARRAY',
      description: 'До 3 пунктов: конфликт со стоп-листом/аллергией (stop) или каких данных не хватает для идеального исполнения (missing). Одно предложение каждый.',
      items: { type: 'OBJECT', properties: { text: { type: 'STRING' }, level: { type: 'STRING', enum: ['stop', 'missing'] } }, required: ['text', 'level'] },
    },
    concierge_tip: { type: 'STRING', description: 'Ровно один совет консьержу в 1–2 предложениях: тонкий VIP-штрих или чего не хватает в данных. Не пересказывает задачи.' },
    client_message_draft: { type: 'STRING', description: 'Готовое сообщение VIP-клиенту в WhatsApp на его языке, 2–3 предложения, обращение {имя}. Уточняет нюанс подарка или подтверждает детали. Не перечисляет задачи.' },
  },
  required: ['tasks', 'alerts', 'concierge_tip', 'client_message_draft'],
};

const GOAL = {
  pre_arrival: 'Гость скоро приезжает, под поездку ещё ничего не заказано. Составь 3–5 задач на первые дни: трансфер под рейс (если есть), то, что гость любит (спа, ресторан и т.п.), приятная деталь к заезду (цветы, которые любит, и т.п.). Расставь по времени разумно, с учётом прилёта.',
  close_date: 'Скоро важная дата. Составь 1–3 задачи для ПОЛУЧАТЕЛЯ повода (см. «получатель_повода»): подарок или цветы под его вкусы, при необходимости — бронь или поздравление. Заказ — за 1–2 дня до даты, доставка — в день даты утром.',
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
    const people = c ? await rest(`people?client_id=eq.${c.id}&select=id,name,role,birthday,allergies,notes`, auth) : [];
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
    // кто получатель повода: сам гость, близкий человек или памятная дата гостя (ключ «date:<вид>:<id>:<год>»)
    const [, rkind, rid] = String(s.key || '').match(/^date:(self|person|date):([0-9a-f-]{36})/) || [];
    const person = rkind === 'person' ? people.find((p) => p.id === rid) : null;
    const due = s.due_at ? new Date(s.due_at).toISOString().slice(0, 10) : null;
    // гость сам рядом с близким в эту дату? Только тогда его привычки и поездка имеют значение для повода
    const low = (v) => String(v || '').toLowerCase();
    const together = !person || trips.some((x) => due && x.start_date <= due && due <= (x.end_date || x.start_date)
      && [person.role, (person.name || '').split(/\s+/)[0]].filter(Boolean).some((w) => low(x.companions).includes(low(w))));
    const forOther = !!person && !together;
    const stop = {
      гость: [...(c?.allergies || []), ...(c?.diet || []), ...(c?.health || [])],
      ...(person ? { получатель: person.allergies || [] } : {}),
      близкие: people.filter((p) => p.id !== person?.id && (p.allergies || []).length).map((p) => ({ роль: p.role, аллергии: p.allergies })),
    };
    // имена в ИИ не уходят: в тексте повода заменяем их на «[имя]»
    const names = [c?.name, person?.name].flatMap((n) => String(n || '').replace(/\(.*?\)/g, ' ').split(/\s+/)).filter((n) => n.length >= 3);
    const scrub = (v) => names.reduce((acc, n) => acc.split(n).join('[имя]'), String(v || ''));
    const ctx = {
      сейчас_по_Парижу: now,
      повод: { тип: s.kind, суть: scrub(s.reason), к_дате: s.due_at ? new Date(s.due_at).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16) : null },
      получатель_повода: rkind === 'person' ? { кто: person ? `близкий клиента: ${person.role || 'роль не указана'}` : 'близкий клиента', аллергии: person?.allergies || [], что_известно: person?.notes || null, клиент_рядом_в_эту_дату: together }
        : rkind === 'date' ? { кто: 'памятная дата клиента', что: scrub(s.title.replace(/^\S+\s/, '')) } : rkind === 'self' ? { кто: 'сам VIP-клиент' } : null,
      стоп_лист: stop,
      vip_клиент: c && (forOther
        // повод для близкого, а клиента рядом нет: его личные вкусы и поездки не переносим на получателя
        ? { язык: c.language, vip: c.vip, город: c.city, избегает: c.dislikes }
        : {
          язык: c.language, vip: c.vip, город: c.city,
          любит: c.likes, избегает: c.dislikes,
          еда: c.pref_food, спа: c.pref_spa, транспорт: c.pref_transport, отели: c.pref_hotels, в_пути: c.travel_habits,
        }),
      поездка: !forOther && t && {
        город: t.city, страна: t.country, отель: t.hotel, заезд: t.start_date, выезд: t.end_date, с_кем: t.companions,
        прилёт: t.flight_in_at ? new Date(t.flight_in_at).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16) + (t.flight_in ? ' ' + t.flight_in : '') : null,
        вылет: t.flight_out_at ? new Date(t.flight_out_at).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16) + (t.flight_out ? ' ' + t.flight_out : '') : null,
      },
      заметки_консьержа: forOther ? null : c?.concierge_notes || null,
      программы_лояльности: forOther ? [] : c?.loyalty || [],
      важные_даты: cdates.map((d) => ({ что: d.title, дата: d.date?.slice(5), заметка: d.notes })),
      окружение: people.map((p) => ({ роль: p.role, день_рождения: p.birthday?.slice(5), аллергии: p.allergies, заметки: p.notes })),
      другие_поездки: forOther ? [] : trips.filter((x) => x.id !== t?.id).map((x) => ({ город: x.city, отель: x.hotel, даты: [x.start_date, x.end_date], с_кем: x.companions, заметки: x.notes })),
      заметки_о_прошлых_поездках: forOther ? [] : c?.travel_history || [],
      уже_запланировано: past.filter((r) => !closed.has(r.status) && r.deadline && new Date(r.deadline) > new Date())
        .map((r) => ({ что: r.summary, когда: new Date(r.deadline).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16), категория: r.category })),
      прошлые_запросы: past.map((r) => ({ что: r.summary, категория: r.category, партнёр: r.partner_id ? pname[r.partner_id] || null : null, выполнен: closed.has(r.status), детали: r.clarifying_questions })),
      партнёры: partners.map((p) => ({ id: p.id, название: p.name, тип: p.type, город: p.city, оценка: p.rating, заметки: p.notes, условия: p.terms })),
    };

    const r = await gfetch(auth, [FLASH, LITE], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `Ты Jarvis — старший консьерж люксового wellness-сервиса с 20-летним опытом. Твои клиенты очень обеспеченные и замечают каждую мелочь. ${GOAL[s.kind] || ''}

Правила — строго:
1. Получатель и клиент — разные люди. «vip_клиент» — тот, кто платит и кому пишет консьерж. «получатель_повода» — для кого повод (мама, сын, годовщина). Вкусы клиента (еда, напитки, отели, спа, перки его поездок) НЕ переносятся на получателя. Если «клиент_рядом_в_эту_дату» = false — не предлагай ничего из жизни клиента, только то, что подходит получателю. Если о вкусах получателя ничего не известно — выбирай классику и честно отметь это в alerts (missing).
2. Стоп-лист: «стоп_лист» обязателен для всех участников. Ни задача, ни подарок, ни блюдо не могут содержать запрещённого. Конфликт или риск — в alerts (stop).
3. Без повторов. tasks — только действия (что, когда, у какого партнёра). concierge_tip — одна мысль, которой нет в задачах. client_message_draft — сообщение клиенту, задачи не пересказывает. Одну и ту же идею не пиши дважды.
4. Задачи: 1–5, конкретные, со временем по Парижу (реалистично, в будущем), с партнёром из списка (его id), если подходит по типу и городу. Учитывай «уже_запланировано» и сроки бронирования из «условий» партнёров.
5. Ничего не выдумывай о людях — только факты из данных.

Задачи, alerts и совет — по-русски. Сообщение клиенту — на его языке (RU/EN/FR), 2–3 предложения, тепло и ненавязчиво, без смайликов, обращение {имя}. В сообщении не упоминай чужие медицинские данные.` }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(ctx) }] }],
        generationConfig: { temperature: 0.35, responseMimeType: 'application/json', responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 1024 } },
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) return res.status(502).json({ error: r.status === 429 ? 'rate_limited' : 'gemini_error' });
    const data = await r.json();
    let out;
    try { out = JSON.parse(data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''); } catch { return res.status(502).json({ error: 'bad_json' }); }
    const ids = new Set(partners.map((p) => p.id));
    const tasks = (out.tasks || []).slice(0, 5).map((x) => ({
      summary: String(x.summary || '').slice(0, 120), category: CATEGORIES.includes(x.category) ? x.category : 'Other',
      when_local: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x.when_local || '') ? x.when_local.slice(0, 16) : null,
      partner_id: ids.has(x.partner_id) ? x.partner_id : null, note: String(x.note || '').slice(0, 160),
    })).filter((x) => x.summary);
    const alerts = (out.alerts || []).filter((w) => w && w.text).slice(0, 3).map((w) => ({ text: String(w.text).slice(0, 220), level: w.level === 'stop' ? 'stop' : 'missing' }));
    // страховка: аллерген в самой задаче («торт с орехами» при аллергии на орехи) — поднимаем тревогу
    const banned = [...stop.гость, ...(stop.получатель || []), ...stop.близкие.flatMap((p) => p.аллергии)].map(low).filter((x) => x.length >= 4);
    for (const t2 of tasks) {
      const sum = low(t2.summary);
      const hit = banned.find((b) => { const stem = b.slice(0, Math.max(4, b.length - 2)); const i = sum.indexOf(stem); return i >= 0 && !/без\s*$/.test(sum.slice(Math.max(0, i - 5), i)); });
      if (hit && !alerts.some((a) => low(a.text).includes(hit))) alerts.unshift({ text: `Проверьте задачу «${t2.summary}»: в стоп-листе — ${hit}.`, level: 'stop' });
    }
    // совет не должен пересказывать задачу
    const words = (v) => new Set(low(v).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3));
    let tip = String(out.concierge_tip || '').slice(0, 280);
    const tw = words(tip);
    if (tw.size && tasks.some((t2) => { const sw = words(t2.summary); let n = 0; for (const w of sw) if (tw.has(w)) n++; return sw.size && n / sw.size > 0.7; })) tip = '';
    const payload = {
      tasks, alerts: alerts.slice(0, 3), concierge_tip: tip,
      client_message_draft: String(out.client_message_draft || '').slice(0, 900),
      recipient: person ? { role: person.role || null, together } : null,
      source: 'ai', drafted_at: new Date().toISOString(),
    };
    await rest(`suggestions?id=eq.${id}`, auth, { method: 'PATCH', body: JSON.stringify({ payload }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ payload });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

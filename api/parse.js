// Умное поле: разбирает текст консьержа в карточки запросов через Gemini.
// Ключ Gemini хранится только здесь (переменная окружения GEMINI_API_KEY в Vercel).
// Отвечает только залогиненному владельцу. Один вызов модели на запрос, без повторов.

import { cacheKey, getCache, setCache, gfetch, FLASH, LITE } from './_cache.js';

const TZ = 'Europe/Paris';
const CATEGORIES = ['Spa & Wellness', 'Dining', 'Transport', 'Accommodation', 'Activities', 'Health & Fitness', 'Gifts & Events', 'Other'];
const URGENCY = ['critical', 'high', 'normal', 'low'];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'RUB', 'AED'];

async function getUser(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth },
  });
  if (!r.ok) return null;
  const user = await r.json();
  const owner = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
  if (owner && (user.email || '').toLowerCase() !== owner) return null;
  return user;
}

// календарь на две недели вперёд, чтобы «пятница» и «завтра» считались без ошибок
function calendar() {
  const fmt = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const now = Date.now();
  const lines = [];
  for (let i = 0; i < 15; i++) {
    const d = new Date(now + i * 864e5);
    lines.push(`${iso.format(d)} — ${fmt.format(d).split(',')[0]}${i === 0 ? ' (сегодня)' : i === 1 ? ' (завтра)' : ''}`);
  }
  const time = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(now);
  return { lines: lines.join('\n'), time };
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    requests: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          guest_name: { type: 'STRING', nullable: true, description: 'Имя гостя точно как написано в тексте' },
          guest_language: { type: 'STRING', enum: ['RU', 'EN', 'FR'], nullable: true },
          category: { type: 'STRING', enum: CATEGORIES },
          urgency: { type: 'STRING', enum: URGENCY },
          deadline_iso: { type: 'STRING', nullable: true, description: 'Местное время Парижа в формате YYYY-MM-DDTHH:MM, без часового пояса. Если время не указано — T00:00' },
          summary: { type: 'STRING', description: 'Суть запроса по-русски, коротко, до 80 символов' },
          budget_amount: { type: 'NUMBER', nullable: true },
          currency: { type: 'STRING', enum: CURRENCIES, nullable: true },
          missing_questions: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Что важно уточнить у гостя, по-русски' },
          new_restrictions: {
            type: 'OBJECT',
            properties: {
              allergies: { type: 'ARRAY', items: { type: 'STRING' } },
              diet: { type: 'ARRAY', items: { type: 'STRING' } },
              health: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['allergies', 'diet', 'health'],
          },
          preferences: {
            type: 'OBJECT',
            properties: {
              food: { type: 'STRING', nullable: true },
              spa: { type: 'STRING', nullable: true },
              transport: { type: 'STRING', nullable: true },
              hotels: { type: 'STRING', nullable: true },
            },
          },
          likes: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Что гость любит (цветы, места, мелочи), по-русски, коротко' },
          dislikes: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Чего гость не любит или чего избегать, по-русски, коротко' },
          approval_needed: { type: 'BOOLEAN' },
          needs_review: { type: 'BOOLEAN' },
        },
        required: ['category', 'urgency', 'summary', 'missing_questions', 'new_restrictions', 'approval_needed', 'needs_review'],
      },
    },
  },
  required: ['requests'],
};

function systemPrompt() {
  const { lines, time } = calendar();
  return `Ты помощник wellness-консьержа. Разбери заметку консьержа в список запросов гостей.
Сейчас ${time} по Парижу. Календарь (часовой пояс Europe/Paris):
${lines}

Правила:
- Одна заметка может содержать несколько запросов (например, массаж и ужин) — верни отдельный элемент на каждый.
- guest_name: имя гостя ровно как в тексте, не переводи и не транслитерируй. Если имени нет — null.
- guest_language: язык гостя, если понятен по имени или тексту (RU, EN, FR), иначе null.
- deadline_iso: дата и время по Парижу, "YYYY-MM-DDTHH:MM". «Пятница», «завтра», «в выходные» считай по календарю выше; если день недели уже прошёл на этой неделе — бери ближайший будущий. Если есть и день недели, и число — доверяй числу. Нет срока — null. Время не указано — "T00:00".
- category: одна из списка. Массаж, спа, бассейн — "Spa & Wellness"; ресторан, ужин — "Dining"; трансфер, машина, такси, самолёт — "Transport"; отель, вилла — "Accommodation"; врач, тренер, анализы — "Health & Fitness"; цветы, подарок, праздник — "Gifts & Events".
- urgency: critical — «срочно» или срок меньше 6 часов; high — срок сегодня или завтра; low — «не срочно», срок дальше двух недель; иначе normal.
- summary: суть по-русски, коротко, без имени гостя и без даты.
- new_restrictions: только то, что сказано в тексте. allergies — на что аллергия (например "масло миндаля"); diet — веганство, без глютена, халяль и т.п.; health — беременность, травмы, давление и т.п. Пиши по-русски, коротко, строчными.
- preferences: устойчивые вкусы гостя, если они названы (еда, спа, транспорт, отели). Иначе null.
- likes / dislikes: устойчивые вкусы, которые не являются аллергией: «обожает пионы» → likes ["пионы"]; «не любит лилии», «без шумных мест» → dislikes ["лилии", "шумные места"]. Только то, что сказано.
- missing_questions: 0–3 коротких вопроса, без которых нельзя выполнить запрос.
- approval_needed: true, если нужно согласовать с гостем варианты или цену.
- needs_review: true, если текст неоднозначный и ты не уверен в разборе.
- budget_amount и currency — только если сумма названа.
Текст может быть на русском, английском или французском. Ответы — по-русски.`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await getUser(req).catch(() => null);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty' });
  if (text.length > 4000) return res.status(400).json({ error: 'too_long' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'no_key' });

  // тот же текст в тот же день (повтор после ошибки, двойное нажатие) — из кэша
  const auth = req.headers.authorization || '';
  const ck = cacheKey('parse', text, new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()));
  const hit = await getCache(auth, ck, 6 * 3600e3);
  if (hit?.requests) return res.status(200).json({ ...hit, cached: true });
  try {
    const r = await gfetch(auth, [LITE, FLASH], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt() }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) {
      const status = r.status === 429 ? 'rate_limited' : 'gemini_error';
      return res.status(502).json({ error: status, code: r.status });
    }
    const data = await r.json();
    const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return res.status(502).json({ error: 'bad_json' }); }
    const list = Array.isArray(parsed?.requests) ? parsed.requests : [];
    if (!list.length) return res.status(502).json({ error: 'empty_result' });

    // мягкая проверка ответа модели
    const clean = list.slice(0, 10).map((x) => ({
      guest_name: typeof x.guest_name === 'string' && x.guest_name.trim() ? x.guest_name.trim().slice(0, 120) : null,
      guest_language: ['RU', 'EN', 'FR'].includes(x.guest_language) ? x.guest_language : null,
      category: CATEGORIES.includes(x.category) ? x.category : 'Other',
      urgency: URGENCY.includes(x.urgency) ? x.urgency : 'normal',
      deadline_iso: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x.deadline_iso || '') ? x.deadline_iso.slice(0, 16) : null,
      summary: String(x.summary || '').trim().slice(0, 200) || text.slice(0, 80),
      budget_amount: Number.isFinite(+x.budget_amount) && x.budget_amount !== null ? +x.budget_amount : null,
      currency: CURRENCIES.includes(x.currency) ? x.currency : null,
      missing_questions: (x.missing_questions || []).filter((q) => typeof q === 'string').slice(0, 5),
      new_restrictions: {
        allergies: (x.new_restrictions?.allergies || []).filter((s) => typeof s === 'string'),
        diet: (x.new_restrictions?.diet || []).filter((s) => typeof s === 'string'),
        health: (x.new_restrictions?.health || []).filter((s) => typeof s === 'string'),
      },
      preferences: {
        food: x.preferences?.food || null, spa: x.preferences?.spa || null,
        transport: x.preferences?.transport || null, hotels: x.preferences?.hotels || null,
      },
      likes: (x.likes || []).filter((v) => typeof v === 'string').slice(0, 10),
      dislikes: (x.dislikes || []).filter((v) => typeof v === 'string').slice(0, 10),
      approval_needed: !!x.approval_needed,
      needs_review: !!x.needs_review,
    }));
    if (clean.length) await setCache(auth, ck, { requests: clean });
    return res.status(200).json({ requests: clean });
  } catch (e) {
    return res.status(504).json({ error: 'timeout' });
  }
}

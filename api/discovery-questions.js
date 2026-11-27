// «Вопросы для персонализации»: 5–7 вопросов, которые консьерж задаёт гостю вслух по ходу звонка.
// Только для владельца. Имя гостя в ИИ не отправляется.
import { gfetch, FLASH, LITE } from './_cache.js';
import { owner, askJSON } from './_owner.js';
import { parseTrip, dossier, list, str } from './_wellness.js';

const CATS = ['Ритм дня', 'Тело и спа', 'Питание и стоп-лист', 'Логистика и приватность', 'Атмосфера'];
const SCHEMA = {
  type: 'OBJECT',
  properties: { questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    category: { type: 'STRING', enum: CATS },
    text: { type: 'STRING', description: 'Вопрос по-русски так, как консьерж задаёт его вслух: тепло, коротко, без жаргона, до 140 символов' },
    chips: { type: 'ARRAY', items: { type: 'STRING' }, description: '2–3 коротких быстрых ответа по-русски (до 24 символов), подходящих именно к этому вопросу' },
  }, required: ['category', 'text', 'chips'] } } },
  required: ['questions'],
};

export default async function handler(req, res) {
  const auth = await owner(req, res); if (!auth) return;
  const b = req.body || {};
  const t = parseTrip(b);
  if (!t.destination) return res.status(400).json({ error: 'no_destination' });
  try {
    const d = await dossier(auth, b.client_id, list(b.allergies, 20));
    const answered = (Array.isArray(b.answered) ? b.answered : []).slice(0, 20).map((x) => ({ вопрос: str(x?.question, 160), ответ: str(x?.answer, 200) })).filter((x) => x.вопрос && x.ответ);
    const asked = list(b.asked, 20, 160);
    const ctx = {
      направление: t.destination, дней: t.durationDays, даты: t.from ? `${t.from}${t.to ? ' — ' + t.to : ''}` : null, цели: t.goals,
      стоп_лист_всех: d.stop, досье_гостя: d.profile || str(b.existingDossier, 600) || null, заметки_звонка: t.notes,
      уже_получены_ответы: answered, уже_задавали: asked,
    };
    const out = await askJSON(gfetch, auth, [FLASH, LITE],
      `Ты старший консьерж уровня Les Clefs d'Or и помогаешь вести живой звонок с гостем, который планирует wellness-поездку. Подготовь от 5 до 7 вопросов, чтобы построить для него идеальный маршрут.
Правила:
- Вопросы подстроены под «направление» (география, климат и сезон, особенности места), «дней», «цели» и то, что уже известно. Никакого шаблона «для любого города».
- НЕ спрашивай то, что уже есть в «досье_гостя», «заметки_звонка», «уже_получены_ответы» или «уже_задавали». Не повторяй стоп-лист — только уточняй новое.
- Вопрос звучит естественно вслух, один вопрос — одна мысль, без «и/или» цепочек.
- Разные категории: ритм дня, тело и спа, питание и стоп-лист, логистика и приватность, атмосфера. Если срок короткий, меньше про «неделя»; если длинный — про темп и отдых между активностями.
- chips — быстрые ответы, которые консьерж нажмёт на лету (например «Рано», «Поздно», «Не важно»).
- Не используй имя гостя и не придумывай фактов о нём.`,
      ctx, SCHEMA, { temperature: 0.6, budget: 0 });
    const seen = new Set(asked.map((x) => x.toLowerCase()));
    const questions = (out.questions || []).filter((q) => q?.text && !seen.has(String(q.text).toLowerCase())).slice(0, 7).map((q, i) => ({
      id: 'q' + Date.now().toString(36) + i, category: CATS.includes(q.category) ? q.category : 'Ритм дня', text: String(q.text).slice(0, 200),
      chips: list(q.chips, 3, 24),
    }));
    return res.status(200).json({ questions });
  } catch (e) {
    return res.status(e.message === 'rate_limited' ? 502 : 500).json({ error: String(e.message || e), tried: e.tried });
  }
}

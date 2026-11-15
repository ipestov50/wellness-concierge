import { CATEGORIES, URGENCY, CURRENCIES, LANGUAGES, PARTNER_TYPES, PARTNER_TYPE_LABEL } from './const.js';
import { esc, options, field, openModal, toParisInput, fromParisInput, toList, toast } from './ui.js';
import { state, byId, save, remove } from './data.js';
import { ui, render } from './router.js';
import { statusOptions, firstKey, statusOf } from './statuses.js';
import { deadlinePicker, bindDeadlinePicker } from './datepicker.js';
import { restrictionsBlock } from './restrictions.js';
export { restrictionsBlock };
import { birthdayField, birthdayValue } from './birthday.js';
import { checklistSection, bindChecklist, buildChecklist } from './checklist.js';
import { roadSlot, bindRoad } from './road.js';
import { ZONES, CITIZENSHIPS, lookupPlace, guestTimeLine } from './tz.js';

const input = (name, value, attrs = '') => `<input id="f-${name}" name="${name}" value="${esc(value)}" ${attrs}>`;
const area = (name, value, attrs = '') => `<textarea id="f-${name}" name="${name}" ${attrs}>${esc(value)}</textarea>`;
const select = (name, html, attrs = '') => `<select id="f-${name}" name="${name}" ${attrs}>${html}</select>`;
const check = (name, label, on) => `<label class="check"><input type="checkbox" id="f-${name}" name="${name}"${on ? ' checked' : ''}> ${esc(label)}</label>`;
const nul = (v) => (v === '' || v == null ? null : v);

// срочность — четыре цветные кнопки вместо списка
const urgencyPicker = (val) => `<div class="seg-pick" role="radiogroup">${URGENCY.map(([k, l]) =>
  `<label class="u-opt u-${k}"><input type="radio" name="urgency" value="${k}"${k === (val || 'normal') ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>`;

export function editRequest(id, presetClient, preset = {}) {
  const ex = id ? byId('requests', id) : null;
  if (ex && !ex.checklist) {
    // запрос создан до появления чек-листов — собираем его сейчас
    ex.checklist = buildChecklist(ex);
    save('requests', id, { checklist: ex.checklist }).catch(() => {});
  }
  const r = id ? byId('requests', id) : { client_id: presetClient || '', status: firstKey(), urgency: 'normal', category: 'Other', currency: 'EUR', ...preset };
  if (!r) return;
  const clients = [...state.clients].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((c) => [c.id, (c.vip ? '★ ' : '') + c.name]);
  const partners = [...state.partners].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((p) => [p.id, `${p.name} · ${PARTNER_TYPE_LABEL[p.type] || ''}${p.city ? ' · ' + p.city : ''}`]);
  const body =
    `<div id="req-restr">${restrictionsBlock(byId('clients', r.client_id))}</div>` +
    roadSlot(r) +
    checklistSection(r) +
    field('client_id', 'Гость', select('client_id', options([['__new', '+ Новый гость…'], ...clients], r.client_id, '— выберите —'))) +
    `<div class="newguest" id="newguest" hidden><div class="f2">${field('new_name', 'Имя нового гостя', input('new_name', '', 'type="text" autocomplete="off" placeholder="Как записать гостя"'))}` +
    field('new_language', 'Язык', select('new_language', options(LANGUAGES, 'RU'))) + '</div>' +
    field('new_allergies', 'Аллергии и ограничения (если знаете)', input('new_allergies', '', 'type="text" placeholder="через запятую"')) + '</div>' +
    field('summary', 'Что нужно', input('summary', r.summary, 'type="text" required placeholder="Массаж на двоих в пятницу вечером"')) +
    `<div class="f2">${field('category', 'Категория', select('category', options(Object.entries(CATEGORIES).map(([k, i]) => [k, i + ' ' + k]), r.category)))}` +
    field('status', 'Статус', select('status', options(statusOptions(), statusOf(r.status) ? r.status : firstKey()))) + '</div>' +
    field('urgency', 'Срочность', urgencyPicker(r.urgency)) +
    field('deadline', 'Срок · время Парижа', deadlinePicker(r.deadline) + '<small class="gtime" id="req-gtime"></small>') +
    `<div class="f2">${field('budget_amount', 'Бюджет', input('budget_amount', r.budget_amount, 'type="number" min="0" step="any" inputmode="decimal"'))}` +
    field('currency', 'Валюта', select('currency', options(CURRENCIES, r.currency || 'EUR'))) + '</div>' +
    field('partner_id', 'Партнёр', select('partner_id', options(partners, r.partner_id, '— не выбран —'))) +
    field('clarifying_questions', 'Что уточнить у гостя', area('clarifying_questions', r.clarifying_questions)) +
    field('original_message', 'Исходное сообщение гостя', area('original_message', r.original_message)) +
    `<div class="checks">${check('needs_approval', 'Нужно одобрение гостя', r.needs_approval)}` +
    `${check('needs_review', 'Нужна проверка', r.needs_review)}</div><small class="hint">«Нужна проверка» ставится сама, если бюджет больше 500.</small>`;
  const m = openModal({
    title: id ? 'Запрос' : 'Новый запрос',
    body,
    onSave: async (v) => {
      let clientId = nul(v.client_id);
      if (clientId === '__new') {
        const name = v.new_name.trim();
        const same = state.clients.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
        if (same) clientId = same.id;
        else {
          const created = await save('clients', null, { name, language: v.new_language, allergies: toList(v.new_allergies) });
          clientId = created.id;
          toast(`Гость «${name}» добавлен в клиенты`);
        }
      }
      await save('requests', id, {
        client_id: clientId, summary: v.summary.trim(), category: v.category, status: v.status, urgency: v.urgency,
        deadline: fromParisInput(v.deadline), budget_amount: v.budget_amount === '' ? null : Number(v.budget_amount),
        currency: v.budget_amount === '' ? nul(v.currency) : v.currency, partner_id: nul(v.partner_id),
        clarifying_questions: nul(v.clarifying_questions.trim()), original_message: nul(v.original_message.trim()),
        needs_approval: v.needs_approval, needs_review: v.needs_review,
      });
      toast(id ? 'Запрос сохранён' : 'Запрос создан');
    },
    onDelete: id ? async () => { await remove('requests', id); toast('Запрос удалён'); } : null,
  });
  bindDeadlinePicker(m.form);
  bindChecklist(m.form);
  bindRoad(m.form);
  // «для гостя — 22:00 по Москве»: обновляем при смене срока или гостя
  const gtime = () => {
    const el = m.form.querySelector('#req-gtime');
    const c = byId('clients', m.form.client_id.value);
    const v = m.form.querySelector('[name="deadline"]')?.value;
    el.innerHTML = c && v ? guestTimeLine(c, fromParisInput(v)) : '';
  };
  gtime();
  m.form.addEventListener('click', () => setTimeout(gtime, 0));
  m.form.client_id.addEventListener('change', gtime);
  m.form.client_id.addEventListener('change', (e) => {
    const isNew = e.target.value === '__new';
    m.form.querySelector('#req-restr').innerHTML = isNew ? '' : restrictionsBlock(byId('clients', e.target.value));
    m.form.querySelector('#newguest').hidden = !isNew;
    m.form.new_name.required = isNew;
    if (isNew) m.form.new_name.focus();
  });
}

export function editClient(id) {
  const c = id ? byId('clients', id) : { language: 'RU', vip: false };
  if (!c) return;
  const lines = (l) => (l || []).join('\n');
  const body =
    field('name', 'Имя', input('name', c.name, 'type="text" required autocomplete="off"')) +
    `<div class="f2">${field('language', 'Язык общения', select('language', options(LANGUAGES, c.language)))}` +
    field('city', 'Город', input('city', c.city, 'type="text"')) + '</div>' +
    `<div class="f2">${field('citizenship', 'Гражданство', select('citizenship', options(CITIZENSHIPS, c.citizenship, '— не указано —')), 'Нужно для брифинга «Перед вылетом»: визы, платежи')}` +
    field('home_tz', 'Часовой пояс дома', select('home_tz', options(ZONES.some(([z]) => z === c.home_tz) || !c.home_tz ? ZONES : [[c.home_tz, c.home_tz], ...ZONES], c.home_tz, '— определить по городу —')), 'Jarvis покажет время гостя и не даст написать ночью') + '</div>' +
    `<div class="f2">${field('phone', 'Телефон', input('phone', c.phone, 'type="tel" placeholder="+33 6 00 00 00 00" autocomplete="off"'))}` +
    field('email', 'Почта', input('email', c.email, 'type="email" placeholder="name@mail.com" autocapitalize="off" autocomplete="off"')) + '</div>' +
    `<div class="f2">${field('telegram', 'Telegram', input('telegram', c.telegram, 'type="text" placeholder="@username" autocapitalize="off"'))}` +
    field('last_contact', 'Последний контакт', input('last_contact', c.last_contact, 'type="date"')) + '</div>' +
    field('bd_day', 'День рождения', birthdayField(c.birthday), 'Год можно не указывать') +
    `<div class="checks">${check('vip', '★ VIP-клиент', c.vip)}</div>` +
    '<h3 class="form-sec warn">Аллергии и ограничения</h3>' +
    field('allergies', 'Аллергии', area('allergies', lines(c.allergies), 'rows="2"'), 'По одной на строку или через запятую') +
    `<div class="f2">${field('diet', 'Диета', area('diet', lines(c.diet), 'rows="2"'))}` +
    field('health', 'Здоровье', area('health', lines(c.health), 'rows="2"')) + '</div>' +
    '<h3 class="form-sec">Предпочтения</h3>' +
    `<div class="f2">${field('pref_food', 'Еда', area('pref_food', c.pref_food, 'rows="2"'))}` +
    field('pref_spa', 'Спа', area('pref_spa', c.pref_spa, 'rows="2"')) + '</div>' +
    `<div class="f2">${field('pref_transport', 'Транспорт', area('pref_transport', c.pref_transport, 'rows="2"'))}` +
    field('pref_hotels', 'Отели', area('pref_hotels', c.pref_hotels, 'rows="2"')) + '</div>' +
    '<h3 class="form-sec">Любит и избегает</h3>' +
    `<div class="f2">${field('likes', '❤️ Любит', area('likes', lines(c.likes), 'rows="2" placeholder="пионы, столик у окна"'))}` +
    field('dislikes', '🚫 Избегает', area('dislikes', lines(c.dislikes), 'rows="2" placeholder="лилии, шумные места"')) + '</div>' +
    '<h3 class="form-sec">В пути</h3>' +
    field('travel_habits', 'Привычки', area('travel_habits', c.travel_habits, 'rows="2" placeholder="Место у окна, 20° в номере, перьевые подушки"')) +
    field('loyalty', 'Программы лояльности', area('loyalty', lines(c.loyalty), 'rows="2" placeholder="Air France · Platinum"'), 'По одной на строку') +
    field('travel_history', 'Заметки о прошлых поездках', area('travel_history', lines(c.travel_history)), 'Новые поездки лучше добавлять во вкладке «Поездки»') +
    field('concierge_notes', 'Заметки консьержа', area('concierge_notes', c.concierge_notes));
  const mc = openModal({
    title: id ? 'Клиент' : 'Новый клиент',
    body,
    onSave: async (v) => {
      const row = await save('clients', id, {
        name: v.name.trim(), language: v.language, city: nul(v.city.trim()), citizenship: nul(v.citizenship), home_tz: nul(v.home_tz) || (await lookupPlace(v.city))?.tz || null, telegram: nul(v.telegram.trim()), phone: nul(v.phone.trim()), email: nul(v.email.trim()), birthday: birthdayValue(v), vip: v.vip,
        last_contact: nul(v.last_contact), allergies: toList(v.allergies), diet: toList(v.diet), health: toList(v.health),
        pref_food: nul(v.pref_food.trim()), pref_spa: nul(v.pref_spa.trim()), pref_transport: nul(v.pref_transport.trim()), pref_hotels: nul(v.pref_hotels.trim()),
        travel_history: v.travel_history.split('\n').map((s) => s.trim()).filter(Boolean),
        likes: toList(v.likes), dislikes: toList(v.dislikes), travel_habits: nul(v.travel_habits.trim()),
        loyalty: v.loyalty.split('\n').map((s) => s.trim()).filter(Boolean),
        concierge_notes: nul(v.concierge_notes.trim()),
      });
      ui.client = row.id;
      render();
      toast(id ? 'Клиент сохранён' : 'Клиент добавлен');
    },
    onDelete: id ? async () => {
      await remove('clients', id);
      ui.client = null; render();
      toast('Клиент удалён. Его запросы остались на доске без клиента.');
    } : null,
  });
  mc.form.city.addEventListener('change', async (e) => {
    if (mc.form.home_tz.value) return;
    const p = await lookupPlace(e.target.value);
    if (!p?.tz) return;
    if (![...mc.form.home_tz.options].some((o) => o.value === p.tz)) mc.form.home_tz.add(new Option(p.tz, p.tz));
    mc.form.home_tz.value = p.tz;
    mc.form.home_tz.classList.add('flash');
  });
}

export function editPartner(id) {
  const p = id ? byId('partners', id) : { type: 'spa' };
  if (!p) return;
  const body =
    field('name', 'Название', input('name', p.name, 'type="text" required')) +
    `<div class="f2">${field('type', 'Тип', select('type', options(PARTNER_TYPES, p.type)))}` +
    field('city', 'Город', input('city', p.city, 'type="text"')) + '</div>' +
    field('address', 'Адрес', input('address', p.address, 'type="text" placeholder="12 Rue de Rivoli, Paris"'), 'Нужен Jarvis, чтобы следить за пробками по пути к партнёру') +
    field('contact', 'Контакт', area('contact', p.contact, 'rows="2"'), 'Имя менеджера, телефон, почта, сайт') +
    `<div class="f2">${field('commission', 'Комиссия', input('commission', p.commission, 'type="text" placeholder="10%"'))}` +
    field('rating', 'Моя оценка', select('rating', options([[5, '★★★★★'], [4, '★★★★'], [3, '★★★'], [2, '★★'], [1, '★']], p.rating, '— без оценки —'))) + '</div>' +
    field('terms', 'Условия', area('terms', p.terms, 'rows="2"'), 'Как бронировать, сроки, отмена') +
    field('notes', 'Заметки', area('notes', p.notes));
  openModal({
    title: id ? 'Партнёр' : 'Новый партнёр',
    body,
    onSave: async (v) => {
      await save('partners', id, {
        name: v.name.trim(), type: v.type, city: nul(v.city.trim()), address: nul(v.address.trim()), contact: nul(v.contact.trim()),
        commission: nul(v.commission.trim()), rating: v.rating ? Number(v.rating) : null, terms: nul(v.terms.trim()), notes: nul(v.notes.trim()),
      });
      toast(id ? 'Партнёр сохранён' : 'Партнёр добавлен');
    },
    onDelete: id ? async () => { await remove('partners', id); toast('Партнёр удалён'); } : null,
  });
}

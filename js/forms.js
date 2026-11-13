import { CATEGORIES, URGENCY, CURRENCIES, LANGUAGES, PARTNER_TYPES, PARTNER_TYPE_LABEL } from './const.js';
import { esc, options, field, openModal, toParisInput, fromParisInput, toList, toast } from './ui.js';
import { state, byId, save, remove } from './data.js';
import { ui, render } from './router.js';
import { statusOptions, firstKey, statusOf } from './statuses.js';
import { deadlinePicker, bindDeadlinePicker } from './datepicker.js';

const input = (name, value, attrs = '') => `<input id="f-${name}" name="${name}" value="${esc(value)}" ${attrs}>`;
const area = (name, value, attrs = '') => `<textarea id="f-${name}" name="${name}" ${attrs}>${esc(value)}</textarea>`;
const select = (name, html, attrs = '') => `<select id="f-${name}" name="${name}" ${attrs}>${html}</select>`;
const check = (name, label, on) => `<label class="check"><input type="checkbox" id="f-${name}" name="${name}"${on ? ' checked' : ''}> ${esc(label)}</label>`;
const nul = (v) => (v === '' || v == null ? null : v);

// срочность — четыре цветные кнопки вместо списка
const urgencyPicker = (val) => `<div class="seg-pick" role="radiogroup">${URGENCY.map(([k, l]) =>
  `<label class="u-opt u-${k}"><input type="radio" name="urgency" value="${k}"${k === (val || 'normal') ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>`;

export function restrictionsBlock(c) {
  if (!c) return '';
  const groups = [['Аллергии', c.allergies], ['Диета', c.diet], ['Здоровье', c.health]].filter(([, l]) => l && l.length);
  if (!groups.length) return '';
  return `<div class="alert"><h4>⚠ Аллергии и ограничения</h4>${groups.map(([t, l]) =>
    `<div class="alert-row"><span>${t}:</span> ${l.map((x) => `<b class="chip">${esc(x)}</b>`).join(' ')}</div>`).join('')}</div>`;
}

export function editRequest(id, presetClient) {
  const r = id ? byId('requests', id) : { client_id: presetClient || '', status: firstKey(), urgency: 'normal', category: 'Other', currency: 'EUR' };
  if (!r) return;
  const clients = [...state.clients].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((c) => [c.id, (c.vip ? '★ ' : '') + c.name]);
  const partners = [...state.partners].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((p) => [p.id, `${p.name} · ${PARTNER_TYPE_LABEL[p.type] || ''}${p.city ? ' · ' + p.city : ''}`]);
  const body =
    `<div id="req-restr">${restrictionsBlock(byId('clients', r.client_id))}</div>` +
    field('client_id', 'Гость', select('client_id', options([['__new', '+ Новый гость…'], ...clients], r.client_id, '— выберите —'))) +
    `<div class="newguest" id="newguest" hidden><div class="f2">${field('new_name', 'Имя нового гостя', input('new_name', '', 'type="text" autocomplete="off" placeholder="Как записать гостя"'))}` +
    field('new_language', 'Язык', select('new_language', options(LANGUAGES, 'RU'))) + '</div>' +
    field('new_allergies', 'Аллергии и ограничения (если знаете)', input('new_allergies', '', 'type="text" placeholder="через запятую"')) + '</div>' +
    field('summary', 'Что нужно', input('summary', r.summary, 'type="text" required placeholder="Массаж на двоих в пятницу вечером"')) +
    `<div class="f2">${field('category', 'Категория', select('category', options(Object.entries(CATEGORIES).map(([k, i]) => [k, i + ' ' + k]), r.category)))}` +
    field('status', 'Статус', select('status', options(statusOptions(), statusOf(r.status) ? r.status : firstKey()))) + '</div>' +
    field('urgency', 'Срочность', urgencyPicker(r.urgency)) +
    field('deadline', 'Срок · время Парижа', deadlinePicker(r.deadline)) +
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
    `<div class="f2">${field('phone', 'Телефон', input('phone', c.phone, 'type="tel" placeholder="+33 6 00 00 00 00" autocomplete="off"'))}` +
    field('email', 'Почта', input('email', c.email, 'type="email" placeholder="name@mail.com" autocapitalize="off" autocomplete="off"')) + '</div>' +
    `<div class="f2">${field('telegram', 'Telegram', input('telegram', c.telegram, 'type="text" placeholder="@username" autocapitalize="off"'))}` +
    field('last_contact', 'Последний контакт', input('last_contact', c.last_contact, 'type="date"')) + '</div>' +
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
    field('travel_history', 'История поездок', area('travel_history', lines(c.travel_history)), 'По строке на поездку: место | когда | заметка') +
    field('concierge_notes', 'Заметки консьержа', area('concierge_notes', c.concierge_notes));
  openModal({
    title: id ? 'Клиент' : 'Новый клиент',
    body,
    onSave: async (v) => {
      const row = await save('clients', id, {
        name: v.name.trim(), language: v.language, city: nul(v.city.trim()), telegram: nul(v.telegram.trim()), phone: nul(v.phone.trim()), email: nul(v.email.trim()), vip: v.vip,
        last_contact: nul(v.last_contact), allergies: toList(v.allergies), diet: toList(v.diet), health: toList(v.health),
        pref_food: nul(v.pref_food.trim()), pref_spa: nul(v.pref_spa.trim()), pref_transport: nul(v.pref_transport.trim()), pref_hotels: nul(v.pref_hotels.trim()),
        travel_history: v.travel_history.split('\n').map((s) => s.trim()).filter(Boolean),
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
}

export function editPartner(id) {
  const p = id ? byId('partners', id) : { type: 'spa' };
  if (!p) return;
  const body =
    field('name', 'Название', input('name', p.name, 'type="text" required')) +
    `<div class="f2">${field('type', 'Тип', select('type', options(PARTNER_TYPES, p.type)))}` +
    field('city', 'Город', input('city', p.city, 'type="text"')) + '</div>' +
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
        name: v.name.trim(), type: v.type, city: nul(v.city.trim()), contact: nul(v.contact.trim()),
        commission: nul(v.commission.trim()), rating: v.rating ? Number(v.rating) : null, terms: nul(v.terms.trim()), notes: nul(v.notes.trim()),
      });
      toast(id ? 'Партнёр сохранён' : 'Партнёр добавлен');
    },
    onDelete: id ? async () => { await remove('partners', id); toast('Партнёр удалён'); } : null,
  });
}

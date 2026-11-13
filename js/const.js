export const STATUSES = [
  ['new', 'Новый'],
  ['clarifying', 'Уточняем'],
  ['sourcing', 'Подбор вариантов'],
  ['awaiting_approval', 'Ждёт одобрения гостя'],
  ['booking', 'Бронируем'],
  ['confirmed', 'Подтверждено'],
  ['done', 'Выполнено'],
  ['postponed', 'Отложен'],
  ['cancelled', 'Отменён'],
];
export const ARCHIVE = ['done', 'postponed', 'cancelled'];
export const STATUS_LABEL = Object.fromEntries(STATUSES);

export const CATEGORIES = {
  'Spa & Wellness': '💆',
  'Dining': '🍽️',
  'Transport': '🚗',
  'Accommodation': '🏨',
  'Activities': '🎟️',
  'Health & Fitness': '🏃',
  'Gifts & Events': '🎁',
  'Other': '📌',
};

export const URGENCY = [
  ['critical', 'Критично'],
  ['high', 'Высокая'],
  ['normal', 'Обычная'],
  ['low', 'Не срочно'],
];
export const URGENCY_LABEL = Object.fromEntries(URGENCY);

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'RUB', 'AED'];
export const LANGUAGES = ['RU', 'EN', 'FR'];

export const PARTNER_TYPES = [
  ['spa', 'Спа'],
  ['restaurant', 'Ресторан'],
  ['transfer', 'Трансфер'],
  ['hotel', 'Отель'],
  ['activities', 'Активности'],
  ['clinic', 'Врач / клиника'],
  ['gifts', 'Подарки'],
  ['other', 'Другое'],
];
export const PARTNER_TYPE_LABEL = Object.fromEntries(PARTNER_TYPES);

export const TZ = 'Europe/Paris';

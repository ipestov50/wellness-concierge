// Колонки доски (статусы) — настраиваются владельцем и хранятся в базе
import { state } from './data.js';

export const DEFAULT_STATUSES = [
  ['new', 'Новый', 'active'], ['clarifying', 'Уточняем', 'active'], ['sourcing', 'Подбор вариантов', 'active'],
  ['awaiting_approval', 'Ждёт одобрения гостя', 'active'], ['booking', 'Бронируем', 'active'],
  ['confirmed', 'Подтверждено', 'active'], ['done', 'Выполнено', 'done'],
  ['postponed', 'Отложен', 'archive'], ['cancelled', 'Отменён', 'archive'],
];
export const KINDS = [['active', 'Рабочая'], ['done', 'Выполнено (сюда уходит «Сделано»)'], ['archive', 'Архив (скрыта по умолчанию)']];

export const columns = () => [...state.statuses].sort((a, b) => a.position - b.position);
export const statusOf = (key) => state.statuses.find((s) => s.key === key) || null;
export const statusLabel = (key) => statusOf(key)?.label || 'Без колонки';
export const firstKey = () => columns().find((s) => s.kind === 'active')?.key || columns()[0]?.key || 'new';
// запрос в несуществующей колонке показываем в первой рабочей
export const effectiveStatus = (key) => (statusOf(key) ? key : firstKey());
export const isClosed = (key) => (statusOf(key)?.kind || 'active') !== 'active';
export const doneKey = () => columns().find((s) => s.kind === 'done')?.key || null;
export const statusOptions = () => columns().map((s) => [s.key, s.label]);

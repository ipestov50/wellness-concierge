// Единая точка смены статуса запроса. Все экраны (Мой день, Доска, Календарь, профиль гостя, меню карточки)
// меняют статус только здесь: мгновенно у себя, затем в базе; при ошибке — откат; везде одно и то же «Отменить».
import { byId, save, patchLocal } from './data.js';
import { doneKey, statusLabel, statusOf, firstKey } from './statuses.js';
import { toast } from './ui.js';

export async function setStatus(id, status, { position, undo = true, quiet = false } = {}) {
  const r = byId('requests', id);
  if (!r || (r.status === status && position == null)) return r;
  const before = { status: r.status, position: r.position };
  const patch = { status, ...(position != null ? { position } : {}) };
  patchLocal('requests', id, patch);           // все экраны обновились сразу
  try {
    await save('requests', id, patch);         // база и другие устройства (realtime)
  } catch (e) {
    patchLocal('requests', id, before);
    toast('Не сохранилось: ' + (e.message || e), 'err');
    throw e;
  }
  if (!quiet) toast(`${statusOf(status)?.kind === 'done' ? '✓ ' : ''}${statusLabel(status)}: ${r.summary}`, '',
    undo ? { label: 'Отменить', fn: () => setStatus(id, before.status, { position: before.position, undo: false, quiet: true }) } : null);
  return r;
}

export const isDone = (r) => statusOf(r?.status)?.kind === 'done';

// «Сделано» — переносит запрос в колонку «Выполнено»
export function completeRequest(id, opts) {
  const k = doneKey();
  if (!k) { toast('Нет колонки типа «Выполнено» — создайте её на доске', 'err'); return null; }
  return setStatus(id, k, opts);
}
// снять отметку — вернуть в первую рабочую колонку
export function reopenRequest(id, opts) { return setStatus(id, firstKey(), opts); }
export function toggleDone(id) { const r = byId('requests', id); return isDone(r) ? reopenRequest(id) : completeRequest(id); }

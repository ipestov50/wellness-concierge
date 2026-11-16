// Единая точка смены статуса запроса. Все экраны (Мой день, Доска, Календарь, профиль гостя, меню карточки)
// меняют статус только здесь: мгновенно у себя, затем в базе; при ошибке — откат; везде одно и то же «Отменить».
import { byId, save, patchLocal, updateMany } from './data.js';
import { doneKey, statusLabel, statusOf, firstKey, isClosed } from './statuses.js';
import { toast } from './ui.js';

export async function setStatus(id, status, { position, undo = true, quiet = false } = {}) {
  const r = byId('requests', id);
  if (!r || (r.status === status && position == null)) return r;
  const before = { status: r.status, position: r.position, archived_at: r.archived_at ?? null };
  // вернули из архива в работу — снимаем отметку архива
  const patch = { status, ...(position != null ? { position } : {}), ...(r.archived_at && statusOf(status)?.kind === 'active' ? { archived_at: null } : {}) };
  patchLocal('requests', id, patch);           // все экраны обновились сразу
  try {
    await save('requests', id, patch);         // база и другие устройства (realtime)
  } catch (e) {
    patchLocal('requests', id, before);
    toast('Не сохранилось: ' + (e.message || e), 'err');
    throw e;
  }
  // выполнили запрос — предлагаем запомнить новое о госте (кнопка, без расхода лимита)
  if (statusOf(status)?.kind === 'done' && r.client_id && !r.archived_at) import('./memory.js').then((m) => m.offerMemory(id)).catch(() => {});
  if (!quiet) toast(`${statusOf(status)?.kind === 'done' ? '✓ ' : ''}${statusLabel(status)}: ${r.summary}`, '',
    undo ? { label: 'Отменить', fn: () => setStatus(id, before.status, { position: before.position, undo: false, quiet: true }).then(() => { if (before.archived_at) archiveRequests([id], { quiet: true }); }) } : null);
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

// ---------- архив: выполненное уходит с доски, но остаётся историей гостя ----------
export async function archiveRequests(ids, { quiet = false } = {}) {
  const rows = ids.map((id) => byId('requests', id)).filter((r) => r && !r.archived_at && isClosed(r.status));
  if (!rows.length) return 0;
  const at = new Date().toISOString();
  rows.forEach((r) => patchLocal('requests', r.id, { archived_at: at }));
  try { await updateMany('requests', rows.map((r) => r.id), { archived_at: at }); }
  catch (e) { rows.forEach((r) => patchLocal('requests', r.id, { archived_at: null })); toast('Не сохранилось: ' + (e.message || e), 'err'); throw e; }
  if (!quiet) toast(`🗄 В архиве: ${rows.length}`, '', { label: 'Отменить', fn: () => unarchiveRequests(rows.map((r) => r.id), { quiet: true }) });
  return rows.length;
}
export async function unarchiveRequests(ids, { quiet = false } = {}) {
  const rows = ids.map((id) => byId('requests', id)).filter((r) => r?.archived_at);
  if (!rows.length) return 0;
  const before = rows.map((r) => [r.id, r.archived_at]);
  rows.forEach((r) => patchLocal('requests', r.id, { archived_at: null }));
  try { await updateMany('requests', rows.map((r) => r.id), { archived_at: null }); }
  catch (e) { before.forEach(([id, at]) => patchLocal('requests', id, { archived_at: at })); toast('Не сохранилось: ' + (e.message || e), 'err'); throw e; }
  if (!quiet) toast(`Возвращено на доску: ${rows.length}`);
  return rows.length;
}

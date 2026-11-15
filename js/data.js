import { getSupabase } from './supabase.js';

export const state = { clients: [], requests: [], partners: [], statuses: [], trips: [], people: [], client_dates: [], suggestions: [], day_items: [], loaded: false };
const TABLES = ['clients', 'requests', 'partners', 'statuses', 'trips', 'people', 'client_dates', 'suggestions', 'day_items'];
const listeners = new Set();
let sb, channel;

export const onChange = (fn) => listeners.add(fn);
// версия данных: растёт при любом изменении — по ней кэшируются план дня и индексы
let version = 0;
export const dataVersion = () => version;
// перерисовка не чаще одного раза за кадр, сколько бы событий ни пришло
let queued = false;
const emit = () => {
  version++;
  if (queued) return;
  queued = true;
  (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout)(() => { queued = false; listeners.forEach((fn) => fn()); });
};

// поиск по id через индекс (Map), а не перебором — пересобирается только после изменений
const idx = {};
export const byId = (table, id) => {
  if (!id) return null;
  let m = idx[table];
  if (!m || m.v !== version || m.list !== state[table]) {
    m = idx[table] = { v: version, list: state[table], map: new Map(state[table].map((x) => [x.id, x])) };
  }
  return m.map.get(id) || null;
};

function upsertLocal(table, row) {
  const list = state[table];
  const i = list.findIndex((x) => x.id === row.id);
  if (i >= 0) list[i] = row; else list.push(row);
  version++;
}
function removeLocal(table, id) {
  state[table] = state[table].filter((x) => x.id !== id);
  version++;
}

// Загрузка всех таблиц: независимо друг от друга. Без клиентов/запросов/колонок работать нельзя — это ошибка;
// сбой второстепенной таблицы (поездки, подсказки…) оставляет прежние данные и отмечается в state.partial.
const CRITICAL = new Set(['clients', 'requests', 'statuses']);
let loading = null;
export function loadAll() {
  if (!loading) loading = doLoad().finally(() => { loading = null; });
  return loading;
}
async function doLoad() {
  sb = await getSupabase();
  const results = await Promise.allSettled(TABLES.map((t) => sb.from(t).select('*')));
  const failed = [];
  results.forEach((r, i) => {
    const t = TABLES[i];
    const err = r.status === 'rejected' ? r.reason : r.value.error;
    if (err) { if (CRITICAL.has(t)) throw err; failed.push(t); return; }
    state[t] = r.value.data;
  });
  state.partial = failed;
  if (!state.statuses.length) await seedStatuses();
  state.loaded = true;
  lastLoad = Date.now();
  emit();
}

export async function startRealtime() {
  sb = await getSupabase();
  if (channel) await sb.removeChannel(channel);
  channel = sb.channel('db-changes');
  for (const table of TABLES) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => {
      if (p.eventType === 'DELETE') removeLocal(table, p.old.id);
      else upsertLocal(table, p.new);
      emit();
    });
  }
  let first = true;
  channel.subscribe((status) => {
    // после разрыва связи перечитываем всё, чтобы ничего не пропустить (первая подписка — сразу после загрузки, не нужно)
    if (status !== 'SUBSCRIBED') return;
    if (first) { first = false; return; }
    if (state.loaded) loadAll().catch(() => {});
  });
}

// Когда вкладка снова видна (телефон проснулся) — освежаем данные
let lastLoad = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.loaded && Date.now() - lastLoad > 60e3) loadAll().catch(() => {});
});

// мгновенное локальное изменение (до ответа сервера) — через слой данных, чтобы все экраны и кэши увидели его сразу
export function patchLocal(table, id, patch) {
  const row = state[table].find((x) => x.id === id);
  if (!row) return null;
  Object.assign(row, patch);
  emit();
  return row;
}

export async function save(table, id, data) {
  // новый запрос сразу получает продуманный чек-лист под свой тип
  if (table === 'requests' && !id && data.checklist === undefined) {
    try { const { buildChecklist } = await import('./checklist.js'); data = { ...data, checklist: buildChecklist(data) }; } catch {}
  }
  const q = id ? sb.from(table).update(data).eq('id', id) : sb.from(table).insert(data);
  const { data: row, error } = await q.select().single();
  if (error) throw error;
  upsertLocal(table, row);
  emit();
  return row;
}

export async function remove(table, id) {
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) throw error;
  removeLocal(table, id);
  emit();
}

export function stopRealtime() {
  if (sb && channel) sb.removeChannel(channel);
  channel = null;
  TABLES.forEach((t) => (state[t] = []));
  state.loaded = false;
}

// стандартные колонки для нового аккаунта
async function seedStatuses() {
  const { DEFAULT_STATUSES } = await import('./statuses.js');
  const rows = DEFAULT_STATUSES.map(([key, label, kind], i) => ({ key, label, kind, position: i + 1 }));
  const { data, error } = await sb.from('statuses').upsert(rows, { onConflict: 'owner_id,key', ignoreDuplicates: true }).select();
  if (!error && data?.length) state.statuses = data;
  else { const r = await sb.from('statuses').select('*'); if (!r.error) state.statuses = r.data; }
}

// изменить сразу много строк (например, перенести все карточки из колонки)
export async function updateWhere(table, column, value, data) {
  const { error } = await sb.from(table).update(data).eq(column, value);
  if (error) throw error;
  state[table].forEach((row) => { if (row[column] === value) Object.assign(row, data); });
  emit();
}

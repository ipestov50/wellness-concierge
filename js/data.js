import { getSupabase } from './supabase.js';

export const state = { clients: [], requests: [], partners: [], statuses: [], loaded: false };
const TABLES = ['clients', 'requests', 'partners', 'statuses'];
const listeners = new Set();
let sb, channel;

export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

export const byId = (table, id) => state[table].find((x) => x.id === id) || null;

function upsertLocal(table, row) {
  const list = state[table];
  const i = list.findIndex((x) => x.id === row.id);
  if (i >= 0) list[i] = row; else list.push(row);
}
function removeLocal(table, id) {
  state[table] = state[table].filter((x) => x.id !== id);
}

export async function loadAll() {
  sb = await getSupabase();
  const results = await Promise.all(TABLES.map((t) => sb.from(t).select('*')));
  results.forEach((r, i) => { if (r.error) throw r.error; state[TABLES[i]] = r.data; });
  if (!state.statuses.length) await seedStatuses();
  state.loaded = true;
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
  channel.subscribe((status) => {
    // после разрыва связи перечитываем всё, чтобы ничего не пропустить
    if (status === 'SUBSCRIBED' && state.loaded) loadAll().catch(() => {});
  });
}

// Когда вкладка снова видна (телефон проснулся) — освежаем данные
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.loaded) loadAll().catch(() => {});
});

export async function save(table, id, data) {
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

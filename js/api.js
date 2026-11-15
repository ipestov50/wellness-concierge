// Единая точка для вызовов /api: токен владельца, отмена (AbortController), понятные ошибки.
// Все внешние сервисы (Gemini, погода, курсы, TomTom) — только через сервер; ключей в браузере нет.
import { getSupabase } from './supabase.js';

export const isAbort = (e) => e?.name === 'AbortError';

export async function api(path, body, { signal } = {}) {
  const sb = await getSupabase();
  const token = (await sb.auth.getSession()).data.session?.access_token;
  const r = await fetch('/api/' + path, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body || {}),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(out.error || 'http_' + r.status); e.status = r.status; throw e; }
  return out;
}

// «Область» запросов: новый запрос в той же области отменяет предыдущий (быстрое переключение гостей)
const scopes = new Map();
export function scope(name) {
  scopes.get(name)?.abort();
  const c = new AbortController();
  scopes.set(name, c);
  return c.signal;
}
export const scopeSignal = (name) => scopes.get(name)?.signal;
export const abortScope = (name) => { scopes.get(name)?.abort(); scopes.delete(name); };

// Кэш живых виджетов в памяти вкладки: повторное открытие не тратит лимиты внешних API.
// Погода/курсы/праздники — 15 мин, дорога (пробки) — 4 мин. force — обновить вручную.
const cache = new Map();
export const TTL = { weather: 15 * 60e3, road: 4 * 60e3 };
export async function cached(key, ttl, fn, { force = false } = {}) {
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < ttl) return { value: await hit.value, at: hit.at, fromCache: true };
  const at = Date.now();
  const value = fn();
  cache.set(key, { at, value });
  try { return { value: await value, at, fromCache: false }; }
  catch (e) { if (cache.get(key)?.value === value) cache.delete(key); throw e; } // ошибки не кэшируем
}
export const clearCache = () => cache.clear();
// «обновлено 3 мин назад»
export function agoLabel(at) {
  const m = Math.floor((Date.now() - at) / 60e3);
  return m < 1 ? 'обновлено только что' : `обновлено ${m} мин назад`;
}

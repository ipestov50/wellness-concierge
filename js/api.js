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

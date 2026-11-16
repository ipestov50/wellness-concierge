// Общий кэш ответов Jarvis (таблица search_cache, RLS: только владелец) — повторы не тратят лимит Gemini.
// Файл начинается с «_» — Vercel не делает из него отдельный адрес /api.
import { createHash } from 'node:crypto';

const base = () => `${process.env.SUPABASE_URL}/rest/v1/search_cache`;
const headers = (auth) => ({ apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth, 'Content-Type': 'application/json' });
export const cacheKey = (prefix, ...parts) => `${prefix}|${createHash('sha1').update(JSON.stringify(parts)).digest('hex')}`;

export async function getCache(auth, key, ttlMs) {
  try {
    const since = new Date(Date.now() - ttlMs).toISOString();
    const r = await fetch(`${base()}?key=eq.${encodeURIComponent(key)}&created_at=gt.${since}&select=result&limit=1`, { headers: headers(auth), signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const [row] = await r.json();
    return row?.result ?? null;
  } catch { return null; }
}

export async function setCache(auth, key, result) {
  try {
    // изредка подчищаем записи старше 30 дней (самый долгий срок жизни кэша) — таблица не растёт бесконечно
    if (Math.random() < 0.05) fetch(`${base()}?created_at=lt.${new Date(Date.now() - 30 * 864e5).toISOString()}`, { method: 'DELETE', headers: headers(auth), signal: AbortSignal.timeout(4000) }).catch(() => {});
    await fetch(`${base()}?on_conflict=owner_id,key`, {
      method: 'POST', headers: { ...headers(auth), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key, result, created_at: new Date().toISOString() }), signal: AbortSignal.timeout(4000),
    });
  } catch {}
}

// Счётчик обращений за день (день — по времени сброса лимита Gemini, Тихоокеанское время)
export const usageDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
export function bump(auth, field) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/bump_usage`, { method: 'POST', headers: headers(auth), body: JSON.stringify({ day: usageDay(), field }), signal: AbortSignal.timeout(4000) }).catch(() => {});
}

// Запрос к Gemini с учётом в счётчике: модели пробуются по очереди (лёгкая → основная или наоборот), пока одна не ответит
export const FLASH = 'gemini-2.5-flash';
export const LITE = 'gemini-3.5-flash-lite';
export async function gfetch(auth, models, init) {
  let r;
  const tried = []; // что пробовали и чем ответило — видно в ответе функции при сбое
  for (const m of [].concat(models)) {
    const counted = bump(auth, m === LITE ? 'lite' : 'flash');
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, init);
    await counted;
    r.tried = tried;
    if (r.ok) return r;
    let why = '';
    try { why = (JSON.parse(await r.clone().text())?.error?.message || '').slice(0, 160); } catch {}
    tried.push(`${m === LITE ? 'lite' : 'flash'}:${r.status}${why ? ' ' + why : ''}`);
  }
  return r;
}

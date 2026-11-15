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
    await fetch(`${base()}?on_conflict=owner_id,key`, {
      method: 'POST', headers: { ...headers(auth), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key, result, created_at: new Date().toISOString() }), signal: AbortSignal.timeout(4000),
    });
  } catch {}
}

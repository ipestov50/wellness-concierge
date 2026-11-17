// «Истории» гостя: свежие новости его города (иначе — страны) из NewsAPI.ai (Event Registry).
// Только для владельца. Ключ NEWSAPI_AI_KEY — лишь на сервере. Ответ кэшируется на час по паре город+страна,
// так что гости из одного города делят один запрос к API. Имена гостей наружу не уходят — только город и страна.
import { getCache, setCache, cacheKey } from './_cache.js';

const TTL = 60 * 60e3;
const ER = 'https://eventregistry.org/api/v1/article/getArticles';
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const countryName = (cc) => { try { return cc ? new Intl.DisplayNames(['en'], { type: 'region' }).of(cc.toUpperCase()) : ''; } catch { return ''; } };
const normTitle = (t) => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80);
const BAIT = /(шок|вы не поверите|you won'?t believe|horoscope|гороскоп|\bsponsored\b|promo code|промокод|casino|казино|ставки на спорт)/i;

async function search(keyword, signal) {
  const since = new Date(Date.now() - 48 * 36e5).toISOString().slice(0, 10);
  const r = await fetch(ER, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'getArticles', apiKey: process.env.NEWSAPI_AI_KEY,
      keyword, keywordLoc: 'title', lang: ['rus', 'eng'], dataType: ['news'],
      dateStart: since, isDuplicateFilter: 'skipDuplicates',
      resultType: 'articles', articlesSortBy: 'date', articlesCount: 12, articlesPage: 1,
      includeArticleImage: true, includeArticleBody: true, articleBodyLen: 400,
    }),
  });
  if (r.status === 429 || r.status === 402) throw Object.assign(new Error('rate_limited'), { soft: true });
  if (!r.ok) throw Object.assign(new Error('news_' + r.status), { soft: true });
  const data = await r.json();
  if (data?.error) throw Object.assign(new Error('news_error'), { soft: true });
  return data?.articles?.results || [];
}

function normalize(list, scope, seen) {
  const out = [];
  for (const a of list) {
    const title = clean(a.title, 200);
    if (!title || title.length < 24 || BAIT.test(title) || !a.url) continue;
    const k = normTitle(title);
    if (seen.has(k)) continue;
    seen.add(k);
    const body = clean(a.body, 400);
    out.push({
      id: String(a.uri || a.url).slice(0, 80), title,
      summary: body.length > 160 ? body.slice(0, 157).replace(/\s+\S*$/, '') + '…' : body,
      source: clean(a.source?.title, 60), publishedAt: a.dateTimePub || a.dateTime || null,
      imageUrl: /^https:\/\//.test(a.image || '') ? a.image : null, url: a.url, scope,
    });
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, max-age=600');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const auth = req.headers.authorization || '';
  const u = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth } });
  if (!u.ok) return res.status(401).json({ error: 'unauthorized' });
  const who = (process.env.OWNER_EMAIL || '').toLowerCase();
  if (who && ((await u.json()).email || '').toLowerCase() !== who) return res.status(401).json({ error: 'unauthorized' });
  // без ключа — тихо пусто: кольца на аватарах просто не появятся
  if (!process.env.NEWSAPI_AI_KEY) return res.json({ stories: [], reason: 'no_key' });

  const city = clean(req.body?.city, 60);
  const cc = /^[A-Za-z]{2}$/.test(req.body?.country || '') ? req.body.country.toUpperCase() : '';
  const country = countryName(cc);
  if (!city && !country) return res.json({ stories: [] });

  const key = cacheKey('stories', city.toLowerCase(), cc);
  const hit = await getCache(auth, key, TTL);
  if (hit) return res.json({ ...hit, cached: true });

  const signal = AbortSignal.timeout(12000);
  const seen = new Set();
  let stories = [];
  try {
    if (city) stories = normalize(await search(city, signal), 'city', seen).slice(0, 5);
    if (stories.length < 2 && country) stories = stories.concat(normalize(await search(country, signal), 'country', seen)).slice(0, 5);
  } catch (e) {
    // лимит или сбой API — интерфейс не ломается, просто нет историй (и не кэшируем пустоту)
    return res.json({ stories, reason: e.soft ? e.message : 'news_failed' });
  }
  const result = { stories, city, country, at: new Date().toISOString() };
  await setCache(auth, key, result);
  res.json(result);
}

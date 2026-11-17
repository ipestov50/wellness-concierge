// «Истории» гостя: полезные консьержу новости его города (иначе — страны) из NewsAPI.ai (Event Registry).
// Только для владельца. Ключ NEWSAPI_AI_KEY — лишь на сервере. Набор новостей кэшируется на час по паре город+страна,
// гости из одного города делят один запрос к API. Наружу уходят только город и страна;
// интересы гостя («Любит», предпочтения) используются лишь здесь, для сортировки, и в NewsAPI.ai не передаются.
import { getCache, setCache, cacheKey } from './_cache.js';

const TTL = 60 * 60e3;
const ER = 'https://eventregistry.org/api/v1/article/getArticles';
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const countryName = (cc) => { try { return cc ? new Intl.DisplayNames(['en'], { type: 'region' }).of(cc.toUpperCase()) : ''; } catch { return ''; } };

// шум: криминал, политика, болезни, кликбейт — дублирует фильтр категорий API на случай неточной разметки
const NOISE = new RegExp([
  'убий', 'убит', 'арест', 'задержан', 'приговор', 'суд ', 'теракт', 'взрыв', 'стрельб', 'погиб', 'скончал', 'ранен',
  'выбор', 'парламент', 'депутат', 'министр', 'санкц', 'войн', 'ракет', 'обстрел', 'протест', 'митинг',
  'вирус', 'эпидеми', 'заболева', 'онколог', 'шок', 'гороскоп', 'казино', 'промокод', 'ставки на',
  '\\bmurder', '\\barrest', '\\bpolice\\b', '\\bcourt\\b', 'sentenced', 'shooting', 'terror', '\\bkilled\\b', '\\bdied\\b',
  'election', 'parliament', '\\bcouncil\\b', 'городск[а-я]* (совет|дум)', '\\bminister', 'sanction', '\\bwar\\b', 'missile', 'protest', 'outbreak', 'cancer', 'disease',
  'horoscope', 'casino', 'promo code', 'sponsored', "you won'?t believe",
].join('|'), 'i');

// четыре корзины консьержа: в порядке важности (логистика — это предупреждения)
const BUCKETS = [
  ['logistics', /аэропорт|авиарейс|рейс[а-я]*\b|задержк|отмен[а-я]* (рейс|поезд)|забастов|стачк|перекры|пробк|ремонт дорог|штормов|метел|снегопад|ураган|наводнен|гололёд|гололед|жар[аы]\b|предупрежден|поезд|электричк|метро|airport|flight|delay|strike|walkout|road closure|closed road|roadworks|storm|weather warning|heavy snow|flood|heatwave|\btrain|\bmetro\b|transport disruption/i],
  ['gastronomy', /ресторан|мишлен|шеф-?повар|\bшеф\b|гастро|винн|вино\b|сомелье|бистро|кондитер|бранч|ужин|дегустац|restaurant|michelin|\bchef|pop-?up|\bwine|sommelier|dining|bistro|tasting|brunch|food (festival|market|hall)|bakery|patisserie/i],
  ['culture', /выставк|музе|опер[аы]\b|оперн|театр|премьер|балет|концерт|арт-?ярмарк|галере|биеннале|кинофестив|показ мод|недел[яи] мод|exhibition|museum|opera|theat|premiere|ballet|concert|art fair|gallery|biennale|film festival|fashion (week|show)|orchestra|philharmonic/i],
  ['local_pulse', /фестивал|праздник|годовщин|юбилей|открыт|ярмарк|рождеств|новогод|иллюминац|парад|набережн|площад|собор|festival|celebrat|anniversary|christmas market|illuminat|parade|landmark|reopen|opening|marathon|new year/i],
];
const WEIGHT = { logistics: 3, gastronomy: 3, culture: 3, local_pulse: 1 };

const words = (t) => new Set(t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3));
// похожесть заголовков (коэффициент Дайса по словам): > 0.7 — та же новость в пересказе
function similar(a, b) {
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return (2 * common) / ((a.size + b.size) || 1) > 0.7;
}

async function search(keyword, signal, { strict = true } = {}) {
  const since = new Date(Date.now() - 48 * 36e5).toISOString().slice(0, 10);
  const r = await fetch(ER, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'getArticles', apiKey: process.env.NEWSAPI_AI_KEY,
      keyword, keywordLoc: 'title', lang: ['rus', 'eng'], dataType: ['news'],
      dateStart: since, isDuplicateFilter: 'skipDuplicates',
      ignoreCategoryUri: ['news/Crime', 'news/Politics', 'news/Health/Conditions_and_Diseases', 'dmoz/Society/Crime', 'dmoz/Health/Conditions_and_Diseases'],
      ...(strict ? { startSourceRankPercentile: 0, endSourceRankPercentile: 30 } : {}),
      resultType: 'articles', articlesSortBy: 'date', articlesCount: 30, articlesPage: 1,
      includeArticleImage: true, includeArticleBody: true, articleBodyLen: 500,
    }),
  });
  if (r.status === 429 || r.status === 402) throw Object.assign(new Error('rate_limited'), { soft: true });
  if (!r.ok) throw Object.assign(new Error('news_' + r.status), { soft: true });
  const data = await r.json();
  if (data?.error) throw Object.assign(new Error('news_error'), { soft: true });
  return data?.articles?.results || [];
}

// приводим к виду истории, размечаем корзиной, отсекаем шум и пересказы одной новости
function normalize(list, scope, kept) {
  for (const a of list) {
    const title = clean(a.title, 200);
    if (!title || title.length < 24 || !a.url) continue;
    const body = clean(a.body, 500);
    const text = `${title} ${body}`;
    if (NOISE.test(text)) continue;
    const tag = BUCKETS.find(([, re]) => re.test(title))?.[0] || BUCKETS.find(([, re]) => re.test(body))?.[0];
    // без корзины берём только городские новости — как «пульс города»; общестрановые без пользы для консьержа не нужны
    if (!tag && scope !== 'city') continue;
    const w = words(title);
    if (kept.some((k) => similar(k._w, w))) continue;
    kept.push({
      _w: w, _text: text.toLowerCase(), _tagged: !!tag,
      id: String(a.uri || a.url).slice(0, 80), title,
      summary: body.length > 160 ? body.slice(0, 157).replace(/\s+\S*$/, '') + '…' : body,
      source: clean(a.source?.title, 60), publishedAt: a.dateTimePub || a.dateTime || null,
      imageUrl: /^https:\/\//.test(a.image || '') ? a.image : null, url: a.url, scope,
      conciergeTag: tag || 'local_pulse',
    });
  }
  return kept;
}

// вкусы гостя → основы слов («устрицы» → «устри») и целые фразы («four seasons»)
function stems(interests) {
  const out = new Set();
  for (const s of [].concat(interests || []).slice(0, 16)) {
    const parts = String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    // «Four Seasons», «вид на море» — ищем целой фразой, иначе «season» совпадёт с чем угодно
    if (parts.length > 1) { out.add(parts.join(' ')); continue; }
    const w = parts[0] || '';
    if (w.length >= 4) out.add(w.length > 6 ? w.slice(0, w.length - 2) : w);
  }
  return [...out].slice(0, 30);
}

function rank(pool, interests) {
  const st = stems(interests);
  return pool.map((s) => {
    const flat = s._text.replace(/[^\p{L}\p{N}]+/gu, ' ');
    const match = st.some((x) => flat.includes(x));
    const score = WEIGHT[s.conciergeTag] + (s._tagged ? 0 : -1) + (s.scope === 'city' ? 1 : 0) + (match ? 2 : 0);
    return { s, match, score, t: Date.parse(s.publishedAt || 0) || 0 };
  }).sort((a, b) => b.score - a.score || b.t - a.t).slice(0, 5)
    .map(({ s, match }) => { const { _w, _text, _tagged, ...pub } = s; return { ...pub, tasteMatch: match }; });
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
  const interests = [].concat(req.body?.interests || []).map((x) => clean(x, 40)).filter(Boolean);
  if (!city && !country) return res.json({ stories: [] });

  const key = cacheKey('stories2', city.toLowerCase(), cc);
  let pool = await getCache(auth, key, TTL);
  if (pool) {
    pool = pool.map((s) => ({ ...s, _w: words(s.title), _text: `${s.title} ${s.summary}`.toLowerCase(), _tagged: s._tagged ?? true }));
  } else {
    const signal = AbortSignal.timeout(14000);
    pool = [];
    try {
      if (city) normalize(await search(city, signal), 'city', pool);
      if (pool.length < 2 && country) normalize(await search(country, signal), 'country', pool);
      // маленький город: среди ведущих изданий пусто — берём и остальные, фильтры шума остаются
      if (!pool.length && city) normalize(await search(city, signal, { strict: false }), 'city', pool);
    } catch (e) {
      // лимит или сбой API — интерфейс не ломается, просто нет историй (и не кэшируем пустоту)
      return res.json({ stories: rank(pool, interests), reason: e.soft ? e.message : 'news_failed' });
    }
    await setCache(auth, key, pool.slice(0, 20).map(({ _w, _text, ...s }) => s));
  }
  res.json({ stories: rank(pool, interests), city, country, at: new Date().toISOString() });
}

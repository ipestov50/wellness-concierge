// Поиск гостя по имени: без учёта регистра, опечаток, «ё», порядка слов и кириллицы/латиницы
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

const norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/ё/g, 'е')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zа-я0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
// латиница с упрощениями: ivanova / iwanowa / ivanovaa сводятся к похожему виду
const latin = (s) => [...norm(s)].map((c) => TR[c] ?? c).join('')
  .replace(/dzh|dj/g, 'j').replace(/w/g, 'v').replace(/(kh|h)/g, 'h').replace(/y/g, 'i').replace(/j/g, 'i').replace(/(.)\1+/g, '$1');

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);
// «скелет» из согласных: Джеймс/James → jms, Смит/Smith → smt
const skel = (w) => w.replace(/[aeiouh]/g, '');
const wsim = (a, b) => {
  const s1 = sim(a, b), ka = skel(a), kb = skel(b);
  return ka.length >= 2 && kb.length >= 2 ? Math.max(s1, sim(ka, kb) * 0.92) : s1;
};

// сходство двух имён: сравниваем слова попарно, порядок не важен
function nameScore(query, name) {
  const q = latin(query).split(' ').filter(Boolean);
  const t = latin(name).split(' ').filter(Boolean);
  if (!q.length || !t.length) return 0;
  const best = q.map((w) => Math.max(...t.map((x) => wsim(w, x))));
  const avg = best.reduce((a, b) => a + b, 0) / best.length;
  const whole = sim(q.slice().sort().join(' '), t.slice().sort().join(' '));
  // одно слово («Мария») совпало с частью полного имени — засчитываем, но чуть ниже
  return q.length < t.length ? Math.min(avg, 0.9) * 0.95 : Math.max(avg, whole);
}

// возвращает { client, score, ambiguous } или null
export function findClient(query, clients) {
  if (!query) return null;
  const scored = clients.map((c) => ({ client: c, score: nameScore(query, c.name) }))
    .filter((x) => x.score >= 0.78).sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const ambiguous = scored.length > 1 && scored[0].score - scored[1].score < 0.05;
  return { ...scored[0], ambiguous };
}

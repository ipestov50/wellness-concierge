// «Истории» на аватаре гостя: свежие новости его города (иначе — страны), просмотр как в Instagram
import { esc, avatar, toast } from './ui.js';
import { state, byId } from './data.js';
import { api, cached } from './api.js';
import { guestWhere } from './tz.js';

const SLIDE = 5000;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPRING = CSS.supports?.('animation-timing-function', 'linear(0, 1)')
  ? 'linear(0, .06 2%, .23 5%, .5 9.5%, .77 15%, .93 21%, 1.01 28%, 1.03 34%, 1.015 44%, 1 60%, 1)' : 'cubic-bezier(.22, 1, .36, 1)';
const ruCountry = (cc) => { try { return cc ? new Intl.DisplayNames(['ru'], { type: 'region' }).of(cc) : ''; } catch { return ''; } };
const firstName = (c) => (c.name || '').replace(/\s*\(.*?\)/g, '').split(/\s+/)[0] || '';

// где гость: город активной поездки, иначе домашний город и гражданство
export function storyPlace(c) {
  const w = guestWhere(c);
  if (w?.away && w.trip) return { city: w.trip.city || '', cc: (w.trip.country_code || '').toUpperCase() };
  return { city: c.city || '', cc: (c.citizenship || '').toUpperCase() };
}

const got = new Map(); // clientId → stories[]
const seenKey = (id) => 'story:' + id;
const isSeen = (c, list) => { try { return localStorage.getItem(seenKey(c.id)) === list[0]?.id; } catch { return false; } };
export function ringClass(c) {
  const list = got.get(c.id);
  if (!list?.length) return '';
  return isSeen(c, list) ? ' st-ring st-seen' : ' st-ring';
}

function load(c) {
  const p = storyPlace(c);
  if (!p.city && !p.cc) return Promise.resolve([]);
  return cached(`stories:${p.city.toLowerCase()}|${p.cc}`, 30 * 60e3, () => api('client-stories', { city: p.city, country: p.cc }))
    .then(({ value }) => value?.stories || []).catch(() => []);
}

function paint(el, c) {
  const cls = ringClass(c);
  el.classList.toggle('st-ring', cls.includes('st-ring'));
  el.classList.toggle('st-seen', cls.includes('st-seen'));
  if (cls) { el.setAttribute('role', 'button'); el.tabIndex = 0; el.setAttribute('aria-label', `Новости: ${storyPlace(c).city || ruCountry(storyPlace(c).cc)}`); }
}

// после отрисовки «Клиентов»: подгружаем истории и зажигаем кольца
export function hydrateStories(root) {
  const els = [...root.querySelectorAll('[data-story]')];
  for (const el of els) {
    const c = byId('clients', el.dataset.story);
    if (!c) continue;
    paint(el, c);
    if (el.dataset.stBound) continue;
    el.dataset.stBound = '1';
    const go = (e) => {
      if (!got.get(c.id)?.length) return;
      e.preventDefault(); e.stopPropagation();
      openStories(c, el);
    };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') go(e); });
    if (!got.has(c.id)) load(c).then((list) => { got.set(c.id, list); document.querySelectorAll(`[data-story="${c.id}"]`).forEach((x) => paint(x, c)); });
  }
}

const ago = (iso) => {
  if (!iso) return '';
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60e3));
  return m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : `${Math.round(m / 1440)} дн. назад`;
};

// ---------- просмотр ----------
let open = null;
function openStories(c, from) {
  const list = got.get(c.id) || [];
  if (!list.length || open) return;
  const p = storyPlace(c);
  const place = [p.city, ruCountry(p.cc)].filter(Boolean).join(' · ');
  const ov = document.createElement('div');
  ov.className = 'st-ov';
  ov.innerHTML = `<div class="st-card" role="dialog" aria-modal="true" aria-label="Новости: ${esc(place)}">
    <div class="st-bars">${list.map(() => '<span><i></i></span>').join('')}</div>
    <header class="st-head">${avatar(c, 'st-av')}<span class="st-who"><b>${esc(firstName(c))}</b><small>📍 ${esc(place)} · <span class="st-ago"></span></small></span>
      <button type="button" class="st-x" aria-label="Закрыть">×</button></header>
    <div class="st-stage"></div>
    <footer class="st-foot"><a class="st-src" target="_blank" rel="noopener">Открыть источник ↗</a>
      <button type="button" class="st-use">✦ Повод написать гостю</button></footer>
  </div>`;
  document.body.append(ov);
  document.body.classList.add('modal-open');
  const card = ov.querySelector('.st-card'), stage = ov.querySelector('.st-stage'), bars = [...ov.querySelectorAll('.st-bars i')];
  let i = 0, t0 = 0, done = 0, paused = false, raf = 0;

  try { localStorage.setItem(seenKey(c.id), list[0].id); } catch {}

  const show = (n, dir = 0) => {
    i = n; done = 0; t0 = performance.now();
    const s = list[i];
    bars.forEach((b, k) => { b.style.transform = `scaleX(${k < i ? 1 : 0})`; });
    stage.innerHTML = `<article class="st-slide${s.imageUrl ? '' : ' paper'}">
      ${s.imageUrl ? `<img class="st-img" src="${esc(s.imageUrl)}" alt="" referrerpolicy="no-referrer" decoding="async">` : ''}
      <div class="st-body"><span class="st-scope ${s.scope}">${s.scope === 'city' ? 'Город' : 'Страна'}</span>
        <h2 class="st-title">${esc(s.title)}</h2>${s.summary ? `<p class="st-sum">${esc(s.summary)}</p>` : ''}
        <p class="st-from">${esc(s.source || '')}${s.source && s.publishedAt ? ' · ' : ''}${esc(ago(s.publishedAt))}</p></div></article>`;
    card.classList.toggle('on-paper', !s.imageUrl);
    stage.querySelector('.st-img')?.addEventListener('error', (e) => { e.target.remove(); stage.firstElementChild.classList.add('paper'); card.classList.add('on-paper'); });
    ov.querySelector('.st-ago').textContent = ago(s.publishedAt);
    const src = ov.querySelector('.st-src'); src.href = s.url;
    if (dir && !reduced()) stage.firstElementChild.animate([{ opacity: 0, transform: `translateX(${dir * 40}px) scale(.98)` }, { opacity: 1, transform: 'none' }], { duration: 420, easing: SPRING });
  };
  const next = () => (i < list.length - 1 ? show(i + 1, 1) : close());
  const prev = () => show(Math.max(0, i - 1), -1);
  const tick = (now) => {
    if (!paused && !document.hidden) {
      const k = Math.min(1, done + (now - t0) / SLIDE);
      bars[i].style.transform = `scaleX(${k})`;
      if (k >= 1) { next(); if (!open) return; }
    } else t0 = now;
    raf = requestAnimationFrame(tick);
  };
  const pause = (on) => {
    if (on === paused) return;
    const now = performance.now();
    if (on) done = Math.min(1, done + (now - t0) / SLIDE); else t0 = now;
    paused = on; card.classList.toggle('held', on);
  };

  // жесты: тап слева 30% — назад, справа — вперёд; удержание — пауза; свайп вбок — листать, вниз — закрыть
  let sx = 0, sy = 0, st = 0, drag = false, id = null;
  stage.addEventListener('pointerdown', (e) => { id = e.pointerId; sx = e.clientX; sy = e.clientY; st = performance.now(); drag = false; pause(true); stage.setPointerCapture(id); });
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!drag && Math.hypot(dx, dy) > 8) drag = true;
    if (drag) card.style.transform = Math.abs(dy) > Math.abs(dx) && dy > 0 ? `translateY(${dy * .6}px) scale(${1 - Math.min(dy, 300) / 3000})` : `translateX(${dx * .55}px) rotate(${dx / 60}deg)`;
  });
  const up = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    const dx = e.clientX - sx, dy = e.clientY - sy, quick = performance.now() - st < 260;
    const from = card.style.transform; card.style.transform = '';
    if (drag && from && !reduced()) card.animate([{ transform: from }, { transform: 'none' }], { duration: 480, easing: SPRING });
    pause(false);
    if (drag && dy > 110 && Math.abs(dy) > Math.abs(dx)) return close();
    if (drag && Math.abs(dx) > 70) return dx < 0 ? next() : prev();
    if (!drag && quick) { const r = stage.getBoundingClientRect(); (e.clientX - r.left < r.width * .3 ? prev : next)(); }
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  const key = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
  };
  document.addEventListener('keydown', key, true);
  ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
  ov.querySelector('.st-x').addEventListener('click', close);
  ov.querySelector('.st-use').addEventListener('click', async () => {
    const s = list[i];
    const text = `Добрый день, ${firstName(c)}! Попалась новость из ${p.city || ruCountry(p.cc)}: «${s.title}». Как у вас дела? Если что-то нужно — я на связи.`;
    try { await navigator.clipboard.writeText(text); toast('Текст скопирован — можно вставить в чат'); } catch { toast('Не удалось скопировать', 'err'); }
    const digits = (c.phone || '').replace(/[^\d]/g, '');
    if (digits) window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });

  function close() {
    if (!open) return;
    open = null;
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', key, true);
    document.querySelectorAll(`[data-story="${c.id}"]`).forEach((x) => paint(x, c));
    const end = () => { ov.remove(); if (!document.querySelector('#modal .ov')) document.body.classList.remove('modal-open'); from?.focus?.(); };
    if (reduced()) return end();
    ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
    card.animate([{ transform: 'none' }, { transform: 'scale(.94)' }], { duration: 220, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }).finished.then(end, end);
  }

  open = { close };
  show(0);
  if (!reduced()) {
    const r = from?.getBoundingClientRect();
    const fx = r ? r.left + r.width / 2 - innerWidth / 2 : 0, fy = r ? r.top + r.height / 2 - innerHeight / 2 : 0;
    ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280 });
    card.animate([{ transform: `translate(${fx}px, ${fy}px) scale(.15)`, opacity: 0, borderRadius: '50%' }, { transform: 'none', opacity: 1, borderRadius: getComputedStyle(card).borderRadius }], { duration: 560, easing: SPRING });
  }
  ov.querySelector('.st-x').focus({ preventScroll: true });
  raf = requestAnimationFrame((now) => { t0 = now; tick(now); });
}

// «📘 Путеводитель-лукбук»: ваши указания → Jarvis собирает книгу (тексты, фото, карта) →
// конструктор: правка прямо на страницах, замена фото, вкл/выкл страниц → «Экспорт PDF» (A4, страница = лист).
// Книга хранится в поездке (trips.guide). Имя гостя в ИИ не уходит — подставляется только здесь.
import { esc, openModal, toast } from './ui.js';
import { state, byId, save } from './data.js';
import { api, isAbort } from './api.js';
import { renderBook, PAGE_KEYS, pageLabel, get, set, mapHtml, MAP_W, MAP_H } from './lookbook.js';
import { mapShot } from './mapshot.js';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const clean = (n) => (n || '').replace(/\s*\(.*?\)/g, '').trim();
const rangeLong = (t) => {
  if (!t.start_date) return '';
  const a = new Date(t.start_date + 'T12:00:00Z'), b = t.end_date ? new Date(t.end_date + 'T12:00:00Z') : null;
  if (!b || +a === +b) return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}` : `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
};
const loadCss = () => { if (!document.getElementById('lb-css')) document.head.insertAdjacentHTML('beforeend', '<link id="lb-css" rel="stylesheet" href="/css/lookbook.css">'); };
const savedContact = () => { try { return JSON.parse(localStorage.getItem('lb.contact') || 'null'); } catch { return null; } };
const thumb = (u) => u.replace(/\/(\d{3,4})px-/, '/400px-');
const photoGrid = (list) => list.length
  ? list.map((x) => `<button type="button" class="gb-ph" data-gb-use="${esc(x.url)}" title="${esc(x.credit || '')}"><img src="${esc(thumb(x.url))}" alt="" referrerpolicy="no-referrer"></button>`).join('')
  : '<p class="muted">Ничего не нашлось — попробуйте другие слова (лучше по-английски).</p>';

export function openGuide(tripId) {
  const t = state.trips.find((x) => x.id === tripId);
  if (!t) return;
  loadCss();
  const c = byId('clients', t.client_id);
  const ctx = () => {
    const g = t.guide || {};
    return { city: t.city || '', guest: clean(c?.name) || 'гостя', first: clean(c?.name).split(/\s+/)[0] || '', dates: rangeLong(t),
      initials: (g.contact?.name || 'W C').split(/\s+/).map((x) => x[0] || '').join('').slice(0, 2).toUpperCase() };
  };
  const m = openModal({ title: '📘 Путеводитель для гостя', saveLabel: 'Закрыть', body: '<div class="gd" id="gd"></div>', onSave: async () => {} });
  m.form.classList.add('wide', 'gb-dlg');
  m.form.querySelector('#cancel').hidden = true;
  const box = m.form.querySelector('#gd');
  const back = '<button type="button" class="link" data-gd-back>← к «Перед вылетом»</button>';

  // ---------- 1. указания Jarvis ----------
  const composer = (msg = '') => {
    const g = t.guide || {};
    const on = new Set(g.pages || PAGE_KEYS);
    box.innerHTML = `${back}
      ${msg ? `<p class="bf-stale">${esc(msg)}</p>` : ''}
      <p class="gd-lead">${esc(t.city)}${rangeLong(t) ? ' · ' + esc(rangeLong(t)) : ''} — Jarvis соберёт книгу в стиле бутик-лукбука: обложку, письмо гостю, план по дням с вашими запросами из календаря, карту, отель и велнес, рекомендации. Учтёт предпочтения, аллергии и ваших партнёров. Имя гостя в ИИ не уходит.</p>
      <label class="f"><span>Ваши указания Jarvis</span>
        <textarea id="gd-notes" rows="4" placeholder="Например: акцент на рыбные рестораны с видом на море, без глютена; день в Монако; спа с хаммамом; вечером — тихие места">${esc(g.notes || '')}</textarea></label>
      <div class="gd-secs">${PAGE_KEYS.map((k) => `<label class="gd-sec"><input type="checkbox" value="${k}"${on.has(k) ? ' checked' : ''}><span>${pageLabel(k)}</span></label>`).join('')}</div>
      <div class="gd-act"><button type="button" class="btn primary" data-gd-run>✦ Собрать путеводитель</button>
        ${g.v === 2 ? '<button type="button" class="btn" data-gd-open>Открыть конструктор</button>' : ''}</div>`;
  };

  // ---------- 2. конструктор ----------
  let zoom = Math.min(0.8, Math.max(0.38, (Math.min(innerWidth, 1180) - 70) / 794));
  let timer = null;
  const status = (s) => { const el = box.querySelector('#gb-status'); if (el) el.textContent = s; };
  const persist = async () => { clearTimeout(timer); timer = null; try { await save('trips', tripId, { guide: t.guide }); status('✓ сохранено'); } catch (e) { status('не сохранилось'); toast('Не сохранилось: ' + e.message, 'err'); } };
  const autosave = () => { status('…'); clearTimeout(timer); timer = setTimeout(persist, 1200); };
  // карта рисуется отдельно (несколько секунд) и подставляется, не перерисовывая страницы
  let shot = null;
  const refreshMap = () => {
    if (!(t.guide.pages || PAGE_KEYS).includes('map')) return;
    mapShot(t.guide.map, MAP_W, MAP_H).then((s) => {
      shot = s;
      const el = box.querySelector('#gb-book .lb-mapbox');
      if (el) el.outerHTML = mapHtml(t.guide.map, MAP_W, MAP_H, s);
    }).catch(() => { const el = box.querySelector('#gb-book .lb-mapbox span'); if (el) el.innerHTML = 'Карта не нарисовалась<br><button type="button" class="btn small" data-gb-map>↻ Нарисовать карту</button>'; });
  };
  const draw = () => { const b = box.querySelector('#gb-book'); if (b) { b.innerHTML = renderBook(t.guide, { ...ctx(), map: shot }, { editable: true }); b.style.zoom = zoom; refreshMap(); } };
  const builder = () => {
    const g = t.guide;
    g.contact = g.contact || savedContact() || { name: '', role: 'Личный консьерж' };
    const on = new Set(g.pages || PAGE_KEYS);
    box.innerHTML = `<div class="gb">
      <div class="gb-bar">${back}
        <div class="gb-pages">${PAGE_KEYS.map((k) => `<label class="gd-sec sm"><input type="checkbox" data-gb-page="${k}"${on.has(k) ? ' checked' : ''}><span>${pageLabel(k)}</span></label>`).join('')}</div>
        <div class="gb-tools"><button type="button" class="icon-btn" data-gb-zoom="-1" aria-label="Мельче">−</button><button type="button" class="icon-btn" data-gb-zoom="1" aria-label="Крупнее">＋</button>
          <span class="muted" id="gb-status">✓ сохранено</span>
          <button type="button" class="btn small" data-gd-redo>↻ Пересобрать</button>
          <button type="button" class="btn small primary" data-gb-pdf>📄 Экспорт PDF</button></div>
        <p class="gb-hint">Нажмите на любой текст, чтобы исправить; на фото — чтобы заменить. Всё сохраняется само.</p></div>
      <div class="gb-stage"><div class="lb-book editing" id="gb-book"></div></div>
      <div class="gb-photo" id="gb-photo" hidden></div></div>`;
    draw();
  };

  // ---------- выбор фото ----------
  const photoPanel = (path) => {
    const p = box.querySelector('#gb-photo');
    p.hidden = false;
    p.dataset.path = path;
    p.innerHTML = `<div class="gb-ph-head"><b>Фото</b><button type="button" class="icon-btn" data-gb-close aria-label="Закрыть">✕</button></div>
      <div class="gb-ph-search"><input type="search" id="gb-q" placeholder="Найти: Nice old town, spa pool…" value="${esc(t.city || '')}"><button type="button" class="btn small" data-gb-find>Найти</button></div>
      <div class="gb-ph-grid" id="gb-grid">${photoGrid(t.guide.photos || [])}</div>
      <div class="gb-ph-url"><input type="url" id="gb-url" placeholder="или вставьте ссылку на фото https://…"><button type="button" class="btn small" data-gb-url>Вставить</button></div>
      <button type="button" class="link" data-gb-use="">Убрать фото</button>
      <p class="gb-credit">Фото: Wikimedia Commons (свободные лицензии).</p>`;
  };
  const setPhoto = (u) => { set(t.guide, box.querySelector('#gb-photo').dataset.path, u); box.querySelector('#gb-photo').hidden = true; draw(); autosave(); };

  box.addEventListener('input', (e) => {
    const el = e.target.closest('[data-k]');
    if (!el) return;
    set(t.guide, el.dataset.k, el.innerText.replace(/\n{3,}/g, '\n\n').trim());
    if (el.dataset.k.startsWith('contact.')) { try { localStorage.setItem('lb.contact', JSON.stringify(t.guide.contact)); } catch {} }
    autosave();
  });
  box.addEventListener('change', (e) => {
    if (!e.target.closest('[data-gb-page]')) return;
    t.guide.pages = [...box.querySelectorAll('[data-gb-page]:checked')].map((x) => x.dataset.gbPage);
    draw(); autosave();
  });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'gb-q') { e.preventDefault(); box.querySelector('[data-gb-find]').click(); } });
  box.addEventListener('click', async (e) => {
    const el = e.target;
    if (el.closest('[data-gd-back]')) { if (timer) await persist(); import('./brief.js').then((b) => b.openBrief(tripId)); return; }
    if (el.closest('[data-gd-open]')) return builder();
    if (el.closest('[data-gd-redo]')) { if (timer) await persist(); return composer(); }
    if (el.closest('[data-gb-map]')) { el.closest('.lb-mapbox').querySelector('span').textContent = 'Рисую карту…'; return refreshMap(); }
    const z = el.closest('[data-gb-zoom]');
    if (z) { zoom = Math.min(1.2, Math.max(0.3, zoom + 0.1 * +z.dataset.gbZoom)); box.querySelector('#gb-book').style.zoom = zoom; return; }
    const del = el.closest('[data-del]');
    if (del) { const ks = del.dataset.del.split('.'); const i = +ks.pop(); get(t.guide, ks.join('.')).splice(i, 1); draw(); autosave(); return; }
    const img = el.closest('[data-img]');
    if (img) return photoPanel(img.dataset.img);
    if (el.closest('[data-gb-close]')) { box.querySelector('#gb-photo').hidden = true; return; }
    const use = el.closest('[data-gb-use]');
    if (use) return setPhoto(use.dataset.gbUse);
    if (el.closest('[data-gb-url]')) {
      const u = box.querySelector('#gb-url').value.trim();
      if (!/^https:\/\/\S+$/.test(u)) return toast('Нужна ссылка, начинающаяся с https://', 'err');
      return setPhoto(u);
    }
    if (el.closest('[data-gb-find]')) {
      const q = box.querySelector('#gb-q').value.trim();
      if (!q) return;
      const gridEl = box.querySelector('#gb-grid');
      gridEl.innerHTML = '<p class="muted"><span class="spin"></span> ищу…</p>';
      try {
        const { photos } = await api('guide', { id: tripId, mode: 'photos', q }, { signal: m.signal });
        t.guide.photos = [...photos, ...(t.guide.photos || []).filter((x) => !photos.some((p) => p.url === x.url))].slice(0, 60);
        gridEl.innerHTML = photoGrid(photos);
      } catch (err) { if (!isAbort(err)) gridEl.innerHTML = '<p class="muted">Поиск не удался</p>'; }
      return;
    }
    if (el.closest('[data-gb-pdf]')) {
      if (timer) await persist();
      let map = shot;
      if ((t.guide.pages || PAGE_KEYS).includes('map') && !map) { toast('Дорисовываю карту…'); map = await mapShot(t.guide.map, MAP_W, MAP_H).catch(() => null); }
      return printBook(t.guide, { ...ctx(), map });
    }
    if (el.closest('[data-gd-run]')) {
      const notes = box.querySelector('#gd-notes').value.trim();
      const pages = [...box.querySelectorAll('.gd-sec input:checked')].map((x) => x.value);
      if (!pages.length) return toast('Выберите хотя бы одну страницу', 'err');
      box.innerHTML = `<div class="bf-busy"><span class="spin"></span> Jarvis ищет места в ${esc(t.city)}, подбирает фото и карту… обычно 40–90 секунд</div><div class="bf-skel"><i></i><i></i><i></i></div>`;
      try {
        const { guide } = await api('guide', { id: tripId, notes, pages }, { signal: m.signal });
        guide.contact = t.guide?.contact || savedContact() || guide.contact;
        t.guide = guide;
        if (m.form.isConnected) builder();
      } catch (err) {
        if (isAbort(err) || !m.form.isConnected) return;
        toast(err.message === 'rate_limited' ? 'Лимит Gemini — попробуйте через минуту' : 'Не получилось: ' + err.message, 'err');
        composer();
        box.querySelector('#gd-notes').value = notes;
      }
    }
  });
  if (t.guide?.v === 2) builder(); else composer(t.guide ? 'Путеводитель теперь собирается как лукбук — нажмите «Собрать», ваши указания сохранены.' : '');
}

// ---------- PDF: та же вёрстка в отдельном окне → «Сохранить как PDF» ----------
function printBook(g, ctx) {
  const w = window.open('', '_blank');
  if (!w) return toast('Браузер заблокировал окно — разрешите всплывающие окна для сайта', 'err');
  w.document.open();
  w.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc((g.cover?.title || ctx.city) + ' · путеводитель')}</title>
    <link rel="stylesheet" href="${location.origin}/css/lookbook.css"><style>body{margin:0;background:#fff}</style></head>
    <body><div class="lb-book">${renderBook(g, ctx)}</div></body></html>`);
  w.document.close();
  toast('Готовлю PDF… в окне печати выберите «Сохранить как PDF»');
  // ждём стили, шрифты и фото, чтобы в PDF ничего не пропало
  const ready = async () => {
    const imgs = [...w.document.images].map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; })));
    await Promise.race([Promise.all(imgs), new Promise((r) => setTimeout(r, 12000))]);
    try { await w.document.fonts.ready; } catch {}
    setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 300);
  };
  if (w.document.readyState === 'complete') ready(); else w.addEventListener('load', ready);
}

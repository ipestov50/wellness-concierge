// Чек-лист запроса: секции «Срочно · Подготовка · Детали · После», приоритеты,
// персональные пункты из досье (✦), перетаскивание с мягкой физикой. Без фреймворков.
import { TEMPLATES, SECTIONS, PRIOS, PRIO_RANK, pickTemplate } from './checklist-templates.js';
import { esc, toast } from './ui.js';
import { state, byId, save } from './data.js';
import { api, isAbort, scopeSignal } from './api.js';

const uid = () => Math.random().toString(36).slice(2, 9);
const LANG = { EN: 'английски', FR: 'французски' };
const KIDS = /сын|доч|реб[её]н|дет|kid|child|enfant/i;
const lc = (s) => String(s || '').toLowerCase();
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
const SEC_KEYS = SECTIONS.map(([k]) => k);
const PRIO_LABEL = Object.fromEntries(PRIOS);
const NEXT_PRIO = { normal: 'med', med: 'high', high: 'normal' };

// ---------- персональные пункты: то, о чём гость сам не подумает ----------
function personal(key, r, c) {
  if (!c) return { items: [], factors: [] };
  const out = [], factors = [];
  const add = (t, hint, section, prio) => out.push({ t, hint: hint || null, section, prio });
  const people = state.people.filter((p) => p.client_id === c.id);
  const trip = state.trips.find((t) => t.client_id === c.id && t.start_date && r.deadline && r.deadline.slice(0, 10) >= t.start_date && r.deadline.slice(0, 10) <= (t.end_date || t.start_date));
  const companions = lc(trip?.companions);
  const kids = people.filter((p) => KIDS.test(p.role || '')).length || KIDS.test(companions);
  const allergies = [...(c.allergies || []), ...(c.diet || [])];
  const others = people.filter((p) => (p.allergies || []).length);
  const food = ['dining', 'gift', 'hotel', 'activity', 'flowers'].includes(key);

  if (allergies.length && (food || key === 'spa')) { add(`Передать: ${allergies.join(', ')}`, key === 'spa' ? 'масла, кремы, чай после процедуры' : 'письменно и ещё раз в день визита', 'urgent', 'high'); factors.push(allergies.join(', ')); }
  if (others.length && food) for (const p of others) { add(`${cap(lc(p.role) || p.name)}: аллергия — ${p.allergies.join(', ')}`, key === 'flowers' || key === 'gift' ? 'чтобы подарок был безопасен для всех рядом' : 'если будет вместе с гостем', 'urgent', 'high'); factors.push(`${lc(p.role) || p.name}: ${p.allergies.join(', ')}`); }
  if (kids) {
    if (key.startsWith('airport') || key === 'transfer') add('Детское кресло и бустер', KIDS.test(companions) ? 'едут дети — по возрасту и весу' : 'если едут дети — по возрасту и весу', 'urgent', 'high');
    if (key === 'dining') add('Детское меню и стульчик', null, 'prep', 'med');
    if (key === 'hotel') add('Детская кроватка, халатики, набор для детей', null, 'prep', 'med');
    if (key === 'activity') add('Программа подходит детям по возрасту', null, 'urgent', 'high');
    factors.push('дети');
  }
  if ((c.dislikes || []).length && ['dining', 'gift', 'flowers', 'hotel', 'activity'].includes(key)) { add(`Стоп-лист: ${c.dislikes.join(', ')}`, 'проверить меню, букет, комплименты', 'details', 'high'); factors.push('стоп-лист'); }
  if ((c.likes || []).length && ['gift', 'flowers', 'hotel'].includes(key)) { add(`Добавить любимое: ${c.likes.slice(0, 3).join(', ')}`, null, 'details', 'med'); factors.push('любит ' + c.likes.slice(0, 2).join(', ')); }
  if (c.pref_transport && (key.startsWith('airport') || key === 'transfer')) { add(`Машина: ${c.pref_transport}`, null, 'prep', 'med'); factors.push(c.pref_transport); }
  if (c.pref_food && key === 'dining') add(`Кухня по вкусу: ${c.pref_food}`, null, 'prep', 'normal');
  if (c.pref_spa && key === 'spa') add(`Как любит: ${c.pref_spa}`, null, 'details', 'med');
  if (c.pref_hotels && key === 'hotel') add(`Предпочтения: ${c.pref_hotels}`, null, 'prep', 'normal');
  if (c.travel_habits && (key === 'airport_out' || key === 'hotel')) { add(`Привычки: ${c.travel_habits}`, null, 'details', 'med'); factors.push('привычки в пути'); }
  if ((c.loyalty || []).length && (key === 'hotel' || key === 'airport_out')) add(`Программа лояльности: ${c.loyalty.join(', ')}`, null, 'prep', 'normal');
  if (LANG[c.language] && ['airport_in', 'airport_out', 'transfer', 'activity', 'health', 'spa'].includes(key)) { add(`Персонал говорит по-${LANG[c.language]}`, null, 'prep', 'med'); factors.push(`язык ${c.language}`); }
  if (c.vip && key === 'airport_in') { add('Личная встреча или ваша открытка в машине', 'для VIP — маленький жест с первой минуты', 'details', 'med'); factors.push('VIP'); }
  if (r.deadline && ['dining', 'hotel', 'spa'].includes(key)) {
    const d0 = Date.parse(r.deadline.slice(0, 10) + 'T12:00:00Z');
    const near = [[c.birthday, 'гостя'], ...people.map((p) => [p.birthday, lc(p.role) || p.name])].find(([b]) => {
      if (!b) return false;
      const [, m, d] = b.split('-').map(Number);
      const y = new Date(d0).getUTCFullYear();
      return [y - 1, y, y + 1].some((yy) => Math.abs(Date.UTC(yy, m - 1, d, 12) - d0) <= 3 * 864e5);
    });
    if (near) { const [, m, d] = near[0].split('-'); add(`${near[1] === 'гостя' ? 'День рождения гостя' : 'День рождения: ' + near[1]} — ${+d}.${m}`, 'комплимент от заведения или открытка', 'details', 'high'); factors.push('день рождения рядом'); }
  }
  return { items: out.map((x) => ({ ...x, src: 'personal' })), factors };
}

const sortByPrio = (items) => SEC_KEYS.flatMap((s) => items.filter((i) => i.section === s).sort((a, b) => PRIO_RANK[a.prio] - PRIO_RANK[b.prio]));

export function buildChecklist(r, key = pickTemplate(r)) {
  const tpl = TEMPLATES[key] || TEMPLATES.other;
  const c = r.client_id ? byId('clients', r.client_id) : null;
  const items = [];
  for (const s of SEC_KEYS) for (const [t, hint, prio] of tpl[s] || []) items.push({ id: uid(), t, hint: hint || null, section: s, prio: prio || 'normal', done: false, src: 'template' });
  const pers = personal(key, r, c);
  for (const p of pers.items) if (!items.some((i) => lc(i.t) === lc(p.t))) items.push({ id: uid(), done: false, ...p });
  return { v: 2, template: key, factors: pers.factors, items: sortByPrio(items) };
}

// старые чек-листы (этапы «заранее / в день / после») переводим в секции
export function normalize(cl) {
  if (!cl || cl.v === 2) return cl;
  const PH = { before: 'prep', day: 'urgent', after: 'after' };
  const items = (cl.items || []).map((i) => ({
    ...i, section: i.section || PH[i.phase] || 'prep',
    prio: i.prio || (i.src === 'personal' && /аллерг|передать|кресло/i.test(i.t) ? 'high' : i.src === 'personal' ? 'med' : 'normal'),
  }));
  return { v: 2, template: cl.template, factors: cl.factors || [], items: sortByPrio(items).map((i) => { delete i.phase; return i; }) };
}

// ---------- кольцо прогресса для карточек ----------
export function ring(r, size = 18) {
  const items = r.checklist?.items || [];
  if (!items.length) return '';
  const done = items.filter((i) => i.done).length;
  const k = done / items.length;
  const R = size / 2 - 2, L = 2 * Math.PI * R;
  return `<span class="ring${k === 1 ? ' full' : ''}" title="Чек-лист: ${done} из ${items.length}"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${R}" class="ring-bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${R}" class="ring-fg"
    stroke-dasharray="${L}" stroke-dashoffset="${L * (1 - k)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg><small>${done}/${items.length}</small></span>`;
}

// ---------- разметка ----------
const CHECK = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.2"/><path d="M6 10.4l2.6 2.6L14 7.6"/></svg>';
const GRIP = '<svg viewBox="0 0 10 16" aria-hidden="true"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg>';

const itemHtml = (i) => `<div class="cl-item p-${i.prio}${i.done ? ' done' : ''}" data-cl-item="${i.id}">
  <button type="button" class="cl-grip" data-cl-grip aria-label="Перетащить «${esc(i.t)}»">${GRIP}</button>
  <button type="button" class="cl-check" data-cl-check="${i.id}" aria-pressed="${i.done}" aria-label="${esc(i.t)}">${CHECK}</button>
  <span class="cl-text"><span>${i.src === 'personal' || i.src === 'ai' ? `<b class="cl-star" title="${i.src === 'ai' ? 'Добавил Jarvis' : 'Из досье гостя'}">✦</b> ` : ''}${esc(i.t)}</span>${i.hint ? `<small>${esc(i.hint)}</small>` : ''}</span>
  <button type="button" class="cl-prio pr-${i.prio}" data-cl-prio="${i.id}" title="Приоритет: ${PRIO_LABEL[i.prio]} — нажмите, чтобы изменить">${i.prio === 'normal' ? '' : PRIO_LABEL[i.prio]}</button>
  <button type="button" class="cl-x" data-cl-del="${i.id}" aria-label="Убрать пункт">×</button>
</div>`;

export function checklistSection(r) {
  if (!r?.id) return '';
  const cl = normalize(r.checklist);
  const items = cl?.items || [];
  const done = items.filter((i) => i.done).length;
  const tpl = TEMPLATES[cl?.template];
  return `<section class="cl" data-cl-req="${r.id}">
    <button type="button" class="cl-head" data-cl-toggle aria-expanded="false">
      <span class="cl-title">${tpl ? tpl.icon + ' ' : ''}Чек-лист${tpl ? ` <small>· ${esc(tpl.title.toLowerCase())}</small>` : ''}</span>
      <span class="cl-prog"><span class="cl-bar"><i style="width:${items.length ? (done / items.length) * 100 : 0}%"></i></span><small>${done}/${items.length}</small></span>
      <span class="cl-chev">▾</span>
    </button>
    <div class="cl-body"><div class="cl-inner">
      ${(cl?.factors || []).length ? `<p class="cl-factors">✦ Учтено из досье: ${esc(cl.factors.slice(0, 5).join(' · '))}</p>` : ''}
      ${SECTIONS.map(([s, label]) => {
        const list = items.filter((i) => i.section === s);
        const left = list.filter((i) => !i.done).length;
        return `<div class="cl-sec s-${s}${list.length ? '' : ' empty'}" data-sec="${s}">
          <div class="cl-sec-head"><span class="cl-sec-title">${label}</span>${list.length ? `<span class="cl-sec-count">${left ? left : '✓'}</span>` : ''}
            ${tpl?.hints?.[s] ? `<span class="cl-sec-hint">${esc(tpl.hints[s])}</span>` : ''}</div>
          <div class="cl-list" data-cl-list="${s}">${list.map(itemHtml).join('')}<div class="cl-drop-hint">Перетащите сюда</div></div>
        </div>`;
      }).join('')}
      <div class="cl-foot">
        <input type="text" class="cl-add" placeholder="＋ Свой пункт" enterkeyhint="done">
        <button type="button" class="cl-link" data-cl-ai>✦ Jarvis дополнит</button>
        <button type="button" class="cl-link muted" data-cl-sort title="Расставить по важности внутри секций">↕ По важности</button>
        <select class="cl-tpl" aria-label="Шаблон">${Object.entries(TEMPLATES).map(([k, v]) => `<option value="${k}"${k === cl?.template ? ' selected' : ''}>${v.icon} ${v.title}</option>`).join('')}</select>
      </div>
    </div></div>
  </section>`;
}

// ---------- поведение ----------
export function bindChecklist(root) {
  const box = root.querySelector('[data-cl-req]');
  if (!box) return;
  const id = box.dataset.clReq;
  const r = () => byId('requests', id);
  // старый формат — переводим и тихо сохраняем
  if (r()?.checklist && r().checklist.v !== 2) { r().checklist = normalize(r().checklist); save('requests', id, { checklist: r().checklist }).catch(() => {}); }
  const cl = () => structuredClone(r().checklist || { v: 2, template: 'other', factors: [], items: [] });
  const persist = async (next) => {
    r().checklist = next;
    try { await save('requests', id, { checklist: next }); } catch (e) { toast('Не сохранилось: ' + (e.message || e), 'err'); }
  };

  const setOpen = (open) => { box.classList.toggle('open', open); box.querySelector('[data-cl-toggle]').setAttribute('aria-expanded', String(open)); };
  setOpen((r()?.checklist?.items || []).some((i) => !i.done));
  box.querySelector('[data-cl-toggle]').addEventListener('click', () => setOpen(!box.classList.contains('open')));

  const refreshHead = () => {
    const items = r()?.checklist?.items || [];
    const done = items.filter((i) => i.done).length;
    box.querySelector('.cl-bar i').style.width = (items.length ? (done / items.length) * 100 : 0) + '%';
    box.querySelector('.cl-prog small').textContent = `${done}/${items.length}`;
    box.querySelectorAll('.cl-sec').forEach((sec) => {
      const list = items.filter((i) => i.section === sec.dataset.sec);
      sec.classList.toggle('empty', !list.length);
      const n = sec.querySelector('.cl-sec-count');
      const left = list.filter((i) => !i.done).length;
      if (n) n.textContent = left || '✓';
      else if (list.length) sec.querySelector('.cl-sec-title').insertAdjacentHTML('afterend', `<span class="cl-sec-count">${left || '✓'}</span>`);
      if (!list.length) sec.querySelector('.cl-sec-count')?.remove();
    });
    if (items.length && done === items.length) { box.classList.add('complete'); setTimeout(() => box.classList.remove('complete'), 900); }
  };
  const redraw = (open = true) => { box.outerHTML = checklistSection(r()); bindChecklist(root); root.querySelector('[data-cl-req]')?.classList.toggle('open', open); };

  box.addEventListener('click', async (e) => {
    const chk = e.target.closest('[data-cl-check]');
    const del = e.target.closest('[data-cl-del]');
    const pr = e.target.closest('[data-cl-prio]');
    if (chk) {
      const next = cl();
      const it = next.items.find((i) => i.id === chk.dataset.clCheck);
      it.done = !it.done;
      chk.closest('.cl-item').classList.toggle('done', it.done); chk.setAttribute('aria-pressed', String(it.done));
      r().checklist = next; refreshHead();
      await persist(next);
    } else if (pr) {
      const next = cl();
      const it = next.items.find((i) => i.id === pr.dataset.clPrio);
      it.prio = NEXT_PRIO[it.prio] || 'normal';
      const row = pr.closest('.cl-item');
      row.classList.remove('p-high', 'p-med', 'p-normal'); row.classList.add('p-' + it.prio);
      pr.className = `cl-prio pr-${it.prio} bump`; pr.textContent = it.prio === 'normal' ? '' : PRIO_LABEL[it.prio];
      pr.title = `Приоритет: ${PRIO_LABEL[it.prio]} — нажмите, чтобы изменить`;
      await persist(next);
    } else if (del) {
      const next = cl();
      next.items = next.items.filter((i) => i.id !== del.dataset.clDel);
      const row = del.closest('.cl-item');
      row.style.height = row.offsetHeight + 'px';
      requestAnimationFrame(() => row.classList.add('leaving'));
      setTimeout(() => { row.remove(); refreshHead(); }, 260);
      r().checklist = next;
      await persist(next);
    } else if (e.target.closest('[data-cl-sort]')) {
      const next = cl();
      next.items = sortByPrio(next.items);
      await animateReorder(box, () => { r().checklist = next; redraw(); });
      persist(next);
    } else if (e.target.closest('[data-cl-ai]')) enrich(e.target.closest('[data-cl-ai]'));
  });
  box.querySelector('.cl-add').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const t = e.target.value.trim();
    if (!t) return;
    const next = cl();
    next.items.push({ id: uid(), t, hint: null, section: 'prep', prio: 'normal', done: false, src: 'manual' });
    e.target.value = '';
    await persist(next);
    redraw();
    root.querySelector('[data-cl-req] .cl-add')?.focus();
  });
  box.querySelector('.cl-tpl').addEventListener('change', async (e) => {
    const fresh = buildChecklist(r(), e.target.value);
    const old = r().checklist?.items || [];
    for (const it of fresh.items) if (old.some((o) => o.done && lc(o.t) === lc(it.t))) it.done = true;
    fresh.items.push(...old.filter((o) => o.src === 'manual' || o.src === 'ai'));
    await persist(fresh);
    redraw();
  });

  enableDrag(box, async (order) => {
    // order: [{ id, section }] в новом порядке — сохраняем порядок и секции
    const next = cl();
    const byIdMap = new Map(next.items.map((i) => [i.id, i]));
    next.items = order.map(({ id: iid, section }) => ({ ...byIdMap.get(iid), section })).filter((i) => i.t);
    r().checklist = next;
    refreshHead();
    await persist(next);
  });

  async function enrich(btn) {
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Jarvis думает…';
    try {
      const body = await api('checklist', { id }, { signal: btn.closest('#frm') ? scopeSignal('modal') : undefined }).catch((e) => { throw isAbort(e) ? e : new Error(e.message === 'rate_limited' ? 'лимит Gemini, попробуйте через минуту' : e.message); });
      if (!btn.isConnected) return;
      const next = cl();
      const add = (body.items || []).filter((x) => !next.items.some((i) => lc(i.t) === lc(x.t)));
      next.items.push(...add.map((x) => ({ id: uid(), t: x.t, hint: x.hint || null, section: SEC_KEYS.includes(x.section) ? x.section : 'details', prio: PRIO_RANK[x.prio] != null ? x.prio : 'med', done: false, src: 'ai' })));
      await persist(next);
      toast(add.length ? `Jarvis добавил пунктов: ${add.length}` : 'Jarvis считает, что всё уже учтено');
      redraw();
    } catch (err) {
      if (isAbort(err)) return;
      toast('Не получилось: ' + (err.message || err), 'err');
      btn.disabled = false; btn.textContent = '✦ Jarvis дополнит';
    }
  }
}

// ---------- плавная перестановка (FLIP): запомнить места → поменять → анимировать сдвиг ----------
function flipSnapshot(scope) {
  const m = new Map();
  scope.querySelectorAll('.cl-item').forEach((el) => m.set(el.dataset.clItem, el.getBoundingClientRect()));
  return m;
}
function flipPlay(scope, before, skip) {
  scope.querySelectorAll('.cl-item').forEach((el) => {
    if (el === skip) return;
    const a = before.get(el.dataset.clItem);
    if (!a) return;
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) return;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
}
async function animateReorder(box, change) {
  const before = flipSnapshot(box);
  change();
  const fresh = document.querySelector(`[data-cl-req="${box.dataset.clReq}"]`);
  if (fresh) flipPlay(fresh, before);
}

// ---------- перетаскивание: мышь и палец, внутри секции и между секциями ----------
let touchLock = false;
document.addEventListener('touchmove', (e) => { if (touchLock) e.preventDefault(); }, { passive: false });

function enableDrag(box, onDrop) {
  box.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('[data-cl-grip]');
    const row = grip?.closest('.cl-item');
    if (!row || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const touch = e.pointerType !== 'mouse';
    const sx = e.clientX, sy = e.clientY;
    let started = false, timer = null, ghost = null, ph = null, x = sx, y = sy, vx = 0, lastX = sx, raf = 0, overList = null;
    const rect = row.getBoundingClientRect();
    const offX = sx - rect.left, offY = sy - rect.top;
    const scroller = box.closest('.ov') || document.scrollingElement;

    const start = () => {
      started = true; touchLock = true;
      box.classList.add('dragging');
      // место-заполнитель той же высоты
      ph = document.createElement('div');
      ph.className = 'cl-ph-slot';
      ph.style.height = rect.height + 'px';
      row.after(ph);
      // поднимаем карточку
      ghost = row;
      ghost.classList.add('lifted');
      Object.assign(ghost.style, { width: rect.width + 'px', left: rect.left + 'px', top: rect.top + 'px' });
      document.body.append(ghost);
      if (navigator.vibrate && touch) navigator.vibrate(8);
      tick();
    };
    const tick = () => {
      // наклон по скорости движения — как будто карточку держат пальцами
      vx = vx * 0.8 + (x - lastX) * 0.2; lastX = x;
      const tilt = Math.max(-4, Math.min(4, vx * 0.6));
      ghost.style.transform = `translate(${x - offX - rect.left}px, ${y - offY - rect.top}px) rotate(${tilt}deg) scale(1.02)`;
      // автопрокрутка у краёв окна формы
      const box2 = scroller.getBoundingClientRect ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight };
      if (y < box2.top + 70) scroller.scrollTop -= 10; else if (y > (box2.bottom || innerHeight) - 70) scroller.scrollTop += 10;
      raf = requestAnimationFrame(tick);
    };
    const place = () => {
      const el = document.elementFromPoint(x, y);
      const list = el?.closest('[data-cl-list]') || el?.closest('.cl-sec')?.querySelector('[data-cl-list]');
      if (!list || !box.contains(list)) return;
      if (overList !== list) { overList?.classList.remove('over'); overList = list; list.classList.add('over'); }
      const items = [...list.querySelectorAll('.cl-item')];
      let ref = null;
      for (const it of items) { const b = it.getBoundingClientRect(); if (y < b.top + b.height / 2) { ref = it; break; } }
      const hint = list.querySelector('.cl-drop-hint');
      const target = ref || hint;
      if (ph.nextSibling === target && ph.parentNode === list) return;
      const before = flipSnapshot(box);
      list.insertBefore(ph, target);
      flipPlay(box, before, ghost);
    };
    const move = (ev) => {
      x = ev.clientX; y = ev.clientY;
      if (!started) { if (Math.hypot(x - sx, y - sy) > 4) start(); else return; } // тянем только за «ручку», поэтому палец и мышь — одинаково
      place();
    };
    const cleanup = () => {
      clearTimeout(timer); cancelAnimationFrame(raf); touchLock = false;
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    };
    const up = () => {
      cleanup();
      if (!started) return;
      overList?.classList.remove('over');
      // мягкое приземление на новое место
      const to = ph.getBoundingClientRect();
      const anim = ghost.animate([
        { transform: ghost.style.transform },
        { transform: `translate(${to.left - rect.left}px, ${to.top - rect.top}px) rotate(0deg) scale(1)` },
      ], { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
      anim.onfinish = () => {
        ghost.classList.remove('lifted');
        ghost.removeAttribute('style');
        ph.replaceWith(ghost);
        ghost.animate([{ boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 500 });
        box.classList.remove('dragging');
        const order = [...box.querySelectorAll('[data-cl-list]')].flatMap((l) => [...l.querySelectorAll('.cl-item')].map((it) => ({ id: it.dataset.clItem, section: l.dataset.clList })));
        onDrop(order);
      };
    };
    addEventListener('pointermove', move, { passive: true });
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

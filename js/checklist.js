// Чек-лист запроса: экспертный шаблон + персональные пункты из досье (✦), аккуратный вид и плавные галочки
import { TEMPLATES, pickTemplate } from './checklist-templates.js';
import { esc, toast } from './ui.js';
import { state, byId, save } from './data.js';
import { getSupabase } from './supabase.js';

const uid = () => Math.random().toString(36).slice(2, 9);
const LANG = { EN: 'английски', FR: 'французски' };
const KIDS = /сын|доч|реб[её]н|дет|kid|child|enfant/i;
const lc = (s) => String(s || '').toLowerCase();

// персональные пункты: то, о чём гость сам не подумает
function personal(key, r, c) {
  if (!c) return [];
  const out = [];
  const add = (t, hint, phase = 'before') => out.push({ t, hint, phase });
  const people = state.people.filter((p) => p.client_id === c.id);
  const trip = state.trips.find((t) => t.client_id === c.id && t.start_date && r.deadline && r.deadline.slice(0, 10) >= t.start_date && r.deadline.slice(0, 10) <= (t.end_date || t.start_date));
  const companions = lc(trip?.companions);
  const kids = people.filter((p) => KIDS.test(p.role || '')).length || KIDS.test(companions);
  const allergies = [...(c.allergies || []), ...(c.diet || [])];
  const others = people.filter((p) => (p.allergies || []).length);
  const food = ['dining', 'gift', 'hotel', 'activity', 'flowers'].includes(key);

  if (allergies.length && (food || key === 'spa')) add(`Передать: ${allergies.join(', ')}`, key === 'spa' ? 'масла, кремы, чай после процедуры' : 'письменно и ещё раз в день визита');
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  if (others.length && food) for (const p of others) add(`${cap(lc(p.role) || p.name)}: аллергия — ${p.allergies.join(', ')}`, key === 'flowers' || key === 'gift' ? 'чтобы подарок был безопасен для всех рядом' : 'если будет вместе с гостем');
  if ((c.dislikes || []).length && ['dining', 'gift', 'flowers', 'hotel', 'activity'].includes(key)) add(`Стоп-лист: ${c.dislikes.join(', ')}`);
  if ((c.likes || []).length && ['gift', 'flowers', 'hotel'].includes(key)) add(`Добавить любимое: ${c.likes.slice(0, 3).join(', ')}`);
  if (kids) {
    if (key.startsWith('airport') || key === 'transfer') add('Детское кресло и бустер', KIDS.test(companions) ? 'едут дети — по возрасту и весу' : 'если едут дети — по возрасту и весу');
    if (key === 'dining') add('Детское меню и стульчик');
    if (key === 'hotel') add('Детская кроватка, халатики, набор для детей');
    if (key === 'activity') add('Программа подходит детям по возрасту');
  }
  if (c.pref_transport && (key.startsWith('airport') || key === 'transfer')) add(`Машина: ${c.pref_transport}`);
  if (c.pref_food && key === 'dining') add(`Кухня по вкусу: ${c.pref_food}`);
  if (c.pref_spa && key === 'spa') add(`Как любит: ${c.pref_spa}`);
  if (c.pref_hotels && key === 'hotel') add(`Предпочтения: ${c.pref_hotels}`);
  if (c.travel_habits && (key === 'airport_out' || key === 'hotel')) add(`Привычки: ${c.travel_habits}`);
  if ((c.loyalty || []).length && (key === 'hotel' || key === 'airport_out')) add(`Программа лояльности: ${c.loyalty.join(', ')}`);
  if (LANG[c.language] && ['airport_in', 'airport_out', 'transfer', 'activity', 'health', 'spa'].includes(key)) add(`Персонал говорит по-${LANG[c.language]}`);
  if (c.vip && key === 'airport_in') add('Личная встреча или ваша открытка в машине', 'для VIP — маленький жест с первой минуты');
  // повод рядом: день рождения гостя или близкого в ближайшие 3 дня от даты запроса
  if (r.deadline && ['dining', 'hotel', 'spa'].includes(key)) {
    const d0 = Date.parse(r.deadline.slice(0, 10) + 'T12:00:00Z');
    const near = [[c.birthday, 'гостя'], ...people.map((p) => [p.birthday, (lc(p.role) || p.name)])].find(([b]) => {
      if (!b) return false;
      const [, m, d] = b.split('-').map(Number);
      const y = new Date(d0).getUTCFullYear();
      return [y - 1, y, y + 1].some((yy) => Math.abs(Date.UTC(yy, m - 1, d, 12) - d0) <= 3 * 864e5);
    });
    if (near) { const [, m, d] = near[0].split('-'); add(`${near[1] === 'гостя' ? 'День рождения гостя' : 'День рождения: ' + near[1]} — ${+d}.${m}`, 'комплимент от заведения или открытка'); }
  }
  return out.map((x) => ({ ...x, src: 'personal' }));
}

export function buildChecklist(r, key = pickTemplate(r)) {
  const tpl = TEMPLATES[key] || TEMPLATES.other;
  const c = r.client_id ? byId('clients', r.client_id) : null;
  const items = [];
  for (const phase of ['before', 'day', 'after'])
    for (const [t, hint] of tpl[phase] || []) items.push({ id: uid(), t, hint: hint || null, phase, done: false, src: 'template' });
  // персональные — в начало своего этапа, без повторов
  const pers = personal(key, r, c).filter((p) => !items.some((i) => lc(i.t) === lc(p.t)));
  for (const p of pers.reverse()) items.splice(items.findIndex((i) => i.phase === p.phase), 0, { id: uid(), done: false, hint: p.hint || null, ...p });
  return { template: key, items };
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

// ---------- чек-лист в форме запроса ----------
const PHASES = [['before', 'Заранее'], ['day', 'В день'], ['after', 'После']];
const CHECK = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.2"/><path d="M6 10.4l2.6 2.6L14 7.6"/></svg>';

export function checklistSection(r) {
  if (!r?.id) return '';
  const cl = r.checklist;
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
      ${items.length ? PHASES.map(([ph, label]) => {
        const list = items.filter((i) => i.phase === ph);
        return list.length ? `<div class="cl-phase"><span class="cl-ph">${label}</span>${list.map((i) => `
          <div class="cl-item${i.done ? ' done' : ''}${i.src === 'personal' || i.src === 'ai' ? ' pers' : ''}" data-cl-item="${i.id}">
            <button type="button" class="cl-check" data-cl-check="${i.id}" aria-pressed="${i.done}" aria-label="${esc(i.t)}">${CHECK}</button>
            <span class="cl-text"><span>${i.src === 'personal' || i.src === 'ai' ? '<b class="cl-star" title="' + (i.src === 'ai' ? 'Добавил Jarvis' : 'Из досье гостя') + '">✦</b> ' : ''}${esc(i.t)}</span>${i.hint ? `<small>${esc(i.hint)}</small>` : ''}</span>
            <button type="button" class="cl-x" data-cl-del="${i.id}" aria-label="Убрать пункт">×</button>
          </div>`).join('')}</div>` : '';
      }).join('') : '<p class="cl-empty">Пунктов пока нет.</p>'}
      <div class="cl-foot">
        <input type="text" class="cl-add" placeholder="＋ Свой пункт" enterkeyhint="done">
        <button type="button" class="cl-link" data-cl-ai>✦ Jarvis дополнит</button>
        <select class="cl-tpl" aria-label="Шаблон">${Object.entries(TEMPLATES).map(([k, v]) => `<option value="${k}"${k === cl?.template ? ' selected' : ''}>${v.icon} ${v.title}</option>`).join('')}</select>
      </div>
    </div></div>
  </section>`;
}

export function bindChecklist(root) {
  const box = root.querySelector('[data-cl-req]');
  if (!box) return;
  const id = box.dataset.clReq;
  const r = () => byId('requests', id);
  const persist = async (cl) => {
    try { await save('requests', id, { checklist: cl }); } catch (e) { toast('Не сохранилось: ' + (e.message || e), 'err'); }
  };
  // плавное раскрытие; открыто по умолчанию, если есть невыполненные
  const setOpen = (open) => { box.classList.toggle('open', open); box.querySelector('[data-cl-toggle]').setAttribute('aria-expanded', String(open)); };
  setOpen((r()?.checklist?.items || []).some((i) => !i.done));
  box.querySelector('[data-cl-toggle]').addEventListener('click', () => setOpen(!box.classList.contains('open')));

  const refreshHead = () => {
    const items = r()?.checklist?.items || [];
    const done = items.filter((i) => i.done).length;
    box.querySelector('.cl-bar i').style.width = (items.length ? (done / items.length) * 100 : 0) + '%';
    box.querySelector('.cl-prog small').textContent = `${done}/${items.length}`;
    if (items.length && done === items.length) { box.classList.add('complete'); setTimeout(() => box.classList.remove('complete'), 900); }
  };
  box.addEventListener('click', async (e) => {
    const chk = e.target.closest('[data-cl-check]');
    const del = e.target.closest('[data-cl-del]');
    if (chk) {
      const cl = structuredClone(r().checklist);
      const it = cl.items.find((i) => i.id === chk.dataset.clCheck);
      it.done = !it.done;
      const row = chk.closest('.cl-item');
      row.classList.toggle('done', it.done); chk.setAttribute('aria-pressed', String(it.done));
      r().checklist = cl; refreshHead();
      await persist(cl);
    } else if (del) {
      const cl = structuredClone(r().checklist);
      cl.items = cl.items.filter((i) => i.id !== del.dataset.clDel);
      const row = del.closest('.cl-item');
      row.classList.add('leaving');
      setTimeout(() => row.remove(), 220);
      r().checklist = cl; refreshHead();
      await persist(cl);
    } else if (e.target.closest('[data-cl-ai]')) {
      enrich(e.target.closest('[data-cl-ai]'));
    }
  });
  box.querySelector('.cl-add').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const t = e.target.value.trim();
    if (!t) return;
    const cl = structuredClone(r().checklist || { template: 'other', items: [] });
    cl.items.push({ id: uid(), t, hint: null, phase: 'before', done: false, src: 'manual' });
    e.target.value = '';
    await persist(cl);
    redraw();
  });
  box.querySelector('.cl-tpl').addEventListener('change', async (e) => {
    const fresh = buildChecklist(r(), e.target.value);
    const old = r().checklist?.items || [];
    // отмеченное и своё — сохраняем
    for (const it of fresh.items) if (old.some((o) => o.done && lc(o.t) === lc(it.t))) it.done = true;
    fresh.items.push(...old.filter((o) => o.src === 'manual' || o.src === 'ai'));
    await persist(fresh);
    redraw();
  });
  const redraw = () => { box.outerHTML = checklistSection(r()); bindChecklist(root); root.querySelector('[data-cl-req]')?.classList.add('open'); };

  async function enrich(btn) {
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Jarvis думает…';
    try {
      const sb = await getSupabase();
      const token = (await sb.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/checklist', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ id }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error === 'rate_limited' ? 'лимит Gemini, попробуйте через минуту' : body.error || res.status);
      const cl = structuredClone(r().checklist || { template: 'other', items: [] });
      const add = (body.items || []).filter((x) => !cl.items.some((i) => lc(i.t) === lc(x.t)));
      cl.items.push(...add.map((x) => ({ id: uid(), t: x.t, hint: x.hint || null, phase: x.phase || 'before', done: false, src: 'ai' })));
      await persist(cl);
      toast(add.length ? `Jarvis добавил пунктов: ${add.length}` : 'Jarvis считает, что всё уже учтено');
      redraw();
    } catch (err) {
      toast('Не получилось: ' + (err.message || err), 'err');
      btn.disabled = false; btn.textContent = '✦ Jarvis дополнит';
    }
  }
}

// Jarvis: умное поле ввода. Текст → Gemini (через /api/parse) → превью → карточки.
// Текст консьержа не теряется никогда: при любой ошибке он сохраняется как запрос «нужна проверка».
import { getSupabase } from './supabase.js';
import { CATEGORIES, URGENCY, CURRENCIES, TZ } from './const.js';
import { esc, options, field, openModal, toast, fromParisInput } from './ui.js';
import { state, byId, save } from './data.js';
import { firstKey } from './statuses.js';
import { findClient } from './match.js';
import { restrictionsBlock } from './forms.js';
import { deadlinePicker, bindDeadlinePicker } from './datepicker.js';
import { render } from './router.js';

const LS_TEXT = 'jarvis.draft', LS_AUTO = 'jarvis.auto';
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };

const smart = { text: ls.get(LS_TEXT) || '', busy: false, result: null, auto: ls.get(LS_AUTO) === '1' };

const REASONS = {
  no_key: 'ключ Gemini ещё не добавлен в Vercel',
  rate_limited: 'исчерпан бесплатный лимит Gemini, попробуйте через минуту',
  unauthorized: 'нужно заново войти на сайт',
  timeout: 'Gemini не ответил вовремя',
  bad_json: 'ИИ вернул непонятный ответ',
  empty_result: 'ИИ не нашёл в тексте запросов',
};

// ---------- поле ----------
export function smartBar() {
  const r = smart.result;
  return `<section class="jarvis${smart.busy ? ' busy' : ''}">
    <form class="jarvis-form" id="jarvisForm" autocomplete="off">
      <span class="jarvis-mark" aria-hidden="true">✦</span>
      <textarea id="jarvisInput" rows="1" placeholder="Опишите запрос для Jarvis"
        aria-label="Умное поле: опишите запрос обычным текстом" ${smart.busy ? 'disabled' : ''}>${esc(smart.text)}</textarea>
      <button class="jarvis-send" type="submit" aria-label="Разобрать" ${smart.busy ? 'disabled' : ''}>${smart.busy ? '<span class="spin"></span>' : '↵'}</button>
    </form>
    <div class="jarvis-foot">
      <span>${smart.busy ? 'Jarvis разбирает текст…' : 'Например: «Мария Иванова: массаж в пятницу в 15:00, аллергия на миндаль»'}</span>
      <label class="switch"><input type="checkbox" id="jarvisAuto"${smart.auto ? ' checked' : ''}><span></span>Создавать сразу</label>
    </div>
    ${r ? `<div class="jarvis-result ${r.kind}" role="status"><div>${r.lines.map((l) => `<p>${l}</p>`).join('')}</div>
      <button type="button" class="icon-btn" id="jarvisClose" aria-label="Скрыть">✕</button></div>` : ''}
  </section>`;
}

export function bindSmart(app) {
  const ta = app.querySelector('#jarvisInput');
  if (!ta) return;
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; };
  grow();
  ta.addEventListener('input', () => { smart.text = ta.value; ls.set(LS_TEXT, ta.value || null); grow(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); app.querySelector('#jarvisForm').requestSubmit(); }
  });
  app.querySelector('#jarvisForm').addEventListener('submit', (e) => { e.preventDefault(); run(); });
  app.querySelector('#jarvisAuto').addEventListener('change', (e) => { smart.auto = e.target.checked; ls.set(LS_AUTO, smart.auto ? '1' : null); });
  app.querySelector('#jarvisClose')?.addEventListener('click', () => { smart.result = null; render(); });
}

const setBusy = (b) => { smart.busy = b; render(); };
const clearText = () => { smart.text = ''; ls.set(LS_TEXT, null); };

// ---------- разбор ----------
async function run() {
  const text = smart.text.trim();
  if (!text || smart.busy) return;
  smart.result = null;
  setBusy(true);
  let parsed;
  try {
    const sb = await getSupabase();
    const token = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ text }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'http_' + r.status);
    parsed = body.requests;
    if (!Array.isArray(parsed) || !parsed.length) throw new Error('empty_result');
  } catch (err) {
    setBusy(false);
    return saveRaw(text, REASONS[err.message] || 'нет связи с ИИ');
  }
  setBusy(false);
  const drafts = parsed.map(toDraft);
  const simple = drafts.every((d) => d.client_id && d.client_id !== '__new' && !d.ambiguous && !d.needs_review);
  if (smart.auto && simple) return createAll(drafts, text);
  preview(drafts, text);
}

function toDraft(p) {
  const m = p.guest_name ? findClient(p.guest_name, state.clients) : null;
  return {
    ...p,
    client_id: m ? m.client.id : p.guest_name ? '__new' : '',
    ambiguous: !!m?.ambiguous,
    new_name: p.guest_name || '',
    deadline_local: p.deadline_iso || '',
  };
}

// если ИИ недоступен — сохраняем исходный текст, чтобы ничего не потерять
async function saveRaw(text, reason) {
  try {
    await save('requests', null, {
      summary: text.length > 80 ? text.slice(0, 78) + '…' : text, original_message: text,
      category: 'Other', urgency: 'normal', status: firstKey(), needs_review: true,
    });
    clearText();
    smart.result = { kind: 'warn', lines: [`<b>Jarvis не смог разобрать текст</b>: ${esc(reason)}.`, 'Текст сохранён как запрос с пометкой «проверить» — он в колонке «Новый», откройте и заполните вручную.'] };
  } catch (err) {
    smart.result = { kind: 'err', lines: [`Не удалось сохранить: ${esc(err.message || err)}.`, 'Текст остался в поле — попробуйте ещё раз.'] };
  }
  render();
}

// ---------- превью ----------
function preview(drafts, text) {
  const clients = [...state.clients].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((c) => [c.id, (c.vip ? '★ ' : '') + c.name]);
  const card = (d, i) => {
    const sel = byId('clients', d.client_id);
    const add = additions(sel, d);
    const guestOpts = [...(d.new_name ? [['__new', `＋ Новый гость: ${d.new_name}`]] : [['__new', '＋ Новый гость…']]), ...clients];
    return `<article class="pv" data-i="${i}">
      <div class="pv-head"><b>${drafts.length > 1 ? `Запрос ${i + 1} из ${drafts.length}` : 'Запрос'}</b>
        ${drafts.length > 1 ? `<button type="button" class="pv-skip" data-skip="${i}">Не создавать</button>` : ''}</div>
      ${field(`client_${i}`, 'Гость', `<select id="f-client_${i}" name="client_${i}">${options(guestOpts, d.client_id, '— без гостя —')}</select>`,
        d.ambiguous ? 'Похоже на нескольких гостей — проверьте, что выбран нужный.' : d.client_id === '__new' ? 'Такого гостя ещё нет — будет создан новый профиль.' : '')}
      <div class="pv-newname" ${d.client_id === '__new' ? '' : 'hidden'}>${field(`newname_${i}`, 'Имя нового гостя', `<input id="f-newname_${i}" name="newname_${i}" type="text" value="${esc(d.new_name)}">`)}</div>
      <div class="pv-restr">${restrictionsBlock(sel)}</div>
      ${add.length ? `<div class="pv-add">В профиль добавится: ${add.map((a) => `<b class="chip">${esc(a.label)}: ${esc(a.value)}</b>`).join(' ')}</div>` : ''}
      ${field(`summary_${i}`, 'Что нужно', `<input id="f-summary_${i}" name="summary_${i}" type="text" required value="${esc(d.summary)}">`)}
      <div class="f2">
        ${field(`category_${i}`, 'Категория', `<select id="f-category_${i}" name="category_${i}">${options(Object.entries(CATEGORIES).map(([k, ic]) => [k, ic + ' ' + k]), d.category)}</select>`)}
        ${field(`budget_${i}`, 'Бюджет', `<div class="pv-money"><input id="f-budget_${i}" name="budget_${i}" type="number" min="0" step="any" inputmode="decimal" value="${d.budget_amount ?? ''}"><select name="currency_${i}" aria-label="Валюта">${options(CURRENCIES, d.currency || 'EUR')}</select></div>`)}
      </div>
      ${field(`urgency_${i}`, 'Срочность', `<div class="seg-pick">${URGENCY.map(([k, l]) =>
        `<label class="u-opt u-${k}"><input type="radio" name="urgency_${i}" value="${k}"${k === d.urgency ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>`)}
      ${field(`deadline_${i}`, 'Срок · время Парижа', deadlinePicker(d.deadline_local ? fromParisInput(d.deadline_local) : null, `deadline_${i}`))}
      ${field(`questions_${i}`, 'Что уточнить у гостя', `<textarea id="f-questions_${i}" name="questions_${i}" rows="2">${esc(d.missing_questions.join('\n'))}</textarea>`)}
      <div class="checks">
        <label class="check"><input type="checkbox" name="approval_${i}"${d.approval_needed ? ' checked' : ''}> Нужно одобрение гостя</label>
        <label class="check"><input type="checkbox" name="review_${i}"${d.needs_review ? ' checked' : ''}> Нужна проверка</label>
      </div>
    </article>`;
  };
  const m = openModal({
    title: drafts.length > 1 ? `Jarvis нашёл ${drafts.length} запроса` : 'Jarvis разобрал запрос',
    saveLabel: drafts.length > 1 ? `Создать (${drafts.length})` : 'Создать',
    body: `<p class="pv-src">«${esc(text)}»</p>${drafts.map(card).join('')}`,
    onSave: async (v) => {
      const items = drafts.map((d, i) => ({ d, i })).filter(({ i }) => !skipped.has(i)).map(({ d, i }) => ({
        ...d,
        client_id: v[`client_${i}`], new_name: (v[`newname_${i}`] || '').trim(),
        summary: v[`summary_${i}`].trim(), category: v[`category_${i}`], urgency: v[`urgency_${i}`] || d.urgency,
        deadline_local: v[`deadline_${i}`] || '', budget_amount: v[`budget_${i}`] === '' ? null : Number(v[`budget_${i}`]),
        currency: v[`currency_${i}`], missing_questions: v[`questions_${i}`].split('\n').map((s) => s.trim()).filter(Boolean),
        approval_needed: !!v[`approval_${i}`], needs_review: !!v[`review_${i}`],
      }));
      if (!items.length) throw new Error('все запросы отмечены «Не создавать»');
      await createAll(items, text);
    },
  });
  // текст остаётся в поле, пока карточки не созданы — отмена ничего не теряет
  const skipped = new Set();
  bindDeadlinePicker(m.form);
  m.form.querySelectorAll('.pv').forEach((el) => {
    const i = +el.dataset.i;
    el.querySelector(`[name="client_${i}"]`).addEventListener('change', (e) => {
      const isNew = e.target.value === '__new';
      el.querySelector('.pv-newname').hidden = !isNew;
      el.querySelector('.pv-restr').innerHTML = isNew ? '' : restrictionsBlock(byId('clients', e.target.value));
      const add = additions(byId('clients', e.target.value), drafts[i]);
      const box = el.querySelector('.pv-add');
      if (box) box.innerHTML = add.length ? 'В профиль добавится: ' + add.map((a) => `<b class="chip">${esc(a.label)}: ${esc(a.value)}</b>`).join(' ') : '';
    });
    el.querySelector('[data-skip]')?.addEventListener('click', (e) => {
      const off = skipped.has(i) ? (skipped.delete(i), false) : (skipped.add(i), true);
      el.classList.toggle('skipped', off);
      e.target.textContent = off ? 'Вернуть' : 'Не создавать';
      el.querySelector(`[name="summary_${i}"]`).required = !off;
    });
  });
}

// что нового узнали о госте (без дублей с тем, что уже в профиле)
const LABELS = { allergies: 'аллергия', diet: 'диета', health: 'здоровье', likes: 'любит', dislikes: 'избегает' };
const PREF = { food: ['pref_food', 'еда'], spa: ['pref_spa', 'спа'], transport: ['pref_transport', 'транспорт'], hotels: ['pref_hotels', 'отели'] };
const lc = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
const has = (list, v) => (list || []).some((x) => lc(x) === lc(v) || lc(x).includes(lc(v)) || lc(v).includes(lc(x)));

function additions(client, d) {
  const out = [];
  for (const k of ['allergies', 'diet', 'health', 'likes', 'dislikes']) {
    const seen = [...(client?.[k] || [])];
    const found = k === 'likes' || k === 'dislikes' ? d[k] : d.new_restrictions?.[k];
    for (const v of found || []) if (v && !has(seen, v)) { out.push({ kind: k, label: LABELS[k], value: v }); seen.push(v); }
  }
  for (const [k, [col, label]] of Object.entries(PREF)) {
    const v = d.preferences?.[k];
    if (v && !lc(client?.[col]).includes(lc(v))) out.push({ kind: col, label, value: v });
  }
  return out;
}

// ---------- создание ----------
const fmtWhen = (iso) => {
  if (!iso) return 'без срока';
  const d = new Date(iso);
  const day = d.toLocaleDateString('ru-RU', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' }).replace(',', '');
  const t = d.toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  return t === '00:00' ? day : `${day} ${t}`;
};
const SHORT = { 'Spa & Wellness': 'Spa', 'Health & Fitness': 'Health', 'Gifts & Events': 'Gifts' };

async function createAll(items, text) {
  const lines = [];
  for (const d of items) {
    let client = d.client_id && d.client_id !== '__new' ? byId('clients', d.client_id) : null;
    let createdGuest = false;
    if (d.client_id === '__new') {
      const name = d.new_name || d.guest_name || 'Новый гость';
      const same = findClient(name, state.clients);
      if (same && same.score >= 0.97) client = same.client;
      else { client = await save('clients', null, { name, language: d.guest_language || 'RU' }); createdGuest = true; }
    }
    // дописываем в профиль аллергии, ограничения и предпочтения — без дублей
    const add = client ? additions(client, d) : [];
    if (client && add.length) {
      const patch = {};
      for (const a of add) {
        if (a.kind in LABELS) patch[a.kind] = [...(patch[a.kind] || client[a.kind] || []), a.value];
        else patch[a.kind] = [patch[a.kind] ?? client[a.kind], a.value].filter(Boolean).join('; ');
      }
      client = await save('clients', client.id, patch);
    }
    const deadline = d.deadline_local ? (d.deadline_local.length > 16 || d.deadline_local.endsWith('Z') ? d.deadline_local : fromParisInput(d.deadline_local)) : null;
    await save('requests', null, {
      client_id: client?.id || null, summary: d.summary, original_message: text, category: d.category, urgency: d.urgency,
      status: firstKey(), deadline, budget_amount: d.budget_amount, currency: d.budget_amount != null ? d.currency || 'EUR' : null,
      clarifying_questions: d.missing_questions.join('\n') || null, needs_approval: !!d.approval_needed, needs_review: !!d.needs_review,
    });
    const restr = add.filter((a) => a.kind in LABELS);
    lines.push(`<b>Создан запрос${client ? ` — ${esc(client.name)}` : ''}</b>: ${esc(SHORT[d.category] || d.category)}, ${esc(fmtWhen(deadline))}.` +
      (createdGuest ? ' Добавлен новый гость.' : '') +
      (restr.length ? ` ${restr.map((a) => ({ allergies: 'Добавлена аллергия', diet: 'Добавлена диета', health: 'Добавлено о здоровье', likes: 'Любит', dislikes: 'Избегает' }[a.kind]) + `: <b>${esc(a.value)}</b>`).join('. ')}.` : ''));
  }
  clearText();
  smart.result = { kind: 'ok', lines };
  render();
  toast(items.length > 1 ? `Создано запросов: ${items.length}` : 'Запрос создан');
}

// для локальной проверки превью
export const _test = { preview, toDraft };

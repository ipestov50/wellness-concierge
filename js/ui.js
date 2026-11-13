import { TZ } from './const.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function options(list, selected, blank) {
  const items = list.map((o) => (Array.isArray(o) ? o : [o, o]));
  return (blank != null ? `<option value="">${esc(blank)}</option>` : '') +
    items.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(selected ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
}

export function field(name, label, control, hint = '') {
  return `<div class="f"><label for="f-${name}">${esc(label)}</label>${control}${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;
}

// ---------- время Европы/Парижа ----------
function parisParts(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).map((x) => [x.type, x.value]));
  if (p.hour === '24') p.hour = '00';
  return p;
}
// ISO-время -> значение для <input type="datetime-local"> в парижском времени
export function toParisInput(iso) {
  if (!iso) return '';
  const p = parisParts(new Date(iso));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
// значение <input type="datetime-local"> (парижское время) -> ISO
export function fromParisInput(v) {
  if (!v) return null;
  const [d, t = '00:00'] = v.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, day, h, min);
  const offset = (g) => { const p = parisParts(new Date(g)); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - g; };
  let ts = guess - offset(guess);
  ts = guess - offset(ts);
  return new Date(ts).toISOString();
}
export function fmtDeadline(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const date = d.toLocaleDateString('ru-RU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  return time === '00:00' ? date : `${date} ${time}`;
}
export function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v.length === 10 ? v + 'T12:00:00Z' : v);
  return d.toLocaleDateString('ru-RU', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
}
export function fmtMoney(amount, cur) {
  if (amount == null || amount === '') return '';
  return Number(amount).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + (cur ? ' ' + cur : '');
}

// списки: «а, б» или по строкам -> массив без пустых и дублей (без учёта регистра)
export function toList(text) {
  const seen = new Set();
  return String(text || '').split(/[\n,;]+/).map((s) => s.trim()).filter((s) => {
    const k = s.toLowerCase();
    if (!s || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// ---------- всплывающее окно ----------
export function openModal({ title, body, onSave, onDelete, saveLabel = 'Сохранить' }) {
  const host = $('#modal');
  host.innerHTML = `
    <div class="ov" id="ov">
      <form class="dlg" role="dialog" aria-modal="true" aria-label="${esc(title)}" id="frm" novalidate>
        <div class="dlg-head"><h2>${esc(title)}</h2>
          <button type="button" class="icon-btn" id="x" aria-label="Закрыть">✕</button></div>
        <div class="notice err-box" id="frm-err" hidden></div>
        ${body}
        <div class="foot">
          ${onDelete ? '<button type="button" class="btn danger left" id="del">Удалить</button>' : ''}
          <button type="button" class="btn" id="cancel">Отмена</button>
          <button class="btn primary" type="submit" id="ok">${esc(saveLabel)}</button>
        </div>
      </form>
    </div>`;
  document.body.classList.add('modal-open');
  const form = $('#frm');
  const close = () => { host.innerHTML = ''; document.body.classList.remove('modal-open'); };
  const fail = (msg) => { const b = $('#frm-err'); b.textContent = msg; b.hidden = false; b.scrollIntoView({ block: 'nearest' }); };
  $('#cancel').onclick = close;
  $('#x').onclick = close;
  $('#ov').addEventListener('mousedown', (e) => { if (e.target.id === 'ov') close(); });
  const first = form.querySelector('input:not([type=hidden]),select,textarea');
  if (first && matchMedia('(pointer:fine)').matches) first.focus();
  if (onDelete) {
    let armed = false;
    $('#del').onclick = async (e) => {
      if (!armed) { armed = true; e.target.textContent = 'Точно удалить?'; e.target.classList.add('armed'); return; }
      e.target.disabled = true;
      try { await onDelete(); close(); } catch (err) { e.target.disabled = false; fail('Не удалось удалить: ' + (err.message || err)); }
    };
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const bad = [...form.elements].find((el) => el.required && !String(el.value).trim());
    if (bad) { fail('Заполните поле «' + (form.querySelector(`label[for="${bad.id}"]`)?.textContent || bad.name) + '».'); bad.focus(); return; }
    const v = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      v[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    $('#ok').disabled = true;
    try { await onSave(v); close(); } catch (err) { $('#ok').disabled = false; fail('Не удалось сохранить: ' + (err.message || err)); }
  };
  return { close, form };
}
export const closeModal = () => { const h = $('#modal'); if (h) h.innerHTML = ''; document.body.classList.remove('modal-open'); };

// ---------- короткое уведомление ----------
let toastTimer;
export function toast(msg, kind = '', action = null) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.className = 'toast show ' + kind + (action ? ' has-action' : '');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = action.label;
    b.onclick = () => { t.classList.remove('show'); action.fn(); };
    t.append(b);
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 7000 : kind === 'err' ? 6000 : 3500);
}

// ---------- монограмма гостя ----------
export function initials(name) {
  const clean = String(name || '').replace(/\(.*?\)/g, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}
export function avatar(c, cls = '') {
  if (!c) return `<span class="av av-none ${cls}" aria-hidden="true">?</span>`;
  const clean = c.name.replace(/\(.*?\)/g, '').trim();
  let h = 0;
  for (const ch of clean) h = (h * 31 + ch.codePointAt(0)) % 360;
  return `<span class="av${c.vip ? ' av-vip' : ''} ${cls}" style="--h:${h}" aria-hidden="true">${esc(initials(c.name))}</span>`;
}

// Поле-«чипы»: Enter или запятая превращают текст в метку, × убирает её. Значение уходит в скрытое поле (по строке на метку),
// поэтому старые записи (строки через запятую или перенос) открываются метками и сохраняются как раньше.
import { esc, toList } from './ui.js';

const chip = (v, rl = 'Убрать') => `<span class="chip" data-v="${esc(v)}"><span class="chip-t">${esc(v)}</span><button type="button" class="chip-x" tabindex="-1" aria-label="${esc(rl)} «${esc(v)}»">×</button></span>`;
export function chipField(name, items, { tone = 'soft', placeholder = '', label = '', remove = 'Убрать' } = {}) {
  const list = toList((items || []).join('\n'));
  return `<div class="chips tone-${tone}" data-chips data-rl="${esc(remove)}"><div class="chip-box">${list.map((v) => chip(v, remove)).join('')}<input class="chip-in" id="f-${name}-in" type="text" enterkeyhint="done" autocomplete="off" aria-label="${esc(label)}" placeholder="${esc(placeholder)}"></div><input type="hidden" id="f-${name}" name="${name}" value="${esc(list.join('\n'))}"></div>`;
}

export function bindChips(root) {
  const sync = (box) => {
    const vals = [...box.querySelectorAll('.chip')].map((c) => c.dataset.v);
    const hid = box.querySelector('input[type=hidden]');
    hid.value = vals.join('\n');
    box.querySelector('.chip-in').placeholder = vals.length ? '' : box.querySelector('.chip-in').dataset.ph || '';
    hid.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const add = (box, text) => {
    const input = box.querySelector('.chip-in');
    const have = new Set([...box.querySelectorAll('.chip')].map((c) => c.dataset.v.toLowerCase()));
    let added = false;
    for (const v of toList(text)) {
      if (have.has(v.toLowerCase())) continue;
      have.add(v.toLowerCase()); input.insertAdjacentHTML('beforebegin', chip(v, box.dataset.rl || 'Убрать')); added = true;
    }
    input.value = '';
    if (added) sync(box);
  };
  root.querySelectorAll('[data-chips] .chip-in').forEach((i) => { i.dataset.ph = i.placeholder; if (i.closest('[data-chips]').querySelector('.chip')) i.placeholder = ''; });
  root.addEventListener('keydown', (e) => {
    const i = e.target.closest?.('.chip-in'); if (!i || e.isComposing) return;
    const box = i.closest('[data-chips]');
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') { e.preventDefault(); add(box, i.value); }
    else if (e.key === 'Backspace' && !i.value) { box.querySelector('.chip:last-of-type')?.remove(); sync(box); }
  });
  root.addEventListener('input', (e) => { const i = e.target.closest?.('.chip-in'); if (i && /[,;\n]/.test(i.value)) add(i.closest('[data-chips]'), i.value); });
  root.addEventListener('focusout', (e) => { const i = e.target.closest?.('.chip-in'); if (i && i.value.trim()) add(i.closest('[data-chips]'), i.value); });
  root.addEventListener('click', (e) => {
    const x = e.target.closest?.('.chip-x');
    if (x) { const box = x.closest('[data-chips]'); x.closest('.chip').remove(); sync(box); box.querySelector('.chip-in').focus(); return; }
    const b = e.target.closest?.('.chip-box'); if (b && e.target === b) b.querySelector('.chip-in').focus();
  });
}

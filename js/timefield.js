// Время заезда: округлая «таблетка» с часами (печатается цифрами: 1530 → 15:30) и быстрые значения рядом.
const QUICK = ['12:00', '14:00', '15:00', '16:00'];
const pad = (n) => String(n).padStart(2, '0');
export function normTime(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  let h, m;
  if (d.length <= 2) { h = +d; m = 0; } else if (d.length === 3) { h = +d[0]; m = +d.slice(1); } else { h = +d.slice(0, 2); m = +d.slice(2, 4); }
  return h > 23 || m > 59 ? null : `${pad(h)}:${pad(m)}`;
}
export function timeField(name, value, { chips = true } = {}) {
  const v = normTime(value) || '';
  return `<div class="tf" data-tf><span class="tf-pill"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>
    <input id="f-${name}" name="${name}" type="text" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="––:––" value="${v}"></span>
    ${chips ? `<div class="tf-quick" role="group" aria-label="Частые значения">${QUICK.map((q) => `<button type="button" data-q="${q}" aria-pressed="${q === v}">${q}</button>`).join('')}</div>` : ''}</div>`;
}
export function bindTimeFields(root) {
  root.querySelectorAll('[data-tf]').forEach((w) => {
    const inp = w.querySelector('input');
    const sync = () => w.querySelectorAll('[data-q]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.q === inp.value)));
    inp.addEventListener('input', sync);
    inp.addEventListener('blur', () => { const t = normTime(inp.value); inp.value = t === null ? '' : t; sync(); });
    w.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { inp.value = b.dataset.q === inp.value ? '' : b.dataset.q; sync(); }));
  });
}

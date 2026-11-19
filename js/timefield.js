// Поле времени в стиле сервиса: печатается цифрами («1530» → 15:30), шаг ±30 минут, быстрые значения.
const QUICK = ['12:00', '14:00', '15:00', '16:00'];
const pad = (n) => String(n).padStart(2, '0');
export function normTime(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  let h, m;
  if (d.length <= 2) { h = +d; m = 0; } else if (d.length === 3) { h = +d[0]; m = +d.slice(1); } else { h = +d.slice(0, 2); m = +d.slice(2, 4); }
  return h > 23 || m > 59 ? null : `${pad(h)}:${pad(m)}`;
}
export function timeField(name, value, labels = {}) {
  const v = normTime(value) || '';
  const L = { less: 'Раньше на 30 минут', more: 'Позже на 30 минут', ph: '––:––', ...labels };
  return `<div class="tf" data-tf>
    <div class="tf-pill"><button type="button" data-d="-30" aria-label="${L.less}">−</button>
    <span class="tf-in"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>
    <input id="f-${name}" name="${name}" type="text" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="${L.ph}" value="${v}"></span>
    <button type="button" data-d="30" aria-label="${L.more}">+</button></div>
    <div class="tf-quick" role="group">${QUICK.map((q) => `<button type="button" data-q="${q}"${q === v ? ' aria-pressed="true"' : ''}>${q}</button>`).join('')}</div></div>`;
}
export function bindTimeFields(root) {
  root.querySelectorAll('[data-tf]').forEach((w) => {
    const inp = w.querySelector('input');
    const sync = () => w.querySelectorAll('[data-q]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.q === inp.value)));
    const set = (t) => { inp.value = t; sync(); };
    inp.addEventListener('blur', () => { const t = normTime(inp.value); if (t === null) { inp.value = ''; inp.setCustomValidity(''); } else inp.value = t; sync(); });
    inp.addEventListener('input', sync);
    w.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => {
      const t = normTime(inp.value) || '15:00', [h, m] = t.split(':').map(Number);
      const x = (h * 60 + m + Number(b.dataset.d) + 1440) % 1440;
      set(`${pad(Math.floor(x / 60))}:${pad(x % 60)}`);
    }));
    w.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => set(b.dataset.q === inp.value ? '' : b.dataset.q)));
  });
}

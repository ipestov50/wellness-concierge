// Время заезда: обычное поле времени + быстрые значения рядом (без лишних − / +).
const QUICK = ['12:00', '14:00', '15:00', '16:00'];
export function timeField(name, value) {
  const v = /^\d{2}:\d{2}/.test(value || '') ? String(value).slice(0, 5) : '';
  return `<div class="tf" data-tf><input id="f-${name}" name="${name}" type="time" autocomplete="off" value="${v}">
    <div class="tf-quick" role="group" aria-label="Частые значения">${QUICK.map((q) => `<button type="button" data-q="${q}" aria-pressed="${q === v}">${q}</button>`).join('')}</div></div>`;
}
export function bindTimeFields(root) {
  root.querySelectorAll('[data-tf]').forEach((w) => {
    const inp = w.querySelector('input');
    const sync = () => w.querySelectorAll('[data-q]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.q === inp.value)));
    inp.addEventListener('input', sync); inp.addEventListener('change', sync);
    w.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { inp.value = b.dataset.q === inp.value ? '' : b.dataset.q; sync(); }));
  });
}

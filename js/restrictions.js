// Блок «Аллергии, ограничения, стоп-лист» — нужен и в профиле, и в разборе запроса, поэтому отдельно от тяжёлой формы
import { esc } from './ui.js';

export function restrictionsBlock(c) {
  if (!c) return '';
  const groups = [['Аллергии', c.allergies], ['Диета', c.diet], ['Здоровье', c.health], ['Избегать', c.dislikes]].filter(([, l]) => l && l.length);
  if (!groups.length) return '';
  return `<div class="alert"><h4>⚠ Аллергии, ограничения, стоп-лист</h4>${groups.map(([t, l]) =>
    `<div class="alert-row"><span>${t}:</span> ${l.map((x) => `<b class="chip">${esc(x)}</b>`).join(' ')}</div>`).join('')}</div>`;
}

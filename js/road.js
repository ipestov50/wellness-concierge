// «🚦 Дорога» в карточке запроса: сколько ехать из отеля гостя прямо сейчас, с пробками (TomTom)
import { getSupabase } from './supabase.js';
import { esc } from './ui.js';
import { TZ } from './const.js';

const CATS = ['Dining', 'Spa & Wellness', 'Activities', 'Health & Fitness', 'Transport', 'Gifts & Events'];
const hm = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

export function roadSlot(r) {
  if (!r?.id || !r.deadline || !CATS.includes(r.category)) return '';
  const left = new Date(r.deadline).getTime() - Date.now();
  if (left < -30 * 60e3 || left > 24 * 3600e3) return ''; // только для ближайших суток — бережём лимит
  return `<div class="road" data-road="${r.id}"><span class="road-ico">🚦</span><span class="road-txt">Jarvis проверяет дорогу…</span></div>`;
}

export async function bindRoad(root) {
  const el = root.querySelector('[data-road]');
  if (!el) return;
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.functions.invoke('jarvis', { body: { mode: 'traffic', id: el.dataset.road } });
    let t = data;
    if (error) { try { t = await error.context.json(); } catch { t = { error: 'fail' }; } }
    if (!el.isConnected) return;
    if (t?.error === 'no_tomtom_key') { el.remove(); return; }
    if (t?.error) {
      el.classList.add('muted-road');
      el.querySelector('.road-txt').innerHTML = t.error === 'no_endpoints'
        ? 'Чтобы Jarvis следил за дорогой: отель в поездке гостя и партнёр с адресом.'
        : t.error === 'not_found' ? 'Не нашёл адрес отеля или партнёра — уточните адрес.' : 'Дорогу проверить не удалось.';
      return;
    }
    const late = t.leaveBy < Date.now();
    el.classList.add(t.level >= 3 ? 'lvl3' : t.level >= 2 ? 'lvl2' : 'lvl0');
    el.querySelector('.road-ico').textContent = t.level >= 3 ? '⛔' : t.level >= 2 ? '🚦' : '🟢';
    el.querySelector('.road-txt').innerHTML = `<b>${t.minutes} мин</b> из ${esc(t.fromName)}${t.delay ? ` <span class="road-delay">+${t.delay} пробки</span>` : ' · дорога свободна'} · ${t.km} км
      <small>${late ? '<b>выезжать сейчас</b>' : `выезжать в <b>${hm(t.leaveBy)}</b>`}${[...t.issues.map((x) => x.label), ...t.near.map((x) => x.label)].slice(0, 2).map((x) => ' · ' + esc(x)).join('')}</small>`;
  } catch { el.remove(); }
}

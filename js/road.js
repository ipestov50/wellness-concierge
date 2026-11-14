// «🚦 Дорога» в карточке запроса: откуда → куда, сколько ехать сейчас с пробками (TomTom), когда выезжать.
// Поля «Откуда / Куда» можно заполнить прямо здесь — Jarvis подставит то, что уже знает.
import { getSupabase } from './supabase.js';
import { esc, toast } from './ui.js';
import { TZ } from './const.js';
import { byId, save } from './data.js';

const CATS = ['Dining', 'Spa & Wellness', 'Activities', 'Health & Fitness', 'Transport', 'Gifts & Events'];
const hm = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

export function roadSlot(r) {
  if (!r?.id || !r.deadline || !CATS.includes(r.category)) return '';
  const left = new Date(r.deadline).getTime() - Date.now();
  if (left < -60 * 60e3 || left > 7 * 24 * 3600e3) return '';
  const auto = left <= 24 * 3600e3; // на ближайшие сутки проверяем сразу, дальше — по кнопке (бережём лимит)
  return `<section class="road" data-road="${r.id}" data-auto="${auto ? 1 : ''}">
    <div class="road-line"><span class="road-ico">🚦</span><span class="road-txt">${auto ? 'Jarvis проверяет дорогу…' : 'Дорога: Jarvis проверит пробки в день визита'}</span>
      <button type="button" class="road-edit" data-road-edit aria-label="Откуда и куда">✎</button></div>
    <div class="road-form" hidden>
      <label><span>Откуда</span><input type="text" class="road-from" placeholder="Отель гостя или адрес" value="${esc(r.road_from || '')}"></label>
      <label><span>Куда</span><input type="text" class="road-to-in" placeholder="Ресторан или адрес" value="${esc(r.road_to || '')}"></label>
      <button type="button" class="btn small primary" data-road-check>🚦 Проверить дорогу</button>
    </div>
  </section>`;
}

export async function bindRoad(root) {
  const el = root.querySelector('[data-road]');
  if (!el) return;
  const id = el.dataset.road;
  const form = el.querySelector('.road-form');
  const txt = el.querySelector('.road-txt');
  const ico = el.querySelector('.road-ico');
  const openForm = (on = true) => { form.hidden = !on; el.classList.toggle('editing', on); if (on) (form.querySelector('.road-from').value ? form.querySelector('.road-to-in') : form.querySelector('.road-from')).focus(); };
  el.querySelector('[data-road-edit]').addEventListener('click', () => openForm(form.hidden));
  // Enter в полях — проверить, а не отправить форму запроса
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); form.querySelector('[data-road-check]').click(); } });

  const show = (t) => {
    el.classList.remove('lvl0', 'lvl2', 'lvl3', 'muted-road');
    if (t?.error === 'no_tomtom_key') { el.remove(); return; }
    if (t?.error === 'no_endpoints') {
      // подставляем то, что Jarvis знает, и открываем поля
      const f = form.querySelector('.road-from'), to = form.querySelector('.road-to-in');
      if (!f.value && t.hint?.from) f.value = t.hint.from;
      if (!to.value && t.hint?.to) to.value = t.hint.to;
      ico.textContent = '🚦';
      txt.innerHTML = `Укажите, ${t.need?.from && t.need?.to ? 'откуда и куда' : t.need?.from ? 'откуда' : 'куда'} едет гость — и Jarvis будет следить за пробками`;
      el.classList.add('muted-road');
      openForm(true);
      return;
    }
    if (t?.error) {
      el.classList.add('muted-road');
      ico.textContent = '⚠️';
      txt.textContent = t.error === 'not_found' ? 'Не нашёл один из адресов — уточните его' : 'Дорогу проверить не удалось';
      openForm(true);
      return;
    }
    const late = t.leaveBy < Date.now();
    el.classList.add(t.level >= 3 ? 'lvl3' : t.level >= 2 ? 'lvl2' : 'lvl0');
    ico.textContent = t.level >= 3 ? '⛔' : t.level >= 2 ? '🚦' : '🟢';
    txt.innerHTML = `<b>${t.minutes} мин</b> из ${esc(t.fromName)}${t.delay ? ` <span class="road-delay">+${t.delay} пробки</span>` : ' · дорога свободна'} · ${t.km} км
      <small>${late ? '<b>выезжать сейчас</b>' : `выезжать в <b>${hm(t.leaveBy)}</b>`}${[...t.issues.map((x) => x.label), ...t.near.map((x) => x.label)].slice(0, 2).map((x) => ' · ' + esc(x)).join('')}</small>
      <small class="road-to">→ ${esc(t.toLabel || '')}${t.guessed ? ' · <b>найдено по названию — уточните адрес через ✎</b>' : ''}</small>`;
    openForm(false);
  };

  const run = async () => {
    ico.innerHTML = '<span class="spin"></span>';
    txt.textContent = 'Jarvis проверяет дорогу…';
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.functions.invoke('jarvis', { body: { mode: 'traffic', id } });
      let t = data;
      if (error) { try { t = await error.context.json(); } catch { t = { error: 'fail' }; } }
      if (el.isConnected) show(t);
    } catch { if (el.isConnected) show({ error: 'fail' }); }
  };

  form.querySelector('[data-road-check]').addEventListener('click', async (e) => {
    const from = form.querySelector('.road-from').value.trim();
    const to = form.querySelector('.road-to-in').value.trim();
    const r = byId('requests', id);
    if (!from || !to) { toast('Заполните «Откуда» и «Куда»', 'err'); return; }
    e.target.disabled = true;
    try {
      // сохраняем, только если изменилось — тогда и расписание будет следить по этим адресам
      if (from !== (r.road_from || '') || to !== (r.road_to || '')) await save('requests', id, { road_from: from, road_to: to });
      await run();
    } catch (err) { toast('Не сохранилось: ' + (err.message || err), 'err'); }
    e.target.disabled = false;
  });

  if (el.dataset.auto) run();
}

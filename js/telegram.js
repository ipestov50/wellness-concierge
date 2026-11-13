// Окно «Telegram»: подключение бота Jarvis и настройки уведомлений
import { getSupabase } from './supabase.js';
import { esc, options, openModal, toast } from './ui.js';

async function call(mode) {
  const sb = await getSupabase();
  const { data, error } = await sb.functions.invoke('jarvis', { body: { mode } });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return data;
}

async function loadSettings() {
  const sb = await getSupabase();
  let { data } = await sb.from('app_settings').select('*').maybeSingle();
  if (!data) ({ data } = await sb.from('app_settings').insert({}).select().single());
  return data;
}

const code = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');

export async function openTelegram() {
  const sb = await getSupabase();
  let s, info;
  // окно открывается не мгновенно (проверка бота) — покажем, что идёт работа
  toast('Проверяю бота…');
  try { [s, info] = await Promise.all([loadSettings(), call('info').catch(() => ({ bot: null, configured: false }))]); }
  catch (e) { toast('Не удалось открыть настройки: ' + (e.message || e), 'err'); return; }
  let poll;

  const status = () => s.tg_chat_id
    ? `<div class="tg-status on"><span class="dot"></span><span><b>Подключено</b>${info.bot ? ` · @${esc(info.bot)}` : ''}</span></div>`
    : `<div class="tg-status"><span class="dot"></span><span><b>Не подключено</b></span></div>`;

  const setup = `<ol class="tg-steps">
      <li>Откройте в Telegram <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> → <b>/newbot</b>, придумайте имя (например, «Jarvis Concierge») и адрес, оканчивающийся на <b>bot</b>.</li>
      <li>BotFather пришлёт <b>токен</b>. Скопируйте его.</li>
      <li>Откройте <a href="https://supabase.com/dashboard/project/qkxxxincphseoyimeicb/functions/secrets" target="_blank" rel="noopener">секреты функций Supabase</a> → <b>Add new secret</b>: имя <code>TELEGRAM_BOT_TOKEN</code>, значение — токен → <b>Save</b>.</li>
      <li>Закройте и снова откройте это окно — появится кнопка «Подключить».</li>
    </ol>`;

  const hours = [6, 7, 8, 9, 10, 11].map((h) => [h, `${String(h).padStart(2, '0')}:00`]);
  const body = `
    <div id="tgStatus">${status()}</div>
    ${!info.configured ? `<p class="tg-lead">Сначала создайте бота — это бесплатно и займёт пару минут:</p>${setup}` : ''}
    ${info.configured && !s.tg_chat_id ? `<p class="tg-lead">Нажмите «Подключить»: откроется Telegram, там нажмите <b>Start</b>. Код действует 15 минут.</p>
      <button type="button" class="btn primary wide" id="tgLink">Подключить Telegram</button>` : ''}
    ${s.tg_chat_id ? `
      <div class="tg-settings">
        <label class="switch"><input type="checkbox" name="notify_on"${s.notify_on ? ' checked' : ''}><span></span>Присылать уведомления</label>
        <div class="f"><label for="f-brief_hour">Утренний бриф</label><select id="f-brief_hour" name="brief_hour">${options(hours, s.brief_hour)}</select></div>
        <p class="hint">Ночью с ${s.quiet_from}:00 до ${String(s.quiet_to).padStart(2, '0')}:00 сообщения не приходят — кроме критичных. Остальное соберётся в утренний бриф.</p>
        <div class="tg-actions">
          <button type="button" class="btn small" id="tgTest">Прислать бриф сейчас</button>
          <button type="button" class="btn small danger" id="tgUnlink">Отключить</button>
        </div>
      </div>
      <details class="tg-rules"><summary>Когда приходят напоминания</summary>
        <table><tr><th></th><th>Проверить</th><th>Финально</th></tr>
          <tr><td>🚗 Трансфер</td><td>накануне 19:00</td><td>за 3 ч</td></tr>
          <tr><td>🍽 Ресторан</td><td>за 24 ч</td><td>за 3 ч</td></tr>
          <tr><td>💆 Спа</td><td>за 24 ч</td><td>за 2 ч</td></tr>
          <tr><td>🏨 Отель, 🎁 Подарки</td><td>за 72 ч</td><td>за 24 ч</td></tr>
          <tr><td>🎟 Активности, 🏃 Здоровье</td><td>за 48 ч</td><td>за 3 ч</td></tr></table>
        <p class="hint">Критичные — ещё и за 1 час. «⚠️ Риск» — если до срока меньше суток, а запрос ещё не дошёл до «Бронируем». «❗ Просрочено» — один раз.</p>
      </details>` : ''}`;

  const m = openModal({
    title: 'Telegram · Jarvis',
    saveLabel: s.tg_chat_id ? 'Сохранить' : 'Закрыть',
    body,
    onSave: async (v) => {
      clearInterval(poll);
      if (!s.tg_chat_id) return;
      const { error } = await sb.from('app_settings').update({ notify_on: !!v.notify_on, brief_hour: +v.brief_hour }).eq('owner_id', s.owner_id);
      if (error) throw error;
      toast('Настройки уведомлений сохранены');
    },
  });
  m.form.querySelector('#cancel').addEventListener('click', () => clearInterval(poll));
  m.form.querySelector('#x').addEventListener('click', () => clearInterval(poll));

  m.form.querySelector('#tgLink')?.addEventListener('click', async (e) => {
    const c = code();
    const { error } = await sb.from('app_settings').update({ tg_link_code: c, tg_link_expires: new Date(Date.now() + 15 * 60e3).toISOString() }).eq('owner_id', s.owner_id);
    if (error) return toast('Не удалось: ' + error.message, 'err');
    window.open(`https://t.me/${info.bot}?start=${c}`, '_blank');
    e.target.textContent = 'Жду подтверждения в Telegram…';
    e.target.disabled = true;
    let tries = 0;
    poll = setInterval(async () => {
      const { data } = await sb.from('app_settings').select('tg_chat_id').eq('owner_id', s.owner_id).single();
      if (data?.tg_chat_id) {
        clearInterval(poll); m.close(); toast('Telegram подключён ✓'); openTelegram();
      } else if (++tries > 60) {
        clearInterval(poll); e.target.disabled = false; e.target.textContent = 'Подключить ещё раз';
      }
    }, 3000);
  });
  m.form.querySelector('#tgTest')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await call('test'); toast('Бриф отправлен в Telegram'); }
    catch (err) { toast('Не отправилось: ' + (err.message || err), 'err'); }
    e.target.disabled = false;
  });
  m.form.querySelector('#tgUnlink')?.addEventListener('click', async (e) => {
    if (!e.target.classList.contains('armed')) { e.target.classList.add('armed'); e.target.textContent = 'Точно отключить?'; return; }
    await sb.from('app_settings').update({ tg_chat_id: null }).eq('owner_id', s.owner_id);
    m.close(); toast('Telegram отключён');
  });
}

// Jarvis: уведомления в Telegram.
// Режимы:
//   cron     — каждые 15 минут из базы (заголовок x-cron-secret): напоминания, риски, просрочки, утренний бриф
//   telegram — вебхук Telegram (заголовок X-Telegram-Bot-Api-Secret-Token): /start <код>, кнопки «Сделано»
//   info/test — с сайта (токен входа владельца): имя бота, статус, тестовое сообщение
//   setup    — один раз (x-cron-secret): регистрирует вебхук и команды бота
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { generateSuggestions } from './suggest.ts';

const TZ = 'Europe/Paris';
const SITE = Deno.env.get('SITE_URL') || 'https://wellness-concierge-desk.vercel.app';
const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const HOOK_SECRET = Deno.env.get('TG_WEBHOOK_SECRET') || '';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const H = 3600e3;
const ICON: Record<string, string> = { 'Spa & Wellness': '💆', Dining: '🍽', Transport: '🚗', Accommodation: '🏨', Activities: '🎟', 'Health & Fitness': '🏃', 'Gifts & Events': '🎁', Other: '📌' };
const NAME: Record<string, string> = { 'Spa & Wellness': 'Спа', Dining: 'Ресторан', Transport: 'Трансфер', Accommodation: 'Отель', Activities: 'Активности', 'Health & Fitness': 'Здоровье', 'Gifts & Events': 'Подарок', Other: 'Запрос' };
// что проверить на каждом этапе
const CHECK: Record<string, [string, string]> = {
  Transport: ['номер рейса, водитель, табличка с именем', 'статус рейса, водитель выехал'],
  Dining: ['подтвердить стол, передать аллергии ресторану', 'бронь в силе, транспорт до ресторана'],
  'Spa & Wellness': ['время, мастер, масла без аллергенов', 'бронь в силе, гость в курсе'],
  Accommodation: ['бронь, ранний заезд, пожелания отелю', 'отель подтвердил, трансфер до отеля'],
  'Gifts & Events': ['доставка, открытка, адрес', 'курьер в пути'],
  Activities: ['бронь, билеты, детали для гостя', 'всё подтверждено, гость в курсе'],
  'Health & Fitness': ['запись, документы, адрес', 'запись в силе, транспорт'],
  Other: ['детали и подтверждения', 'всё готово'],
};

// ---------- время Парижа ----------
const parts = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  .formatToParts(d).map((p) => [p.type, p.value])) as Record<string, string>;
const parisHour = (d: Date) => +parts(d).hour % 24;
const parisDay = (d: Date) => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };
function parisAt(day: string, hh: number, mm = 0): number { // «день в Париже, hh:mm» → метка времени
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = (g: number) => { const p = parts(new Date(g)); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - g; };
  return guess - off(guess - off(guess));
}
const fmt = (d: Date) => {
  const day = d.toLocaleDateString('ru-RU', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' }).replace(',', '');
  const t = d.toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  return t === '00:00' ? day : `${day} · ${t}`;
};
const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const human = (ms: number) => { const h = Math.round(ms / H); return h >= 48 ? `${Math.round(h / 24)} дн.` : h >= 1 ? `${h} ч` : `${Math.max(1, Math.round(ms / 60000))} мин`; };

// срок «только дата» (00:00) считаем как 10:00 этого дня
function effectiveDeadline(iso: string): number {
  const d = new Date(iso);
  const p = parts(d);
  return p.hour === '00' && p.minute === '00' ? parisAt(parisDay(d), 10) : d.getTime();
}

// этапы напоминаний по категории: [ключ, время срабатывания]
function stages(r: any): [string, number][] {
  const dl = effectiveDeadline(r.deadline);
  const day = parisDay(new Date(dl));
  const prevDay = parisDay(new Date(dl - 24 * H));
  const list: [string, number][] = [];
  switch (r.category) {
    case 'Transport': list.push(['first', parisAt(prevDay, 19)], ['final', dl - 3 * H]); break;
    case 'Dining': list.push(['first', dl - 24 * H], ['final', dl - 3 * H]); break;
    case 'Spa & Wellness': list.push(['first', dl - 24 * H], ['final', dl - 2 * H]); break;
    case 'Accommodation': case 'Gifts & Events': list.push(['first', dl - 72 * H], ['final', dl - 24 * H]); break;
    default: list.push(['first', dl - 48 * H], ['final', dl - 3 * H]);
  }
  if (r.urgency === 'critical') list.push(['hour', dl - H]);
  void day;
  return list.sort((a, b) => a[1] - b[1]);
}

// ---------- Telegram ----------
async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
const buttons = (id?: string) => ({
  inline_keyboard: [[...(id ? [{ text: '✓ Сделано', callback_data: `done:${id}` }] : []), { text: 'Открыть', url: SITE }]],
});
const send = (chat: number, text: string, id?: string) =>
  tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: buttons(id) });

// ---------- данные ----------
async function loadOwner(owner: string) {
  const [req, cli, par, st, tr, pe, dt] = await Promise.all([
    db.from('requests').select('*').eq('owner_id', owner),
    db.from('clients').select('*').eq('owner_id', owner),
    db.from('partners').select('id,name').eq('owner_id', owner),
    db.from('statuses').select('*').eq('owner_id', owner).order('position'),
    db.from('trips').select('*').eq('owner_id', owner),
    db.from('people').select('*').eq('owner_id', owner),
    db.from('client_dates').select('*').eq('owner_id', owner),
  ]);
  const statuses = st.data || [];
  const active = statuses.filter((s: any) => s.kind === 'active');
  // «ещё не забронировано» — рабочие колонки до «Бронируем» (или до «Подтверждено»)
  let cut = active.findIndex((s: any) => s.key === 'booking');
  if (cut < 0) cut = active.findIndex((s: any) => s.key === 'confirmed');
  if (cut < 0) cut = Math.max(1, active.length - 1);
  return {
    requests: req.data || [], clients: new Map((cli.data || []).map((c: any) => [c.id, c])), partners: new Map((par.data || []).map((p: any) => [p.id, p])),
    activeKeys: new Set(active.map((s: any) => s.key)), earlyKeys: new Set(active.slice(0, cut).map((s: any) => s.key)),
    label: new Map(statuses.map((s: any) => [s.key, s.label])), doneKey: statuses.find((s: any) => s.kind === 'done')?.key || null,
    clientsList: cli.data || [], trips: tr.data || [], people: pe.data || [], dates: dt.data || [],
  };
}
const logged = async (owner: string, key: string) =>
  !!(await db.from('notifications_log').select('id').eq('owner_id', owner).eq('key', key).maybeSingle()).data;
const log = (owner: string, key: string, request_id?: string) =>
  db.from('notifications_log').insert({ owner_id: owner, key, request_id: request_id ?? null });

function card(r: any, D: any) {
  const c = D.clients.get(r.client_id);
  const p = D.partners.get(r.partner_id);
  const restr = c ? [...(c.allergies || []), ...(c.diet || []), ...(c.health || [])] : [];
  return [
    `${c ? `<b>${esc(c.name)}</b>${c.vip ? ' ★' : ''} — ` : ''}${esc(r.summary)}`,
    `🕗 ${fmt(new Date(r.deadline))}${p ? ` · ${esc(p.name)}` : ''} · ${esc(D.label.get(r.status) || '')}`,
    restr.length ? `⚠️ ${esc(restr.join(', '))}` : '',
  ].filter(Boolean).join('\n');
}

// ---------- проверка по расписанию ----------
async function runCron() {
  // поводы Jarvis — для всех владельцев, даже без Telegram
  const { data: all } = await db.from('app_settings').select('owner_id');
  for (const o of all || []) { try { await generateSuggestions(db, o.owner_id, await loadOwner(o.owner_id)); } catch (e) { console.error('suggest', e); } }
  const { data: owners } = await db.from('app_settings').select('*').not('tg_chat_id', 'is', null).eq('notify_on', true);
  const now = Date.now();
  const report: Record<string, number> = {};
  for (const s of owners || []) {
    const D = await loadOwner(s.owner_id);
    const hour = parisHour(new Date(now));
    const quiet = s.quiet_from > s.quiet_to ? hour >= s.quiet_from || hour < s.quiet_to : hour >= s.quiet_from && hour < s.quiet_to;
    let sent = 0;
    const open = D.requests.filter((r: any) => D.activeKeys.has(r.status) || !D.label.has(r.status));

    for (const r of open) {
      if (!r.deadline) continue;
      const dl = effectiveDeadline(r.deadline);
      const created = new Date(r.created_at).getTime();
      const critical = r.urgency === 'critical';

      // просрочено — один раз
      if (now > dl) {
        if (now - dl < 7 * 24 * H && !(await logged(s.owner_id, `overdue:${r.id}`))) {
          if (quiet && !critical) continue;
          await send(s.tg_chat_id, `❗ <b>Просрочено</b> ${ICON[r.category] || ''}\n${card(r, D)}\n<i>Срок прошёл ${human(now - dl)} назад, запрос не закрыт.</i>`, r.id);
          await log(s.owner_id, `overdue:${r.id}`, r.id); sent++;
        }
        continue;
      }

      // риск: меньше суток, а ещё не бронируем
      if (dl - now <= 24 * H && D.earlyKeys.has(r.status) && !(await logged(s.owner_id, `risk:${r.id}`))) {
        if (!quiet || critical) {
          await send(s.tg_chat_id, `⚠️ <b>Риск: не забронировано</b> ${ICON[r.category] || ''}\n${card(r, D)}\n<i>До срока ${human(dl - now)}, а запрос ещё в «${esc(D.label.get(r.status))}».</i>`, r.id);
          await log(s.owner_id, `risk:${r.id}`, r.id); sent++;
          continue; // риск важнее обычного напоминания в этот раз
        }
      }

      // обычные этапы: берём самый поздний наступивший, ранние помечаем пропущенными
      const due = stages(r).filter(([, t]) => now >= t && t >= created - 15 * 60e3);
      if (!due.length) continue;
      const [stage] = due[due.length - 1];
      const key = `${stage}:${r.id}`;
      if (await logged(s.owner_id, key)) continue;
      for (const [k] of due.slice(0, -1)) if (!(await logged(s.owner_id, `${k}:${r.id}`))) await log(s.owner_id, `${k}:${r.id}`, r.id);
      if (quiet && !critical) { await log(s.owner_id, key, r.id); continue; } // ночью молчим, это попадёт в бриф
      const [c1, c2] = CHECK[r.category] || CHECK.Other;
      const title = stage === 'hour' ? 'Через час' : `${NAME[r.category] || 'Запрос'} через ${human(dl - now)}`;
      await send(s.tg_chat_id, `${ICON[r.category] || '📌'} <b>${title}</b>\n${card(r, D)}\n<i>Проверить: ${stage === 'first' ? c1 : c2}</i>`, r.id);
      await log(s.owner_id, key, r.id); sent++;
    }

    // утренний бриф
    const today = parisDay(new Date(now));
    if (hour === s.brief_hour && !(await logged(s.owner_id, `brief:${today}`))) {
      await send(s.tg_chat_id, brief(D, now, await openSuggestions(s.owner_id)));
      await log(s.owner_id, `brief:${today}`); sent++;
    }
    report[s.owner_id] = sent;
  }
  return report;
}

async function openSuggestions(owner: string) {
  const { data } = await db.from('suggestions').select('title,status,snooze_until,due_at').eq('owner_id', owner).in('status', ['new', 'snoozed']).order('due_at');
  return (data || []).filter((x: any) => x.status === 'new' || (x.snooze_until && new Date(x.snooze_until) < new Date()));
}

function brief(D: any, now: number, sugg: any[] = []) {
  const today = parisDay(new Date(now));
  const open = D.requests.filter((r: any) => D.activeKeys.has(r.status) || !D.label.has(r.status));
  const late = open.filter((r: any) => r.deadline && effectiveDeadline(r.deadline) < now);
  const todays = open.filter((r: any) => r.deadline && parisDay(new Date(r.deadline)) === today && effectiveDeadline(r.deadline) >= now)
    .sort((a: any, b: any) => a.deadline.localeCompare(b.deadline));
  const risk = open.filter((r: any) => r.deadline && D.earlyKeys.has(r.status) && effectiveDeadline(r.deadline) >= now && effectiveDeadline(r.deadline) - now <= 24 * H);
  const hm = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const guest = (t: any) => esc(D.clients.get(t.client_id)?.name || '');
  const arrivals = D.trips.filter((t: any) => (t.flight_in_at && parisDay(new Date(t.flight_in_at)) === today) || (!t.flight_in_at && t.start_date === today))
    .map((t: any) => `${t.flight_in_at ? hm(t.flight_in_at) : '—'} 🛬 ${guest(t)} — ${esc(t.city)}${t.flight_in ? ', ' + esc(t.flight_in) : ''}${t.hotel ? ' · ' + esc(t.hotel) : ''}`);
  const departures = D.trips.filter((t: any) => (t.flight_out_at && parisDay(new Date(t.flight_out_at)) === today) || (!t.flight_out_at && t.end_date === today && t.end_date !== t.start_date))
    .map((t: any) => `${t.flight_out_at ? hm(t.flight_out_at) : '—'} 🛫 ${guest(t)} — из ${esc(t.city)}${t.flight_out ? ', ' + esc(t.flight_out) : ''}`);
  const tomorrowDay = parisDay(new Date(now + 24 * H));
  const tomorrowArr = D.trips.filter((t: any) => (t.flight_in_at && parisDay(new Date(t.flight_in_at)) === tomorrowDay) || (!t.flight_in_at && t.start_date === tomorrowDay))
    .map((t: any) => `${t.flight_in_at ? hm(t.flight_in_at) : '—'} 🛬 ${guest(t)} — ${esc(t.city)}${t.flight_in ? ', ' + esc(t.flight_in) : ''}`);
  const line = (r: any) => {
    const c = D.clients.get(r.client_id);
    const t = new Date(r.deadline).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
    return `${t === '00:00' ? '—' : t} ${ICON[r.category] || ''} ${c ? esc(c.name) + ' — ' : ''}${esc(r.summary)}`;
  };
  // дни рождения на неделе
  const [ty, tm, td] = today.split('-').map(Number);
  const t0 = Date.UTC(ty, tm - 1, td);
  const nextOf = (date: string) => { const [, m, d] = date.split('-').map(Number); let n = Date.UTC(ty, m - 1, d); if (n < t0) n = Date.UTC(ty + 1, m - 1, d); return { days: Math.round((n - t0) / 864e5), d, m }; };
  const bdays = [
    ...D.clientsList.filter((c: any) => c.birthday).map((c: any) => ({ name: esc(c.name), what: '🎂', ...nextOf(c.birthday) })),
    ...D.people.filter((p: any) => p.birthday).map((p: any) => ({ name: `${esc(p.name)}${p.role ? ' (' + esc(p.role.toLowerCase()) + ')' : ''} — гость ${esc(D.clients.get(p.client_id)?.name || '')}`, what: '🎂', ...nextOf(p.birthday) })),
    ...D.dates.map((x: any) => ({ name: `${esc(x.title)} — ${esc(D.clients.get(x.client_id)?.name || '')}`, what: '📅', ...nextOf(x.date) })),
  ].filter((x: any) => x.days <= 7).sort((a: any, b: any) => a.days - b.days);
  const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const date = new Date(now).toLocaleDateString('ru-RU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
  const out = [`☀️ <b>Bonjour! Бриф на ${esc(date)}</b>`];
  out.push(`Сегодня: <b>${todays.length}</b> · риски: <b>${risk.length}</b> · просрочено: <b>${late.length}</b>`);
  if (late.length) out.push('', '❗ <b>Просрочено</b>', ...late.slice(0, 5).map(line));
  if (risk.length) out.push('', '⚠️ <b>Не забронировано, срок меньше суток</b>', ...risk.slice(0, 5).map(line));
  if (todays.length) out.push('', '📋 <b>План на день</b>', ...todays.slice(0, 12).map(line));
  if (arrivals.length || departures.length) out.push('', '✈️ <b>Прилёты и вылеты сегодня</b>', ...arrivals, ...departures);
  if (tomorrowArr.length) out.push('', '🗓 <b>Завтра прилетают</b>', ...tomorrowArr);
  if (bdays.length) out.push('', '🎂 <b>Даты на неделе</b>', ...bdays.map((x: any) => `${x.what} ${x.name} — ${x.days === 0 ? '<b>сегодня</b>' : x.days === 1 ? 'завтра' : `${x.d} ${MON[x.m - 1]}`}`));
  if (sugg.length) out.push('', `✨ <b>Jarvis предлагает: ${sugg.length}</b>`, ...sugg.slice(0, 4).map((x: any) => esc(x.title)), '<i>Планы готовы на сайте — откройте «Сегодня».</i>');
  if (!late.length && !risk.length && !todays.length && !arrivals.length && !departures.length && !sugg.length) out.push('', 'На сегодня задач нет. Хорошего дня ✨');
  return out.join('\n');
}

// ---------- Telegram: команды и кнопки ----------
async function onTelegram(u: any) {
  if (u.message?.text) {
    const chat = u.message.chat.id;
    const [cmd, code] = u.message.text.trim().split(/\s+/);
    if (cmd === '/start' && code) {
      const { data } = await db.from('app_settings').select('*').eq('tg_link_code', code).maybeSingle();
      if (!data || !data.tg_link_expires || new Date(data.tg_link_expires) < new Date()) {
        await tg('sendMessage', { chat_id: chat, text: 'Код устарел. Откройте сайт → ⋯ → Telegram и нажмите «Подключить» ещё раз.' });
        return;
      }
      await db.from('app_settings').update({ tg_chat_id: chat, tg_link_code: null, tg_link_expires: null }).eq('owner_id', data.owner_id);
      await tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: '✦ <b>Jarvis подключён.</b>\nСюда будут приходить напоминания о сроках, риски и утренний бриф. Кнопка «✓ Сделано» под сообщением закрывает запрос.' });
      return;
    }
    const { data: me } = await db.from('app_settings').select('*').eq('tg_chat_id', chat).maybeSingle();
    if (!me) { await tg('sendMessage', { chat_id: chat, text: 'Это личный бот. Подключение — только с сайта владельца.' }); return; }
    if (cmd === '/brief' || cmd === '/today') {
      const D = await loadOwner(me.owner_id);
      await send(chat, brief(D, Date.now(), await openSuggestions(me.owner_id)));
    } else {
      await tg('sendMessage', { chat_id: chat, text: 'Команды: /brief — бриф на сегодня.' });
    }
    return;
  }
  const q = u.callback_query;
  if (q?.data?.startsWith('done:')) {
    const id = q.data.slice(5);
    const { data: me } = await db.from('app_settings').select('*').eq('tg_chat_id', q.message.chat.id).maybeSingle();
    if (!me) return tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Нет доступа' });
    const D = await loadOwner(me.owner_id);
    if (!D.doneKey) return tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Нет колонки «Выполнено»', show_alert: true });
    const { error } = await db.from('requests').update({ status: D.doneKey }).eq('id', id).eq('owner_id', me.owner_id);
    await tg('answerCallbackQuery', { callback_query_id: q.id, text: error ? 'Не удалось' : 'Готово ✓' });
    if (!error) await tg('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: '✅ Выполнено', callback_data: 'noop' }]] } });
  } else if (q) await tg('answerCallbackQuery', { callback_query_id: q.id });
}

// ---------- вход ----------
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({});
  // вебхук Telegram
  if (req.headers.get('x-telegram-bot-api-secret-token')) {
    if (!HOOK_SECRET || req.headers.get('x-telegram-bot-api-secret-token') !== HOOK_SECRET) return json({ ok: false }, 401);
    try { await onTelegram(await req.json()); } catch (e) { console.error(e); }
    return json({ ok: true });
  }
  const body = await req.json().catch(() => ({}));
  // расписание и разовая настройка
  if (req.headers.get('x-cron-secret')) {
    if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ error: 'unauthorized' }, 401);
    if (!TOKEN) return json({ error: 'no_token' }, 503);
    if (body.mode === 'setup') {
      const hook = await tg('setWebhook', { url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/jarvis`, secret_token: HOOK_SECRET, allowed_updates: ['message', 'callback_query'] });
      await tg('setMyCommands', { commands: [{ command: 'brief', description: 'Бриф на сегодня' }] });
      const me = await tg('getMe', {});
      return json({ webhook: hook.ok, bot: me.result?.username });
    }
    return json({ sent: await runCron() });
  }
  // с сайта: только владелец
  const jwt = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const { data: u } = await db.auth.getUser(jwt);
  if (!u?.user) return json({ error: 'unauthorized' }, 401);
  if (body.mode === 'info') {
    if (!TOKEN) return json({ bot: null, configured: false });
    const me = await tg('getMe', {});
    if (!me.ok) return json({ bot: null, configured: false, error: 'bad_token' });
    // вебхук настраивается сам при первом открытии окна
    const hookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/jarvis`;
    const wh = await tg('getWebhookInfo', {});
    if (wh.result?.url !== hookUrl) {
      await tg('setWebhook', { url: hookUrl, secret_token: HOOK_SECRET, allowed_updates: ['message', 'callback_query'] });
      await tg('setMyCommands', { commands: [{ command: 'brief', description: 'Бриф на сегодня' }] });
    }
    return json({ bot: me.result.username, configured: true });
  }
  if (body.mode === 'suggest') {
    await db.from('app_settings').upsert({ owner_id: u.user.id }, { onConflict: 'owner_id', ignoreDuplicates: true });
    return json(await generateSuggestions(db, u.user.id, await loadOwner(u.user.id), { wide: !!body.wide }));
  }
  if (body.mode === 'test') {
    const { data: s } = await db.from('app_settings').select('*').eq('owner_id', u.user.id).maybeSingle();
    if (!s?.tg_chat_id) return json({ error: 'not_linked' }, 400);
    const D = await loadOwner(u.user.id);
    const r = await send(s.tg_chat_id, brief(D, Date.now(), await openSuggestions(u.user.id)));
    return json({ ok: !!r.ok });
  }
  return json({ error: 'bad_request' }, 400);
});

// «Jarvis думает на шаг вперёд»: находит поводы и создаёт предложения.
// Здесь только правила (без ИИ). Черновик плана составляется отдельно, когда предложение открыто на сайте.

const TZ = 'Europe/Paris';
const H = 3600e3;
const parts = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  .formatToParts(d).map((p) => [p.type, p.value])) as Record<string, string>;
const dayOf = (d: Date) => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diff = (a: string, b: string) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 864e5);
function parisAt(day: string, hh: number, mm = 0): string {
  const [y, m, d] = day.split('-').map(Number);
  const g = Date.UTC(y, m - 1, d, hh, mm);
  const off = (x: number) => { const p = parts(new Date(x)); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - x; };
  return new Date(g - off(g - off(g))).toISOString();
}
const localOf = (iso: string) => { const p = parts(new Date(iso)); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('ru-RU', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const inDays = (n: number) => (n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} дн.`);
const shortName = (s: string) => String(s || '').replace(/\s*\(.*?\)/g, '');

// wide = ручной запуск «Что впереди?»: смотрим дальше (поездки 21 день, даты 30 дней, рейсы 21 день)
export async function generateSuggestions(db: any, owner: string, D: any, opt: { wide?: boolean } = {}) {
  const W = { trip: 21, date: 30, flight: 21 };
  const N = opt.wide ? W : { trip: 5, date: 10, flight: 14 };
  const now = new Date();
  const today = dayOf(now);
  const reqs = D.requests as any[];
  const byClient = (id: string) => reqs.filter((r) => r.client_id === id);
  const reqDay = (r: any) => (r.deadline ? dayOf(new Date(r.deadline)) : null);

  // что владелец недавно отклонил — не предлагаем этому гостю такое же 30 дней
  const { data: dismissed } = await db.from('suggestions').select('kind,client_id').eq('owner_id', owner).eq('status', 'dismissed').gte('updated_at', new Date(Date.now() - 30 * 864e5).toISOString());
  const muted = new Set((dismissed || []).map((x: any) => `${x.kind}:${x.client_id}`));

  const found: any[] = [];        // попадают в рабочее окно — сохраняем
  const watch = new Set<string>(); // в широком окне — не считаем устаревшими
  const push = (s: any, inWindow = true) => {
    watch.add(s.key);
    if (inWindow && !muted.has(`${s.kind}:${s.client_id}`)) found.push({ owner_id: owner, ...s });
  };

  for (const t of D.trips as any[]) {
    const c = D.clients.get(t.client_id);
    if (!c) continue;
    const name = shortName(c.name);
    // ✈️ скоро приезд: до заезда 0–5 дней, запросов под поездку нет
    if (t.start_date) {
      const n = diff(t.start_date, today);
      const end = t.end_date || t.start_date;
      const has = byClient(c.id).some((r) => { const d = reqDay(r); return d && d >= addDays(t.start_date, -1) && d <= addDays(end, 1); });
      if (n >= 0 && n <= W.trip && !has) push({
        client_id: c.id, trip_id: t.id, kind: 'pre_arrival', key: `pre_arrival:${t.id}`,
        title: `✈️ ${name} прилетает ${inDays(n)}`,
        reason: `${t.city}${t.hotel ? ', ' + t.hotel : ''} · ${+t.start_date.slice(8)} ${MON[+t.start_date.slice(5, 7) - 1]}${end !== t.start_date ? ` – ${+end.slice(8)} ${MON[+end.slice(5, 7) - 1]}` : ''}. Запросов под поездку ещё нет.`,
        due_at: parisAt(t.start_date, 10),
      }, n <= N.trip);
    }
    // 🛬 рейс без трансфера: прилёт или вылет в ближайшие 14 дней, трансфера рядом по времени нет
    for (const [at, num, dir] of [[t.flight_in_at, t.flight_in, 'in'], [t.flight_out_at, t.flight_out, 'out']] as [string, string, string][]) {
      if (!at) continue;
      const ms = new Date(at).getTime();
      if (ms < Date.now() || ms - Date.now() > W.flight * 24 * H) continue;
      const inWin = ms - Date.now() <= N.flight * 24 * H;
      const covered = byClient(c.id).some((r) => r.category === 'Transport' && r.deadline && Math.abs(new Date(r.deadline).getTime() - ms) <= 6 * H);
      if (covered) continue;
      const when = dir === 'in' ? new Date(ms + 30 * 60e3).toISOString() : new Date(ms - 3 * H).toISOString();
      push({
        client_id: c.id, trip_id: t.id, kind: 'transfer', key: `transfer:${t.id}:${dir}`,
        title: dir === 'in' ? `🛬 Прилёт${num ? ' ' + num : ''} без трансфера` : `🛫 Вылет${num ? ' ' + num : ''} без трансфера`,
        reason: `${name}: ${dir === 'in' ? 'прилёт' : 'вылет'} ${fmtWhen(at)}, ${t.city}. Трансфер не заказан.`,
        due_at: when,
        payload: { tasks: [{
          summary: dir === 'in' ? `Трансфер из аэропорта${num ? ', рейс ' + num : ''}${t.hotel ? ' → ' + t.hotel : ''}` : `Трансфер в аэропорт${num ? ', рейс ' + num : ''}`,
          category: 'Transport', when_local: localOf(when), partner_id: null,
          note: [c.pref_transport, dir === 'in' ? 'табличка с именем, вода в машине' : 'выезд за 3 часа до вылета'].filter(Boolean).join('; '),
        }], source: 'rules' },
      }, inWin);
    }
  }

  // 🎂 даты близких (и самого гостя): через 0–10 дней, подарок не заказан
  const [ty, tm, td] = today.split('-').map(Number);
  const t0 = Date.UTC(ty, tm - 1, td);
  const next = (date: string) => { const [, m, d] = date.split('-').map(Number); let x = Date.UTC(ty, m - 1, d); if (x < t0) x = Date.UTC(ty + 1, m - 1, d); return { days: Math.round((x - t0) / 864e5), day: new Date(x).toISOString().slice(0, 10) }; };
  const dates: any[] = [];
  for (const c of D.clientsList) if (c.birthday) dates.push({ c, ref: c.id, kind: 'self', title: 'день рождения', who: shortName(c.name), date: c.birthday });
  for (const p of D.people) { const c = D.clients.get(p.client_id); if (c && p.birthday) dates.push({ c, ref: p.id, kind: 'person', title: 'день рождения', who: `${p.name}${p.role ? ' (' + p.role.toLowerCase() + ')' : ''}`, date: p.birthday }); }
  for (const x of D.dates) { const c = D.clients.get(x.client_id); if (c) dates.push({ c, ref: x.id, kind: 'date', title: x.title.toLowerCase(), who: shortName(c.name), date: x.date }); }
  for (const x of dates) {
    const n = next(x.date);
    if (n.days > W.date) continue;
    const has = byClient(x.c.id).some((r) => r.category === 'Gifts & Events' && reqDay(r) && reqDay(r)! >= today && reqDay(r)! <= n.day);
    if (has) continue;
    const guest = shortName(x.c.name);
    push({
      client_id: x.c.id, kind: 'close_date', key: `date:${x.kind}:${x.ref}:${n.day.slice(0, 4)}`,
      title: `🎂 ${x.kind === 'self' ? guest : x.who} — ${x.title} ${inDays(n.days)}`,
      reason: x.kind === 'self' ? `${+n.day.slice(8)} ${MON[+n.day.slice(5, 7) - 1]}. Поздравление и подарок ещё не заказаны.`
        : `${x.kind === 'person' ? 'Близкий человек гостя ' + guest : 'Гость ' + guest}, ${+n.day.slice(8)} ${MON[+n.day.slice(5, 7) - 1]}. Подарок ещё не заказан.`,
      due_at: parisAt(n.day, 10),
    }, n.days <= N.date);
  }

  // 💬 давно не общались: VIP, больше 30 дней без контакта и без запросов
  for (const c of D.clientsList) {
    if (!c.vip) continue;
    const touches = [c.last_contact ? Date.parse(c.last_contact + 'T12:00:00Z') : 0, Date.parse(c.created_at), ...byClient(c.id).map((r) => Date.parse(r.created_at))];
    const last = Math.max(...touches);
    const days = Math.floor((Date.now() - last) / 864e5);
    if (days < 30) continue;
    const soon = dates.filter((x) => x.c.id === c.id).map((x) => ({ ...x, n: next(x.date) })).filter((x) => x.n.days <= 30).sort((a, b) => a.n.days - b.n.days)[0];
    push({
      client_id: c.id, kind: 'reconnect', key: `reconnect:${c.id}:${today.slice(0, 7)}`,
      title: `💬 Давно не общались: ${shortName(c.name)}`,
      reason: `Последний контакт ${days} дн. назад.${soon ? ` Повод: ${soon.kind === 'self' ? 'день рождения' : soon.who + ' — ' + soon.title} ${inDays(soon.n.days)}.` : ''}`,
      due_at: now.toISOString(),
    });
  }

  // сохраняем новые (дубли отсекает уникальный ключ)
  if (found.length) await db.from('suggestions').upsert(found, { onConflict: 'owner_id,key', ignoreDuplicates: true });

  // устаревшие поводы убираем: под поездку уже есть запросы, трансфер заказан, подарок оформлен
  const valid = watch;
  const { data: open } = await db.from('suggestions').select('id,key,kind').eq('owner_id', owner).in('status', ['new', 'snoozed']).in('kind', ['pre_arrival', 'transfer', 'close_date']);
  const stale = (open || []).filter((s: any) => !valid.has(s.key)).map((s: any) => s.id);
  if (stale.length) await db.from('suggestions').delete().in('id', stale);
  return { found: found.length, removed: stale.length };
}

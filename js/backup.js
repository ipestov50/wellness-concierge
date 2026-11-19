// Резервная копия: «Скачать всё» (JSON для восстановления) и таблица Excel для чтения.
// Дата последней копии хранится в профиле входа — напоминание работает на всех устройствах.
import { getSupabase } from './supabase.js';
import { CATEGORIES, URGENCY, PARTNER_TYPES, TZ } from './const.js';
import { esc, openModal, toast } from './ui.js';

const TABLES = ['clients', 'requests', 'partners', 'statuses', 'trips', 'people', 'client_dates'];
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let lastBackupAt = null;

export function setLastBackupFromSession(session) { lastBackupAt = session?.user?.user_metadata?.last_backup_at || null; }

export function daysSinceBackup() {
  if (!lastBackupAt) return null;
  return Math.floor((Date.now() - new Date(lastBackupAt)) / 864e5);
}
export const backupDue = () => { const d = daysSinceBackup(); return d == null || d >= 7; };

const stamp = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// свежие данные прямо из базы, а не с экрана
async function fetchAll() {
  const sb = await getSupabase();
  const res = await Promise.all(TABLES.map((t) => sb.from(t).select('*').order('created_at', { ascending: true })));
  const out = {};
  res.forEach((r, i) => { if (r.error) throw r.error; out[TABLES[i]] = r.data; });
  return out;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function markDone() {
  const sb = await getSupabase();
  const at = new Date().toISOString();
  lastBackupAt = at;
  await sb.auth.updateUser({ data: { last_backup_at: at } }).catch(() => {});
}

export async function exportJSON() {
  const data = await fetchAll();
  const payload = {
    app: 'Wellness Concierge', format: 1, exported_at: new Date().toISOString(),
    counts: Object.fromEntries(TABLES.map((t) => [t, data[t].length])), tables: data,
  };
  download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `wellness-concierge-${stamp()}.json`);
  await markDone();
  return payload.counts;
}

function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((ok, fail) => {
    const s = Object.assign(document.createElement('script'), { src: XLSX_URL, onload: () => ok(window.XLSX), onerror: () => fail(new Error('не загрузилась библиотека для Excel')) });
    document.head.append(s);
  });
}

export async function exportExcel() {
  const [XLSX, data] = await Promise.all([loadXLSX(), fetchAll()]);
  const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
  const clients = byId(data.clients), partners = byId(data.partners);
  const statusLabel = Object.fromEntries(data.statuses.map((s) => [s.key, s.label]));
  const urg = Object.fromEntries(URGENCY), ptype = Object.fromEntries(PARTNER_TYPES);
  const dt = (v) => (v ? new Date(v).toLocaleString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const d = (v) => (v ? new Date(v.length === 10 ? v + 'T12:00:00Z' : v).toLocaleDateString('ru-RU', { timeZone: TZ }) : '');
  const list = (a) => (a || []).join(', ');
  const bd = (v) => (!v ? '' : v.startsWith('1900-') ? v.slice(5).split('-').reverse().join('.') : d(v));

  const sheets = {
    'Запросы': data.requests.map((r) => ({
      'Гость': clients[r.client_id]?.name || '', 'Что нужно': r.summary, 'Категория': `${CATEGORIES[r.category] || ''} ${r.category}`,
      'Статус': statusLabel[r.status] || r.status, 'Срочность': urg[r.urgency] || r.urgency, 'Срок': dt(r.deadline),
      'Бюджет': r.budget_amount ?? '', 'Валюта': r.currency || '', 'Партнёр': partners[r.partner_id]?.name || '',
      'Что уточнить': r.clarifying_questions || '', 'Одобрение гостя': r.needs_approval ? 'да' : '', 'Проверить': r.needs_review ? 'да' : '',
      'Исходное сообщение': r.original_message || '', 'Создан': dt(r.created_at), 'Обновлён': dt(r.updated_at),
    })),
    'Клиенты': data.clients.map((c) => ({
      'Имя': c.name, 'VIP': c.vip ? '★' : '', 'Язык': c.language, 'Город': c.city || '', 'Телефон': c.phone || '', 'Почта': c.email || '',
      'Telegram': c.telegram || '', 'День рождения': bd(c.birthday), 'Аллергии': list(c.allergies), 'Диета': list(c.diet), 'Здоровье': list(c.health),
      'Еда': c.pref_food || '', 'Спа': c.pref_spa || '', 'Транспорт': c.pref_transport || '', 'Отели': c.pref_hotels || '',
      'Поездки': (c.travel_history || []).join('\n'), 'Заметки': c.concierge_notes || '', 'Последний контакт': d(c.last_contact),
    })),
    'Поездки': (data.trips || []).map((t) => ({
      'Гость': clients[t.client_id]?.name || '', 'Город': t.city, 'Страна': t.country || '', 'Отель': t.hotel || '',
      'Заезд': d(t.start_date), 'Выезд': d(t.end_date), 'Рейс туда': t.flight_in || '', 'Прилёт': dt(t.flight_in_at),
      'Рейс обратно': t.flight_out || '', 'Вылет': dt(t.flight_out_at), 'Спутники': t.companions || '', 'Заметки': t.notes || '',
      'Бриф': t.brief ? JSON.stringify(t.brief) : '',
    })),
    'Близкие': (data.people || []).map((p) => ({
      'Гость': clients[p.client_id]?.name || '', 'Имя': p.name, 'Роль': p.role || '', 'Телефон': p.phone || '',
      'День рождения': bd(p.birthday), 'Аллергии': list(p.allergies), 'Заметки': p.notes || '',
    })),
    'Важные даты': (data.client_dates || []).map((x) => ({
      'Гость': clients[x.client_id]?.name || '', 'Событие': x.title, 'Дата': d(x.date), 'Заметки': x.notes || '',
    })),
    'Партнёры': data.partners.map((p) => ({
      'Название': p.name, 'Тип': ptype[p.type] || p.type, 'Город': p.city || '', 'Контакт': p.contact || '', 'Условия': p.terms || '',
      'Комиссия': p.commission || '', 'Оценка': p.rating ? '★'.repeat(p.rating) : '', 'Заметки': p.notes || '',
    })),
  };
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': 'Пусто' }]);
    const keys = Object.keys(rows[0] || { '': '' });
    ws['!cols'] = keys.map((k) => ({ wch: Math.min(48, Math.max(k.length + 2, ...rows.map((r) => String(r[k] ?? '').split('\n')[0].length + 1))) }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `wellness-concierge-${stamp()}.xlsx`);
  await markDone();
  return { clients: data.clients.length, requests: data.requests.length, partners: data.partners.length, trips: (data.trips || []).length, people: (data.people || []).length, client_dates: (data.client_dates || []).length };
}

// окно «Резервная копия»
export function openBackup(onDone) {
  const days = daysSinceBackup();
  const last = lastBackupAt ? new Date(lastBackupAt).toLocaleString('ru-RU', { timeZone: TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null;
  const m = openModal({
    title: 'Резервная копия',
    saveLabel: 'Закрыть',
    body: `<p class="bk-last ${backupDue() ? 'due' : ''}">${last ? `Последняя копия: <b>${esc(last)}</b>${days ? ` (${days} дн. назад)` : ''}` : 'Копию ещё ни разу не делали.'}</p>
      <div class="bk-opts">
        <button type="button" class="bk-opt" data-bk="json"><span class="bk-ico">🗄</span><span><b>Скачать всё</b><small>Полная копия в одном файле (.json). Из неё можно всё восстановить.</small></span></button>
        <button type="button" class="bk-opt" data-bk="xlsx"><span class="bk-ico">📊</span><span><b>Таблица Excel</b><small>Клиенты, запросы и партнёры на отдельных листах. Удобно читать и печатать.</small></span></button>
      </div>
      <p class="hint">Файл сохранится в «Загрузки» (на iPhone — в приложении «Файлы»). Напоминание появится, если копии не было 7 дней.</p>`,
    onSave: async () => {},
  });
  m.form.querySelector('#cancel').hidden = true;
  m.form.querySelectorAll('[data-bk]').forEach((b) => b.addEventListener('click', async () => {
    const all = m.form.querySelectorAll('[data-bk]');
    all.forEach((x) => (x.disabled = true));
    b.classList.add('loading');
    try {
      const n = b.dataset.bk === 'json' ? await exportJSON() : await exportExcel();
      toast(`Копия готова: клиенты ${n.clients}, запросы ${n.requests}, партнёры ${n.partners}, поездки ${n.trips}, близкие ${n.people}, важные даты ${n.client_dates}`);
      m.close(); onDone?.();
    } catch (err) {
      toast('Не получилось сделать копию. Попробуйте ещё раз.', 'err');
      all.forEach((x) => (x.disabled = false)); b.classList.remove('loading');
    }
  }));
}

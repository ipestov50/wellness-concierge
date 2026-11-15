// Офлайн: снимок «на сегодня» — расписание и ключевое о гостях (аллергии, предпочтения, близкие и их телефоны).
// Хранится только в IndexedDB этого устройства, только пока владелец вошёл; при выходе стирается.
const DB = 'wc-offline', STORE = 'snap', KEY = 'today';
const DAY = 864e5;

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); res(out?.result); };
    t.onerror = () => { db.close(); rej(t.error); };
  });
}

// что берём с собой: открытые запросы на неделю вперёд (и просроченные), текущие и ближайшие поездки, всё о гостях
export function pickSnapshot(state, now = Date.now()) {
  const soon = now + 7 * DAY;
  const today = new Date(now).toISOString().slice(0, 10);
  const requests = state.requests.filter((r) => !r.deadline || Date.parse(r.deadline) < soon);
  const trips = state.trips.filter((t) => (t.end_date || t.start_date || '9') >= today);
  return {
    clients: state.clients, people: state.people, client_dates: state.client_dates,
    statuses: state.statuses, partners: state.partners, day_items: state.day_items,
    requests, trips, suggestions: [],
  };
}

let timer;
export function saveSnapshot(state) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { tx('readwrite', (s) => s.put({ at: Date.now(), data: pickSnapshot(state) }, KEY)).catch(() => {}); } catch {}
  }, 1500);
}
export async function loadSnapshot() {
  try { const r = await tx('readonly', (s) => s.get(KEY)); return r || null; } catch { return null; }
}
export async function clearSnapshot() {
  clearTimeout(timer);
  try { await tx('readwrite', (s) => s.clear()); } catch {}
}

// владелец входил на этом устройстве (сессия Supabase сохранена)
export function storedSession() {
  try {
    const k = Object.keys(localStorage).find((x) => /^sb-.+-auth-token$/.test(x));
    return k ? JSON.parse(localStorage.getItem(k)) : null;
  } catch { return null; }
}

export function registerSW() {
  if (!('serviceWorker' in navigator) || location.hostname === 'localhost') return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// после загрузки, в простое, подтягиваем остальные разделы — чтобы они открывались и без сети
export function warmModules() {
  const go = () => ['./views/clients.js', './views/partners.js', './views/trips.js', './views/calendar.js', './brief.js', './dossier.js', './forms.js', './road.js', './telegram.js', './views/archive.js', './guide.js']
    .forEach((p) => import(p).catch(() => {}));
  (self.requestIdleCallback || ((f) => setTimeout(f, 3000)))(go, { timeout: 8000 });
}

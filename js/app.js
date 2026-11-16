import { getSupabase } from './supabase.js';
import { esc, $, toast, closeModal } from './ui.js';
import { state, onChange, loadAll, startRealtime, stopRealtime } from './data.js';
import { ui, render, registerLazy, viewSkeleton } from './router.js';
import { editRequest, editClient, editPartner } from './lazy.js';
import { openBackup, setLastBackupFromSession } from './backup.js';
import { clearCache } from './api.js';
import { saveSnapshot, loadSnapshot, clearSnapshot, storedSession, registerSW, warmModules } from './offline.js';
import './views/requests.js';
// остальные разделы — по требованию (меньше кода на старте)
registerLazy('clients', () => import('./views/clients.js'));
registerLazy('partners', () => import('./views/partners.js'));
registerLazy('trips', () => import('./views/trips.js'));

const root = document.getElementById('root');
let sb, shown = null;

// ---------- тема ----------
const THEMES = ['auto', 'light', 'dark'];
const THEME_ICON = { auto: '◐', light: '☀', dark: '☾' };
const THEME_LABEL = { auto: 'Тема: как в системе', light: 'Тема: светлая', dark: 'Тема: тёмная' };
function getTheme() { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } }
function applyTheme(t) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
  const b = $('#theme'); if (b) { b.textContent = THEME_ICON[t]; b.title = THEME_LABEL[t]; b.setAttribute('aria-label', THEME_LABEL[t]); }
}
applyTheme(getTheme());

const AUTH_ERRORS = {
  'Invalid login credentials': 'Неверная почта или пароль.',
  'Signups not allowed for otp': 'Этот адрес не зарегистрирован.',
  'User not found': 'Этот адрес не зарегистрирован.',
};
const authError = (e) => AUTH_ERRORS[e?.message] || (/rate limit|security purposes/i.test(e?.message || '')
  ? 'Слишком много попыток. Подождите минуту и попробуйте снова.'
  : 'Не получилось: ' + (e?.message || 'неизвестная ошибка'));

// ---------- вход ----------
function renderLogin() {
  shown = 'login';
  root.innerHTML = `
    <main class="center">
      <form class="login" id="login">
        <div class="mark">W</div>
        <h1>Wellness Concierge</h1>
        <p class="lead">Вход только для владельца</p>
        <label class="f"><span>Почта</span><input type="email" name="email" autocomplete="username" required inputmode="email"></label>
        <label class="f"><span>Пароль</span><input type="password" name="password" autocomplete="current-password" placeholder="если уже задан"></label>
        <button class="btn primary wide" type="submit" data-mode="password">Войти</button>
        <button class="btn wide" type="submit" data-mode="link">Прислать ссылку для входа</button>
        <p class="msg" role="status"></p>
      </form>
    </main>`;
  const form = $('#login');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const mode = ev.submitter?.dataset.mode || 'password';
    const email = form.email.value.trim();
    const password = form.password.value;
    const msg = form.querySelector('.msg');
    form.querySelectorAll('button').forEach((b) => (b.disabled = true));
    msg.className = 'msg'; msg.textContent = mode === 'link' || !password ? 'Отправляю ссылку…' : 'Вхожу…';
    let error;
    if (mode === 'link' || !password) {
      ({ error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin } }));
      if (!error) { msg.className = 'msg ok'; msg.textContent = 'Ссылка отправлена. Откройте письмо на этом устройстве.'; }
    } else {
      ({ error } = await sb.auth.signInWithPassword({ email, password }));
    }
    if (error) { msg.className = 'msg err'; msg.textContent = authError(error); }
    form.querySelectorAll('button').forEach((b) => (b.disabled = false));
  });
}

// ---------- приложение ----------
function renderShell(session) {
  shown = 'app';
  setLastBackupFromSession(session);
  root.innerHTML = `
    <header class="top">
      <div class="brand">Wellness Concierge<small>клиенты · запросы · партнёры</small></div>
      <nav class="tabs" role="tablist">
        <button class="tab" role="tab" data-tab="requests" type="button">Запросы</button>
        <button class="tab" role="tab" data-tab="clients" type="button">Клиенты</button>
        <button class="tab" role="tab" data-tab="trips" type="button">Кто где</button>
        <button class="tab" role="tab" data-tab="partners" type="button">Партнёры</button>
      </nav>
      <div class="tools">
        <button class="btn primary" id="addBtn" type="button">+ Новый запрос</button>
        <button class="icon-btn" id="theme" type="button"></button>
        <div class="menu">
          <button class="icon-btn" id="menuBtn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Меню">⋯</button>
          <div class="menu-list" id="menuList" hidden>
            <div class="menu-who">${esc(session.user.email)}</div>
            <div class="menu-who" id="usageLine" hidden></div>
            <button type="button" id="tgBtn">✈️ Telegram-уведомления…</button>
            <button type="button" id="backupBtn">💾 Резервная копия…</button>
            <button type="button" id="setPass">Задать пароль</button>
            <button type="button" id="logout">Выйти</button>
          </div>
        </div>
      </div>
    </header>
    <div class="offline-bar" id="offbar" role="status" hidden></div>
    <main id="app">${viewSkeleton()}</main>
    <button type="button" class="fab" id="fab" aria-label="Новый запрос">＋</button>
    <div id="modal"></div>`;
  applyTheme(getTheme());
  render();
  firstLoad();
}

// первая загрузка: при сбое — карточка с «Повторить» вместо пустого экрана
function firstLoad() {
  loadAll().then(() => {
    state.offline = null; offlineBar();
    if (state.partial?.length) toast('Часть данных не загрузилась — покажу, что есть, и обновлю позже', 'err');
    warmModules();
    return startRealtime();
  }).then(() => import('./tz.js').then((m) => m.backfillTrips())).catch(async (e) => {
    const app = $('#app');
    if (!app) return;
    if (await showOffline()) return;
    app.innerHTML = `<div class="notice retry-card"><p>Не удалось загрузить данные${navigator.onLine ? '' : ' — нет интернета'}.</p><small>${esc(e.message || e)}</small>
      <button type="button" class="btn primary" id="retryLoad">↻ Повторить</button></div>`;
    $('#retryLoad').addEventListener('click', () => { app.innerHTML = viewSkeleton(); firstLoad(); });
  });
}

onChange(() => {
  if (shown === 'app' && state.loaded) render();
  if (shown === 'app' && state.loaded && !state.offline) saveSnapshot(state); // свежий снимок на случай, если пропадёт сеть
});

// ---------- офлайн ----------
// нет сети — показываем сохранённый снимок «на сегодня» (только просмотр) и плашку с его временем
async function showOffline() {
  const snap = await loadSnapshot();
  if (!snap) return false;
  Object.assign(state, snap.data, { loaded: true, offline: snap.at });
  offlineBar();
  render();
  return true;
}
function offlineBar() {
  const bar = $('#offbar');
  if (!bar) return;
  const off = state.offline || !navigator.onLine;
  bar.hidden = !off;
  if (off) bar.textContent = state.offline
    ? `Нет сети — показываю данные на ${new Date(state.offline).toLocaleString('ru-RU', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} (по Парижу). Изменения сохранятся, когда появится связь.`
    : 'Нет сети — изменения пока не сохраняются';
}
addEventListener('offline', offlineBar);
addEventListener('online', () => { offlineBar(); if (shown === 'app' && state.offline) firstLoad(); });
registerSW();

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab],[data-req],[data-cl],[data-newreq],[data-editcl],[data-editp],#addBtn,#theme,#menuBtn,#setPass,#logout,#backupBtn,[data-backup],#tgBtn,#fab');
  const menu = $('#menuList');
  if (menu && !menu.hidden && !e.target.closest('.menu')) { menu.hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); }
  if (!t) return;
  if (t.dataset.tab) { ui.tab = t.dataset.tab; ui.q = ''; render(); scrollTo(0, 0); }
  else if (t.dataset.req) editRequest(t.dataset.req);
  else if (t.dataset.cl) { if (ui.client !== t.dataset.cl) ui.ctab = 'overview'; ui.client = t.dataset.cl; render(); if (matchMedia('(max-width: 760px)').matches) scrollTo(0, 0); }
  else if (t.dataset.newreq) editRequest(null, t.dataset.newreq);
  else if (t.dataset.editcl) editClient(t.dataset.editcl);
  else if (t.dataset.editp) editPartner(t.dataset.editp);
  else if (t.id === 'fab') editRequest(null, ui.tab === 'clients' && ui.client ? ui.client : undefined); // в профиле гостя — сразу для него
  else if (t.id === 'addBtn') {
    if (ui.tab === 'requests') editRequest(null);
    else if (ui.tab === 'clients') editClient(null);
    else if (ui.tab === 'trips') import('./dossier.js').then((m) => m.editTrip(null, ui.client));
    else editPartner(null);
  } else if (t.id === 'theme') {
    const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
    try { localStorage.setItem('theme', next); } catch {}
    applyTheme(next); toast(THEME_LABEL[next]);
  } else if (t.id === 'menuBtn') {
    menu.hidden = !menu.hidden; t.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) showUsage();
  } else if (t.id === 'setPass') {
    menu.hidden = true;
    const p = prompt('Новый пароль (не меньше 8 символов):');
    if (!p) return;
    if (p.length < 8) { toast('Пароль слишком короткий.', 'err'); return; }
    sb.auth.updateUser({ password: p }).then(({ error }) => toast(error ? authError(error) : 'Пароль сохранён. Теперь можно входить по паролю.', error ? 'err' : ''));
  } else if (t.id === 'tgBtn') {
    if (menu) menu.hidden = true;
    import('./telegram.js').then((m) => m.openTelegram());
  } else if (t.id === 'backupBtn' || t.dataset.backup != null) {
    if (menu) menu.hidden = true;
    openBackup(render);
  } else if (t.id === 'logout') {
    sb.auth.signOut();
  }
});
// «Перед вылетом» — модуль брифинга грузится при первом нажатии
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-brief]');
  if (b) { e.stopPropagation(); import('./brief.js').then((m) => m.openBrief(b.dataset.brief)); }
});
// поиск: перерисовка через 300 мс после последней буквы, а не на каждую
let qTimer;
document.addEventListener('input', (e) => { if (e.target.id === 'q') { ui.q = e.target.value; clearTimeout(qTimer); qTimer = setTimeout(render, 300); } });
document.addEventListener('change', (e) => {
  if (e.target.id === 'ptype') { ui.ptype = e.target.value; render(); }
  if (e.target.id === 'pcity') { ui.pcity = e.target.value; render(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); const m = $('#menuList'); if (m) m.hidden = true; } });

function route(session, event) {
  if (session && shown !== 'app') renderShell(session);
  else if (!session) {
    // без сети сессию не обновить — если владелец уже входил на этом устройстве, открываем офлайн-снимок
    const kept = storedSession();
    if (!navigator.onLine && kept?.user && event !== 'SIGNED_OUT') { if (shown !== 'app') renderShell(kept); return; }
    stopRealtime(); closeModal(); clearSnapshot(); clearCache(); renderLogin();
  }
}

try {
  sb = await getSupabase();
  const { data } = await sb.auth.getSession();
  route(data.session);
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') route(session, event);
  });
} catch {
  root.innerHTML = `<main class="center"><div class="login"><h1>Сайт не настроен</h1>
    <p class="lead">Нет подключения к базе. Проверьте переменные окружения в Vercel.</p></div></main>`;
}

// сколько раз сегодня обращались к Jarvis (день — по времени сброса лимита Gemini)
async function showUsage() {
  const el = $('#usageLine');
  if (!el) return;
  try {
    const sb = await getSupabase();
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const { data } = await sb.from('search_cache').select('result').eq('key', `usage|${day}`).maybeSingle();
    const u = data?.result || {};
    el.textContent = `Jarvis сегодня: ${u.flash || 0} осн. · ${u.lite || 0} лёгк.${u.tavily ? ` · поиск ${u.tavily}` : ''}`;
    el.hidden = false;
  } catch { el.hidden = true; }
}

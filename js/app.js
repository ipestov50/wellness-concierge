import { getSupabase } from './supabase.js';
import { esc, $, toast, closeModal } from './ui.js';
import { state, onChange, loadAll, startRealtime, stopRealtime } from './data.js';
import { ui, render } from './router.js';
import { editRequest, editClient, editPartner } from './forms.js';
import { openBackup, setLastBackupFromSession } from './backup.js';
import './views/requests.js';
import './views/clients.js';
import './views/partners.js';

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
        <button class="tab" role="tab" data-tab="partners" type="button">Партнёры</button>
      </nav>
      <div class="tools">
        <button class="btn primary" id="addBtn" type="button">+ Новый запрос</button>
        <button class="icon-btn" id="theme" type="button"></button>
        <div class="menu">
          <button class="icon-btn" id="menuBtn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Меню">⋯</button>
          <div class="menu-list" id="menuList" hidden>
            <div class="menu-who">${esc(session.user.email)}</div>
            <button type="button" id="backupBtn">💾 Резервная копия…</button>
            <button type="button" id="setPass">Задать пароль</button>
            <button type="button" id="logout">Выйти</button>
          </div>
        </div>
      </div>
    </header>
    <main id="app"><div class="empty">Загружаю данные…</div></main>
    <div id="modal"></div>`;
  applyTheme(getTheme());
  render();
  loadAll().then(startRealtime).catch((e) => {
    $('#app').innerHTML = `<div class="notice">Не удалось загрузить данные: ${esc(e.message || e)}. Обновите страницу.</div>`;
  });
}

onChange(() => { if (shown === 'app' && state.loaded) render(); });

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab],[data-req],[data-cl],[data-newreq],[data-editcl],[data-editp],#addBtn,#theme,#menuBtn,#setPass,#logout,#backupBtn,[data-backup]');
  const menu = $('#menuList');
  if (menu && !menu.hidden && !e.target.closest('.menu')) { menu.hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); }
  if (!t) return;
  if (t.dataset.tab) { ui.tab = t.dataset.tab; ui.q = ''; render(); scrollTo(0, 0); }
  else if (t.dataset.req) editRequest(t.dataset.req);
  else if (t.dataset.cl) { ui.client = t.dataset.cl; render(); if (matchMedia('(max-width: 760px)').matches) scrollTo(0, 0); }
  else if (t.dataset.newreq) editRequest(null, t.dataset.newreq);
  else if (t.dataset.editcl) editClient(t.dataset.editcl);
  else if (t.dataset.editp) editPartner(t.dataset.editp);
  else if (t.id === 'addBtn') {
    if (ui.tab === 'requests') editRequest(null);
    else if (ui.tab === 'clients') editClient(null);
    else editPartner(null);
  } else if (t.id === 'theme') {
    const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
    try { localStorage.setItem('theme', next); } catch {}
    applyTheme(next); toast(THEME_LABEL[next]);
  } else if (t.id === 'menuBtn') {
    menu.hidden = !menu.hidden; t.setAttribute('aria-expanded', String(!menu.hidden));
  } else if (t.id === 'setPass') {
    menu.hidden = true;
    const p = prompt('Новый пароль (не меньше 8 символов):');
    if (!p) return;
    if (p.length < 8) { toast('Пароль слишком короткий.', 'err'); return; }
    sb.auth.updateUser({ password: p }).then(({ error }) => toast(error ? authError(error) : 'Пароль сохранён. Теперь можно входить по паролю.', error ? 'err' : ''));
  } else if (t.id === 'backupBtn' || t.dataset.backup != null) {
    if (menu) menu.hidden = true;
    openBackup(render);
  } else if (t.id === 'logout') {
    sb.auth.signOut();
  }
});
document.addEventListener('input', (e) => { if (e.target.id === 'q') { ui.q = e.target.value; render(); } });
document.addEventListener('change', (e) => {
  if (e.target.id === 'ptype') { ui.ptype = e.target.value; render(); }
  if (e.target.id === 'pcity') { ui.pcity = e.target.value; render(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); const m = $('#menuList'); if (m) m.hidden = true; } });

function route(session) {
  if (session && shown !== 'app') renderShell(session);
  else if (!session) { stopRealtime(); closeModal(); renderLogin(); }
}

try {
  sb = await getSupabase();
  const { data } = await sb.auth.getSession();
  route(data.session);
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') route(session);
  });
} catch {
  root.innerHTML = `<main class="center"><div class="login"><h1>Сайт не настроен</h1>
    <p class="lead">Нет подключения к базе. Проверьте переменные окружения в Vercel.</p></div></main>`;
}

import { getSupabase } from './supabase.js';

const root = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const AUTH_ERRORS = {
  'Invalid login credentials': 'Неверная почта или пароль.',
  'Email not confirmed': 'Почта ещё не подтверждена.',
  'Signups not allowed for otp': 'Этот адрес не зарегистрирован.',
  'User not found': 'Этот адрес не зарегистрирован.',
};
const authError = (e) => AUTH_ERRORS[e?.message] || (/rate limit|security purposes/i.test(e?.message || '')
  ? 'Слишком много попыток. Подождите минуту и попробуйте снова.'
  : 'Не получилось: ' + (e?.message || 'неизвестная ошибка'));

let sb;

function renderLogin(message = '', kind = '') {
  root.innerHTML = `
    <main class="center">
      <form class="card" id="login">
        <div class="mark">W</div>
        <h1>Wellness Concierge</h1>
        <p class="sub">Вход только для владельца</p>
        <label class="field"><span>Почта</span>
          <input type="email" name="email" autocomplete="username" required inputmode="email"></label>
        <label class="field"><span>Пароль</span>
          <input type="password" name="password" autocomplete="current-password" placeholder="если уже задан"></label>
        <button class="btn primary" type="submit" data-mode="password">Войти</button>
        <button class="btn ghost" type="submit" data-mode="link">Прислать ссылку для входа</button>
        <p class="msg ${kind}" role="status">${esc(message)}</p>
      </form>
    </main>`;
  const form = root.querySelector('#login');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const mode = ev.submitter?.dataset.mode || 'password';
    const email = form.email.value.trim();
    const password = form.password.value;
    const msg = form.querySelector('.msg');
    form.querySelectorAll('button').forEach((b) => (b.disabled = true));
    msg.className = 'msg'; msg.textContent = mode === 'link' ? 'Отправляю ссылку…' : 'Вхожу…';
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

async function renderHome(session) {
  root.innerHTML = `
    <header class="top">
      <span class="brand">Wellness Concierge</span>
      <span class="spacer"></span>
      <button class="btn ghost small" id="set-pass">Задать пароль</button>
      <button class="btn ghost small" id="logout">Выйти</button>
    </header>
    <main class="center">
      <section class="card">
        <h1>Вы вошли</h1>
        <p class="sub">${esc(session.user.email)}</p>
        <div class="status">Вход работает · этап 4</div>
        <h2>Партнёры в базе</h2>
        <ul class="list" id="partners"><li class="muted">Загружаю…</li></ul>
      </section>
    </main>`;
  root.querySelector('#logout').onclick = () => sb.auth.signOut();
  root.querySelector('#set-pass').onclick = async () => {
    const p = prompt('Новый пароль (не меньше 8 символов):');
    if (!p) return;
    if (p.length < 8) return alert('Пароль слишком короткий.');
    const { error } = await sb.auth.updateUser({ password: p });
    alert(error ? authError(error) : 'Пароль сохранён. Теперь можно входить по паролю.');
  };
  const { data, error } = await sb.from('partners').select('name, city').order('name');
  const ul = root.querySelector('#partners');
  ul.innerHTML = error ? `<li class="err">Ошибка: ${esc(error.message)}</li>`
    : data.length ? data.map((p) => `<li>${esc(p.name)} <span class="muted">· ${esc(p.city)}</span></li>`).join('')
    : '<li class="muted">Пока пусто</li>';
}

function render(session) { session ? renderHome(session) : renderLogin(); }

try {
  sb = await getSupabase();
  const { data } = await sb.auth.getSession();
  render(data.session);
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') render(session);
  });
} catch (e) {
  root.innerHTML = `<main class="center"><div class="card"><h1>Сайт не настроен</h1>
    <p class="sub">Нет подключения к базе. Проверьте переменные окружения в Vercel.</p></div></main>`;
}

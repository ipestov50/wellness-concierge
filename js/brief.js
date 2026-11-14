// «✈️ Перед вылетом»: время, погода, праздники, деньги — сразу; въезд, платежи, связь, фразы — от Jarvis с источниками
import { getSupabase } from './supabase.js';
import { esc, openModal, toast, fromParisInput } from './ui.js';
import { state, byId, save } from './data.js';
import { firstKey } from './statuses.js';
import { flag, timeIn, diffHours, fmtDiff, CITIZENSHIPS } from './tz.js';
import { fmtRange } from './dossier.js';

const WMO = (c) => (c === 0 ? '☀️' : c <= 2 ? '🌤' : c === 3 ? '☁️' : c <= 48 ? '🌫' : c <= 57 ? '🌦' : c <= 67 ? '🌧' : c <= 77 ? '🌨' : c <= 82 ? '🌦' : c <= 86 ? '🌨' : '⛈');
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const SYM = { RUB: '₽', KZT: '₸', UZS: 'сум', AZN: '₼', AMD: '֏', GEL: '₾', BYN: 'Br', KGS: 'с', UAH: '₴', EUR: '€', USD: '$', GBP: '£', AED: 'AED', CHF: 'CHF', TRY: '₺', THB: '฿' };
const money = (n, cur) => `${Number(n).toLocaleString('ru-RU', { maximumFractionDigits: n < 10 ? 2 : 0 })} ${SYM[cur] || cur}`;
const ENTRY = { visa_free: ['Без визы', 'ok'], evisa: ['Электронная виза', 'mid'], visa_required: ['Нужна виза', 'bad'], unknown: ['Уточнить', 'mid'] };

async function call(id, mode) {
  const sb = await getSupabase();
  const token = (await sb.auth.getSession()).data.session?.access_token;
  const r = await fetch('/api/brief', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ id, mode }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || r.status);
  return body;
}

// советы из погоды — то, что консьерж предусмотрит заранее
function weatherAdvice(days) {
  const out = [];
  const rainy = days.filter((d) => (d.rain ?? 0) >= 60 || (d.mm ?? 0) >= 5);
  if (rainy.length) out.push(`☔ Дождь ${rainy.length === days.length ? 'все дни' : rainy.map((d) => +d.date.slice(8)).join(', ') + '-го'} — зонт в машине, план под крышей`);
  if (days.some((d) => d.tmax >= 30)) out.push('🌡 Жара — тень, вода, SPF, бассейн днём, активности утром');
  if (days.some((d) => d.tmin <= 3)) out.push('🧣 Холодно — пледы в машину, тёплые вещи детям');
  if (days.some((d) => (d.wind ?? 0) >= 40)) out.push('💨 Сильный ветер — яхта и вертолёт под вопросом, запасной вариант');
  return out;
}

const skeleton = '<div class="bf-skel"><i></i><i></i><i></i></div>';

export function openBrief(tripId) {
  const t = state.trips.find((x) => x.id === tripId);
  if (!t) return;
  const c = byId('clients', t.client_id);
  const cit = CITIZENSHIPS.find(([k]) => k === c?.citizenship)?.[1];
  const m = openModal({
    title: 'Перед вылетом',
    saveLabel: 'Закрыть',
    body: `<div class="bf">
      <header class="bf-hero">
        <div class="bf-flag">${flag(t.country_code) || '✈️'}</div>
        <div class="bf-h"><h3>${esc(t.city)}${t.country ? `<span>, ${esc(t.country)}</span>` : ''}</h3>
          <p>${esc(fmtRange(t) || 'даты не указаны')}${t.hotel ? ` · ${esc(t.hotel)}` : ''}</p>
          <p class="bf-guest">${c ? esc(c.name) : ''}${cit ? ` · ${cit}` : c ? ' · <button type="button" class="link" data-editcl="' + c.id + '">указать гражданство</button>' : ''}</p></div>
      </header>
      <div class="bf-grid">
        <section class="bf-card" id="bf-time"><h4>🕐 Время</h4>${skeleton}</section>
        <section class="bf-card" id="bf-money"><h4>💱 Деньги</h4>${skeleton}</section>
        <section class="bf-card wide" id="bf-weather"><h4>🌦 Погода</h4>${skeleton}</section>
        <section class="bf-card" id="bf-hol"><h4>🎌 Праздники</h4>${skeleton}</section>
      </div>
      <section class="bf-jarvis" id="bf-jarvis"></section>
    </div>`,
    onSave: async () => {},
  });
  m.form.classList.add('wide');
  m.form.querySelector('#cancel').hidden = true;
  const $ = (s) => m.form.querySelector(s);

  // ---------- факты: сразу ----------
  call(tripId, 'facts').then((f) => {
    // время
    const tz = f.tz || t.tz;
    if (tz) {
      const home = c?.home_tz;
      const d = home ? diffHours(home, tz, t.start_date ? new Date(t.start_date + 'T12:00:00Z') : new Date()) : null;
      $('#bf-time').innerHTML = `<h4>🕐 Время</h4>
        <div class="bf-big" data-tz-clock="${esc(tz)}">${timeIn(tz)}</div><p class="bf-sub">местное время · ${esc(t.city)}</p>
        ${d != null ? `<p class="bf-line">${d === 0 ? 'как дома у гостя' : `<b>на ${Math.abs(d)} ч ${d < 0 ? 'раньше' : 'позже'}</b>, чем дома у гостя`}</p>${Math.abs(d) >= 3 ? `<p class="bf-tip">😴 Разница ${Math.abs(d)} ч — первый вечер без поздних броней, завтрак попозже</p>` : ''}`
          : `<p class="bf-tip">Укажите часовой пояс гостя — Jarvis посчитает смену часов</p>`}
        <p class="bf-line muted">${(() => { const p = diffHours('Europe/Paris', tz); return p === 0 ? 'как в Париже' : `${fmtDiff(p)} к Парижу`; })()}</p>`;
    } else $('#bf-time').innerHTML = '<h4>🕐 Время</h4><p class="bf-sub">Город не найден</p>';
    // деньги
    if (f.money?.rate) {
      const { local, home, rate } = f.money;
      $('#bf-money').innerHTML = `<h4>💱 Деньги</h4>
        <div class="bf-big">1 ${SYM[local] || local} = ${money(rate, home)}</div><p class="bf-sub">местная валюта — ${local}</p>
        <label class="bf-conv"><input type="number" inputmode="decimal" value="500" min="0" step="any" id="bf-amt"><span>${SYM[local] || local} =</span><b id="bf-res">${money(500 * rate, home)}</b></label>`;
      $('#bf-amt').addEventListener('input', (e) => { $('#bf-res').textContent = money((+e.target.value || 0) * rate, home); });
    } else $('#bf-money').innerHTML = `<h4>💱 Деньги</h4><p class="bf-sub">${f.money?.local ? 'Курс недоступен' : 'Валюта страны не определена'}</p>`;
    // погода
    const w = f.weather;
    if (w?.days?.length) {
      const adv = weatherAdvice(w.days);
      $('#bf-weather').innerHTML = `<h4>🌦 Погода ${w.mode === 'lastyear' ? '<small>· прогноз появится за 2 недели, пока — как было в эти даты год назад</small>' : ''}</h4>
        <div class="bf-days">${w.days.map((d) => { const dt = new Date(d.date + 'T12:00:00Z'); return `<div class="bf-day${(d.rain ?? 0) >= 60 || (d.mm ?? 0) >= 5 ? ' wet' : ''}">
          <small>${WD[dt.getUTCDay()]} ${dt.getUTCDate()}</small><span class="bf-ic">${WMO(d.code)}</span><b>${Math.round(d.tmax)}°</b><small>${Math.round(d.tmin)}°</small>
          ${d.rain != null ? `<i>${d.rain}%</i>` : d.mm ? `<i>${Math.round(d.mm)} мм</i>` : '<i></i>'}</div>`; }).join('')}</div>
        ${adv.length ? `<ul class="bf-adv">${adv.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '<p class="bf-tip">Погода спокойная — без сюрпризов</p>'}`;
    } else $('#bf-weather').innerHTML = `<h4>🌦 Погода</h4><p class="bf-sub">${t.start_date ? 'Нет данных о погоде' : 'Укажите даты поездки'}</p>`;
    // праздники
    const h = f.holidays || [];
    $('#bf-hol').innerHTML = `<h4>🎌 Праздники</h4>${h.length ? `<ul class="bf-hl">${h.map((x) => `<li><b>${+x.date.slice(8)}.${x.date.slice(5, 7)}</b> ${esc(x.name)}${x.en && x.en !== x.name ? ` <small>${esc(x.en)}</small>` : ''}</li>`).join('')}</ul>
      <p class="bf-tip">Магазины и часть ресторанов закрыты — брони заранее, пробки на дорогах</p>` : `<p class="bf-sub">${f.cc ? 'В эти даты праздников нет' : 'Страна не определена'}</p>`}`;
  }).catch((e) => {
    m.form.querySelectorAll('.bf-card').forEach((el) => { el.querySelector('.bf-skel')?.replaceWith(Object.assign(document.createElement('p'), { className: 'bf-sub', textContent: 'Не удалось загрузить: ' + e.message })); });
  });

  // ---------- Jarvis ----------
  const renderJarvis = (b, busy = false) => {
    const box = $('#bf-jarvis');
    if (busy) { box.innerHTML = `<div class="bf-jhead"><b>✦ Jarvis: въезд и на месте</b></div><div class="bf-busy"><span class="spin"></span> Jarvis ищет актуальные правила въезда, оплаты и связи для ${esc(t.city)}…</div>${skeleton}`; return; }
    if (!b) {
      box.innerHTML = `<div class="bf-jhead"><b>✦ Jarvis: въезд и на месте</b></div>
        <div class="bf-empty"><p>Визы для гражданства гостя, работают ли карты, наличные и чаевые, связь и розетки, этикет, фразы для таксиста и что предусмотреть заранее — с источниками.</p>
        <button type="button" class="btn primary" data-bf-run>✦ Собрать брифинг</button></div>`;
      return;
    }
    const e = ENTRY[b.entry?.status] || ENTRY.unknown;
    const stale = b.for && (b.for.citizenship !== (c?.citizenship || null) || b.for.city !== t.city || b.for.start !== t.start_date);
    box.innerHTML = `<div class="bf-jhead"><b>✦ Jarvis: въезд и на месте</b>
        <span class="muted">${b.generated_at ? new Date(b.generated_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : ''}${b.confidence === 'low' ? ' · ⚠ мало данных' : ''}</span>
        <button type="button" class="link" data-bf-run>↻ Обновить</button></div>
      ${stale ? '<p class="bf-stale">Данные поездки или гражданство изменились — обновите брифинг</p>' : ''}
      <div class="bf-entry ${e[1]}"><span class="bf-badge">${e[0]}</span><div><b>${esc(b.entry?.title || '')}</b>${(b.entry?.details || []).length ? `<ul>${b.entry.details.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div></div>
      <div class="bf-grid">
        <section class="bf-card"><h4>💳 Оплата</h4>
          ${b.money?.cards ? `<p><b>Карты.</b> ${esc(b.money.cards)}</p>` : ''}${b.money?.cash ? `<p><b>Наличные.</b> ${esc(b.money.cash)}</p>` : ''}${b.money?.tips ? `<p><b>Чаевые.</b> ${esc(b.money.tips)}</p>` : ''}</section>
        <section class="bf-card"><h4>📶 Связь</h4>${b.connect?.sim ? `<p>${esc(b.connect.sim)}</p>` : ''}${b.connect?.plugs ? `<p>🔌 ${esc(b.connect.plugs)}</p>` : ''}</section>
        ${(b.etiquette || []).length ? `<section class="bf-card"><h4>🎩 Этикет</h4><ul>${b.etiquette.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
        ${(b.safety || []).length ? `<section class="bf-card"><h4>🛡 Безопасность</h4><ul>${b.safety.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
      </div>
      ${(b.phrases || []).length ? `<section class="bf-phr"><h4>🗣 Фразы для гостя</h4>${b.phrases.map((p, i) => `<button type="button" class="bf-ph" data-bf-copy="${i}" title="Скопировать">
        <span>${esc(p.ru)}</span><b>${esc(p.local)}</b>${p.say ? `<small>${esc(p.say)}</small>` : ''}</button>`).join('')}</section>` : ''}
      ${(b.actions || []).length ? `<section class="bf-act"><h4>✓ Что предусмотреть заранее</h4>
        ${b.actions.map((a, i) => `<label class="bf-ai"><input type="checkbox" data-bf-a="${i}" checked><span><b>${esc(a.t)}</b>${a.why ? `<small>${esc(a.why)}</small>` : ''}</span>${a.days_before ? `<em>за ${a.days_before} дн.</em>` : ''}</label>`).join('')}
        <button type="button" class="btn small primary" data-bf-tasks>Создать задачи</button></section>` : ''}
      ${(b.sources || []).length ? `<p class="bf-src">Источники: ${b.sources.map((s) => `<a href="${esc(s.uri)}" target="_blank" rel="noopener">${esc(s.title || 'ссылка')}</a>`).join(' · ')}</p>` : ''}
      <p class="bf-note">Правила въезда меняются — перед поездкой сверьте с официальным сайтом посольства или консульства.</p>`;
  };
  renderJarvis(t.brief);

  m.form.addEventListener('click', async (e) => {
    if (e.target.closest('[data-bf-run]')) {
      renderJarvis(null, true);
      try { const { brief } = await call(tripId, 'jarvis'); t.brief = brief; renderJarvis(brief); }
      catch (err) { renderJarvis(t.brief); toast(err.message === 'rate_limited' ? 'Лимит Gemini — попробуйте через минуту' : 'Не получилось: ' + err.message, 'err'); }
    }
    const cp = e.target.closest('[data-bf-copy]');
    if (cp) { const p = t.brief.phrases[+cp.dataset.bfCopy]; await navigator.clipboard.writeText(`${p.ru}\n${p.local}${p.say ? `\n(${p.say})` : ''}`); cp.classList.add('copied'); setTimeout(() => cp.classList.remove('copied'), 900); toast('Фраза скопирована'); }
    if (e.target.closest('[data-bf-tasks]')) {
      const btn = e.target.closest('[data-bf-tasks]');
      const chosen = (t.brief.actions || []).filter((_, i) => m.form.querySelector(`[data-bf-a="${i}"]`)?.checked);
      if (!chosen.length) return toast('Отметьте хотя бы один пункт', 'err');
      btn.disabled = true;
      try {
        for (const a of chosen) {
          let deadline = null;
          if (t.start_date) {
            const d = new Date(t.start_date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - (a.days_before || 3));
            const today = new Date().toISOString().slice(0, 10);
            const day = d.toISOString().slice(0, 10) < today ? today : d.toISOString().slice(0, 10);
            deadline = fromParisInput(`${day}T10:00`);
          }
          await save('requests', null, { client_id: t.client_id, summary: a.t, category: 'Other', urgency: 'normal', status: firstKey(), deadline, clarifying_questions: a.why || null, original_message: `Перед вылетом: ${t.city}` });
        }
        toast(`Создано задач: ${chosen.length}`);
      } catch (err) { toast('Не получилось: ' + err.message, 'err'); }
      btn.disabled = false;
    }
  });
}

// кнопка «Перед вылетом» на карточках поездок
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-brief]');
  if (b) { e.stopPropagation(); openBrief(b.dataset.brief); }
});

// «📘 Путеводитель» для гостя: ваши указания → черновик Jarvis → правки → PDF.
// Черновик хранится в поездке (trips.guide). PDF — через системное «Сохранить как PDF» (бесплатно, без сервисов).
import { esc, openModal, toast } from './ui.js';
import { state, byId, save } from './data.js';
import { api, isAbort } from './api.js';
import { fmtRange } from './dossier.js';

const SECTIONS = [
  ['dining', '🍽 Рестораны и кафе'], ['wellness', '💆 Спа и велнес'], ['places', '🏛 Прогулки и места'], ['shopping', '🛍 Шопинг'],
  ['kids', '🧸 С детьми'], ['nightlife', '🌙 Вечером'], ['transport', '🚇 Как передвигаться'], ['useful', '💡 Полезно знать'],
];
const ICON = Object.fromEntries(SECTIONS.map(([k, l]) => [k, l.split(' ')[0]]));
const firstName = (c) => (c?.name || '').replace(/\s*\(.*?\)/g, '').split(/\s+/)[0] || '';
const fill = (s, c) => String(s || '').replace(/\{имя\}/g, firstName(c) || 'дорогой гость');

export function openGuide(tripId) {
  const t = state.trips.find((x) => x.id === tripId);
  if (!t) return;
  const c = byId('clients', t.client_id);
  const m = openModal({ title: '📘 Путеводитель для гостя', saveLabel: 'Закрыть', body: '<div class="gd" id="gd"></div>', onSave: async () => {} });
  m.form.classList.add('wide');
  m.form.querySelector('#cancel').hidden = true;
  const box = m.form.querySelector('#gd');
  const back = `<button type="button" class="link" data-gd-back>← к «Перед вылетом»</button>`;

  // ---------- 1. ваши указания ----------
  const composer = () => {
    const g = t.guide;
    const kids = /дет|сын|доч|реб/i.test(t.companions || '');
    const on = new Set(g?.sections_req || SECTIONS.map(([k]) => k).filter((k) => k !== 'kids' || kids));
    box.innerHTML = `${back}
      <p class="gd-lead">${esc(t.city)}${fmtRange(t) ? ' · ' + esc(fmtRange(t)) : ''} — Jarvis учтёт предпочтения гостя, аллергии, ваших партнёров в городе и брифинг «Перед вылетом». Имя гостя в ИИ не уходит.</p>
      <label class="f"><span>Ваши указания Jarvis</span>
        <textarea id="gd-notes" rows="4" placeholder="Например: акцент на рыбные рестораны с видом на море, без глютена; один день в Монако; спа только с хаммамом; ничего шумного по вечерам">${esc(g?.notes || '')}</textarea></label>
      <div class="gd-secs">${SECTIONS.map(([k, l]) => `<label class="gd-sec"><input type="checkbox" value="${k}"${on.has(k) ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <div class="gd-act"><button type="button" class="btn primary" data-gd-run>✦ Собрать черновик</button>
        ${g ? '<button type="button" class="btn" data-gd-edit>Открыть сохранённый черновик</button>' : ''}</div>`;
  };

  // ---------- 2. черновик: всё можно поправить ----------
  const itemHtml = (x = {}) => `<div class="gd-item">
      <div class="gd-row"><input class="gd-name" value="${esc(x.name || '')}" placeholder="Название">${x.partner ? '<span class="gd-partner" title="Ваш партнёр">★ партнёр</span>' : ''}<button type="button" class="icon-btn gd-del" data-gd-del aria-label="Убрать">✕</button></div>
      <textarea class="gd-what" rows="2" placeholder="Что это и чем хорошо">${esc(x.what || '')}</textarea>
      <textarea class="gd-why" rows="1" placeholder="Почему для этого гостя">${esc(x.why || '')}</textarea>
      <div class="gd-row2"><input class="gd-area" value="${esc(x.area || '')}" placeholder="Район / адрес"><input class="gd-tip" value="${esc(x.tip || '')}" placeholder="Совет: что заказать, дресс-код, бронь"></div>
      <input type="hidden" class="gd-p" value="${x.partner ? 1 : ''}"></div>`;
  const editor = () => {
    const g = t.guide;
    box.innerHTML = `${back}
      <div class="gd-top"><input id="gd-title" class="gd-title" value="${esc(g.title || '')}">
        <span class="muted">${g.generated_at ? 'черновик от ' + new Date(g.generated_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : ''}</span></div>
      <label class="f"><span>Вступление · «{имя}» заменится на имя гостя</span><textarea id="gd-intro" rows="3">${esc(g.intro || '')}</textarea></label>
      ${(g.sections || []).map((s, i) => `<section class="gd-s" data-key="${esc(s.key)}">
        <div class="gd-row"><span class="gd-ic">${ICON[s.key] || '📍'}</span><input class="gd-stitle" value="${esc(s.title)}"><button type="button" class="icon-btn" data-gd-sdel="${i}" aria-label="Убрать раздел">✕</button></div>
        <div class="gd-items">${s.items.map(itemHtml).join('')}</div>
        <button type="button" class="btn small ghostish" data-gd-add>＋ Добавить место</button></section>`).join('')}
      <label class="f"><span>💡 Советы (по одному в строке)</span><textarea id="gd-tips" rows="4">${esc((g.tips || []).join('\n'))}</textarea></label>
      ${(g.sources || []).length ? `<p class="bf-src">Источники: ${g.sources.map((s) => `<a href="${esc(s.uri)}" target="_blank" rel="noopener">${esc(s.title || 'ссылка')}</a>`).join(' · ')}</p>` : ''}
      <div class="gd-act sticky"><button type="button" class="btn" data-gd-save>💾 Сохранить правки</button>
        <button type="button" class="btn" data-gd-redo>↻ Пересобрать с указаниями</button>
        <button type="button" class="btn primary" data-gd-pdf>📄 Скачать PDF</button></div>`;
  };
  // собрать то, что сейчас в полях
  const collect = () => ({
    ...t.guide,
    title: box.querySelector('#gd-title').value.trim(),
    intro: box.querySelector('#gd-intro').value.trim(),
    tips: box.querySelector('#gd-tips').value.split('\n').map((x) => x.trim()).filter(Boolean),
    sections: [...box.querySelectorAll('.gd-s')].map((s) => ({
      key: s.dataset.key, title: s.querySelector('.gd-stitle').value.trim(),
      items: [...s.querySelectorAll('.gd-item')].map((it) => ({
        name: it.querySelector('.gd-name').value.trim(), what: it.querySelector('.gd-what').value.trim(), why: it.querySelector('.gd-why').value.trim(),
        area: it.querySelector('.gd-area').value.trim(), tip: it.querySelector('.gd-tip').value.trim(), partner: !!it.querySelector('.gd-p').value,
      })).filter((x) => x.name || x.what),
    })).filter((s) => s.items.length),
    edited_at: new Date().toISOString(),
  });
  const persist = async () => { const g = collect(); await save('trips', tripId, { guide: g }); t.guide = g; return g; };

  box.addEventListener('click', async (e) => {
    const el = e.target;
    if (el.closest('[data-gd-back]')) { const g = box.querySelector('#gd-title') && collect(); if (g) save('trips', tripId, { guide: g }).catch(() => {}); import('./brief.js').then((b) => b.openBrief(tripId)); return; }
    if (el.closest('[data-gd-edit]')) return editor();
    if (el.closest('[data-gd-redo]')) { await persist().catch(() => {}); return composer(); }
    if (el.closest('[data-gd-del]')) return el.closest('.gd-item').remove();
    if (el.closest('[data-gd-sdel]')) return el.closest('.gd-s').remove();
    if (el.closest('[data-gd-add]')) { el.closest('.gd-s').querySelector('.gd-items').insertAdjacentHTML('beforeend', itemHtml()); return; }
    if (el.closest('[data-gd-save]')) { try { await persist(); toast('Путеводитель сохранён'); } catch (err) { toast('Не сохранилось: ' + err.message, 'err'); } return; }
    if (el.closest('[data-gd-pdf]')) { let g; try { g = await persist(); } catch { g = collect(); } return printGuide(g, t, c); }
    const run = el.closest('[data-gd-run]');
    if (run) {
      const notes = box.querySelector('#gd-notes').value.trim();
      const sections = [...box.querySelectorAll('.gd-sec input:checked')].map((x) => x.value);
      if (!sections.length) return toast('Выберите хотя бы один раздел', 'err');
      box.innerHTML = `<div class="bf-busy"><span class="spin"></span> Jarvis ищет места в ${esc(t.city)} и собирает путеводитель под гостя… обычно 20–60 секунд</div><div class="bf-skel"><i></i><i></i><i></i></div>`;
      try {
        const { guide } = await api('guide', { id: tripId, notes, sections }, { signal: m.signal });
        t.guide = guide;
        if (m.form.isConnected) editor();
      } catch (err) {
        if (isAbort(err) || !m.form.isConnected) return;
        toast(err.message === 'rate_limited' ? 'Лимит Gemini — попробуйте через минуту' : 'Не получилось: ' + err.message, 'err');
        composer();
        box.querySelector('#gd-notes').value = notes;
      }
    }
  });
  if (t.guide) editor(); else composer();
}

// ---------- PDF: отдельная страница с печатной вёрсткой → «Сохранить как PDF» ----------
function printGuide(g, t, c) {
  const w = window.open('', '_blank');
  if (!w) return toast('Браузер заблокировал окно — разрешите всплывающие окна для сайта', 'err');
  const dates = fmtRange(t);
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(fill(g.title, c))}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, system-ui, sans-serif; color: #1f1b16; font-size: 10.5pt; line-height: 1.5; margin: 0; }
  .cover { border-bottom: 2px solid #1d6b66; padding-bottom: 14px; margin-bottom: 18px; }
  .brand { font-size: 8.5pt; letter-spacing: .18em; text-transform: uppercase; color: #1d6b66; font-weight: 600; }
  h1 { font-family: Newsreader, Georgia, serif; font-size: 28pt; font-weight: 600; margin: 6px 0 2px; line-height: 1.1; }
  .sub { color: #6b6257; }
  .intro { font-size: 11.5pt; margin: 0 0 18px; }
  h2 { font-family: Newsreader, Georgia, serif; font-size: 16pt; margin: 22px 0 8px; break-after: avoid; color: #1d6b66; }
  .it { padding: 8px 0 10px; border-bottom: 1px solid #e8e0d2; break-inside: avoid; }
  .it b { font-size: 11pt; } .star { color: #b08d57; font-size: 8.5pt; margin-left: 6px; }
  .it p { margin: 2px 0; } .why { color: #4a6b68; font-style: italic; } .meta { color: #6b6257; font-size: 9pt; }
  .tips { background: #f6f1e8; border-radius: 10px; padding: 10px 14px 10px 28px; margin-top: 18px; break-inside: avoid; }
  .foot { margin-top: 22px; font-size: 8.5pt; color: #8a8175; }
</style></head><body>
  <div class="cover"><div class="brand">Wellness Concierge</div><h1>${esc(fill(g.title, c))}</h1>
    <div class="sub">${esc(t.city)}${t.country ? ', ' + esc(t.country) : ''}${dates ? ' · ' + esc(dates) : ''}${t.hotel ? ' · ' + esc(t.hotel) : ''}</div></div>
  ${g.intro ? `<p class="intro">${esc(fill(g.intro, c))}</p>` : ''}
  ${(g.sections || []).map((s) => `<h2>${ICON[s.key] || '📍'} ${esc(s.title)}</h2>${s.items.map((x) => `<div class="it">
    <b>${esc(x.name)}</b>${x.partner ? '<span class="star">★ рекомендуем</span>' : ''}
    ${x.what ? `<p>${esc(fill(x.what, c))}</p>` : ''}${x.why ? `<p class="why">${esc(fill(x.why, c))}</p>` : ''}
    ${x.area || x.tip ? `<p class="meta">${[x.area && '📍 ' + esc(x.area), x.tip && '💡 ' + esc(fill(x.tip, c))].filter(Boolean).join(' · ')}</p>` : ''}</div>`).join('')}`).join('')}
  ${(g.tips || []).length ? `<ul class="tips">${g.tips.map((x) => `<li>${esc(fill(x, c))}</li>`).join('')}</ul>` : ''}
  <p class="foot">Подготовлено вашим консьержем · ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}. Часы работы и цены могут меняться — бронирование через консьержа.</p>
</body></html>`;
  w.document.open(); w.document.write(html); w.document.close();
  const go = () => { try { w.focus(); w.print(); } catch {} };
  // ждём шрифты, чтобы PDF был красивым
  (w.document.fonts?.ready || Promise.resolve()).then(() => setTimeout(go, 200));
  toast('В окне печати выберите «Сохранить как PDF»');
}

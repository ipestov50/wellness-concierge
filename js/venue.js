// Блок «Место» в карточке запроса: ★ наш партнёр (из списка) или 📍 другое место (гость нашёл сам / подобрал Jarvis).
// «Другое место» можно проверить на карте и одним нажатием добавить в партнёры.
import { esc, options, toast } from './ui.js';
import { state, byId, save } from './data.js';
import { api } from './api.js';
import { PARTNER_TYPE_LABEL } from './const.js';
import { updateGliders } from './router.js';

const CHECK = { verified: ['ok', '✓ найдено на карте по этому адресу'], corrected: ['mid', '↻ на карте другой адрес — подставлен'], unverified: ['bad', '⚠ не нашёл на карте — проверьте'] };
const CAT_TYPE = { Dining: 'restaurant', 'Spa & Wellness': 'spa', Activities: 'activity', 'Health & Fitness': 'spa', Transport: 'transport', Accommodation: 'hotel' };
const maps = (name, addr) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, addr].filter(Boolean).join(', '))}`;

function cityOf(r) {
  const day = (r.deadline || new Date().toISOString()).slice(0, 10);
  const t = state.trips.find((x) => x.client_id === r.client_id && x.start_date && x.start_date <= day && day <= (x.end_date || x.start_date));
  return t?.city || byId('clients', r.client_id)?.city || '';
}

export function venueBlock(r) {
  const v = r.venue || (r.partner_id ? { kind: 'partner', partner_id: r.partner_id } : null);
  const kind = v?.kind || '';
  const partners = [...state.partners].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((p) => [p.id, `${p.name} · ${PARTNER_TYPE_LABEL[p.type] || ''}${p.city ? ' · ' + p.city : ''}`]);
  const pl = kind === 'place' ? v : {};
  const [cls, label] = CHECK[pl.check] || [];
  return `<section class="venue" id="venue">
    <div class="venue-h"><b>Место</b>
      <div class="seg venue-seg" role="tablist" aria-label="Место">
        <button type="button" data-vk="partner" aria-selected="${kind === 'partner'}">★ Наш партнёр</button>
        <button type="button" data-vk="place" aria-selected="${kind === 'place'}">📍 Другое место</button>
        <button type="button" data-vk="" aria-selected="${!kind}">Пока нет</button></div></div>
    <input type="hidden" name="venue_kind" value="${esc(kind)}">
    <div class="venue-p" data-vpanel="partner"${kind === 'partner' ? '' : ' hidden'}>
      <select id="f-partner_id" name="partner_id">${options(partners, v?.partner_id || r.partner_id, '— выберите партнёра —')}</select>
      <p class="venue-info" id="venue-pinfo"></p></div>
    <div class="venue-p" data-vpanel="place"${kind === 'place' ? '' : ' hidden'}>
      <p class="venue-tip">Место, которое гость нашёл сам, или вариант Jarvis — не из ваших партнёров.</p>
      <div class="f2"><input name="v_name" placeholder="Название" value="${esc(pl.name || '')}" autocomplete="off"><input name="v_address" placeholder="Адрес" value="${esc(pl.address || '')}" autocomplete="off"></div>
      <div class="f2"><input name="v_phone" type="tel" placeholder="Телефон (для WhatsApp)" value="${esc(pl.phone || '')}" autocomplete="off"><input name="v_website" type="url" placeholder="Сайт" value="${esc(pl.website || '')}" autocomplete="off"></div>
      <input type="hidden" name="v_check" value="${esc(pl.check || '')}"><input type="hidden" name="v_maps" value="${esc(pl.maps || '')}">
      <div class="venue-row"><button type="button" class="btn small" data-v-verify>🔎 Проверить на карте</button>
        <span class="venue-res" id="venue-res">${label ? `<span class="opt-check ${cls}">${label}</span>` : ''}${pl.maps ? ` <a href="${esc(pl.maps)}" target="_blank" rel="noopener">📍 Google Maps</a>` : ''}</span>
        <button type="button" class="link" data-v-topartner>★ В мои партнёры</button></div></div>
  </section>`;
}

export function bindVenue(form, r) {
  const box = form.querySelector('#venue');
  if (!box) return;
  const kindIn = box.querySelector('[name="venue_kind"]');
  const pinfo = () => {
    const p = byId('partners', box.querySelector('#f-partner_id').value);
    box.querySelector('#venue-pinfo').innerHTML = p ? [p.address && `📍 ${esc(p.address)}`, p.contact && `☎ ${esc(p.contact)}`, p.address && `<a href="${esc(maps(p.name, p.address))}" target="_blank" rel="noopener">карта</a>`].filter(Boolean).join(' · ') || '<span class="muted">Адрес и контакт не заполнены — добавьте в «Партнёрах»</span>' : '';
  };
  pinfo();
  box.querySelector('#f-partner_id').addEventListener('change', pinfo);
  box.addEventListener('input', (e) => { if (e.target.name === 'v_name' || e.target.name === 'v_address') { box.querySelector('[name="v_check"]').value = ''; box.querySelector('#venue-res').innerHTML = ''; } });
  box.addEventListener('click', async (e) => {
    const k = e.target.closest('[data-vk]');
    if (k) {
      kindIn.value = k.dataset.vk;
      box.querySelectorAll('[data-vk]').forEach((b) => b.setAttribute('aria-selected', String(b === k)));
      box.querySelectorAll('[data-vpanel]').forEach((p) => { p.hidden = p.dataset.vpanel !== k.dataset.vk; });
      updateGliders();
      (k.dataset.vk === 'place' ? box.querySelector('[name="v_name"]') : k.dataset.vk === 'partner' ? box.querySelector('#f-partner_id') : null)?.focus();
      return;
    }
    if (e.target.closest('[data-v-verify]')) {
      const name = box.querySelector('[name="v_name"]').value.trim();
      if (!name) return toast('Впишите название места', 'err');
      const res = box.querySelector('#venue-res');
      res.innerHTML = '<span class="spin"></span> ищу на карте…';
      try {
        const out = await api('options', { mode: 'verify', id: r.id || '00000000-0000-0000-0000-000000000000', name, address: box.querySelector('[name="v_address"]').value.trim(), city: cityOf({ ...r, client_id: form.client_id?.value || r.client_id }) });
        const [cls, label] = CHECK[out.check] || CHECK.unverified;
        if (out.address && out.check === 'corrected') box.querySelector('[name="v_address"]').value = out.address;
        if (out.address && !box.querySelector('[name="v_address"]').value) box.querySelector('[name="v_address"]').value = out.address;
        box.querySelector('[name="v_check"]').value = out.check;
        box.querySelector('[name="v_maps"]').value = out.maps;
        res.innerHTML = `<span class="opt-check ${cls}">${label}</span> <a href="${esc(out.maps)}" target="_blank" rel="noopener">📍 Google Maps</a>${out.check === 'corrected' && out.address_given ? `<small class="opt-was">было: ${esc(out.address_given)}</small>` : ''}`;
      } catch { res.innerHTML = '<span class="muted">Проверка не удалась — попробуйте ещё раз</span>'; }
      return;
    }
    if (e.target.closest('[data-v-topartner]')) {
      const name = box.querySelector('[name="v_name"]').value.trim();
      if (!name) return toast('Впишите название места', 'err');
      const same = state.partners.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
      if (same) { toast('Такой партнёр уже есть — выберите его во вкладке «★ Наш партнёр»'); return; }
      try {
        const p = await save('partners', null, { name, address: box.querySelector('[name="v_address"]').value.trim() || null, city: cityOf(r) || null,
          contact: [box.querySelector('[name="v_phone"]').value.trim(), box.querySelector('[name="v_website"]').value.trim()].filter(Boolean).join(' · ') || null,
          type: CAT_TYPE[form.category?.value || r.category] || 'other' });
        // переключаем блок на партнёра
        const sel = box.querySelector('#f-partner_id');
        sel.insertAdjacentHTML('beforeend', `<option value="${esc(p.id)}">${esc(p.name)}</option>`);
        sel.value = p.id;
        box.querySelector('[data-vk="partner"]').click();
        pinfo();
        toast(`★ «${p.name}» добавлен в партнёры`);
      } catch (err) { toast('Не сохранилось: ' + (err.message || err), 'err'); }
    }
  });
}

// значения блока → поля запроса
export function readVenue(v, r) {
  if (v.venue_kind === 'partner' && v.partner_id) {
    const p = byId('partners', v.partner_id);
    return { partner_id: v.partner_id, venue: { kind: 'partner', partner_id: v.partner_id, name: p?.name || '', address: p?.address || '', maps: maps(p?.name, p?.address || p?.city), from: r.venue?.partner_id === v.partner_id ? r.venue?.from || 'manual' : 'manual' } };
  }
  if (v.venue_kind === 'place' && v.v_name.trim()) {
    const name = v.v_name.trim(), address = v.v_address.trim();
    return { partner_id: null, venue: { kind: 'place', name, address, phone: v.v_phone.trim(), website: v.v_website.trim(), check: v.v_check || null, maps: v.v_maps || maps(name, address), from: r.venue?.name === name ? r.venue?.from || 'manual' : 'manual' } };
  }
  return { partner_id: null, venue: null };
}

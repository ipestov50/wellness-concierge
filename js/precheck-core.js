// Тихое подтверждение: чистая логика без DOM — окна T-24ч / T-3ч и текст партнёру. Её проверяют тесты (scripts/test-precheck.mjs).
export const H = 36e5;

// окно проверки: T3 — до события ≤ 3 ч и финальный контроль ещё не отмечен; T24 — от 3 до 24 ч и реконфирмация не отмечена
export function precheckWindow(deadlineIso, now, flags = {}) {
  const t = Date.parse(deadlineIso);
  if (!Number.isFinite(t)) return null;
  const dt = t - now;
  if (dt < -30 * 60e3 || dt > 24 * H) return null;
  if (dt <= 3 * H) return flags.precheck3h_done ? null : 'T3';
  return flags.precheck24h_done ? null : 'T24';
}
export const countdown = (deadlineIso, now) => {
  const m = Math.max(0, Math.floor((Date.parse(deadlineIso) - now) / 60e3));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

// язык сообщения партнёру: по стране места; для остальных — английский
const BY_CC = { FR: 'fr', MC: 'fr', DE: 'de', AT: 'de', CH: 'de', IT: 'it', ES: 'es', RU: 'ru', BY: 'ru', KZ: 'ru' };
export const langFor = (cc) => BY_CC[String(cc || '').toUpperCase()] || 'en';
const T = {
  en: { hi: 'Hello!', body: (d) => `We would like to quietly reconfirm the booking on ${d}`, venue: (v) => ` at ${v}`, guest: (g) => `, under the name ${g}`, ask: 'Please confirm that everything is in place and the time is held.', allergy: (a) => `Guest allergies: ${a}.`, pref: (p) => `Preferences: ${p}.`, pickup: (p) => `Pickup point: ${p}.`, thanks: 'Thank you very much!' },
  fr: { hi: 'Bonjour,', body: (d) => `Nous souhaitons reconfirmer discrètement la réservation du ${d}`, venue: (v) => ` chez ${v}`, guest: (g) => `, au nom de ${g}`, ask: 'Pourriez-vous nous confirmer que tout est en place et que l’horaire est bien réservé ?', allergy: (a) => `Allergies du client : ${a}.`, pref: (p) => `Préférences : ${p}.`, pickup: (p) => `Point de prise en charge : ${p}.`, thanks: 'Merci beaucoup !' },
  de: { hi: 'Guten Tag,', body: (d) => `wir möchten die Reservierung am ${d} kurz rückbestätigen`, venue: (v) => ` bei ${v}`, guest: (g) => `, auf den Namen ${g}`, ask: 'Bitte bestätigen Sie uns, dass alles vorbereitet und der Termin reserviert ist.', allergy: (a) => `Allergien des Gastes: ${a}.`, pref: (p) => `Wünsche: ${p}.`, pickup: (p) => `Abholort: ${p}.`, thanks: 'Vielen Dank!' },
  it: { hi: 'Buongiorno,', body: (d) => `desideriamo riconfermare con discrezione la prenotazione di ${d}`, venue: (v) => ` presso ${v}`, guest: (g) => `, a nome ${g}`, ask: 'Potete confermare che tutto sia pronto e l’orario riservato?', allergy: (a) => `Allergie dell’ospite: ${a}.`, pref: (p) => `Preferenze: ${p}.`, pickup: (p) => `Punto di ritiro: ${p}.`, thanks: 'Grazie mille!' },
  es: { hi: 'Buenos días,', body: (d) => `nos gustaría reconfirmar con discreción la reserva del ${d}`, venue: (v) => ` en ${v}`, guest: (g) => `, a nombre de ${g}`, ask: '¿Podrían confirmar que todo está listo y el horario reservado?', allergy: (a) => `Alergias del huésped: ${a}.`, pref: (p) => `Preferencias: ${p}.`, pickup: (p) => `Punto de recogida: ${p}.`, thanks: '¡Muchas gracias!' },
  ru: { hi: 'Добрый день!', body: (d) => `Хотим тихо подтвердить бронь на ${d}`, venue: (v) => ` в «${v}»`, guest: (g) => `, на имя ${g}`, ask: 'Пожалуйста, подтвердите, что всё готово и время за нами.', allergy: (a) => `Аллергии гостя: ${a}.`, pref: (p) => `Пожелания: ${p}.`, pickup: (p) => `Место подачи: ${p}.`, thanks: 'Спасибо!' },
};
// Только то, что нужно партнёру: время, имя на брони, аллергии, пожелания к услуге, место подачи. Личные заметки консьержа сюда не попадают.
export function partnerMessage({ lang = 'en', whenIso, tz, venue, guest, allergies = [], pref = '', pickup = '' }) {
  const L = T[lang] || T.en;
  let when = whenIso;
  try { when = new Intl.DateTimeFormat(lang, { timeZone: tz || 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(whenIso)); } catch { /* оставляем ISO */ }
  const first = `${L.hi} ${L.body(when)}${venue ? L.venue(venue) : ''}${guest ? L.guest(guest) : ''}.`;
  const extra = [allergies.length && L.allergy(allergies.join(', ')), pref && L.pref(pref), pickup && L.pickup(pickup)].filter(Boolean);
  return [first, ...extra, L.ask, L.thanks].join(' ');
}

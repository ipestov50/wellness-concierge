// Доверие к источникам для VIP-брони: признанные гиды, официальные порталы, первичные продавцы билетов —
// и категорический запрет перепродавцов, сайтов-двойников, коротких ссылок и сайтов без HTTPS.

// признанные гиды и издания (упоминание = сильное подтверждение)
export const GUIDES = {
  'guide.michelin.com': 'Michelin', 'michelin.com': 'Michelin', 'gaultmillau.com': 'Gault&Millau', 'gault-millau.de': 'Gault&Millau', 'gaultmillau.ch': 'Gault&Millau',
  'falstaff.com': 'Falstaff', 'falstaff.de': 'Falstaff', 'falstaff.at': 'Falstaff', 'forbestravelguide.com': 'Forbes Travel Guide',
  'cntraveler.com': 'Condé Nast Traveler', 'cntraveller.com': 'Condé Nast Traveller', 'theworlds50best.com': "World's 50 Best", 'timeout.com': 'Time Out',
  'lefooding.com': 'Le Fooding', 'gamberorosso.it': 'Gambero Rosso', 'repsol.com': 'Guía Repsol', 'laliste.com': 'La Liste', 'eater.com': 'Eater',
  'nytimes.com': 'NYT', 'theguardian.com': 'The Guardian', 'telegraph.co.uk': 'The Telegraph', 'tatler.com': 'Tatler', 'robbreport.com': 'Robb Report',
  'monocle.com': 'Monocle', 'wallpaper.com': 'Wallpaper*', 'afar.com': 'AFAR', 'travelandleisure.com': 'Travel + Leisure', 'lonelyplanet.com': 'Lonely Planet',
};
// карты и отзывы — подтверждают существование, но не качество
export const MAPS = ['google.com', 'maps.google.com', 'maps.app.goo.gl', 'openstreetmap.org', 'tripadvisor.com', 'tripadvisor.de', 'tripadvisor.fr', 'yelp.com', 'thefork.com', 'opentable.com', 'resy.com', 'exploretock.com', 'quandoo.com', 'sevenrooms.com'];
// первичные продавцы билетов — «официальная продажа»
export const PRIMARY_TICKETS = ['ticketmaster.', 'eventim.', 'axs.com', 'seetickets.', 'ticketone.it', 'fnacspectacles.com', 'livenation.', 'dice.fm', 'ticketcorner.ch', 'oeticket.com', 'entradas.com', 'ticketline.pt', 'ticketportal.', 'reservix.de', 'myticket.de'];
// перепродажа — показываем с пометкой риска, без кнопки «Билеты»
export const RESALE = ['stubhub.', 'ticketswap.', 'vividseats.com', 'seatgeek.com', 'tickpick.com', 'gigsberg.com', 'fansale.', 'twickets.', 'ticketexchange'];
// категорически запрещено (мошенничество, завышенная перепродажа, сайты-двойники, короткие ссылки)
export const BLOCKED = ['viagogo.', 'ticombo.', 'footballticketnet.', 'livefootballtickets.', 'ticketbis.', 'seatwave.', 'onlineticketshop.', 'ticket-compare.', 'tixstock.',
  'premiumseats.', 'sportsevents365.', 'ticketsales.com', 'getmein.', 'bit.ly', 'tinyurl.com', 't.co', 'goo.gl/', 'cutt.ly', 'shorturl.', 'rebrand.ly', 'is.gd', 'ow.ly'];
// те же запреты — конкретными доменами, чтобы поиск исключал их сразу
export const EXCLUDE_DOMAINS = ['viagogo.com', 'viagogo.de', 'viagogo.co.uk', 'viagogo.fr', 'viagogo.it', 'viagogo.es', 'ticombo.com', 'ticombo.de', 'footballticketnet.com',
  'livefootballtickets.com', 'ticketbis.com', 'seatwave.com', 'onlineticketshop.com', 'ticket-compare.com', 'tixstock.com', 'premiumseats.co.uk', 'sportsevents365.com',
  'ticketsales.com', 'getmein.com', 'bit.ly', 'tinyurl.com', 'cutt.ly', 'rebrand.ly', 'is.gd', 'ow.ly'];
// соцсети и агрегаторы — не «официальный сайт»
const NOT_OFFICIAL = ['instagram.com', 'facebook.com', 'tiktok.com', 'linktr.ee', 'booking.com', 'expedia.', 'hotels.com', 'agoda.com', 'trip.com', 'wikipedia.org',
  'youtube.com', 'pinterest.', 'reddit.com', 'medium.com', 'blogspot.', 'wordpress.com', ...MAPS, ...Object.keys(GUIDES)];

export const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const has = (list, d) => !!d && list.some((x) => d === x || d.endsWith('.' + x) || (x.endsWith('.') && (d.startsWith(x) || d.includes('.' + x))) || (x.endsWith('/') && d.startsWith(x.slice(0, -1))));
export const isBlocked = (url, own = []) => { const d = domainOf(url); return !d || !/^https:/i.test(url) || has(BLOCKED, d) || own.some((x) => d === x || d.endsWith('.' + x)); };
export const isResale = (url) => has(RESALE, domainOf(url));
export const isPrimaryTicket = (url) => has(PRIMARY_TICKETS, domainOf(url));
export const guideOf = (url) => { const d = domainOf(url); const k = Object.keys(GUIDES).find((g) => d === g || d.endsWith('.' + g)); return k ? GUIDES[k] : (/^(visit|discover|explore)[a-z-]*\.|tourism|tourisme|turismo/.test(d) ? 'туристический портал' : null); };
export const isMapSource = (url) => has(MAPS, domainOf(url));

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
const tokens = (name) => norm(name).replace(/\b(the|le|la|les|der|die|das|il|el|restaurant|ristorante|hotel|spa|bar|cafe|caffe|wirtshaus|brasserie|bistro|club|berlin|paris|nice|london|munich|munchen|wien|rome|roma|milano)\b/g, ' ')
  .split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
// «официальный сайт»: домен содержит значимое слово из названия и это не соцсеть/гид/агрегатор
export function isOfficial(url, name) {
  const d = domainOf(url);
  if (!d || has(NOT_OFFICIAL, d) || has(BLOCKED, d) || has(RESALE, d)) return false;
  const base = d.split('.').slice(0, -1).join('').replace(/[^a-z0-9]/g, '');
  return tokens(name).some((t) => base.includes(t));
}
// упоминает ли источник это место (название целиком или все значимые слова)
export function mentions(src, name) {
  const text = norm(`${src.title} ${src.content || ''} ${src.url}`);
  const n = norm(name).trim();
  if (n.length >= 5 && text.includes(n)) return true;
  const t = tokens(name);
  return t.length > 0 && t.every((w) => text.includes(w));
}

// метка доверия: high — ≥2 независимых подтверждения и (официальный сайт или гид); medium — 2 подтверждения; low — меньше
export function trustOf(item, sources, mapOk) {
  const doms = new Set(), guides = new Set();
  for (const s of sources) {
    if (isBlocked(s.url) || !mentions(s, item.title)) continue;
    const d = domainOf(s.url);
    doms.add(d.split('.').slice(-2).join('.'));
    const g = guideOf(s.url);
    if (g) guides.add(g);
  }
  const official = !!(item.url && isOfficial(item.url, item.title));
  if (official) doms.add(domainOf(item.url).split('.').slice(-2).join('.'));
  if (mapOk) doms.add('map');
  const n = doms.size;
  const level = n >= 2 && (official || guides.size) ? 'high' : n >= 2 ? 'medium' : 'low';
  return { level, official, guides: [...guides].slice(0, 3), map: !!mapOk, sources: n };
}

// Снимок карты для лукбука: OpenFreeMap (бесплатно, без ключа и лимитов) + MapLibre рисует карту в браузере,
// мы сохраняем её картинкой и координаты пинов — так карта одинаково выглядит в конструкторе и в PDF.
const LIB = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.js';
const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const cache = new Map();
let loading;
const loadLib = () => loading || (loading = new Promise((ok, fail) => {
  if (window.maplibregl) return ok();
  const s = document.createElement('script');
  s.src = LIB; s.onload = ok; s.onerror = () => { loading = null; fail(new Error('map_lib')); };
  document.head.append(s);
}));

// W×H — размер карты на странице (px при 96 dpi); картинка в 2 раза чётче для печати
export async function mapShot(m, W, H) {
  const pts = (m?.points || []).map((p, i) => ({ ...p, i })).filter((p) => p.lat != null);
  const c = m?.center || pts[0];
  if (!c) return null;
  const key = JSON.stringify([W, H, c.lat, c.lon, pts.map((p) => [p.lat, p.lon])]);
  if (cache.has(key)) return cache.get(key);
  const job = (async () => {
    await loadLib();
    const box = document.createElement('div');
    Object.assign(box.style, { position: 'fixed', left: '-10000px', top: '0', width: W + 'px', height: H + 'px' });
    document.body.append(box);
    const map = new window.maplibregl.Map({ container: box, style: STYLE, center: [c.lon, c.lat], zoom: 13, interactive: false, attributionControl: false, preserveDrawingBuffer: true, pixelRatio: 2, fadeDuration: 0 });
    try {
      // ошибки отдельных плиток не мешают — ждём загрузку стиля (или 20 с)
      await new Promise((ok, fail) => { map.once('load', ok); setTimeout(() => fail(new Error('map_timeout')), 20000); });
      if (pts.length > 1) {
        const lons = pts.map((p) => p.lon), lats = pts.map((p) => p.lat);
        map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 48, maxZoom: 15, duration: 0 });
      } else if (pts.length === 1) map.jumpTo({ center: [pts[0].lon, pts[0].lat], zoom: 14 });
      await new Promise((ok) => { map.once('idle', ok); setTimeout(ok, 8000); });
      const url = map.getCanvas().toDataURL('image/jpeg', 0.9);
      const pins = pts.map((p) => { const xy = map.project([p.lon, p.lat]); return { n: p.i + 1, x: Math.round(xy.x), y: Math.round(xy.y) }; });
      return { url, pins };
    } finally { map.remove(); box.remove(); }
  })();
  cache.set(key, job);
  job.catch(() => cache.delete(key));
  return job;
}

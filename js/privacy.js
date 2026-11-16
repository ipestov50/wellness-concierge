// Режим приватности: прячет фамилии гостей на экране (удобно на звонке или при показе экрана).
// Меняется только отображение текста — данные, запросы к серверу и поля ввода не затрагиваются.
import { state } from './data.js';

let on = false;
try { on = localStorage.getItem('mask') === '1'; } catch {}
const reflect = () => { document.documentElement.classList.toggle('masked', on); document.getElementById('privacy')?.setAttribute('aria-pressed', String(on)); };

export const isMasked = () => on;
export function setMasked(v) { on = !!v; try { localStorage.setItem('mask', on ? '1' : '0'); } catch {} reflect(); }
export const syncMaskButton = reflect;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let rx = null, key = '';
// склонения («Ивановой», «Иванову»): для длинных фамилий берём основу без последних двух букв
const stem = (w) => (w.length >= 6 ? w.slice(0, w.length - 2) : w);
function pattern() {
  const names = new Set();
  for (const c of state.clients) {
    const parts = String(c.name || '').replace(/\(.*?\)/g, ' ').trim().split(/\s+/);
    if (parts.length > 1) parts.slice(1).forEach((p) => { if (p.length > 2) names.add(stem(p)); });
  }
  const list = [...names].sort((a, b) => b.length - a.length);
  const k = list.join('|');
  if (k !== key) { key = k; rx = list.length ? new RegExp(`(^|[^\\p{L}])(${list.map(esc).join('|')})\\p{L}*`, 'giu') : null; }
  return rx;
}

export function applyMask(root = document.body) {
  if (!on || !root) return;
  const re = pattern();
  if (!re) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.parentElement?.tagName;
    if (t && /^(SCRIPT|STYLE|TEXTAREA|INPUT|OPTION|SELECT)$/.test(t)) continue;
    nodes.push(n);
  }
  for (const n of nodes) {
    re.lastIndex = 0;
    if (!re.test(n.nodeValue)) continue;
    re.lastIndex = 0;
    n.nodeValue = n.nodeValue.replace(re, (m, pre, name) => `${pre}${name[0].toUpperCase()}.`);
  }
}

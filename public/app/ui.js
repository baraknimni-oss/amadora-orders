// Small DOM toolkit + shared components.
import { statusInfo, statusLabel, collection, sla, slaShort, SLA_TONE, money0, matchesQuery, stageTime, stageShort } from './logic.js';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv); }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  arrowL: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>',
  gem: '<path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18M9 3l3 18 3-18"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
};
export function icon(name, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}

// ---------- pills ----------
export const statusColor = k => `var(--s-${k})`;
export function statusPill(o) {
  const s = statusInfo(o);
  return h('span', { class: 'pill status', style: { '--sc': statusColor(s.key) } }, h('span', { class: 'dot' }), statusLabel(s.key));
}
export function collectionPill(o) { const c = collection(o); return h('span', { class: `pill ${c.tone}` }, c.label); }
export function slaPill(s) { return s ? h('span', { class: `pill ${SLA_TONE[s.level]}` }, slaShort(s)) : null; }
export function stagePill(f) {
  return f ? h('span', { class: `pill ${f.over ? 'late' : f.level === 'warn' ? 'warn' : 'info'}`, title: `יעד: עד ${f.max} ימי עסקים ${f.where}` }, stageShort(f)) : null;
}

// ---------- order card ----------
export function orderCard(o, ctx, { draggable = false, extra = null } = {}) {
  const s = sla(o, ctx.settings, ctx.holidays, ctx.today);
  const f = stageTime(o, ctx.settings, ctx.holidays, ctx.today);
  const card = h('article', {
    class: `ocard lvl-${s?.level || 'ok'}`, tabindex: '0', role: 'link', 'aria-label': `הזמנה ${o.order_number} – ${o.customer_name}`,
    draggable: draggable ? 'true' : null, dataset: { id: o.id },
    onclick: () => ctx.go(`#/order/${o.order_number}`),
    onkeydown: e => { if (e.key === 'Enter') ctx.go(`#/order/${o.order_number}`); },
  },
    h('div', { class: 'oc-top' }, h('span', { class: 'oc-num' }, `#${o.order_number}`), slaPill(s)),
    h('div', { class: 'oc-name' }, o.customer_name),
    h('div', { class: 'oc-desc' }, o.description || '—'),
    f ? h('div', { class: 'oc-fac' }, stagePill(f), h('span', { class: 'oc-fac-max' }, `יעד: עד ${f.max} ימים`)) : null,
    h('div', { class: 'oc-foot' }, h('span', { class: 'oc-price' }, +o.sale_price ? money0(o.sale_price) : 'ללא מחיר'), collectionPill(o)),
    extra,
  );
  return card;
}

// ---------- modal ----------
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const prevFocus = document.activeElement;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); onClose?.(); prevFocus?.focus?.(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-h' }, h('h2', null, title), h('button', { class: 'x', type: 'button', 'aria-label': 'סגירה', onclick: close }, icon('x'))),
    h('div', { class: 'modal-b' }, body),
    actions.length ? h('div', { class: 'modal-f' }, actions) : null,
  );
  const bg = h('div', { class: 'modal-bg', onmousedown: e => { if (e.target === bg) close(); } }, box);
  document.body.append(bg);
  document.addEventListener('keydown', onKey);
  setTimeout(() => (box.querySelector('input:not([type=hidden]),select,textarea,button.btn-primary') || box).focus?.(), 20);
  return { close, box };
}
export function confirmBox({ title, text, okText = 'אישור', danger = false }) {
  return new Promise(res => {
    let done = false;
    const m = modal({
      title, body: h('p', { style: { margin: '0', 'line-height': '1.7' } }, text),
      onClose: () => { if (!done) res(false); },
      actions: [
        h('button', { class: `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`, type: 'button', onclick: () => { done = true; m.close(); res(true); } }, okText),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'ביטול'),
      ],
    });
  });
}

// ---------- toast ----------
let toastBox;
export function toast(text, bad = false) {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const t = h('div', { class: `toast${bad ? ' bad' : ''}` }, text);
  toastBox.append(t);
  setTimeout(() => t.remove(), bad ? 6500 : 3200);
}

// ---------- form helpers ----------
export function field(label, input, { req = false, hint, err, full = false } = {}) {
  const tag = input.classList?.contains('chips-in') ? 'div' : 'label'; // radio groups must not sit inside a <label>
  return h(tag, { class: `field${err ? ' err' : ''}`, style: full ? { 'grid-column': '1 / -1' } : null },
    h('span', null, label, req ? h('span', { class: 'req' }, ' *') : null, hint ? h('span', { class: 'hint' }, ` · ${hint}`) : null),
    input, err ? h('span', { class: 'err-msg' }, err) : null);
}
export const moneyInput = (id, value, extra = {}) =>
  h('div', { class: 'money-in' }, h('input', { id, name: id, type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: value ?? '', ...extra }));
export function methodChips(name, value) {
  return h('div', { class: 'chips-in', role: 'radiogroup' },
    ['מזומן', 'העברה בנקאית', 'אשראי', 'שת"פ', 'פייבוקס', 'ביט', 'אתר'].map(m =>
      h('label', null, h('input', { type: 'radio', name, value: m, checked: value === m }), h('span', null, m))));
}
export const readRadio = (root, name) => root.querySelector(`input[name="${name}"]:checked`)?.value || null;

export function searchOrders(orders, q, limit = 8) {
  return orders.filter(o => !o.deleted_at && matchesQuery(o, q)).slice(0, limit);
}
export function kv(k, v, { big = false, cls = '' } = {}) {
  const empty = v == null || v === '—';
  return h('div', { class: `kv-r ${cls}` }, h('span', { class: 'k' }, k), h('span', { class: `v${big ? ' big' : ''}${empty ? ' empty-v' : ''}` }, empty ? '—' : v));
}

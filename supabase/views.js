// All screens. Each view receives the shared ctx and returns a DOM node.
import { h, icon, statusPill, collectionPill, slaPill, factoryPill, orderCard, statusColor, modal, field, moneyInput, methodChips, readRadio, kv, toast, confirmBox } from './ui.js';
import {
  STATUSES, UNASSIGNED, STATUS_BY_KEY, statusKey, statusInfo, statusLabel, nextStatus, NEEDS_PAYMENT2, FIRST_ORDER_NUMBER,
  financials, collection, suggestedRemainder, money, money0, pct, num, sla, slaShort, SLA_TONE, urgency,
  fmtDate, fmtDateLong, fmtDateTime, todayISO, israelDate, businessDaysBetween, weekday, validateNewOrder, validatePayment2,
  FIELD_LABELS, matchesQuery, CHECKLISTS, CHECK_LABELS, checklistDone,
} from './logic.js';
import { buildXlsx, download } from './xlsx.js';

const pageHead = (title, sub, actions = [], crumb = null) =>
  h('div', { class: 'page-head' },
    h('div', { style: { 'min-width': '0' } }, crumb, h('h1', null, title), sub ? h('div', { class: 'sub' }, sub) : null),
    actions.length ? h('div', { class: 'actions' }, actions) : null);
const crumbTo = (hash, label) => h('a', { class: 'crumb', href: hash }, icon('arrowR', 14), label);
const card = (title, body, { aside, foot, cls = '' } = {}) =>
  h('section', { class: `card ${cls}` },
    title ? h('div', { class: 'card-h' }, h('h2', null, title), aside ? h('span', { class: 'aside' }, aside) : null) : null,
    body, foot ? h('div', { class: 'card-f' }, foot) : null);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const bySla = ctx => (a, b) => urgency(ctx.slaOf(a)) - urgency(ctx.slaOf(b)) || a.order_number - b.order_number;
const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);

// ===================================================================== DASHBOARD
export function dashboard(ctx) {
  const act = ctx.active();
  const att = ctx.attention();
  const of = key => act.filter(o => statusKey(o) === key);
  const unassigned = of('unassigned');

  const tiles = STATUSES.map(s => {
    const list = of(s.key);
    const slas = list.map(ctx.slaOf).filter(Boolean);
    const late = slas.filter(x => x.level === 'late').length;
    const urgent = slas.filter(x => x.level === 'critical' || x.level === 'warn').length;
    const value = sum(list, o => +o.sale_price);
    return h('a', { class: 'tile', href: `#/status/${s.key}`, style: { '--sc': statusColor(s.key) }, 'aria-label': `${statusLabel(s.key)}: ${list.length} הזמנות` },
      h('div', { class: 'tile-top' }, h('span', { class: 'tile-step' }, s.step), h('span', { class: 'tile-group' }, s.group), h('span', { class: 'tile-arrow' }, icon('arrowL', 16))),
      h('h3', null, s.name),
      h('div', { class: 'rule' }),
      h('div', { class: 'tile-foot' },
        h('div', { class: 'tile-count' }, list.length, h('small', null, list.length === 1 ? 'הזמנה' : 'הזמנות')),
        h('div', { class: 'tile-flags' },
          late ? h('span', { class: 'pill late' }, `${late} באיחור`) : null,
          urgent ? h('span', { class: 'pill warn' }, `${urgent} דחופות`) : null,
          value ? h('span', { class: 'tile-sum' }, money0(value)) : null)));
  });

  const attPanel = card('קרובות למועד האספקה', att.length
    ? h('div', { class: 'rowlist' }, att.slice(0, 6).map(({ o, s }) => h('a', { href: `#/order/${o.order_number}` },
      h('div', { class: 'r-main' }, h('div', { class: 'r-title' }, `#${o.order_number} · ${o.customer_name}`), h('div', { class: 'r-sub' }, statusLabel(statusKey(o)))),
      slaPill(s))))
    : h('div', { class: 'empty' }, 'אין הזמנות קרובות למועד האספקה.'),
  { aside: att.length ? plural(att.length, 'הזמנה', 'הזמנות') : null, foot: att.length > 6 ? h('a', { class: 'btn-link', href: '#/board' }, 'ללוח העבודה') : null });

  const toCollect = act.filter(o => ['returned', 'ready', 'with_customer'].includes(o.status) && collection(o).balance > 0.5)
    .sort((a, b) => collection(b).balance - collection(a).balance);
  const collectPanel = card('יתרות לגבייה', toCollect.length
    ? h('div', { class: 'rowlist' }, toCollect.slice(0, 6).map(o => h('a', { href: `#/order/${o.order_number}` },
      h('div', { class: 'r-main' }, h('div', { class: 'r-title' }, `#${o.order_number} · ${o.customer_name}`), h('div', { class: 'r-sub' }, statusLabel(o.status))),
      h('span', { class: 'r-val' }, money0(collection(o).balance)))))
    : h('div', { class: 'empty' }, 'אין יתרות פתוחות בהזמנות שחזרו מהמפעל.'),
  { aside: toCollect.length ? money0(sum(toCollect, o => collection(o).balance)) : null });

  const recent = [...act].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.order_number - a.order_number).slice(0, 6);
  const recentPanel = card('נכנסו לאחרונה', recent.length
    ? h('div', { class: 'rowlist' }, recent.map(o => h('a', { href: `#/order/${o.order_number}` },
      h('div', { class: 'r-main' }, h('div', { class: 'r-title' }, `#${o.order_number} · ${o.customer_name}`), h('div', { class: 'r-sub' }, (o.description || '').split('\n')[0] || '—')),
      h('span', { class: 'r-sub' }, fmtDate(o.entered_at)))))
    : h('div', { class: 'empty' }, 'עדיין אין הזמנות.'),
  { foot: h('a', { class: 'btn-link', href: '#/orders' }, 'כל ההזמנות') });

  const lateCount = att.filter(x => x.s.level === 'late').length;
  return h('div', null,
    pageHead('לוח בקרה',
      `${plural(act.length, 'הזמנה פעילה', 'הזמנות פעילות')} · ${att.length ? `${att.length} קרובות למועד האספקה` : 'אין הזמנות דחופות'}${lateCount ? ` · ${lateCount} באיחור` : ''}`,
      [h('a', { class: 'btn btn-ghost', href: '#/board' }, icon('board', 16), 'לוח עבודה'), h('a', { class: 'btn btn-primary', href: '#/orders/new' }, icon('plus', 16), 'הזמנה חדשה')]),
    unassigned.length ? h('div', { class: 'notice' }, icon('alert', 18),
      h('div', null, h('b', null, plural(unassigned.length, 'הזמנה ממתינה', 'הזמנות ממתינות')), ' לשיוך סטטוס (יובאו מהאקסל).'),
      h('a', { class: 'btn btn-ghost btn-sm', href: '#/status/unassigned' }, 'לשיוך')) : null,
    h('div', { class: 'pipeline' }, tiles),
    h('div', { class: 'panels' }, attPanel, collectPanel, recentPanel));
}

// ===================================================================== STATUS LIST
function statusTabs(ctx, current) {
  const act = ctx.active();
  const keys = [...(act.some(o => !o.status) ? ['unassigned'] : []), ...STATUSES.map(s => s.key)];
  return h('div', { class: 'seg', style: { 'margin-bottom': '16px' } }, keys.map(k =>
    h('button', { type: 'button', class: k === current ? 'on' : '', onclick: () => ctx.go(`#/status/${k}`) },
      k === 'unassigned' ? 'ממתין לשיוך' : `${statusInfo(k).step}. ${statusInfo(k).name}`, h('span', { class: 'n' }, act.filter(o => statusKey(o) === k).length))));
}

export function statusList(ctx, key) {
  if (!STATUS_BY_KEY[key]) return notFound(ctx);
  const list = ctx.active().filter(o => statusKey(o) === key).sort(bySla(ctx));
  const s = statusInfo(key);
  const value = sum(list, o => +o.sale_price);
  const next = STATUSES.find(x => x.step === s.step + 1);
  return h('div', null,
    pageHead(statusLabel(key), `${plural(list.length, 'הזמנה', 'הזמנות')}${value ? ` · ${money0(value)}` : ''} · ממוינות לפי דחיפות`,
      [h('a', { class: 'btn btn-ghost', href: '#/board' }, icon('board', 16), 'תצוגת לוח')], crumbTo('#/', 'לוח בקרה')),
    statusTabs(ctx, key),
    key === 'unassigned' ? h('div', { class: 'notice' }, icon('alert', 18), 'הזמנות שיובאו מהאקסל. פתחו כל הזמנה וקבעו לה סטטוס מתוך "שינוי סטטוס".') : null,
    key === 'returned' ? h('div', { class: 'notice' }, icon('alert', 18), `לפני מעבר ל"${next.name}" יש לסמן את בדיקות השלב (במסך "דורש טיפול" או בדף ההזמנה), להזין את השלמת התשלום ולסמן שיצאה חשבונית.`) : null,
    key === 'to_factory' || key === 'ready' ? h('div', { class: 'notice' }, icon('alert', 18), `לפני מעבר ל"${next.name}" יש לסמן את בדיקות השלב במסך "דורש טיפול" או בדף ההזמנה.`) : null,
    list.length ? h('div', { class: 'cards' }, list.map(o => orderCard(o, ctx)))
      : h('div', { class: 'card empty' }, 'אין הזמנות בשלב הזה.', key === 'new' ? h('div', { style: { 'margin-top': '10px' } }, h('a', { class: 'btn btn-primary btn-sm', href: '#/orders/new' }, 'פתיחת הזמנה חדשה')) : null));
}

// ===================================================================== ATTENTION (work board with stage checklists)
/** The checklist block shown inside a card. Clicks here must not open the order page. */
function checklistBox(ctx, o, key) {
  const c = CHECKLISTS[key]; if (!c) return null;
  const done = checklistDone(o, key);
  const next = STATUSES.find(x => x.step === statusInfo(key).step + 1);
  const stop = e => e.stopPropagation();
  return h('div', { class: 'oc-check', onclick: stop, onkeydown: stop },
  c.items.map(i => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: !!o[i.key], onchange: e => ctx.toggleCheck(o, i.key, e.target.checked) }), i.label)),
  next ? h('button', { class: `btn btn-sm ${done ? 'btn-primary' : 'btn-ghost'}`, type: 'button', disabled: done ? null : true,
    onclick: e => { e.stopPropagation(); ctx.changeStatus(o, next.key); } }, `העבר ל"${next.name}"`, icon('arrowL', 14)) : null,
  !done ? h('div', { class: 'hint-locked' }, c.mode === 'any' ? 'יש לסמן אחת מהאפשרויות כדי להתקדם' : 'יש לסמן את כל הבדיקות כדי להתקדם') : null);
}

export function attention(ctx) {
  const keys = ctx.WORK_KEYS;
  const act = ctx.active();
  let dragged = null;
  const cols = keys.map(k => {
    const list = act.filter(o => o.status === k).sort(bySla(ctx));
    const body = h('div', { class: 'col-b' }, list.map(o => {
      const c = orderCard(o, ctx, { draggable: true, extra: checklistBox(ctx, o, k) });
      c.addEventListener('dragstart', e => { dragged = o; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', o.id); });
      c.addEventListener('dragend', () => { c.classList.remove('dragging'); });
      return c;
    }), list.length ? null : h('div', { class: 'empty', style: { padding: '18px 6px', 'font-size': '13px' } }, 'ריק'));
    const col = h('div', { class: 'col', style: { '--sc': statusColor(k) }, dataset: { key: k } },
      h('div', { class: 'col-h' }, h('span', { class: 'dot' }), statusLabel(k), h('span', { class: 'n' }, list.length)), body);
    col.addEventListener('dragover', e => { if (dragged && statusKey(dragged) !== k) { e.preventDefault(); col.classList.add('drop'); } });
    col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); });
    col.addEventListener('drop', async e => { e.preventDefault(); col.classList.remove('drop'); const o = dragged; dragged = null; if (o) await ctx.changeStatus(o, k); });
    return col;
  });

  const diffs = act.filter(o => collection(o).key === 'diff');
  const unassigned = act.filter(o => !o.status);
  const sec = (title, list, sub) => h('section', { style: { 'margin-top': '26px' } },
    h('h2', { style: { 'font-size': '16px', margin: '0 0 10px' } }, title, ' ', h('span', { style: { color: 'var(--muted)', 'font-weight': '500' } }, `(${list.length})`), sub ? h('span', { style: { color: 'var(--muted)', 'font-weight': '400', 'font-size': '13px' } }, ` · ${sub}`) : null),
    h('div', { class: 'cards' }, list.map(o => orderCard(o, ctx))));

  return h('div', null,
    pageHead('דורש טיפול', `סמנו את הבדיקות בכל הזמנה כדי לאפשר מעבר לשלב הבא. כתום: נותרו ${ctx.settings.warn_days_1} ימים או פחות לאספקה · אדום: ${ctx.settings.warn_days_2} ימים או פחות.`,
      [h('a', { class: 'btn btn-ghost', href: '#/board' }, icon('board', 16), 'לוח עבודה מלא')], crumbTo('#/', 'לוח בקרה')),
    h('div', { class: 'board-wrap' }, h('div', { class: 'board' }, cols)),
    diffs.length ? sec('הפרש בתשלומים', diffs, 'סכום התשלומים שונה ממחיר המכירה') : null,
    unassigned.length ? sec('ממתינות לשיוך סטטוס', unassigned) : null);
}

// ===================================================================== BOARD
export function board(ctx) {
  const act = ctx.active();
  const keys = [...(act.some(o => !o.status) ? ['unassigned'] : []), ...STATUSES.map(s => s.key)];
  let dragged = null;
  const cols = keys.map(k => {
    const list = act.filter(o => statusKey(o) === k).sort(bySla(ctx));
    const body = h('div', { class: 'col-b' }, list.map(o => {
      const c = orderCard(o, ctx, { draggable: true });
      c.addEventListener('dragstart', e => { dragged = o; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', o.id); });
      c.addEventListener('dragend', () => { c.classList.remove('dragging'); });
      return c;
    }), list.length ? null : h('div', { class: 'empty', style: { padding: '18px 6px', 'font-size': '13px' } }, 'ריק'));
    const col = h('div', { class: 'col', style: { '--sc': statusColor(k) }, dataset: { key: k } },
      h('div', { class: 'col-h' }, h('span', { class: 'dot' }), k === 'unassigned' ? 'ממתין לשיוך' : statusLabel(k), h('span', { class: 'n' }, list.length)), body);
    if (k !== 'unassigned') {
      col.addEventListener('dragover', e => { if (dragged && statusKey(dragged) !== k) { e.preventDefault(); col.classList.add('drop'); } });
      col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); });
      col.addEventListener('drop', async e => { e.preventDefault(); col.classList.remove('drop'); const o = dragged; dragged = null; if (o) await ctx.changeStatus(o, k); });
    }
    return col;
  });
  return h('div', null,
    pageHead('לוח עבודה', 'גררו הזמנה בין עמודות כדי לשנות סטטוס. בטלפון: פתחו את ההזמנה ושנו סטטוס מתוכה.',
      [h('a', { class: 'btn btn-primary', href: '#/orders/new' }, icon('plus', 16), 'הזמנה חדשה')], crumbTo('#/', 'לוח בקרה')),
    h('div', { class: 'board-wrap' }, h('div', { class: 'board' }, cols)));
}

// ===================================================================== ALL ORDERS (table + export)
const EXPORT_COLUMNS = [
  { title: 'מספר הזמנה', width: 11, type: 'num' }, { title: 'תאריך כניסה', width: 12, type: 'date' }, { title: 'שם לקוח', width: 18 },
  { title: 'טלפון', width: 13 }, { title: 'פירוט', width: 40 }, { title: 'סטטוס', width: 26 }, { title: 'ימי עסקים שעברו', width: 10, type: 'num' },
  { title: 'ימים שנותרו', width: 10, type: 'num' }, { title: 'תאריך יעד', width: 12, type: 'date' }, { title: 'נמסר ללקוח', width: 12, type: 'date' },
  { title: 'מחיר מכירה', width: 12, type: 'money' }, { title: 'לפני מע"מ', width: 12, type: 'money' }, { title: 'עלות ליאור', width: 11, type: 'money' },
  { title: 'עלות יהלומים', width: 11, type: 'money' }, { title: 'רווח', width: 11, type: 'money' }, { title: 'אחוז רווח', width: 9 },
  { title: 'מקדמה', width: 11, type: 'money' }, { title: 'אמצעי תשלום (מקדמה)', width: 14 }, { title: 'חשבונית (מקדמה)', width: 9 },
  { title: 'השלמת תשלום', width: 11, type: 'money' }, { title: 'אמצעי תשלום (השלמה)', width: 14 }, { title: 'חשבונית (השלמה)', width: 9 },
  { title: 'סה"כ שולם', width: 11, type: 'money' }, { title: 'יתרה', width: 11, type: 'money' }, { title: 'סטטוס גבייה', width: 16 },
  { title: 'דרך מי הגיע', width: 14 }, { title: 'הערות', width: 30 }, { title: 'הערת תשלום מהאקסל', width: 20 }, { title: 'בארכיון', width: 8 },
];
export function exportOrders(ctx, orders, name = 'הזמנות') {
  const yn = b => b ? 'כן' : 'לא';
  const rows = orders.map(o => {
    const f = financials(o, ctx.settings.vat_rate), c = collection(o), s = ctx.slaOf(o);
    return [o.order_number, o.entered_at, o.customer_name, o.customer_phone, o.description, statusLabel(statusKey(o)), s?.elapsed, s && !s.stopped ? s.remaining : null,
      s?.due, o.delivered_at ? israelDate(o.delivered_at) : null, f.sale, Math.round(f.preVat * 100) / 100, +o.cost_lior || 0, +o.cost_diamonds || 0,
      Math.round(f.profit * 100) / 100, f.margin == null ? '' : pct(f.margin), o.payment1_amount, o.payment1_method, o.payment1_amount == null ? '' : yn(o.payment1_invoice),
      o.payment2_amount, o.payment2_method, o.payment2_amount == null ? '' : yn(o.payment2_invoice), c.paid, c.balance, c.label, o.source, o.notes,
      o.legacy_payment_note, yn(o.archived_at)];
  });
  download(buildXlsx(name, EXPORT_COLUMNS, rows), `${name}-${todayISO()}.xlsx`);
  toast(`יוצאו ${rows.length} הזמנות לאקסל`);
}

export function allOrders(ctx) {
  const st = ctx.listState ||= { status: 'all', coll: 'all', archived: false, sort: 'order_number', dir: -1 };
  if (ctx.searchQuery != null) { st.q = ctx.searchQuery; ctx.searchQuery = null; }
  const tableBox = h('div');
  const countEl = h('span', { class: 'sub' });
  const q = h('input', { class: 'input', type: 'search', placeholder: 'סינון לפי שם, מספר, טלפון או פירוט', value: st.q || '', style: { 'max-width': '300px' }, 'aria-label': 'סינון' });

  const filtered = () => ctx.orders.filter(o => !o.deleted_at && (st.archived || !o.archived_at)
    && (st.status === 'all' || statusKey(o) === st.status)
    && (st.coll === 'all' || collection(o).key === st.coll || (st.coll === 'open' && collection(o).balance > 0.5))
    && matchesQuery(o, st.q));
  const val = (o, k) => k === 'sla' ? urgency(ctx.slaOf(o)) : k === 'sale_price' ? +o.sale_price : k === 'status' ? (statusInfo(o).step) : (o[k] ?? '');
  const draw = () => {
    const rows = filtered().sort((a, b) => { const x = val(a, st.sort), y = val(b, st.sort); return (x > y ? 1 : x < y ? -1 : 0) * st.dir || b.order_number - a.order_number; });
    countEl.textContent = plural(rows.length, 'הזמנה', 'הזמנות');
    const th = (label, key, cls = '') => h('th', { class: `${key ? 'sortable' : ''} ${cls}`, onclick: key ? () => { st.dir = st.sort === key ? -st.dir : (key === 'sla' ? 1 : -1); st.sort = key; draw(); } : null, 'aria-sort': st.sort === key ? (st.dir > 0 ? 'ascending' : 'descending') : null },
      label, st.sort === key ? (st.dir > 0 ? ' ↑' : ' ↓') : '');
    tableBox.replaceChildren(rows.length ? h('div', { class: 'card table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, th('#', 'order_number'), th('לקוח', 'customer_name'), th('פירוט', null, 'hide-sm'), th('סטטוס', 'status'), th('אספקה', 'sla'), th('מחיר', 'sale_price', 'num'), th('גבייה', null, 'hide-sm'), th('נכנס', 'entered_at', 'hide-sm'))),
      h('tbody', null, rows.map(o => h('tr', { class: 'click', onclick: () => ctx.go(`#/order/${o.order_number}`) },
        h('td', { class: 'tnum' }, o.order_number),
        h('td', null, h('b', null, o.customer_name), o.archived_at ? h('span', { class: 'pill muted', style: { 'margin-inline-start': '6px' } }, 'ארכיון') : null),
        h('td', { class: 'clip hide-sm' }, (o.description || '').split('\n')[0]),
        h('td', null, statusPill(o)),
        h('td', null, slaPill(ctx.slaOf(o))),
        h('td', { class: 'num' }, +o.sale_price ? money0(o.sale_price) : '—'),
        h('td', { class: 'hide-sm' }, collectionPill(o)),
        h('td', { class: 'tnum hide-sm' }, fmtDate(o.entered_at)))))))
      : h('div', { class: 'card empty' }, 'לא נמצאו הזמנות שמתאימות לסינון.'));
  };
  q.addEventListener('input', () => { st.q = q.value; draw(); });
  const act = ctx.orders.filter(o => !o.deleted_at && (st.archived || !o.archived_at));
  const statusSeg = h('div', { class: 'seg' }, [['all', 'הכול'], ...(act.some(o => !o.status) ? [['unassigned', 'ממתין לשיוך']] : []), ...STATUSES.map(s => [s.key, s.name])].map(([k, label]) =>
    h('button', { type: 'button', class: st.status === k ? 'on' : '', onclick: e => { st.status = k; e.currentTarget.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); draw(); } },
      label, h('span', { class: 'n' }, k === 'all' ? act.length : act.filter(o => statusKey(o) === k).length))));
  const collSel = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'סטטוס גבייה', onchange: e => { st.coll = e.target.value; draw(); } },
    [['all', 'כל מצבי הגבייה'], ['open', 'יש יתרה לתשלום'], ['deposit', 'מקדמה שולמה'], ['paid', 'שולם במלואו'], ['diff', 'הפרש בתשלומים'], ['none', 'טרם שולם'], ['unknown', 'תשלום לא הוזן']]
      .map(([v, l]) => h('option', { value: v, selected: st.coll === v ? true : null }, l)));
  const archChk = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.archived, onchange: e => { st.archived = e.target.checked; ctx.render(); } }), 'כולל ארכיון');
  draw();
  return h('div', null,
    pageHead('כל ההזמנות', countEl, [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => exportOrders(ctx, filtered()) }, icon('download', 16), 'ייצוא לאקסל'),
      h('a', { class: 'btn btn-primary', href: '#/orders/new' }, icon('plus', 16), 'הזמנה חדשה')]),
    h('div', { class: 'toolbar' }, q, collSel, archChk),
    h('div', { class: 'toolbar' }, statusSeg),
    tableBox);
}

// ===================================================================== ORDER PAGE
const EVENT_TEXT = {
  created: e => ['ההזמנה נפתחה', e.details?.payment1_amount != null ? `מקדמה ${money(e.details.payment1_amount)}${e.details.payment1_method ? ` · ${e.details.payment1_method}` : ''}` : null],
  imported: () => ['יובאה מקובץ האקסל', null],
  status: e => [`הועברה ל"${statusLabel(e.to_status || 'unassigned')}"`, e.from_status ? `מ"${statusLabel(e.from_status)}"` : null],
  payment2: e => ['הוזנה השלמת תשלום', `${money(e.details?.amount)}${e.details?.method ? ` · ${e.details.method}` : ''} · ${e.details?.invoice ? 'יצאה חשבונית' : 'ללא חשבונית'}`],
  edit: e => ['עודכנו פרטים', (e.details?.fields || []).map(f => FIELD_LABELS[f] || f).join(', ')],
  checklist: e => ['עודכנו בדיקות שלב', Object.entries(e.details || {}).map(([k, v]) => `${CHECK_LABELS[k] || k}: ${v ? 'סומן ✓' : 'בוטל'}`).join(' · ')],
  archived: () => ['הועברה לארכיון', null], unarchived: () => ['הוחזרה מהארכיון', null],
  deleted: () => ['הועברה לסל המחזור', null], restored: () => ['שוחזרה מסל המחזור', null],
};

export async function orderPage(ctx, number) {
  const o = ctx.byNumber(number);
  if (!o) return h('div', null, pageHead('ההזמנה לא נמצאה', `אין הזמנה עם מספר ${number}.`, [], crumbTo('#/', 'לוח בקרה')));
  const events = await ctx.api.events(o.id).catch(() => []);
  const s = ctx.slaOf(o);
  const f = financials(o, ctx.settings.vat_rate);
  const c = collection(o);
  const key = statusKey(o);
  const next = nextStatus(o);
  const locked = !!o.deleted_at;

  // ---- header
  const statusSelect = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'שינוי סטטוס', disabled: locked ? true : null,
    onchange: async e => { const v = e.target.value; e.target.value = key; if (v !== key) await ctx.changeStatus(o, v); } },
  !o.status ? h('option', { value: 'unassigned', selected: true }, 'שינוי סטטוס…') : null,
  STATUSES.map(st => h('option', { value: st.key, selected: st.key === o.status ? true : null }, `${st.step}. ${statusLabel(st.key)}`)));
  const actions = locked
    ? [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.restore(o) }, icon('restore', 16), 'שחזור מסל המחזור')]
    : [
      next ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.changeStatus(o, next.key) }, `העבר ל"${next.name}"`, icon('arrowL', 16)) : null,
      statusSelect,
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => editOrder(ctx, o) }, icon('edit', 16), 'עריכה'),
      o.archived_at ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ctx.unarchive(o) }, icon('restore', 16), 'החזרה מהארכיון')
        : h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ctx.archive(o) }, icon('archive', 16), 'לארכיון'),
      h('button', { class: 'btn btn-danger', type: 'button', onclick: () => ctx.trash(o), 'aria-label': 'מחיקה' }, icon('trash', 16)),
    ];
  const head = h('div', { class: 'o-head' },
    h('div', { style: { 'min-width': '0' } },
      crumbTo(o.deleted_at ? '#/trash' : o.archived_at ? '#/archive' : `#/status/${key}`, o.deleted_at ? 'סל מחזור' : o.archived_at ? 'ארכיון' : statusLabel(key)),
      h('div', { class: 'o-id' }, `הזמנה #${o.order_number}`),
      h('h1', null, o.customer_name),
      h('div', { class: 'chips' }, statusPill(o), collectionPill(o), factoryPill(ctx.factoryOf(o)),
        o.archived_at ? h('span', { class: 'pill muted' }, 'בארכיון') : null, o.deleted_at ? h('span', { class: 'pill crit' }, 'בסל המחזור') : null,
        o.is_import ? h('span', { class: 'pill info' }, 'יובאה מהאקסל') : null)),
    h('div', { class: 'actions' }, actions));

  // ---- stepper
  const arrived = {};
  for (const e of [...events].reverse()) if ((e.type === 'status' || e.type === 'created') && e.to_status) arrived[e.to_status] = e.at;
  const curStep = statusInfo(key).step;
  const stepper = h('div', { class: 'stepper', 'aria-label': 'שלבי ההזמנה' }, STATUSES.map(st =>
    h('div', { class: `step ${st.step < curStep ? 'done' : st.step === curStep ? 'cur' : ''}` },
      h('span', { class: 'b' }, st.step < curStep ? '✓' : st.step),
      h('span', { class: 'l' }, st.name),
      h('span', { class: 'd' }, st.step <= curStep && arrived[st.key] ? fmtDate(israelDate(arrived[st.key])) : ''))));

  // ---- details card
  const details = card('פירוט הזמנה', h('div', { class: 'card-b' },
    h('div', { class: 'sub-h' }, 'פירוט התכשיט'),
    h('div', { class: 'desc-box' }, o.description || '—'),
    h('div', { class: 'grid-2', style: { 'margin-top': '6px' } },
      h('div', null, h('div', { class: 'sub-h' }, 'הרכב עלויות'), h('div', { class: 'kv' },
        kv('ליאור', money(o.cost_lior || 0)), kv('יהלומים', money(o.cost_diamonds || 0)), kv('סה"כ עלויות', money(f.costs), { cls: 'total' }))),
      h('div', null, h('div', { class: 'sub-h' }, 'מחיר'), h('div', { class: 'kv' },
        kv('מחיר מכירה (כולל מע"מ)', money(f.sale), { big: true }),
        kv(`לפני מע"מ (÷ ${(1 + ctx.settings.vat_rate).toFixed(2)})`, money(f.preVat)),
        kv('רווח', money(f.profit)), kv('אחוז רווח', pct(f.margin)))))),
  { aside: h('button', { class: 'btn-link', type: 'button', onclick: () => editOrder(ctx, o), disabled: locked ? true : null }, 'עריכה') });

  // ---- payments card
  const p2missing = num(o.payment2_amount) == null;
  const payments = card('תשלומים וגבייה', h('div', { class: 'card-b' },
    h('div', { class: 'pay-grid' },
      h('div', { class: `pay-block${o.payment1_amount == null ? ' pending' : ''}` },
        h('div', { class: 'pay-head' }, 'מקדמה', h('span', { style: { color: 'var(--muted)', 'font-weight': '500' } }, '· בפתיחת ההזמנה')),
        h('div', { class: 'kv' }, kv('כמה שולם', o.payment1_amount == null ? null : money(o.payment1_amount)),
          kv('איך שולם', o.payment1_amount == null ? null : (o.payment1_method || (+o.payment1_amount === 0 ? 'ללא תשלום' : null))),
          kv('חשבונית', o.payment1_amount == null ? null : (o.payment1_invoice ? 'יצאה ✓' : 'לא יצאה')))),
      h('div', { class: `pay-block${p2missing ? ' pending' : ''}` },
        h('div', { class: 'pay-head' }, 'השלמת תשלום', p2missing ? h('span', { class: 'pill muted' }, 'טרם הוזן') : h('span', { style: { color: 'var(--muted)', 'font-weight': '500' } }, `· ${fmtDate(israelDate(o.payment2_at))}`)),
        h('div', { class: 'kv' }, kv('כמה נותר לשלם', p2missing ? null : money(o.payment2_amount)),
          kv('איך שולם', p2missing ? null : (o.payment2_method || (+o.payment2_amount === 0 ? 'ללא תשלום' : null))),
          kv('חשבונית', p2missing ? null : (o.payment2_invoice ? 'יצאה ✓' : 'לא יצאה'))),
        p2missing && !locked ? h('div', { style: { padding: '8px 0 4px' } },
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => ctx.openPayment2(o) }, `הזנת השלמת תשלום · ${money0(suggestedRemainder(o))}`)) : null)),
    h('div', { class: 'kv', style: { 'margin-top': '10px' } },
      kv('מחיר מכירה', money(f.sale)), kv('סה"כ שולם', money(c.paid)),
      kv('יתרה לתשלום', money(Math.max(0, c.balance)), { cls: 'total' })),
    o.legacy_payment_note ? h('div', { class: 'legacy' }, h('b', null, 'הערת תשלום מהאקסל: '), o.legacy_payment_note) : null),
  { aside: collectionPill(o) });

  // ---- SLA
  const slaCard = s ? card('זמן אספקה', h('div', { class: 'card-b sla' },
    s.stopped
      ? h('div', { class: 'sla-big' }, h('b', { class: `lvl-c-${s.onTime ? 'ok' : 'late'}` }, s.elapsed), h('span', null, `ימי עסקים עד המסירה · ${s.onTime ? 'בזמן' : 'באיחור'}`))
      : h('div', { class: 'sla-big' }, h('b', { class: `lvl-c-${s.level}` }, `יום ${s.elapsed}`), h('span', null, `מתוך ${s.days}`)),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(s.days), 'aria-valuenow': String(Math.min(s.elapsed, s.days)) },
      h('i', { class: `lvl-b-${s.stopped ? (s.onTime ? 'ok' : 'late') : s.level}`, style: { width: `${Math.min(100, (s.elapsed / s.days) * 100)}%` } })),
    h('div', { class: 'meta' }, h('span', { class: `lvl-c-${s.level}`, style: { 'font-weight': '700' } }, slaShort(s)), h('span', null, `יעד: ${fmtDateLong(s.due)}`)),
    h('div', { class: 'meta' }, h('span', null, `נכנסה: ${fmtDateLong(o.entered_at)}`), o.delivered_at ? h('span', null, `נמסרה: ${fmtDate(israelDate(o.delivered_at))}`) : null)),
  { aside: 'ימי עסקים: א׳–ה׳ ללא חגים' }) : null;

  // ---- customer
  const phone = o.customer_phone ? h('span', { style: { display: 'inline-flex', gap: '6px', 'align-items': 'center', direction: 'ltr' } },
    o.customer_phone, h('button', { class: 'btn-link', type: 'button', 'aria-label': 'העתקת מספר', onclick: async () => {
      try { await navigator.clipboard.writeText(o.customer_phone); toast('המספר הועתק'); } catch { toast('לא ניתן להעתיק', true); } } }, icon('copy', 14))) : null;
  const customer = card('פרטי לקוח והזמנה', h('div', { class: 'card-b' }, h('div', { class: 'kv' },
    kv('מספר הזמנה', `#${o.order_number}`), kv('שם לקוח', o.customer_name), kv('טלפון', phone), kv('דרך מי הגיע', o.source),
    kv('תאריך כניסה', fmtDate(o.entered_at)), kv('נפתחה ע״י', o.created_by_name), kv('עדכון אחרון', `${o.updated_by_name || '—'} · ${fmtDateTime(o.updated_at)}`))));

  // ---- stage checklists
  const checks = card('בדיקות שלב', h('div', { class: 'card-b' }, Object.entries(CHECKLISTS).map(([k, c]) => {
    const done = checklistDone(o, k);
    return h('div', { class: `cl-group${k === key ? ' cur' : ''}` },
      h('div', { class: 'cl-h' }, statusLabel(k), h('span', { class: `pill ${done ? 'ok' : k === key ? 'warn' : 'muted'}` }, done ? 'הושלם' : c.mode === 'any' ? 'יש לבחור אחד' : 'לא הושלם')),
      c.items.map(i => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!o[i.key], disabled: locked ? true : null, onchange: e => ctx.toggleCheck(o, i.key, e.target.checked) }), i.label)));
  })), { aside: 'נדרש למעבר לשלב הבא' });

  const notes = card('הערות', h('div', { class: 'card-b' }, o.notes ? h('div', { style: { 'white-space': 'pre-wrap', 'line-height': '1.7' } }, o.notes) : h('div', { style: { color: 'var(--muted)' } }, 'אין הערות.')),
    { aside: locked ? null : h('button', { class: 'btn-link', type: 'button', onclick: () => editOrder(ctx, o) }, o.notes ? 'עריכה' : 'הוספה') });

  const history = card('היסטוריית שינויים', h('div', { class: 'card-b' }, events.length ? h('div', { class: 'timeline' }, events.map(e => {
    const [title, sub] = (EVENT_TEXT[e.type] || (() => [e.type, null]))(e);
    return h('div', { class: 'tl' }, h('span', { class: 'tl-dot' }), h('div', null,
      h('div', { class: 'tl-t' }, title), sub ? h('div', { class: 'tl-m', style: { color: 'var(--ink-2)' } }, sub) : null,
      h('div', { class: 'tl-m' }, `${e.actor_name || '—'} · ${fmtDateTime(e.at)}`)));
  })) : h('div', { style: { color: 'var(--muted)' } }, 'אין עדיין שינויים.')));

  return h('div', null, head,
    o.status ? stepper : h('div', { class: 'notice' }, icon('alert', 18), 'להזמנה הזו עדיין אין סטטוס. בחרו סטטוס מתוך "שינוי סטטוס" למעלה.'),
    h('div', { class: 'o-grid' },
      h('div', { class: 'o-col' }, details, payments, history),
      h('div', { class: 'o-col' }, slaCard, checks, customer, notes)));
}

// ---------- edit modal ----------
function editOrder(ctx, o) {
  const errBox = h('div');
  const vat = ctx.settings.vat_rate;
  const preview = h('span', { class: 'hint' });
  const updPreview = () => { const v = num(form.querySelector('#e_sale').value) || 0; preview.textContent = `לפני מע"מ: ${money(v / (1 + vat))}`; };
  const hasP2 = num(o.payment2_amount) != null;
  const form = h('form', { novalidate: true, style: { display: 'flex', 'flex-direction': 'column', gap: '14px' } },
    h('div', { class: 'grid-2' },
      field('מספר הזמנה', h('input', { id: 'e_num', type: 'number', inputmode: 'numeric', value: o.order_number, dir: 'ltr' })),
      field('תאריך כניסה', h('input', { id: 'e_date', type: 'date', value: o.entered_at })),
      field('שם לקוח', h('input', { id: 'e_name', value: o.customer_name }), { req: true }),
      field('טלפון', h('input', { id: 'e_phone', type: 'tel', value: o.customer_phone || '', dir: 'ltr' })),
      field('דרך מי הגיע', h('input', { id: 'e_source', value: o.source || '' }), { full: true }),
      field('פירוט התכשיט', h('textarea', { id: 'e_desc' }, o.description || ''), { full: true })),
    h('div', { class: 'sub-h' }, 'עלויות ומחיר'),
    h('div', { class: 'grid-3' },
      field('ליאור', moneyInput('e_lior', o.cost_lior ?? 0)),
      field('יהלומים', moneyInput('e_diam', o.cost_diamonds ?? 0)),
      field('מחיר מכירה', moneyInput('e_sale', o.sale_price ?? 0, { oninput: () => updPreview() }))),
    preview,
    h('div', { class: 'sub-h' }, 'מקדמה'),
    field('כמה שולם', moneyInput('e_p1', o.payment1_amount ?? ''), { req: !o.is_import, hint: o.is_import ? 'יובא מהאקסל: אפשר להשאיר ריק' : 'אפשר 0' }),
    field('איך שולם', methodChips('e_p1m', o.payment1_method)),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'e_p1i', checked: o.payment1_invoice }), 'יצאה חשבונית'),
    hasP2 ? h('div', { class: 'sub-h' }, 'השלמת תשלום') : null,
    hasP2 ? field('כמה נותר לשלם', moneyInput('e_p2', o.payment2_amount), { req: true }) : null,
    hasP2 ? field('איך שולם', methodChips('e_p2m', o.payment2_method)) : null,
    hasP2 ? h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'e_p2i', checked: o.payment2_invoice }), 'יצאה חשבונית') : null,
    h('div', { class: 'sub-h' }, 'הערות'),
    field('הערות', h('textarea', { id: 'e_notes' }, o.notes || '')),
    errBox);
  updPreview();
  const m = modal({
    title: `עריכת הזמנה #${o.order_number}`, body: form, wide: true,
    actions: [
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        const v = id => form.querySelector(id)?.value;
        const txt = id => (v(id) || '').trim() || null;
        const patch = {
          order_number: num(v('#e_num')), entered_at: v('#e_date') || o.entered_at, customer_name: (v('#e_name') || '').trim(),
          customer_phone: txt('#e_phone'), source: txt('#e_source'), description: (v('#e_desc') || '').trim(), notes: txt('#e_notes'),
          cost_lior: num(v('#e_lior')) ?? 0, cost_diamonds: num(v('#e_diam')) ?? 0, sale_price: num(v('#e_sale')) ?? 0,
          payment1_amount: num(v('#e_p1')), payment1_method: readRadio(form, 'e_p1m'), payment1_invoice: form.querySelector('#e_p1i').checked,
        };
        if (hasP2) Object.assign(patch, { payment2_amount: num(v('#e_p2')), payment2_method: readRadio(form, 'e_p2m'), payment2_invoice: form.querySelector('#e_p2i').checked });
        const errs = [];
        if (!patch.order_number || patch.order_number < 1) errs.push('מספר הזמנה לא תקין.');
        if (!patch.customer_name) errs.push('יש להזין שם לקוח.');
        if (!o.is_import && patch.payment1_amount == null) errs.push('יש להזין כמה שולם במקדמה (אפשר 0).');
        if (patch.payment1_amount > 0 && !patch.payment1_method) errs.push('יש לבחור איך שולמה המקדמה.');
        if (hasP2) errs.push(...Object.values(validatePayment2(patch)));
        if (['cost_lior', 'cost_diamonds', 'sale_price'].some(k => patch[k] < 0)) errs.push('סכומים לא יכולים להיות שליליים.');
        errBox.replaceChildren(...errs.map(t => h('div', { class: 'form-err' }, t)));
        if (errs.length) return;
        try {
          const row = await ctx.save(o.id, patch, 'השינויים נשמרו');
          m.close();
          ctx.go(`#/order/${row.order_number}`);
        } catch { /* toast shown */ }
      } }, 'שמירת שינויים'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'ביטול'),
    ],
  });
}

// ===================================================================== NEW ORDER
export function newOrder(ctx) {
  const vat = ctx.settings.vat_rate;
  const nextNum = Math.max(FIRST_ORDER_NUMBER, ...ctx.orders.filter(o => o.order_number >= FIRST_ORDER_NUMBER).map(o => o.order_number + 1));
  const errTop = h('div', { class: 'form-err', hidden: true, role: 'alert' });
  const sumBox = h('div', { class: 'kv' });
  const form = h('form', { class: 'form-page', novalidate: true });
  const err = {};
  const errFor = k => { const s = h('span', { class: 'err-msg', hidden: true }); err[k] = s; return s; };
  const withErr = (fld, k) => { fld.append(errFor(k)); fld.dataset.k = k; return fld; };

  const left = h('div', { class: 'o-col' },
    card('פרטי לקוח', h('div', { class: 'card-b grid-2' },
      withErr(field('שם לקוח', h('input', { id: 'n_name', autocomplete: 'off' }), { req: true }), 'customer_name'),
      field('טלפון', h('input', { id: 'n_phone', type: 'tel', dir: 'ltr', autocomplete: 'off' })),
      field('דרך מי הגיע', h('input', { id: 'n_source', placeholder: 'אינסטגרם, המלצה, אתר…', list: 'n_sources' })),
      field('תאריך כניסה', h('input', { id: 'n_date', type: 'date', value: todayISO() })),
      h('datalist', { id: 'n_sources' }, [...new Set(ctx.orders.map(o => o.source).filter(Boolean))].map(s => h('option', { value: s })))), { cls: 'form-sec' }),
    card('פירוט הזמנה', h('div', { class: 'card-b' },
      field('פירוט התכשיט', h('textarea', { id: 'n_desc', placeholder: 'סוג התכשיט, מתכת, אבנים, מידות…', rows: 4 })),
      h('div', { class: 'grid-3' },
        withErr(field('עלות ליאור', moneyInput('n_lior', 0)), 'cost_lior'),
        withErr(field('עלות יהלומים', moneyInput('n_diam', 0)), 'cost_diamonds'),
        withErr(field('מחיר מכירה', moneyInput('n_sale', ''), { hint: 'כולל מע"מ' }), 'sale_price'))), { cls: 'form-sec' }),
    card('תשלום בפתיחת ההזמנה', h('div', { class: 'card-b' },
      h('p', { style: { margin: 0, color: 'var(--muted)', 'font-size': '13px' } }, 'חובה למלא לפני פתיחת ההזמנה. אם לא שולמה מקדמה, הזינו 0. לא ניתן לפתוח הזמנה לפני שיצאה חשבונית.'),
      withErr(field('כמה שולם?', moneyInput('n_p1', ''), { req: true, hint: 'בשקלים' }), 'payment1_amount'),
      withErr(field('איך שולם?', methodChips('n_p1m', null), { req: true, hint: 'חובה אם הסכום גדול מ-0' }), 'payment1_method'),
      (() => { const w = h('div', { class: 'field field-check' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'n_p1i' }), 'יצאה חשבונית', h('span', { class: 'req' }, ' *')), errFor('payment1_invoice')); return w; })()), { cls: 'form-sec' }),
    card('הערות', h('div', { class: 'card-b' }, field('הערות', h('textarea', { id: 'n_notes', rows: 3 }))), { cls: 'form-sec' }));

  const submit = h('button', { class: 'btn btn-primary', type: 'submit', style: { width: '100%', padding: '11px' } }, 'פתיחת הזמנה');
  const right = h('div', { class: 'o-col sticky-side' },
    card('סיכום', h('div', { class: 'card-b summary-box' }, sumBox), { foot: h('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '10px' } }, errTop, submit) }));
  form.append(left, right);

  const read = () => ({
    customer_name: form.querySelector('#n_name').value.trim(),
    customer_phone: form.querySelector('#n_phone').value.trim() || null,
    source: form.querySelector('#n_source').value.trim() || null,
    entered_at: form.querySelector('#n_date').value || todayISO(),
    description: form.querySelector('#n_desc').value.trim(),
    cost_lior: num(form.querySelector('#n_lior').value) ?? 0,
    cost_diamonds: num(form.querySelector('#n_diam').value) ?? 0,
    sale_price: num(form.querySelector('#n_sale').value) ?? 0,
    payment1_amount: num(form.querySelector('#n_p1').value),
    payment1_method: readRadio(form, 'n_p1m'),
    payment1_invoice: form.querySelector('#n_p1i').checked,
    notes: form.querySelector('#n_notes').value.trim() || null,
  });
  const paint = () => {
    const d = read(), f = financials(d, vat), rest = Math.max(0, f.sale - (d.payment1_amount || 0));
    sumBox.replaceChildren(
      kv('מספר הזמנה', `#${nextNum}`), kv('סטטוס פתיחה', statusLabel('new')),
      kv('מחיר מכירה', money(f.sale), { big: true }), kv('לפני מע"מ', money(f.preVat)), kv('עלויות', money(f.costs)), kv('רווח', `${money(f.profit)} · ${pct(f.margin)}`),
      kv('מקדמה', d.payment1_amount == null ? null : money(d.payment1_amount)), kv('יתרה לגבייה', money(rest), { cls: 'total' }),
      kv('יעד אספקה', fmtDateLong(sla({ entered_at: d.entered_at }, ctx.settings, ctx.holidays).due)));
  };
  form.addEventListener('input', paint);
  form.addEventListener('change', paint);
  paint();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = read();
    const errs = validateNewOrder(d);
    for (const [k, el] of Object.entries(err)) { el.hidden = !errs[k]; el.textContent = errs[k] || ''; el.closest('.field')?.classList.toggle('err', !!errs[k]); }
    if (Object.keys(errs).length) {
      errTop.textContent = 'יש להשלים את השדות המסומנים.'; errTop.hidden = false;
      form.querySelector('.field.err input, .field.err textarea')?.focus();
      return;
    }
    errTop.hidden = true; submit.disabled = true; submit.textContent = 'פותח הזמנה…';
    try {
      const row = await ctx.api.createOrder({ ...d, updated_by_name: ctx.name });
      ctx.orders.unshift(row);
      toast(`הזמנה #${row.order_number} נפתחה`);
      ctx.go(`#/order/${row.order_number}`);
    } catch (ex) {
      errTop.textContent = ex.message || 'הפתיחה נכשלה.'; errTop.hidden = false;
      submit.disabled = false; submit.textContent = 'פתיחת הזמנה';
    }
  });
  setTimeout(() => form.querySelector('#n_name')?.focus(), 30);
  return h('div', null, pageHead('הזמנה חדשה', `המספר ייקבע אוטומטית בשמירה (#${nextNum}). ההזמנה תיפתח בשלב "${statusLabel('new')}".`, [], crumbTo('#/', 'לוח בקרה')), form);
}

// ===================================================================== STATS
const MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
export async function stats(ctx) {
  const st = ctx.statsState ||= { period: 'month' };
  const today = ctx.today, [ty, tm] = today.split('-').map(Number);
  const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
  const prev = tm === 1 ? ym(ty - 1, 12) : ym(ty, tm - 1);
  const inPeriod = d => !d ? false : st.period === 'month' ? d.startsWith(ym(ty, tm)) : st.period === 'prev' ? d.startsWith(prev) : st.period === 'year' ? d.startsWith(String(ty)) : true;
  const periodName = { month: 'החודש', prev: 'החודש הקודם', year: 'השנה', all: 'כל הזמן' }[st.period];
  const all = ctx.orders.filter(o => !o.deleted_at);
  const set = all.filter(o => inPeriod(o.entered_at));
  const vat = ctx.settings.vat_rate;
  const fin = set.map(o => financials(o, vat));
  const revenue = sum(fin, f => f.sale), preVat = sum(fin, f => f.preVat), profit = sum(fin, f => f.profit);
  const delivered = all.filter(o => o.delivered_at && inPeriod(israelDate(o.delivered_at))).map(o => ctx.slaOf(o));
  const onTime = delivered.filter(s => s.onTime).length;
  const act = ctx.active();
  const lateNow = act.map(ctx.slaOf).filter(s => s && s.level === 'late').length;
  const openBal = sum(act.filter(o => o.status), o => Math.max(0, collection(o).balance));

  const kpi = (k, v, s) => h('div', { class: 'card kpi' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), s ? h('div', { class: 's' }, s) : null);

  // monthly chart (last 12 months)
  const months = []; for (let i = 11; i >= 0; i--) { let y = ty, m = tm - i; while (m < 1) { m += 12; y--; } months.push({ key: ym(y, m), label: MONTHS[m - 1], y }); }
  for (const mo of months) { const os = all.filter(o => o.entered_at?.startsWith(mo.key)); mo.count = os.length; mo.rev = sum(os, o => +o.sale_price); }
  const maxC = Math.max(1, ...months.map(m => m.count));
  const step = maxC <= 5 ? 1 : maxC <= 10 ? 2 : maxC <= 25 ? 5 : maxC <= 50 ? 10 : Math.ceil(maxC / 50) * 10;
  const top = Math.ceil(maxC / step) * step;
  const grid = []; for (let v = step; v <= top; v += step) grid.push(h('div', { class: 'gridline', style: { bottom: `${(v / top) * 100}%` } }, h('span', null, v)));
  const chart = h('div', null,
    h('div', { class: 'chart', style: { '--n': months.length }, role: 'img', 'aria-label': 'מספר הזמנות לפי חודש' }, grid,
      months.map(mo => h('div', { class: 'bcol', tabindex: '0', 'aria-label': `${mo.label} ${mo.y}: ${mo.count} הזמנות` },
        h('i', { style: { height: `${(mo.count / top) * 100}%` } }),
        h('span', { class: 'tip' }, `${mo.label} ${mo.y} · ${plural(mo.count, 'הזמנה', 'הזמנות')} · ${money0(mo.rev)}`)))),
    h('div', { class: 'chart-x', style: { '--n': months.length } }, months.map(mo => h('span', null, mo.label))));

  // time per stage (completed stages only)
  let stageRows = [];
  try {
    const evs = await ctx.api.statusEvents();
    const byOrder = {}; for (const e of evs) (byOrder[e.order_id] ||= []).push(e);
    const acc = Object.fromEntries(STATUSES.map(s => [s.key, { n: 0, d: 0 }]));
    for (const list of Object.values(byOrder)) {
      list.sort((a, b) => String(a.at).localeCompare(String(b.at)));
      for (let i = 0; i < list.length - 1; i++) {
        const k = list[i].to_status; if (!acc[k]) continue;
        acc[k].n++; acc[k].d += businessDaysBetween(israelDate(list[i].at), israelDate(list[i + 1].at), ctx.holidays);
      }
    }
    stageRows = STATUSES.filter(s => s.key !== 'with_customer').map(s => [s, acc[s.key]]);
  } catch { /* history unavailable */ }

  const groupBy = (arr, keyFn) => { const m = new Map(); for (const o of arr) { const k = keyFn(o) || 'לא צוין'; const g = m.get(k) || { n: 0, rev: 0 }; g.n++; g.rev += +o.sale_price || 0; m.set(k, g); } return [...m.entries()].sort((a, b) => b[1].rev - a[1].rev); };
  const bySource = groupBy(set, o => o.source);
  const methods = new Map();
  for (const o of set) for (const [a, m] of [[o.payment1_amount, o.payment1_method], [o.payment2_amount, o.payment2_method]]) if (+a > 0) methods.set(m || 'לא צוין', (methods.get(m || 'לא צוין') || 0) + +a);

  const tbl = (heads, rows) => rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, heads.map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
    h('tbody', null, rows.map(r => h('tr', null, r.map((x, i) => h('td', { class: i ? 'num' : '' }, x))))))) : h('div', { class: 'empty' }, 'אין נתונים לתקופה.');

  const seg = h('div', { class: 'seg' }, [['month', 'החודש'], ['prev', 'החודש הקודם'], ['year', 'השנה'], ['all', 'הכול']].map(([k, l]) =>
    h('button', { type: 'button', class: st.period === k ? 'on' : '', onclick: () => { st.period = k; ctx.render(); } }, l)));

  return h('div', null,
    pageHead('סיכום ונתונים', `${periodName} · לפי תאריך כניסת ההזמנה`, [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => exportOrders(ctx, set, 'הזמנות') }, icon('download', 16), 'ייצוא התקופה לאקסל')]),
    h('div', { class: 'toolbar' }, seg),
    h('div', { class: 'kpis' },
      kpi('הזמנות שנכנסו', set.length, periodName),
      kpi('מחזור מכירות', money0(revenue), `לפני מע"מ ${money0(preVat)}`),
      kpi('רווח', money0(profit), preVat ? `${pct(profit / preVat)} מהמחיר לפני מע"מ` : null),
      kpi('עמידה בזמני אספקה', delivered.length ? pct(onTime / delivered.length) : '—', delivered.length ? `${onTime} מתוך ${delivered.length} שנמסרו` : 'אין מסירות בתקופה')),
    h('div', { class: 'kpis' },
      kpi('הזמנות פעילות כעת', act.length, null),
      kpi('באיחור כעת', lateNow, lateNow ? h('a', { class: 'btn-link', href: '#/board' }, 'ללוח העבודה') : 'הכול בזמן'),
      kpi('יתרות פתוחות', money0(openBal), 'בהזמנות פעילות'),
      kpi('ממוצע ימי עסקים עד מסירה', delivered.length ? (sum(delivered, s => s.elapsed) / delivered.length).toFixed(1) : '—', `יעד: ${ctx.settings.sla_days}`)),
    h('div', { class: 'panels', style: { 'grid-template-columns': 'minmax(0,1.4fr) minmax(0,1fr)' } },
      card('הזמנות לפי חודש', h('div', { class: 'card-b' }, chart), { aside: '12 החודשים האחרונים' }),
      card('זמן ממוצע בכל שלב', tbl(['שלב', 'ימי עסקים', 'הזמנות'], stageRows.filter(([, a]) => a.n).map(([s, a]) => [statusLabel(s.key), (a.d / a.n).toFixed(1), a.n])), { aside: 'שלבים שהסתיימו' })),
    h('div', { class: 'panels', style: { 'margin-top': '16px', 'grid-template-columns': 'repeat(2, minmax(0,1fr))' } },
      card('לפי מקור הגעה', tbl(['מקור', 'הזמנות', 'מחזור'], bySource.map(([k, g]) => [k, g.n, money0(g.rev)])), { aside: periodName }),
      card('תקבולים לפי אמצעי תשלום', tbl(['אמצעי', 'סכום'], [...methods.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, money0(v)])), { aside: periodName })));
}

// ===================================================================== ARCHIVE & TRASH
function simpleTable(ctx, list, extraHead, extraCell) {
  return list.length ? h('div', { class: 'card table-wrap' }, h('table', { class: 't' },
    h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'לקוח'), h('th', { class: 'hide-sm' }, 'פירוט'), h('th', null, 'סטטוס'), h('th', { class: 'num' }, 'מחיר'), h('th', { class: 'hide-sm' }, 'גבייה'), h('th', null, extraHead), h('th', null, ''))),
    h('tbody', null, list.map(o => h('tr', { class: 'click', onclick: e => { if (!e.target.closest('button')) ctx.go(`#/order/${o.order_number}`); } },
      h('td', { class: 'tnum' }, o.order_number), h('td', null, h('b', null, o.customer_name)), h('td', { class: 'clip hide-sm' }, (o.description || '').split('\n')[0]),
      h('td', null, statusPill(o)), h('td', { class: 'num' }, +o.sale_price ? money0(o.sale_price) : '—'), h('td', { class: 'hide-sm' }, collectionPill(o)),
      ...extraCell(o)))))) : null;
}
export function archive(ctx) {
  const list = ctx.orders.filter(o => o.archived_at && !o.deleted_at).sort((a, b) => String(b.archived_at).localeCompare(String(a.archived_at)));
  return h('div', null,
    pageHead('ארכיון', `${plural(list.length, 'הזמנה', 'הזמנות')} שהסתיימו. הן לא מופיעות בריבועים, אבל נשמרות לחיפוש ולסיכומים.`,
      list.length ? [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => exportOrders(ctx, list, 'ארכיון') }, icon('download', 16), 'ייצוא לאקסל')] : []),
    simpleTable(ctx, list, 'הועברה', o => [h('td', { class: 'tnum' }, fmtDate(israelDate(o.archived_at))),
      h('td', null, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => ctx.unarchive(o) }, 'החזרה'))])
    || h('div', { class: 'card empty' }, 'הארכיון ריק. כשהזמנה מסתיימת (אצל הלקוח), העבירו אותה לארכיון מדף ההזמנה.'));
}
export function trash(ctx) {
  const list = ctx.orders.filter(o => o.deleted_at).sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
  return h('div', null,
    pageHead('סל מחזור', 'הזמנות שנמחקו. אפשר לשחזר אותן, או למחוק לצמיתות.'),
    simpleTable(ctx, list, 'נמחקה', o => [h('td', { class: 'tnum' }, fmtDate(israelDate(o.deleted_at))),
      h('td', null, h('div', { style: { display: 'flex', gap: '6px' } },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => ctx.restore(o) }, 'שחזור'),
        h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => ctx.deleteForever(o) }, 'מחיקה לצמיתות')))])
    || h('div', { class: 'card empty' }, 'סל המחזור ריק.'));
}

// ===================================================================== SETTINGS
export function settingsPage(ctx) {
  const s = ctx.settings;
  const msg = h('div', { class: 'form-err', hidden: true });
  const f = h('form', { novalidate: true, class: 'card-b', style: { display: 'flex', 'flex-direction': 'column', gap: '14px' } },
    h('div', { class: 'grid-2' },
      field('אחוז מע"מ', h('input', { id: 's_vat', type: 'number', step: '0.1', min: '0', max: '99', value: Math.round(s.vat_rate * 1000) / 10, dir: 'ltr' }), { hint: 'מחיר לפני מע"מ = מחיר ÷ (1 + מע"מ)' }),
      field('התחייבות אספקה (ימי עסקים)', h('input', { id: 's_sla', type: 'number', min: '1', value: s.sla_days, dir: 'ltr' })),
      field('התראה ראשונה כשנותרו', h('input', { id: 's_w1', type: 'number', min: '0', value: s.warn_days_1, dir: 'ltr' }), { hint: 'ימים' }),
      field('התראה דחופה כשנותרו', h('input', { id: 's_w2', type: 'number', min: '0', value: s.warn_days_2, dir: 'ltr' }), { hint: 'ימים' }),
      field('זמן מקסימלי במפעל', h('input', { id: 's_fac', type: 'number', min: '1', value: s.factory_days ?? 5, dir: 'ltr' }), { hint: 'ימי עסקים · מעבר לזה מסומן כחריגה' })),
    msg,
    h('div', null, h('button', { class: 'btn btn-primary', type: 'submit' }, 'שמירת הגדרות')));
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const p = { vat_rate: (num(f.querySelector('#s_vat').value) ?? 18) / 100, sla_days: num(f.querySelector('#s_sla').value), warn_days_1: num(f.querySelector('#s_w1').value), warn_days_2: num(f.querySelector('#s_w2').value), factory_days: num(f.querySelector('#s_fac').value) };
    if (!(p.sla_days > 0) || !(p.factory_days > 0) || p.warn_days_1 == null || p.warn_days_2 == null || p.vat_rate < 0 || p.vat_rate >= 1) { msg.textContent = 'יש להזין ערכים תקינים בכל השדות.'; msg.hidden = false; return; }
    msg.hidden = true;
    try { ctx.settings = { ...ctx.settings, ...(await ctx.api.updateSettings(p)) }; ctx.settings.vat_rate = +ctx.settings.vat_rate; toast('ההגדרות נשמרו'); ctx.render(); } catch (ex) { ctx.handleError(ex); }
  });

  const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const upcoming = ctx.holidayList.filter(x => x.day >= `${ctx.today.slice(0, 4)}-01-01`);
  const hDate = h('input', { class: 'input', type: 'date', id: 'h_day', style: { width: 'auto' }, 'aria-label': 'תאריך' });
  const hName = h('input', { class: 'input', id: 'h_name', placeholder: 'שם החג או היום', style: { flex: '1', 'min-width': '160px' }, 'aria-label': 'שם' });
  const holCard = card('חגים וימים ללא עבודה', h('div', null,
    h('div', { class: 'card-b', style: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap', 'border-bottom': '1px solid var(--line)' } }, hDate, hName,
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
        if (!hDate.value || !hName.value.trim()) return toast('יש לבחור תאריך ולהזין שם.', true);
        try { await ctx.api.addHoliday(hDate.value, hName.value.trim()); await ctx.refresh(false); toast('היום נוסף'); ctx.render(); } catch (ex) { ctx.handleError(ex); }
      } }, icon('plus', 16), 'הוספה')),
    upcoming.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, h('th', null, 'תאריך'), h('th', null, 'יום'), h('th', null, 'שם'), h('th', null, ''))),
      h('tbody', null, upcoming.map(x => h('tr', { style: weekday(x.day) >= 5 ? { opacity: '.55' } : null },
        h('td', { class: 'tnum' }, fmtDate(x.day)), h('td', null, DAYS[weekday(x.day)]), h('td', null, x.name),
        h('td', null, h('button', { class: 'btn-link', type: 'button', onclick: async () => {
          if (!await confirmBox({ title: 'הסרת יום', text: `להסיר את "${x.name}" (${fmtDate(x.day)}) מרשימת החגים?`, okText: 'הסרה', danger: true })) return;
          try { await ctx.api.removeHoliday(x.day); await ctx.refresh(false); ctx.render(); } catch (ex) { ctx.handleError(ex); }
        } }, 'הסרה'))))))) : h('div', { class: 'empty' }, 'אין חגים ברשימה.')),
  { aside: 'חגים שחלים בשישי או בשבת מוצגים באפור, כי ממילא אינם ימי עסקים' });

  const allNonDeleted = ctx.orders.filter(o => !o.deleted_at);
  return h('div', null,
    pageHead('הגדרות', 'כללי החישוב של המערכת. שינוי כאן משפיע מיד על כל ההזמנות.'),
    h('div', { class: 'o-grid' },
      h('div', { class: 'o-col' }, card('חישובים והתראות', f), holCard),
      h('div', { class: 'o-col' },
        card('כניסה למערכת', h('div', { class: 'card-b', style: { 'line-height': '1.7' } },
          ctx.api.mode === 'live' && ctx.api.loginEmail
            ? h('p', { style: { margin: '0 0 8px' } }, 'כל הצוות נכנס עם סיסמה משותפת אחת. כל אחד מזין את שמו בכניסה, והשם נרשם בהיסטוריה.')
            : h('p', { style: { margin: '0 0 8px' } }, 'כל משתמש נכנס עם מייל וסיסמה משלו.'),
          h('p', { style: { margin: 0, color: 'var(--muted)', 'font-size': '13px' } }, 'החלפת סיסמה או הוספת משתמשים: ב-Supabase, תחת Authentication ← Users. ההוראות המלאות בקובץ README שבמאגר.'))),
        card('גיבוי', h('div', { class: 'card-b' },
          h('p', { style: { margin: '0 0 12px', color: 'var(--muted)' } }, 'הורדת כל ההזמנות (כולל ארכיון) לקובץ אקסל.'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => exportOrders(ctx, allNonDeleted, 'גיבוי הזמנות') }, icon('download', 16), `הורדת גיבוי (${allNonDeleted.length})`))))));
}

export function notFound(ctx) {
  return h('div', null, pageHead('העמוד לא נמצא', null, [], crumbTo('#/', 'לוח בקרה')));
}

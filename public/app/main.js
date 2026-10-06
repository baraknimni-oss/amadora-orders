import { loadConfig, makeApi, store, AuthError } from './api.js';
import { h, icon, toast, modal, field, moneyInput, methodChips, readRadio, searchOrders, confirmBox } from './ui.js';
import {
  STATUSES, NEEDS_PAYMENT2, statusLabel, statusKey, todayISO, sla, urgency, collection, money, money0,
  suggestedRemainder, validatePayment2, num, fmtDate,
} from './logic.js';
import * as V from './views.js';

const root = document.getElementById('root');
const ctx = {
  api: null, cfg: null, name: store.get('amadora.name') || '',
  orders: [], settings: { vat_rate: 0.18, sla_days: 14, warn_days_1: 6, warn_days_2: 3 },
  holidays: new Set(), holidayList: [], today: todayISO(), loadedAt: null, stale: false,
};

// ---------------------------------------------------------------- helpers on ctx
ctx.go = hash => { if (location.hash === hash) render(); else location.hash = hash; };
ctx.active = () => ctx.orders.filter(o => !o.deleted_at && !o.archived_at);
ctx.byNumber = n => ctx.orders.find(o => String(o.order_number) === String(n));
ctx.slaOf = o => sla(o, ctx.settings, ctx.holidays, ctx.today);
ctx.attention = () => ctx.active()
  .map(o => ({ o, s: ctx.slaOf(o) }))
  .filter(({ s }) => s && !s.stopped && ['warn', 'critical', 'late'].includes(s.level))
  .sort((a, b) => urgency(a.s) - urgency(b.s));

ctx.refresh = async (rerender = true) => {
  const [orders, settings, hol] = await Promise.all([ctx.api.listOrders(), ctx.api.getSettings(), ctx.api.holidays()]);
  ctx.orders = orders;
  if (settings) ctx.settings = { ...settings, vat_rate: +settings.vat_rate };
  ctx.holidayList = hol;
  ctx.holidays = new Set(hol.map(x => x.day));
  ctx.today = todayISO();
  ctx.loadedAt = new Date();
  if (rerender) render();
};

ctx.save = async (id, patch, okMsg) => {
  try {
    const row = await ctx.api.updateOrder(id, { ...patch, updated_by_name: ctx.name });
    const i = ctx.orders.findIndex(o => o.id === id); if (i >= 0) ctx.orders[i] = row;
    if (okMsg) toast(okMsg);
    return row;
  } catch (e) { handleError(e); throw e; }
};

/** Move an order to another status. Opens the payment form first when the move requires it. */
ctx.changeStatus = async (o, to) => {
  if (statusKey(o) === to) return;
  if (NEEDS_PAYMENT2.has(to) && num(o.payment2_amount) == null) return ctx.openPayment2(o, to);
  await ctx.save(o.id, { status: to }, `#${o.order_number} הועברה ל"${statusLabel(to)}"`).catch(() => {});
  render();
};

ctx.openPayment2 = (o, thenStatus = null) => new Promise(resolve => {
  const suggested = suggestedRemainder(o);
  const errs = h('div');
  const amount = moneyInput('p2_amount', o.payment2_amount ?? '', { placeholder: String(suggested) });
  const body = h('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '14px' } },
    thenStatus ? h('p', { style: { margin: 0, color: 'var(--muted)' } },
      `כדי להעביר את הזמנה #${o.order_number} ל"${statusLabel(thenStatus)}" צריך להזין את השלמת התשלום.`) : null,
    h('div', { class: 'kv', style: { background: 'var(--surface-2)', border: '1px solid var(--line)', 'border-radius': '8px', padding: '2px 14px' } },
      h('div', { class: 'kv-r' }, h('span', { class: 'k' }, 'מחיר מכירה'), h('span', { class: 'v' }, money(o.sale_price))),
      h('div', { class: 'kv-r' }, h('span', { class: 'k' }, 'שולם בפתיחה'), h('span', { class: 'v' }, o.payment1_amount == null ? 'לא הוזן' : money(o.payment1_amount))),
      h('div', { class: 'kv-r' }, h('span', { class: 'k' }, 'נותר לפי החישוב'), h('span', { class: 'v' }, money(suggested))),
    ),
    field('כמה נותר לשלם?', h('div', { style: { display: 'flex', gap: '8px', 'align-items': 'center' } },
      h('div', { style: { flex: '1' } }, amount),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { amount.querySelector('input').value = suggested; } }, `השתמש ב-${money0(suggested)}`)),
    { req: true, hint: 'אפשר 0' }),
    field('איך שולם?', methodChips('p2_method', o.payment2_method), { req: true, hint: 'חובה אם הסכום גדול מ-0' }),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'p2_invoice', checked: o.payment2_invoice }), 'יצאה חשבונית'),
    errs,
  );
  let saved = false;
  const m = modal({
    title: thenStatus ? 'השלמת תשלום לפני מסירה' : 'הזנת השלמת תשלום', body,
    onClose: () => resolve(saved),
    actions: [
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        const d = {
          payment2_amount: num(m.box.querySelector('#p2_amount').value),
          payment2_method: readRadio(m.box, 'p2_method'),
          payment2_invoice: m.box.querySelector('#p2_invoice').checked,
        };
        const e = validatePayment2(d);
        errs.replaceChildren(...Object.values(e).map(t => h('div', { class: 'form-err' }, t)));
        if (Object.keys(e).length) return;
        if (!(d.payment2_amount > 0)) d.payment2_method = d.payment2_method || null;
        try {
          await ctx.save(o.id, { ...d, ...(thenStatus ? { status: thenStatus } : {}) },
            thenStatus ? `התשלום נשמר וההזמנה הועברה ל"${statusLabel(thenStatus)}"` : 'השלמת התשלום נשמרה');
          saved = true; m.close(); render();
        } catch { /* toast shown */ }
      } }, thenStatus ? 'שמירה והעברה' : 'שמירה'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'ביטול'),
    ],
  });
});

ctx.archive = async o => { await ctx.save(o.id, { archived_at: new Date().toISOString() }, `#${o.order_number} הועברה לארכיון`).catch(() => {}); render(); };
ctx.unarchive = async o => { await ctx.save(o.id, { archived_at: null }, `#${o.order_number} הוחזרה מהארכיון`).catch(() => {}); render(); };
ctx.trash = async o => {
  if (!await confirmBox({ title: 'מחיקת הזמנה', text: `הזמנה #${o.order_number} (${o.customer_name}) תעבור לסל המחזור. אפשר לשחזר אותה משם בכל עת.`, okText: 'העבר לסל המחזור', danger: true })) return;
  await ctx.save(o.id, { deleted_at: new Date().toISOString() }, `#${o.order_number} הועברה לסל המחזור`).catch(() => {});
  ctx.go('#/');
};
ctx.restore = async o => { await ctx.save(o.id, { deleted_at: null }, `#${o.order_number} שוחזרה`).catch(() => {}); render(); };
ctx.deleteForever = async o => {
  if (!await confirmBox({ title: 'מחיקה לצמיתות', text: `הזמנה #${o.order_number} (${o.customer_name}) וכל ההיסטוריה שלה יימחקו לצמיתות. אי אפשר לבטל את הפעולה.`, okText: 'מחיקה לצמיתות', danger: true })) return;
  try { await ctx.api.deleteForever(o.id); ctx.orders = ctx.orders.filter(x => x.id !== o.id); toast('ההזמנה נמחקה לצמיתות'); render(); } catch (e) { handleError(e); }
};

function handleError(e) {
  if (e instanceof AuthError) { toast('פג תוקף הכניסה. יש להתחבר מחדש.', true); render(); return; }
  toast(e?.message || 'משהו השתבש. נסו שוב.', true);
}
ctx.handleError = handleError;

// ---------------------------------------------------------------- routing
const ROUTES = [
  [/^$/, () => V.dashboard(ctx)],
  [/^attention$/, () => V.attention(ctx)],
  [/^status\/([a-z_]+)$/, m => V.statusList(ctx, m[1])],
  [/^board$/, () => V.board(ctx)],
  [/^orders$/, () => V.allOrders(ctx)],
  [/^orders\/new$/, () => V.newOrder(ctx)],
  [/^order\/(\d+)$/, m => V.orderPage(ctx, m[1])],
  [/^stats$/, () => V.stats(ctx)],
  [/^archive$/, () => V.archive(ctx)],
  [/^trash$/, () => V.trash(ctx)],
  [/^settings$/, () => V.settingsPage(ctx)],
];
const routePath = () => decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('?')[0];

let shell = null;
async function render() {
  if (!ctx.api.loggedIn || !ctx.name) return renderLogin();
  if (!shell) shell = buildShell();
  if (!root.contains(shell.el)) root.replaceChildren(shell.el);
  shell.update();
  const path = routePath();
  const route = ROUTES.find(([re]) => re.test(path));
  const view = shell.view;
  try {
    const node = route ? await route[1](path.match(route[0])) : V.notFound(ctx);
    if (routePath() !== path) return; // user navigated while loading
    view.replaceChildren(node);
  } catch (e) {
    if (e instanceof AuthError) return render();
    view.replaceChildren(h('div', { class: 'card empty' }, 'לא הצלחנו לטעון את המסך. ', h('button', { class: 'btn-link', onclick: () => render() }, 'נסו שוב')));
    console.error(e);
  }
  ctx.stale = false;
}
ctx.render = render;

// ---------------------------------------------------------------- shell
function buildShell() {
  const counts = {};
  const nav = h('nav', { class: 'nav', 'aria-label': 'ניווט ראשי' });
  const view = h('main', { class: 'view', id: 'view' });
  const side = h('aside', { class: 'side' },
    h('div', { class: 'brand' },
      h('div', { class: 'brand-mark' }, h('span', { class: 'brand-word' }, 'AMADORA'), h('span', { style: { color: 'var(--gold)' } }, icon('gem', 20))),
      h('div', { class: 'brand-sub' }, 'מערכת ניהול הזמנות')),
    nav,
    h('div', { class: 'side-foot' }, 'מחובר/ת: ', h('span', { class: 'who' }), h('button', { type: 'button', onclick: logout }, 'יציאה')),
  );
  const link = (hash, ic, label, countKey) => {
    const c = countKey ? h('span', { class: 'count' }) : null;
    if (countKey) counts[countKey] = c;
    return h('a', { href: hash, dataset: { hash } }, icon(ic), label, c);
  };
  nav.append(
    h('div', { class: 'nav-sec' }, 'סקירה'),
    link('#/', 'grid', 'לוח בקרה'),
    link('#/attention', 'alert', 'דורש טיפול', 'attention'),
    link('#/stats', 'chart', 'סיכום ונתונים'),
    h('div', { class: 'nav-sec' }, 'הזמנות'),
    link('#/orders/new', 'plus', 'הזמנה חדשה'),
    link('#/board', 'board', 'לוח עבודה'),
    link('#/orders', 'list', 'כל ההזמנות', 'all'),
    h('div', { class: 'nav-sec' }, 'ניהול'),
    link('#/archive', 'archive', 'ארכיון', 'archive'),
    link('#/trash', 'trash', 'סל מחזור', 'trash'),
    link('#/settings', 'settings', 'הגדרות'),
  );
  nav.addEventListener('click', e => { if (e.target.closest('a')) side.classList.remove('open'); });

  // global search
  const input = h('input', { type: 'search', placeholder: 'חיפוש לפי מספר הזמנה, שם לקוח, טלפון או פירוט…', 'aria-label': 'חיפוש הזמנות', autocomplete: 'off' });
  const pop = h('div', { class: 'search-pop', hidden: true });
  let sel = -1, results = [];
  const paint = () => {
    results = input.value.trim() ? searchOrders(ctx.orders, input.value) : [];
    pop.hidden = !results.length;
    pop.replaceChildren(...results.map((o, i) => h('a', { href: `#/order/${o.order_number}`, class: i === sel ? 'sel' : '' },
      h('span', { class: 'sp-num' }, `#${o.order_number}`), h('b', null, o.customer_name), h('span', { class: 'sp-desc' }, (o.description || '').split('\n')[0]))));
  };
  input.addEventListener('input', () => { sel = -1; paint(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, results.length - 1); paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, -1); paint(); e.preventDefault(); }
    else if (e.key === 'Enter') {
      if (sel >= 0 && results[sel]) ctx.go(`#/order/${results[sel].order_number}`);
      else { ctx.searchQuery = input.value.trim(); ctx.go('#/orders'); }
      input.value = ''; paint(); input.blur();
    } else if (e.key === 'Escape') { input.value = ''; paint(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { pop.hidden = true; }, 150));
  pop.addEventListener('click', () => { input.value = ''; paint(); });

  const meta = h('span', { class: 'top-meta' });
  const top = h('header', { class: 'top' },
    h('button', { class: 'menu-btn', type: 'button', 'aria-label': 'תפריט', onclick: () => side.classList.toggle('open') }, icon('menu')),
    h('div', { class: 'search' }, icon('search', 16), input, pop),
    meta,
    h('a', { class: 'btn btn-primary btn-sm', href: '#/orders/new' }, icon('plus', 16), h('span', { class: 'hide-sm' }, 'הזמנה חדשה')),
  );
  const demo = ctx.api.mode === 'demo'
    ? h('div', { class: 'demo-bar' }, ctx.cfg.reason === 'not-configured'
      ? 'מצב הדגמה: המערכת עדיין לא מחוברת לבסיס הנתונים, והשינויים לא נשמרים. יש להגדיר את משתני הסביבה ב-Vercel (ראו README).'
      : 'מצב הדגמה: נתוני דוגמה בלבד, השינויים לא נשמרים.')
    : null;
  const el = h('div', { class: 'shell' }, side, h('div', { class: 'main' }, demo, top, view));

  return {
    el, view,
    update() {
      const path = '#/' + routePath();
      nav.querySelectorAll('a').forEach(a => {
        const hsh = a.dataset.hash;
        a.classList.toggle('on', hsh === '#/' ? path === '#/' : path === hsh || (hsh === '#/orders' && path.startsWith('#/order/')));
      });
      const att = ctx.attention();
      const late = att.filter(x => x.s.level === 'late' || x.s.level === 'critical').length;
      counts.attention.textContent = att.length || ''; counts.attention.hidden = !att.length;
      counts.attention.classList.toggle('hot', late > 0);
      counts.all.textContent = ctx.active().length;
      const arch = ctx.orders.filter(o => o.archived_at && !o.deleted_at).length;
      counts.archive.textContent = arch || ''; counts.archive.hidden = !arch;
      const tr = ctx.orders.filter(o => o.deleted_at).length;
      counts.trash.textContent = tr || ''; counts.trash.hidden = !tr;
      side.querySelector('.who').textContent = ctx.name;
      meta.textContent = ctx.loadedAt ? `עודכן ${ctx.loadedAt.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : '';
    },
  };
}

async function logout() {
  await ctx.api.logout();
  shell = null;
  render();
}

// ---------------------------------------------------------------- login
function renderLogin() {
  shell = null;
  const shared = !!ctx.api.loginEmail;
  const err = h('div', { class: 'form-err', hidden: true, role: 'alert' });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit', style: { padding: '11px' } }, 'כניסה');
  const form = h('form', { novalidate: true },
    h('div', null, h('h1', null, 'כניסה למערכת'), h('div', { class: 'sub' }, 'ניהול הזמנות, סטטוסים וגבייה')),
    field('השם שלך', h('input', { id: 'login_name', autocomplete: 'name', value: ctx.name, required: true }), { hint: 'יופיע בהיסטוריית השינויים' }),
    shared && ctx.api.mode === 'live' ? null : (ctx.api.mode === 'live' ? field('מייל', h('input', { id: 'login_email', type: 'email', autocomplete: 'username', dir: 'ltr' })) : null),
    field('סיסמה', h('input', { id: 'login_pass', type: 'password', autocomplete: 'current-password', dir: 'ltr', required: true }),
      { hint: ctx.api.mode === 'demo' ? 'במצב הדגמה: demo' : null }),
    err, btn,
  );
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name = form.querySelector('#login_name').value.trim();
    const pass = form.querySelector('#login_pass').value;
    const email = form.querySelector('#login_email')?.value.trim();
    err.hidden = true;
    if (!name) { err.textContent = 'יש להזין שם.'; err.hidden = false; return; }
    if (!pass) { err.textContent = 'יש להזין סיסמה.'; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'מתחבר…';
    try {
      await ctx.api.login(email, pass);
      ctx.name = name; store.set('amadora.name', name);
      await ctx.refresh(false);
      render();
    } catch (ex) {
      err.textContent = ex.message || 'הכניסה נכשלה.'; err.hidden = false;
      btn.disabled = false; btn.textContent = 'כניסה';
    }
  });
  const gem = icon('gem', 380); gem.classList.add('gem');
  root.replaceChildren(h('div', { class: 'login' },
    h('div', { class: 'login-art' },
      h('div', null,
        h('div', { class: 'brand-mark', style: { 'justify-content': 'flex-start' } }, h('span', { style: { color: 'var(--gold)' } }, icon('gem', 26)), h('span', { class: 'brand-word' }, 'AMADORA')),
        h('div', { class: 'brand-sub', style: { 'text-align': 'right', 'margin-top': '8px' } }, 'מערכת ניהול הזמנות')),
      h('p', null, 'כל הזמנה, מהרגע שנכנסה ועד שהתכשיט אצל הלקוח: סטטוס, זמן אספקה וגבייה במקום אחד.'),
      gem),
    h('div', { class: 'login-form' }, form)));
  setTimeout(() => form.querySelector(ctx.name ? '#login_pass' : '#login_name')?.focus(), 30);
}

// ---------------------------------------------------------------- boot
async function boot() {
  ctx.cfg = await loadConfig();
  ctx.api = makeApi(ctx.cfg);
  if (ctx.api.loggedIn && ctx.name) {
    try { await ctx.refresh(false); } catch (e) { if (!(e instanceof AuthError)) { console.error(e); toast('לא הצלחנו לטעון נתונים. בדקו את החיבור לאינטרנט.', true); } }
  }
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
  render();

  // keep data fresh for everyone working at the same time
  const tick = async () => {
    if (document.hidden || !ctx.api.loggedIn || !ctx.name) return;
    const busy = document.querySelector('.modal-bg') || document.activeElement?.closest?.('form, .field') || routePath().startsWith('orders/new') || routePath() === 'settings';
    try { await ctx.refresh(false); } catch (e) { if (e instanceof AuthError) return render(); return; }
    if (!busy) render(); else { ctx.stale = true; shell?.update(); }
  };
  setInterval(tick, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
boot();

export { ctx, STATUSES, collection, fmtDate };

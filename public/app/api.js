// Data access. "live" talks to Supabase over its REST API; "demo" keeps data in memory (used locally and
// when the site has not been configured yet). Both expose the same methods.
import { guardRow, num, STATUSES, todayISO, NEEDS_PAYMENT2 } from './logic.js';

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export class AuthError extends Error {}

export async function loadConfig() {
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    if (r.ok) {
      const c = await r.json();
      if (c.supabaseUrl && c.supabaseKey) return { ...c, mode: 'live' };
      return { mode: 'demo', reason: 'not-configured' };
    }
  } catch { /* offline or local static server */ }
  return { mode: 'demo', reason: 'local' };
}

function friendly(j, status) {
  const m = j && (j.message || j.msg || j.error_description || j.hint);
  if (j && j.code === '23505') return 'מספר ההזמנה הזה כבר קיים.';
  if (j && j.code === '23514') return 'אחד הערכים אינו תקין (למשל סכום שלילי).';
  if (status === 403 || (j && j.code === '42501')) return 'אין הרשאה לפעולה הזו.';
  return m || `שגיאה בשמירה (${status}).`;
}

// ===================================================================== LIVE
class Live {
  constructor(cfg) {
    this.mode = 'live';
    this.url = cfg.supabaseUrl.replace(/\/+$/, '');
    this.key = cfg.supabaseKey;
    this.loginEmail = cfg.loginEmail || '';
    try { this.session = JSON.parse(store.get('amadora.session') || 'null'); } catch { this.session = null; }
  }
  get loggedIn() { return !!this.session?.refresh_token; }
  saveSession(j) {
    this.session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 };
    store.set('amadora.session', JSON.stringify(this.session));
  }
  clearSession() { this.session = null; store.del('amadora.session'); }

  async auth(grant, body) {
    const r = await fetch(`${this.url}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST', headers: { apikey: this.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  }
  async login(email, password) {
    const { ok, status, j } = await this.auth('password', { email: email || this.loginEmail, password });
    if (!ok) throw new Error(status === 400 ? 'הסיסמה שגויה.' : (j.error_description || j.msg || 'הכניסה נכשלה. נסו שוב.'));
    this.saveSession(j);
  }
  async logout() {
    const tok = this.session?.access_token;
    this.clearSession();
    if (tok) fetch(`${this.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: this.key, Authorization: `Bearer ${tok}` } }).catch(() => {});
  }
  async token() {
    if (!this.session) throw new AuthError('not logged in');
    if (Date.now() > this.session.expires_at - 60_000) {
      if (!this._refreshing) {
        this._refreshing = this.auth('refresh_token', { refresh_token: this.session.refresh_token })
          .then(({ ok, j }) => { if (!ok) { this.clearSession(); throw new AuthError('expired'); } this.saveSession(j); })
          .finally(() => { this._refreshing = null; });
      }
      await this._refreshing;
    }
    return this.session.access_token;
  }
  async req(path, { method = 'GET', body, prefer, headers = {} } = {}) {
    const tok = await this.token();
    const r = await fetch(`${this.url}/rest/v1/${path}`, {
      method,
      headers: { apikey: this.key, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 401) { this.clearSession(); throw new AuthError('expired'); }
    const txt = await r.text();
    let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { j = { message: txt }; }
    if (!r.ok) throw new Error(friendly(j, r.status));
    return j;
  }
  async all(path) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const page = await this.req(path, { headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
      out.push(...page);
      if (page.length < 1000) return out;
    }
  }
  listOrders() { return this.all('orders?select=*&order=order_number.desc'); }
  events(orderId) { return this.req(`order_events?order_id=eq.${orderId}&order=at.desc,id.desc`); }
  statusEvents() { return this.all('order_events?type=eq.status&select=order_id,at,from_status,to_status&order=at.asc,id.asc'); }
  async createOrder(data) { return (await this.req('orders', { method: 'POST', body: data, prefer: 'return=representation' }))[0]; }
  async updateOrder(id, patch) {
    const rows = await this.req(`orders?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
    if (!rows?.length) throw new Error('ההזמנה לא נמצאה.');
    return rows[0];
  }
  deleteForever(id) { return this.req(`orders?id=eq.${id}`, { method: 'DELETE' }); }
  async getSettings() { return (await this.req('settings?id=eq.1'))[0] || null; }
  async updateSettings(p) { return (await this.req('settings?id=eq.1', { method: 'PATCH', body: p, prefer: 'return=representation' }))[0]; }
  holidays() { return this.req('holidays?order=day.asc'); }
  addHoliday(day, name) { return this.req('holidays', { method: 'POST', body: { day, name }, prefer: 'resolution=merge-duplicates' }); }
  removeHoliday(day) { return this.req(`holidays?day=eq.${day}`, { method: 'DELETE' }); }
}

// ===================================================================== DEMO
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const daysAgo = n => { const d = new Date(Date.parse(todayISO() + 'T00:00:00Z') - n * 86400000); return d.toISOString().slice(0, 10); };

function demoSeed() {
  const imp = [
    [2715, '2026-10-04', 'טלי צורבל', 'זוג עגילים 0.30 + 0.15 בודד\nאלגריסי 0.30 *2\nבודד 0.15 * 1 - אלגריסי', 2000, '2000 בהעברה'],
    [2716, '2026-10-04', 'ליהיא קלוו', 'תיקון מידה לטבעת', 0, null],
    [2717, '2026-10-04', 'ניצן שטיינברג', 'שרשרת MOM בלי לב + צארם אות L', 4100, 'שילם 2050 במורנינג'],
    [2718, '2026-10-04', 'לוסי', 'צמיד טניס תיקון', 0, null],
    [2719, '2026-10-05', 'בת שבע', 'עגילי פסים', 0, null],
    [2720, '2026-10-05', 'בת שבע', 'שיבוץ אבן בטבעת', 0, null],
    [2721, '2026-10-05', 'ורד שרון', 'הוספת אות R', 1600, 'שולם באשראי'],
  ].map(([n, d, c, desc, sale, leg]) => ({
    order_number: n, entered_at: d, customer_name: c, description: desc, sale_price: sale, legacy_payment_note: leg,
    is_import: true, status: null, created_by_name: 'ייבוא מאקסל',
  }));
  const ex = (n, ago, name, desc, status, sale, p1, m1, extra = {}) => ({
    order_number: n, entered_at: daysAgo(ago), customer_name: name, description: desc, status, sale_price: sale,
    payment1_amount: p1, payment1_method: m1, payment1_invoice: true, cost_lior: Math.round(sale * 0.22), cost_diamonds: Math.round(sale * 0.3),
    is_import: false, created_by_name: 'דוגמה', source: 'אינסטגרם', ...extra,
  });
  const rows = [...imp,
    ex(2772, 1, 'לקוחה לדוגמה א׳', 'טבעת סוליטר 1.00 קראט, זהב לבן 14K', 'new', 6900, 3450, 'העברה בנקאית'),
    ex(2773, 6, 'לקוחה לדוגמה ב׳', 'עגילי טניס 1.5 קראט', 'to_factory', 5200, 2600, 'ביט'),
    ex(2774, 12, 'לקוח לדוגמה ג׳', 'טבעת נישואין חרוטה', 'factory', 2400, 1200, 'אשראי'),
    ex(2775, 17, 'לקוחה לדוגמה ד׳', 'שרשרת אות + יהלום 0.10', 'factory', 1900, 950, 'מזומן'),
    ex(2776, 15, 'לקוחה לדוגמה ה׳', 'צמיד טניס 3 קראט', 'returned', 9800, 4900, 'העברה בנקאית'),
    ex(2777, 13, 'לקוח לדוגמה ו׳', 'טבעת אירוסין Halo', 'ready', 7400, 3700, 'אשראי', { payment2_amount: 3700, payment2_method: 'אשראי', payment2_invoice: true, payment2_at: new Date().toISOString() }),
  ];
  return rows.map(r => ({
    id: uid(), customer_phone: null, source: null, notes: null, cost_lior: 0, cost_diamonds: 0,
    payment1_amount: null, payment1_method: null, payment1_invoice: false,
    payment2_amount: null, payment2_method: null, payment2_invoice: false, payment2_at: null, legacy_payment_note: null,
    archived_at: null, deleted_at: null, delivered_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    status_changed_at: new Date().toISOString(), updated_by_name: r.created_by_name, ...r,
  }));
}

class Demo {
  constructor() {
    this.mode = 'demo';
    this.loginEmail = 'demo';
    this.orders = demoSeed();
    this.evts = [];
    for (const o of this.orders) this.log(o, o.is_import ? 'imported' : 'created', { to_status: o.status, at: o.created_at });
    // backfill status history so the demo stepper and stats have something to show
    for (const o of this.orders.filter(x => x.status)) {
      const idx = STATUSES.findIndex(s => s.key === o.status);
      for (let i = 1; i <= idx; i++) {
        const at = new Date(Date.parse(o.entered_at) + i * 2.2 * 86400000).toISOString();
        this.evts.push({ id: this.evts.length + 1, order_id: o.id, at, actor_name: 'דוגמה', type: 'status', from_status: STATUSES[i - 1].key, to_status: STATUSES[i].key });
      }
    }
    this.settings = { id: 1, vat_rate: 0.18, sla_days: 14, warn_days_1: 6, warn_days_2: 3 };
    this.hol = [['2026-09-12', 'ראש השנה א׳'], ['2026-09-13', 'ראש השנה ב׳'], ['2026-09-21', 'יום כיפור'], ['2026-09-26', 'סוכות'], ['2026-10-03', 'שמיני עצרת / שמחת תורה'],
      ['2027-04-22', 'פסח'], ['2027-04-28', 'שביעי של פסח'], ['2027-05-12', 'יום העצמאות'], ['2027-06-11', 'שבועות']].map(([day, name]) => ({ day, name }));
    this.seq = 2778;
    this.session = store.get('amadora.demo') === '1';
  }
  get loggedIn() { return this.session; }
  async login(_email, password) { if (password !== 'demo') throw new Error('במצב הדגמה הסיסמה היא: demo'); this.session = true; store.set('amadora.demo', '1'); }
  async logout() { this.session = false; store.del('amadora.demo'); }
  log(o, type, extra = {}) { this.evts.push({ id: this.evts.length + 1, order_id: o.id, at: new Date().toISOString(), actor_name: o.updated_by_name, type, ...extra }); }
  clone(x) { return JSON.parse(JSON.stringify(x)); }
  async listOrders() { return this.clone(this.orders).sort((a, b) => b.order_number - a.order_number); }
  async events(id) { return this.clone(this.evts.filter(e => e.order_id === id)).reverse(); }
  async statusEvents() { return this.clone(this.evts.filter(e => e.type === 'status')); }
  async createOrder(d) {
    const row = { id: uid(), is_import: false, status: 'new', cost_lior: 0, cost_diamonds: 0, sale_price: 0, payment1_invoice: false, payment2_invoice: false,
      entered_at: todayISO(), description: '', created_at: new Date().toISOString(), ...d };
    const err = guardRow(row, null); if (err) throw new Error(err);
    if (row.order_number == null) row.order_number = this.seq++;
    if (this.orders.some(o => o.order_number === row.order_number)) throw new Error('מספר ההזמנה הזה כבר קיים.');
    row.created_by_name = row.updated_by_name; row.status_changed_at = row.created_at; row.updated_at = row.created_at;
    this.orders.push(row); this.log(row, 'created', { to_status: row.status, details: { payment1_amount: row.payment1_amount, payment1_method: row.payment1_method } });
    return this.clone(row);
  }
  async updateOrder(id, patch) {
    const i = this.orders.findIndex(o => o.id === id); if (i < 0) throw new Error('ההזמנה לא נמצאה.');
    const prev = this.orders[i], row = { ...prev, ...patch, updated_at: new Date().toISOString() };
    const err = guardRow(row, prev); if (err) throw new Error(err);
    if (row.order_number !== prev.order_number && this.orders.some(o => o.order_number === row.order_number)) throw new Error('מספר ההזמנה הזה כבר קיים.');
    if (row.status !== prev.status) row.status_changed_at = row.updated_at;
    row.delivered_at = row.status === 'with_customer' ? (prev.status === 'with_customer' ? prev.delivered_at : row.updated_at) : null;
    if (num(row.payment2_amount) == null) row.payment2_at = null; else if (num(prev.payment2_amount) == null) row.payment2_at = row.updated_at;
    this.orders[i] = row;
    if (row.status !== prev.status) this.log(row, 'status', { from_status: prev.status, to_status: row.status });
    if (num(row.payment2_amount) != null && num(prev.payment2_amount) == null) this.log(row, 'payment2', { details: { amount: row.payment2_amount, method: row.payment2_method, invoice: row.payment2_invoice } });
    if (row.archived_at !== prev.archived_at) this.log(row, row.archived_at ? 'archived' : 'unarchived');
    if (row.deleted_at !== prev.deleted_at) this.log(row, row.deleted_at ? 'deleted' : 'restored');
    const fields = ['order_number', 'customer_name', 'customer_phone', 'entered_at', 'description', 'source', 'notes', 'cost_lior', 'cost_diamonds', 'sale_price']
      .filter(k => String(row[k] ?? '') !== String(prev[k] ?? ''));
    if (['payment1_amount', 'payment1_method', 'payment1_invoice'].some(k => String(row[k] ?? '') !== String(prev[k] ?? ''))) fields.push('payment1');
    if (num(prev.payment2_amount) != null && ['payment2_amount', 'payment2_method', 'payment2_invoice'].some(k => String(row[k] ?? '') !== String(prev[k] ?? ''))) fields.push('payment2');
    if (fields.length) this.log(row, 'edit', { details: { fields } });
    return this.clone(row);
  }
  async deleteForever(id) {
    const o = this.orders.find(x => x.id === id);
    if (!o?.deleted_at) throw new Error('אפשר למחוק לצמיתות רק הזמנה שנמצאת בסל המחזור.');
    this.orders = this.orders.filter(x => x.id !== id); this.evts = this.evts.filter(e => e.order_id !== id);
  }
  async getSettings() { return { ...this.settings }; }
  async updateSettings(p) { Object.assign(this.settings, p); return { ...this.settings }; }
  async holidays() { return this.clone(this.hol).sort((a, b) => a.day.localeCompare(b.day)); }
  async addHoliday(day, name) { this.hol = this.hol.filter(h => h.day !== day).concat({ day, name }); }
  async removeHoliday(day) { this.hol = this.hol.filter(h => h.day !== day); }
}

export function makeApi(cfg) { return cfg.mode === 'live' ? new Live(cfg) : new Demo(); }
export { NEEDS_PAYMENT2 };

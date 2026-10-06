// Business rules shared by every screen. Pure functions only (no DOM, no network).

export const STATUSES = [
  { key: 'new',           step: 1, group: 'משרד',  name: 'הזמנה נכנסה' },
  { key: 'to_factory',    step: 2, group: 'משרד',  name: 'לצורך משלוח למפעל או הכנסת יהלומים' },
  { key: 'factory',       step: 3, group: 'ייצור', name: 'מפעל' },
  { key: 'returned',      step: 4, group: 'משרד',  name: 'חזר ממפעל' },
  { key: 'ready',         step: 5, group: 'מסירה', name: 'מוכן למסירה' },
  { key: 'with_customer', step: 6, group: 'לקוח',  name: 'אצל הלקוח' },
];
export const UNASSIGNED = { key: 'unassigned', step: 0, group: '', name: 'ממתין לשיוך סטטוס' };
export const STATUS_BY_KEY = Object.fromEntries([...STATUSES, UNASSIGNED].map(s => [s.key, s]));
export const statusKey = o => o.status || 'unassigned';
export const statusInfo = keyOrOrder => STATUS_BY_KEY[typeof keyOrOrder === 'string' ? keyOrOrder : statusKey(keyOrOrder)];
export const statusLabel = k => { const s = statusInfo(k); return s.group && s.key !== 'ready' && s.key !== 'with_customer' ? `${s.group} – ${s.name}` : s.name; };
export const nextStatus = o => { const i = STATUSES.findIndex(s => s.key === o.status); return i >= 0 && i < STATUSES.length - 1 ? STATUSES[i + 1] : (o.status ? null : STATUSES[0]); };
export const NEEDS_PAYMENT2 = new Set(['ready', 'with_customer']);
export const FIRST_ORDER_NUMBER = 2772;

export const PAYMENT_METHODS = ['מזומן', 'העברה בנקאית', 'אשראי', 'שת"פ', 'פייבוקס', 'ביט', 'אתר'];

// ---------- Numbers & money ----------
export const num = v => (v === '' || v == null || Number.isNaN(+v)) ? null : +v;
const ils = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const ils0 = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
export const money = v => v == null ? '—' : ils.format(Math.round(+v * 100) / 100);
export const money0 = v => v == null ? '—' : ils0.format(Math.round(+v));
export const pct = v => v == null || !isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`;

export function financials(o, vat = 0.18) {
  const sale = +o.sale_price || 0;
  const preVat = sale / (1 + vat);
  const costs = (+o.cost_lior || 0) + (+o.cost_diamonds || 0);
  const profit = preVat - costs;
  return { sale, preVat, costs, profit, margin: preVat > 0 ? profit / preVat : null };
}

// ---------- Collection (גבייה) ----------
export function collection(o) {
  const sale = +o.sale_price || 0;
  const p1 = num(o.payment1_amount), p2 = num(o.payment2_amount);
  const paid = (p1 || 0) + (p2 || 0);
  if (p1 == null && p2 == null) {
    return o.is_import
      ? { key: 'unknown', label: 'תשלום לא הוזן', tone: 'muted', paid, balance: sale }
      : { key: 'none', label: 'טרם שולם', tone: 'muted', paid, balance: sale };
  }
  const balance = Math.round((sale - paid) * 100) / 100;
  if (p2 != null) {
    if (Math.abs(balance) < 0.5) return { key: 'paid', label: 'שולם במלואו', tone: 'ok', paid, balance: 0 };
    return balance > 0
      ? { key: 'diff', label: `הפרש: חסר ${money0(balance)}`, tone: 'crit', paid, balance }
      : { key: 'diff', label: `הפרש: עודף ${money0(-balance)}`, tone: 'warn', paid, balance };
  }
  if (sale > 0 && paid >= sale) return { key: 'paid', label: 'שולם במלואו', tone: 'ok', paid, balance: 0 };
  if (paid > 0) return { key: 'deposit', label: 'מקדמה שולמה', tone: 'warn', paid, balance };
  return { key: 'none', label: 'טרם שולם', tone: 'muted', paid, balance };
}
export const suggestedRemainder = o => Math.max(0, Math.round(((+o.sale_price || 0) - (num(o.payment1_amount) || 0)) * 100) / 100);

// ---------- Dates & business days ----------
const DAY = 86400000;
const israelFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });
export const israelDate = ts => israelFmt.format(ts ? new Date(ts) : new Date());
export const todayISO = () => israelDate();
const t = iso => Date.parse(iso + 'T00:00:00Z');
const iso = ms => new Date(ms).toISOString().slice(0, 10);
export const weekday = d => new Date(t(d)).getUTCDay(); // 0 = Sunday
export const isBusinessDay = (d, holidays) => { const w = weekday(d); return w !== 5 && w !== 6 && !holidays.has(d); };

/** Business days in (start, end] — the entry day itself is not counted. */
export function businessDaysBetween(start, end, holidays) {
  let n = 0;
  for (let x = t(start) + DAY, e = t(end); x <= e; x += DAY) if (isBusinessDay(iso(x), holidays)) n++;
  return n;
}
/** The date on which `k` business days have passed since `start`. */
export function addBusinessDays(start, k, holidays) {
  let x = t(start), n = 0;
  while (n < k) { x += DAY; if (isBusinessDay(iso(x), holidays)) n++; }
  return iso(x);
}

/** Delivery commitment status for an order. */
export function sla(o, settings, holidays, today = todayISO()) {
  if (!o.entered_at) return null;
  const days = settings?.sla_days ?? 14, w1 = settings?.warn_days_1 ?? 6, w2 = settings?.warn_days_2 ?? 3;
  const stopAt = o.delivered_at || o.archived_at;
  const end = stopAt ? israelDate(stopAt) : today;
  const elapsed = businessDaysBetween(o.entered_at, end, holidays);
  const remaining = days - elapsed;
  const due = addBusinessDays(o.entered_at, days, holidays);
  let level = 'ok';
  if (stopAt) level = 'stopped';
  else if (remaining < 0) level = 'late';
  else if (remaining <= w2) level = 'critical';
  else if (remaining <= w1) level = 'warn';
  return { days, elapsed, remaining, due, level, stopped: !!stopAt, onTime: elapsed <= days };
}
export const SLA_TONE = { ok: 'ok', warn: 'warn', critical: 'crit', late: 'late', stopped: 'muted' };
export function slaShort(s) {
  if (!s) return '';
  if (s.stopped) return s.onTime ? `נמסר אחרי ${s.elapsed} ימים` : `נמסר באיחור (${s.elapsed} ימים)`;
  if (s.remaining < 0) return `באיחור של ${-s.remaining} ${-s.remaining === 1 ? 'יום' : 'ימים'}`;
  if (s.remaining === 0) return 'יום אחרון לאספקה';
  return `נותרו ${s.remaining} ${s.remaining === 1 ? 'יום' : 'ימים'}`;
}
/** Sort key: most urgent first; delivered/archived last. */
export const urgency = s => !s ? 1e6 : s.stopped ? 1e5 + s.elapsed : s.remaining;

const HE_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const fmtDate = d => { if (!d) return '—'; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${+dd}.${+m}.${y.slice(2)}`; };
export const fmtDateLong = d => d ? `יום ${HE_DAYS[weekday(String(d).slice(0, 10))]} ${fmtDate(d)}` : '—';
export const fmtDateTime = ts => {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${fmtDate(israelDate(d))} · ${d.toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' })}`;
};

// ---------- Validation (mirrors the database rules, for immediate feedback) ----------
export function validateNewOrder(d) {
  const e = {};
  if (!d.customer_name?.trim()) e.customer_name = 'יש להזין שם לקוח.';
  if (num(d.payment1_amount) == null) e.payment1_amount = 'יש להזין כמה שולם (אפשר 0).';
  else if (num(d.payment1_amount) < 0) e.payment1_amount = 'הסכום לא יכול להיות שלילי.';
  if (num(d.payment1_amount) > 0 && !d.payment1_method) e.payment1_method = 'יש לבחור איך שולם.';
  for (const k of ['sale_price', 'cost_lior', 'cost_diamonds']) if (num(d[k]) != null && num(d[k]) < 0) e[k] = 'הסכום לא יכול להיות שלילי.';
  return e;
}
export function validatePayment2(d) {
  const e = {};
  if (num(d.payment2_amount) == null) e.payment2_amount = 'יש להזין כמה נותר לשלם (אפשר 0).';
  else if (num(d.payment2_amount) < 0) e.payment2_amount = 'הסכום לא יכול להיות שלילי.';
  if (num(d.payment2_amount) > 0 && !d.payment2_method) e.payment2_method = 'יש לבחור איך שולם.';
  return e;
}
/** Full rule check for a row about to be saved (used by demo mode as the "database"). */
export function guardRow(row, prev) {
  if (!row.customer_name?.trim()) return 'יש להזין שם לקוח.';
  if (!prev && !row.is_import && num(row.payment1_amount) == null) return 'יש להזין כמה שולם בפתיחת ההזמנה (אפשר להזין 0).';
  if (prev && !row.is_import && num(row.payment1_amount) == null) return 'לא ניתן למחוק את סכום המקדמה (אפשר להזין 0).';
  if (num(row.payment1_amount) > 0 && !row.payment1_method) return 'יש לבחור איך שולמה המקדמה.';
  if (NEEDS_PAYMENT2.has(row.status) && num(row.payment2_amount) == null) return 'לפני מעבר ל"מוכן למסירה" יש להזין את השלמת התשלום: כמה נותר לשלם, איך שולם והאם יצאה חשבונית.';
  if (num(row.payment2_amount) > 0 && !row.payment2_method) return 'יש לבחור איך שולמה השלמת התשלום.';
  return null;
}

export const FIELD_LABELS = {
  order_number: 'מספר הזמנה', customer_name: 'שם לקוח', customer_phone: 'טלפון', entered_at: 'תאריך כניסה', description: 'פירוט',
  source: 'דרך מי הגיע', notes: 'הערות', cost_lior: 'עלות ליאור', cost_diamonds: 'עלות יהלומים', sale_price: 'מחיר מכירה',
  payment1: 'פרטי מקדמה', payment2: 'פרטי השלמת תשלום',
};

export function matchesQuery(o, q) {
  if (!q) return true;
  const s = q.trim().toLowerCase();
  return String(o.order_number).includes(s) || (o.customer_name || '').toLowerCase().includes(s)
    || (o.description || '').toLowerCase().includes(s) || (o.customer_phone || '').replace(/\D/g, '').includes(s.replace(/\D/g, '') || '\u0000')
    || (o.notes || '').toLowerCase().includes(s);
}

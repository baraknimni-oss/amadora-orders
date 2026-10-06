// Integration endpoint for outside systems (ManyChat / WhatsApp bot, Shopify, Make, Zapier…).
//
//   GET  /api/orders?number=2772            → status of one order (for "where is my order?" bots)
//   POST /api/orders   { customer_name, payment1_amount, payment1_method, ... }   → opens a new order
//
// Every call must send the header:  x-api-key: <INTEGRATION_API_KEY>
// Required Vercel environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGRATION_API_KEY.
// The same database rules apply as in the app (a deposit is required, numbering continues automatically, history is logged).

const STATUS = {
  new: 'משרד – הזמנה נכנסה', to_factory: 'משרד – לצורך משלוח למפעל או הכנסת יהלומים', factory: 'ייצור – מפעל',
  returned: 'משרד – חזר ממפעל', ready: 'מוכן למסירה', with_customer: 'אצל הלקוח',
};
const ALLOWED = ['customer_name', 'customer_phone', 'description', 'source', 'notes', 'sale_price', 'cost_lior', 'cost_diamonds',
  'payment1_amount', 'payment1_method', 'payment1_invoice', 'entered_at'];

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGRATION_API_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !INTEGRATION_API_KEY) {
    return res.status(503).json({ error: 'החיבור החיצוני עדיין לא הוגדר (חסרים משתני סביבה ב-Vercel).' });
  }
  if (!timingSafeEqual(req.headers['x-api-key'] || '', INTEGRATION_API_KEY)) {
    return res.status(401).json({ error: 'מפתח API שגוי.' });
  }
  const base = SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1';
  const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };

  try {
    if (req.method === 'GET') {
      const n = parseInt(req.query.number, 10);
      if (!n) return res.status(400).json({ error: 'יש לשלוח number.' });
      const r = await fetch(`${base}/orders?order_number=eq.${n}&deleted_at=is.null&select=order_number,customer_name,status,entered_at,delivered_at,archived_at`, { headers });
      const rows = await r.json();
      if (!r.ok) return res.status(502).json({ error: rows.message || 'שגיאה בבסיס הנתונים.' });
      if (!rows.length) return res.status(404).json({ error: 'ההזמנה לא נמצאה.' });
      const o = rows[0];
      return res.status(200).json({ ...o, status_label: o.status ? STATUS[o.status] : 'בטיפול' });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const row = {};
      for (const k of ALLOWED) if (body[k] !== undefined) row[k] = body[k];
      row.updated_by_name = `חיבור חיצוני${body.source ? `: ${String(body.source).slice(0, 40)}` : ''}`;
      const r = await fetch(`${base}/orders`, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(row) });
      const out = await r.json();
      if (!r.ok) return res.status(400).json({ error: out.message || 'ההזמנה לא נפתחה.' });
      return res.status(201).json({ order_number: out[0].order_number, status_label: STATUS[out[0].status] });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'שגיאה פנימית.' });
  }
};

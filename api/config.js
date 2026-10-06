// Returns the public connection settings to the browser.
// Values come from Vercel → Project → Settings → Environment Variables.
// SUPABASE_ANON_KEY is the public ("anon" / "publishable") key: it is safe to expose, access is enforced by the database rules.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_ANON_KEY || '',
    loginEmail: process.env.LOGIN_EMAIL || '',
  });
};

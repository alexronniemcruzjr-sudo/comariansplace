const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const anonSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function verifyAuth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await anonSupabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

const PRICE_FIELDS = [
  'peak_weekday', 'peak_fri_sun', 'peak_saturday',
  'offpeak_weekday', 'offpeak_fri_sun', 'offpeak_saturday',
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Rate sheets (table: rate_settings, see supabase/migrations/0002_rate_settings.sql).
// Each row is a full rate sheet applying to STAY NIGHTS on or after effective_from;
// the site uses the latest row whose effective_from <= the night.
//
//   GET    (public) — all sheets, oldest first. index.html falls back to its
//                     built-in RATES if this fails or returns nothing.
//   POST   (admin)  — create, or replace the sheet with the same effective_from.
//   DELETE (admin)  — remove a sheet by id (the last remaining one is kept).
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('rate_settings')
      .select('*')
      .order('effective_from', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    return res.status(200).json({ sheets: data || [] });
  }

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!DATE_RE.test(body.effective_from || '')) {
      return res.status(400).json({ error: 'effective_from must be a date (YYYY-MM-DD)' });
    }

    const row = { effective_from: body.effective_from };
    for (const f of PRICE_FIELDS) {
      const n = Number(body[f]);
      if (!Number.isInteger(n) || n < 1000 || n > 200000) {
        return res.status(400).json({ error: `${f} must be a whole peso amount between 1,000 and 200,000` });
      }
      row[f] = n;
    }

    const months = Array.isArray(body.peak_months) ? body.peak_months.map(Number) : [];
    if (months.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) {
      return res.status(400).json({ error: 'peak_months must be month numbers 1-12' });
    }
    row.peak_months = [...new Set(months)].sort((a, b) => a - b);

    const dates = Array.isArray(body.extra_peak_dates) ? body.extra_peak_dates : [];
    if (dates.some((d) => !DATE_RE.test(d))) {
      return res.status(400).json({ error: 'extra_peak_dates must be dates (YYYY-MM-DD)' });
    }
    row.extra_peak_dates = [...new Set(dates)].sort();

    const { data, error } = await supabase
      .from('rate_settings')
      .upsert(row, { onConflict: 'effective_from' })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    const id = (req.body && req.body.id) || (req.query && req.query.id);
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { count } = await supabase
      .from('rate_settings')
      .select('id', { count: 'exact', head: true });
    if (count !== null && count <= 1) {
      return res.status(400).json({ error: 'Cannot delete the only rate sheet' });
    }

    const { error } = await supabase.from('rate_settings').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

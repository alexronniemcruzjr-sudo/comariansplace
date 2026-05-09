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

// Admin-only history search across both `bookings` (live) and
// `bookings_archive` (auto-archived on DELETE via Postgres trigger
// installed by supabase/migrations/0001_bookings_archive.sql).
//
// Used when a guest sends an old receipt screenshot and Doc/owner
// needs to confirm whether they ever actually submitted through the
// site. Without this, deleted bookings are invisible.
//
// Usage: GET /api/admin-search?q=<text>
// Searches: guest_name (case-insensitive prefix), email (exact-ish),
//           phone (exact-ish). Returns up to 25 most-recent matches
//           from each table, merged + sorted by created_at DESC.
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const q = (req.query && req.query.q ? String(req.query.q) : '').trim();
  if (!q) return res.status(200).json({ results: [], query: '' });
  if (q.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }

  // Build OR filter: name ILIKE %q%, OR email ILIKE %q%, OR phone ILIKE %q%
  const safe = q.replace(/[,()*]/g, ''); // strip PostgREST-special chars
  const orFilter = `guest_name.ilike.*${safe}*,email.ilike.*${safe}*,phone.ilike.*${safe}*`;

  const [live, archived] = await Promise.all([
    supabase
      .from('bookings')
      .select('id,guest_name,email,phone,check_in,check_out,guests,room_type,total_price,payment_status,payment_proof_url,created_at')
      .or(orFilter)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('bookings_archive')
      .select('id,guest_name,email,phone,check_in,check_out,guests,room_type,total_price,payment_status,payment_proof_url,created_at,archived_at,archive_reason')
      .or(orFilter)
      .order('archived_at', { ascending: false })
      .limit(25),
  ]);

  if (live.error || archived.error) {
    return res.status(500).json({
      error: 'Search failed',
      detail: live.error?.message || archived.error?.message,
    });
  }

  const results = [
    ...(live.data || []).map((b) => ({ ...b, source: 'live' })),
    ...(archived.data || []).map((b) => ({ ...b, source: 'archived' })),
  ].sort((a, b) => {
    const ta = new Date(a.archived_at || a.created_at).getTime();
    const tb = new Date(b.archived_at || b.created_at).getTime();
    return tb - ta;
  });

  return res.status(200).json({ query: q, results });
};

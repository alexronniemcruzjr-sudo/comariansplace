const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const today = new Date().toISOString().split('T')[0];

  // Block dates for:
  //   1. Confirmed bookings — payment_status in (partial, paid)
  //   2. Pending bookings WITH proof uploaded — provisional lock until owner
  //      verifies in admin. Cleanup auto-removes after 24h30m if owner ignores.
  // Pending without proof still does NOT block — first to upload proof wins.
  // (Rule changed 2026-05 — old comment said "first to pay wins"; updated because
  // owner can't verify within minutes of upload, so legit paid guests were seeing
  // their dates listed as available and overlapping inquiries kept rolling in.)
  const [{ data: confirmed, error: e1 }, { data: pendingWithProof, error: e2 }] =
    await Promise.all([
      supabase
        .from('bookings')
        .select('check_in, check_out')
        .in('payment_status', ['partial', 'paid'])
        .gte('check_out', today),
      supabase
        .from('bookings')
        .select('check_in, check_out')
        .eq('payment_status', 'pending')
        .not('payment_proof_url', 'is', null)
        .gte('check_out', today),
    ]);

  if (e1 || e2) return res.status(500).json({ error: (e1 || e2).message });

  const data = [...(confirmed || []), ...(pendingWithProof || [])];

  // Build array of all blocked dates (each day between check_in and check_out - 1)
  const blocked = [];
  for (const booking of data) {
    const start = new Date(booking.check_in + 'T00:00:00');
    const end = new Date(booking.check_out + 'T00:00:00');
    const current = new Date(start);
    while (current < end) {
      const dateStr = current.toISOString().split('T')[0];
      if (!blocked.includes(dateStr)) {
        blocked.push(dateStr);
      }
      current.setDate(current.getDate() + 1);
    }
  }

  // Cache for 5 minutes
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
  return res.status(200).json({ blocked });
};

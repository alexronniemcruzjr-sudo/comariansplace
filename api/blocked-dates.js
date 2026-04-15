const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const today = new Date().toISOString().split('T')[0];

  // Get all confirmed bookings (not cancelled) with check_out >= today
  const { data, error } = await supabase
    .from('bookings')
    .select('check_in, check_out')
    .gte('check_out', today)
    .order('check_in', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

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

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

// Admin-only endpoint to block a date manually for a guest who paid via
// Messenger / offline (i.e. before the system was tracking them).
// Creates a booking already marked as 'paid' so the date instantly blocks
// on the public calendar.
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { guest_name, check_in, check_out, note } = req.body || {};
  if (!guest_name || !check_in || !check_out) {
    return res.status(400).json({ error: 'guest_name, check_in, and check_out are required' });
  }
  if (check_out <= check_in) {
    return res.status(400).json({ error: 'check_out must be after check_in' });
  }

  // Prevent overlap with another paid booking
  const { data: conflicts } = await supabase
    .from('bookings')
    .select('id, guest_name')
    .in('payment_status', ['partial', 'paid'])
    .lt('check_in', check_out)
    .gt('check_out', check_in);

  if (conflicts && conflicts.length > 0) {
    return res.status(409).json({
      error: `Date already booked by ${conflicts[0].guest_name}`,
      conflict: conflicts[0],
    });
  }

  const { data, error } = await supabase
    .from('bookings')
    .insert([{
      guest_name,
      email: 'manual@comariansplace.local',
      phone: '',
      check_in,
      check_out,
      guests: 1,
      room_type: 'Manual Block',
      total_price: 0,
      payment_status: 'paid',
      notes: note || 'Manually blocked by admin (offline payment)',
    }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Clear any other pending bookings that overlap (losers from prior inquiries)
  await supabase
    .from('bookings')
    .delete()
    .eq('payment_status', 'pending')
    .lt('check_in', check_out)
    .gt('check_out', check_in);

  return res.status(201).json(data);
};

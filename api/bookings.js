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

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // POST — Create booking (public)
  if (req.method === 'POST') {
    const { guest_name, email, phone, check_in, check_out, guests, room_type, total_price } = req.body;

    if (!guest_name || !email || !check_in || !check_out || !room_type || !total_price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data, error } = await supabase
      .from('bookings')
      .insert([{ guest_name, email, phone, check_in, check_out, guests: guests || 1, room_type, total_price }])
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  // All other methods require auth
  const user = await verifyAuth(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // GET — List all bookings
  if (req.method === 'GET') {
    const { status, upcoming } = req.query;
    let query = supabase.from('bookings').select('*').order('check_in', { ascending: true });

    if (status) {
      query = query.eq('payment_status', status);
    }
    if (upcoming === 'true') {
      query = query.gte('check_in', new Date().toISOString().split('T')[0]);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // PATCH — Update booking
  if (req.method === 'PATCH') {
    const { id, ...updates } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing booking id' });

    const allowed = ['payment_status', 'dp_paid', 'security_deposit_paid', 'payment_proof_url', 'reminder_sent', 'notes', 'guests'];
    const filtered = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) filtered[key] = updates[key];
    }

    const { data, error } = await supabase
      .from('bookings')
      .update(filtered)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // DELETE — Delete booking
  if (req.method === 'DELETE') {
    const id = (req.body && req.body.id) || (req.query && req.query.id);
    if (!id) return res.status(400).json({ error: 'Missing booking id' });

    const { error } = await supabase.from('bookings').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

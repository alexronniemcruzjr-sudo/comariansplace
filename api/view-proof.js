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
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  let path = req.query.path;
  const url = req.query.url;

  if (!path && url) {
    const match = String(url).match(/\/payment-proofs\/(.+?)(?:\?|$)/);
    if (match) path = decodeURIComponent(match[1]);
  }

  if (!path) return res.status(400).json({ error: 'Missing path or url' });

  const { data, error } = await supabase.storage
    .from('payment-proofs')
    .createSignedUrl(path, 300);

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ url: data.signedUrl });
};

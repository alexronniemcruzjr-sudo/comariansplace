const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const NO_PROOF_TTL_MS = 30 * 60 * 1000;            // 30 minutes
const WITH_PROOF_TTL_MS = (24 * 60 + 30) * 60 * 1000; // 24h30m upper bound

// Deletes expired pending bookings. Two rules:
//   - Pending + no proof uploaded: delete if created_at older than 30 minutes
//   - Pending + proof uploaded:    delete if created_at older than 24h 30m
//                                  (owner had a day to verify, never did)
// Runs via direct call or piggybacks on other API endpoints (see runCleanup export).
async function runCleanup() {
  const now = Date.now();
  const noProofCutoff = new Date(now - NO_PROOF_TTL_MS).toISOString();
  const withProofCutoff = new Date(now - WITH_PROOF_TTL_MS).toISOString();

  const [r1, r2] = await Promise.all([
    supabase
      .from('bookings')
      .delete()
      .eq('payment_status', 'pending')
      .is('payment_proof_url', null)
      .lt('created_at', noProofCutoff)
      .select('id'),
    supabase
      .from('bookings')
      .delete()
      .eq('payment_status', 'pending')
      .not('payment_proof_url', 'is', null)
      .lt('created_at', withProofCutoff)
      .select('id'),
  ]);

  const deleted = [
    ...(r1.data || []),
    ...(r2.data || []),
  ];
  const errs = [r1.error, r2.error].filter(Boolean);
  return { deleted, errors: errs };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Optional secret guard — only enforced if env var is set
  const expectedSecret = process.env.CLEANUP_SECRET;
  const providedSecret =
    req.headers['x-cleanup-secret'] ||
    (req.query && req.query.secret);

  if (expectedSecret && providedSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { deleted, errors } = await runCleanup();
  if (errors.length) {
    return res.status(500).json({ error: errors.map((e) => e.message).join('; ') });
  }
  return res.status(200).json({ deleted: deleted.length, bookings: deleted });
};

module.exports.runCleanup = runCleanup;

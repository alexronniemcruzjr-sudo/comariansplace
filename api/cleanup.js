const { createClient } = require('@supabase/supabase-js');
const { notifyOwnerCleanupDigest } = require('./_email');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const NO_PROOF_TTL_MS = 4 * 60 * 60 * 1000;        // 4 hours
const WITH_PROOF_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Deletes expired pending bookings. Two rules:
//   - Pending + no proof uploaded: delete if created_at older than 4 hours
//                                  (was 30 min — too short for slow uploaders / mobile data)
//   - Pending + proof uploaded:    delete if created_at older than 7 days
//                                  (was 24h30m — silently deleted real bookings whose owner
//                                  hadn't verified yet; owner uses offline Messenger/paper
//                                  tracking, so 24h was unrealistic. 7d matches her cadence.)
// Real cases that triggered this widening (2026-05-09):
//   - Anna Francesca Cunanan paid ₱6,750 DP 2026-05-06 9:01 PM, record gone by 2026-05-07
//     before owner could verify in admin. Guest had to be asked to redo the booking form.
//   - Staff "Doc" reported a June 13 double-booking; both records had already been cleaned.
// Runs via direct call or piggybacks on other API endpoints (see runCleanup export).
async function runCleanup() {
  const now = Date.now();
  const noProofCutoff = new Date(now - NO_PROOF_TTL_MS).toISOString();
  const withProofCutoff = new Date(now - WITH_PROOF_TTL_MS).toISOString();

  // Select full rows back so we can email the owner a digest before they're gone.
  // Without this, deleted bookings vanish without any audit trail — a real
  // problem when offline-tracking owner hasn't seen them yet.
  const [r1, r2] = await Promise.all([
    supabase
      .from('bookings')
      .delete()
      .eq('payment_status', 'pending')
      .is('payment_proof_url', null)
      .lt('created_at', noProofCutoff)
      .select('*'),
    supabase
      .from('bookings')
      .delete()
      .eq('payment_status', 'pending')
      .not('payment_proof_url', 'is', null)
      .lt('created_at', withProofCutoff)
      .select('*'),
  ]);

  const deleted = [
    ...(r1.data || []),
    ...(r2.data || []),
  ];
  const errs = [r1.error, r2.error].filter(Boolean);

  // Best-effort notification — don't block on or fail the cleanup if the
  // email send errors (Brevo down, missing API key, etc.). The deletion
  // already happened; we just lose the digest for that one batch.
  if (deleted.length > 0) {
    try {
      await notifyOwnerCleanupDigest(deleted);
    } catch (_) { /* ignore */ }
  }

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

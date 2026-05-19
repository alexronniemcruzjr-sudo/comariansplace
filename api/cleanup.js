const { createClient } = require('@supabase/supabase-js');
const { notifyOwnerCleanupDigest } = require('./_email');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const NO_PROOF_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// Cleanup rule (simplified 2026-05-19 after repeat data-loss incidents):
//
//   ONLY auto-delete pending bookings with NO proof uploaded (after 4h).
//   These are abandoned-cart equivalents — guest filled the form but never
//   paid. Safe to drop.
//
//   NEVER auto-delete pending bookings WITH proof uploaded. A proof upload
//   means the guest sent real money — that record is a REAL reservation
//   and MUST persist until the owner explicitly verifies (→ partial/paid)
//   or explicitly rejects (→ manual delete in admin).
//
// History of why we landed here:
//   - Original: 30 min / 24h30m TTLs. Silently deleted real bookings.
//     Cases: Anna Francesca Cunanan (₱6,750 DP, 2026-05-06).
//   - 2026-05-09 (commit 411d798): Widened to 4h / 7 days + digest email.
//     Bought time but didn't fix root cause — owner does offline tracking
//     and 7 days is still not enough cadence for her to verify in admin.
//   - 2026-05-19: Iza Giron (June 6-7, ₱13,500) and Hazel Calma (May 25-26,
//     ₱11,500) both auto-deleted by the 7-day TTL despite being real,
//     upcoming, proof-uploaded reservations. Owner reported "nagagalit
//     yung mga guest" — calendar unblocked, new guests overbook, refunds
//     and reputation damage. Removing the proof-uploaded TTL entirely.
//
// Side effect: pending+proof bookings can pile up. Mitigation: admin's
// "Pending" filter lists them all sorted by date — owner can bulk-clean
// stale ones manually. Trade-off accepted: over-block > over-cancel.
async function runCleanup() {
  const now = Date.now();
  const noProofCutoff = new Date(now - NO_PROOF_TTL_MS).toISOString();

  const { data, error } = await supabase
    .from('bookings')
    .delete()
    .eq('payment_status', 'pending')
    .is('payment_proof_url', null)
    .lt('created_at', noProofCutoff)
    .select('*');

  const deleted = data || [];
  const errs = error ? [error] : [];

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

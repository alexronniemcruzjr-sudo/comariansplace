-- Bookings archive table + auto-archive trigger
-- Run once in Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run)
--
-- Why: The cleanup job hard-deletes pending bookings past their TTL.
-- Real cases (Anna Francesca 2026-05-06, June 13 phantom overlap) showed
-- that deletion without an audit trail makes triage impossible. This
-- archive table preserves every deleted booking so admin can search
-- history when a guest re-surfaces with an old receipt screenshot.
--
-- Trigger fires on ANY DELETE from bookings (cleanup OR manual admin
-- delete). Archive grows append-only — own a row forever once written.

CREATE TABLE IF NOT EXISTS bookings_archive (
  id              UUID PRIMARY KEY,
  guest_name      TEXT,
  email           TEXT,
  phone           TEXT,
  check_in        DATE,
  check_out       DATE,
  guests          INT,
  room_type       TEXT,
  total_price     NUMERIC,
  payment_status  TEXT,
  payment_proof_url TEXT,
  created_at      TIMESTAMPTZ,
  archived_at     TIMESTAMPTZ DEFAULT NOW(),
  archive_reason  TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookings_archive_email ON bookings_archive (email);
CREATE INDEX IF NOT EXISTS idx_bookings_archive_phone ON bookings_archive (phone);
CREATE INDEX IF NOT EXISTS idx_bookings_archive_archived_at ON bookings_archive (archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_archive_guest_name_lower ON bookings_archive (LOWER(guest_name));

-- Same RLS posture as bookings: service role only. Anon/authenticated
-- have no policies, so PostgREST denies them by default.
ALTER TABLE bookings_archive ENABLE ROW LEVEL SECURITY;

-- Auto-archive any DELETE on bookings.
CREATE OR REPLACE FUNCTION archive_deleted_booking() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO bookings_archive (
    id, guest_name, email, phone, check_in, check_out,
    guests, room_type, total_price, payment_status,
    payment_proof_url, created_at, archive_reason
  ) VALUES (
    OLD.id, OLD.guest_name, OLD.email, OLD.phone, OLD.check_in, OLD.check_out,
    OLD.guests, OLD.room_type, OLD.total_price, OLD.payment_status,
    OLD.payment_proof_url, OLD.created_at,
    CASE
      WHEN OLD.payment_proof_url IS NOT NULL THEN 'auto_with_proof'
      ELSE 'auto_no_proof'
    END
  )
  ON CONFLICT (id) DO NOTHING;  -- if already archived (re-delete edge case), keep first row
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_archive_deleted_booking ON bookings;
CREATE TRIGGER trg_archive_deleted_booking
BEFORE DELETE ON bookings
FOR EACH ROW
EXECUTE FUNCTION archive_deleted_booking();

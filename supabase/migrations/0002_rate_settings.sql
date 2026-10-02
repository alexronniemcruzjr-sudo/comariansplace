-- Rate settings — lets the owner change prices from admin.html without a deploy.
-- Run once in Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run)
--
-- Each row is a full rate sheet that takes effect for STAY NIGHTS on or after
-- effective_from. The site uses the latest row whose effective_from <= the night.
-- If the table is empty or unreachable, index.html falls back to its built-in RATES.

CREATE TABLE IF NOT EXISTS rate_settings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from   DATE NOT NULL UNIQUE,
  peak_weekday     INT NOT NULL,
  peak_fri_sun     INT NOT NULL,
  peak_saturday    INT NOT NULL,   -- also applies to holidays
  offpeak_weekday  INT NOT NULL,
  offpeak_fri_sun  INT NOT NULL,
  offpeak_saturday INT NOT NULL,
  peak_months      INT[] NOT NULL DEFAULT '{4,5,11,12}',
  extra_peak_dates DATE[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Same posture as bookings: service role only, no policies.
ALTER TABLE rate_settings ENABLE ROW LEVEL SECURITY;

-- Seed with the rates live as of 2026-10-01.
INSERT INTO rate_settings
  (effective_from, peak_weekday, peak_fri_sun, peak_saturday,
   offpeak_weekday, offpeak_fri_sun, offpeak_saturday)
VALUES ('2026-10-01', 15000, 17000, 18500, 11500, 12500, 14500)
ON CONFLICT (effective_from) DO NOTHING;

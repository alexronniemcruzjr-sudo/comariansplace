// Shared email helper for Brevo (9K/month free tier).
// Silently no-ops when BREVO_API_KEY is not set so deploys stay green
// until credentials are added.

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'donice23@yahoo.com';
const OWNER_NAME = process.env.OWNER_NAME || "Comarian's Place";
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || OWNER_EMAIL;
const SENDER_NAME = process.env.BREVO_SENDER_NAME || OWNER_NAME;
const SITE_URL = process.env.SITE_URL || 'https://comarians-place.vercel.app';

async function sendMail({ to, toName, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey || !to) return { skipped: true };
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: SENDER_EMAIL, name: SENDER_NAME },
        to: [{ email: to, name: toName || to }],
        subject,
        htmlContent: html,
      }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { error: err.message };
  }
}

function peso(n) {
  return '₱' + Number(n || 0).toLocaleString();
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
}

function referenceFor(booking) {
  if (!booking || !booking.id) return '';
  return 'CP-' + String(booking.id).replace(/-/g, '').slice(0, 8).toUpperCase();
}

const wrapHtml = (body) => `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#2a2018;">
  <div style="background:#3d5a3e;color:#fdfaf5;padding:16px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;font-size:18px;">Comarian's Place</h2>
  </div>
  <div style="background:#fdfaf5;padding:24px;border:1px solid #e8e0d0;border-top:0;border-radius:0 0 8px 8px;">
    ${body}
  </div>
  <p style="font-size:11px;color:#6b5a45;margin-top:12px;text-align:center;">
    Comarian's Place — Sanctuary away from your home<br/>
    <a href="${SITE_URL}" style="color:#6b5a45;">${SITE_URL}</a>
  </p>
</div>`;

// ------- templates -------

async function notifyOwnerNewInquiry(booking) {
  const ref = referenceFor(booking);
  const dp = Math.round((booking.total_price || 0) * 0.5);
  const html = wrapHtml(`
    <h3 style="margin-top:0;">New booking inquiry</h3>
    <p><strong>${booking.guest_name}</strong> (${booking.email}${booking.phone ? ', ' + booking.phone : ''}) just submitted an inquiry.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0;">
      <tr><td style="padding:6px 0;color:#6b5a45;">Reference</td><td style="padding:6px 0;text-align:right;font-family:monospace;">${ref}</td></tr>
      <tr><td style="padding:6px 0;color:#6b5a45;">Check-in</td><td style="padding:6px 0;text-align:right;">${formatDate(booking.check_in)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b5a45;">Check-out</td><td style="padding:6px 0;text-align:right;">${formatDate(booking.check_out)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b5a45;">Guests</td><td style="padding:6px 0;text-align:right;">${booking.guests || 1}</td></tr>
      <tr><td style="padding:6px 0;color:#6b5a45;">Package</td><td style="padding:6px 0;text-align:right;">${booking.room_type}</td></tr>
      <tr><td style="padding:6px 0;color:#6b5a45;">Total stay</td><td style="padding:6px 0;text-align:right;">${peso(booking.total_price)}</td></tr>
      <tr><td style="padding:6px 0;color:#3d5a3e;font-weight:600;">Expected DP (50%)</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#3d5a3e;font-size:16px;">${peso(dp)}</td></tr>
    </table>
    <p style="font-size:13px;color:#92400e;background:#fef3c7;padding:10px 12px;border-radius:6px;">
      ⏰ The guest has 30 minutes to pay the <strong>${peso(dp)} downpayment</strong> and upload their proof. If no proof arrives, the inquiry auto-expires and the date stays open.
    </p>
    <p style="text-align:center;margin-top:20px;">
      <a href="${SITE_URL}/admin.html" style="background:#3d5a3e;color:#fff;padding:10px 22px;text-decoration:none;border-radius:6px;font-size:14px;">Open Admin Panel</a>
    </p>
  `);
  return sendMail({
    to: OWNER_EMAIL,
    toName: OWNER_NAME,
    subject: `New inquiry: ${booking.guest_name} — DP ${peso(dp)} — ${formatDate(booking.check_in)}`,
    html,
  });
}

async function notifyOwnerProofUploaded(booking) {
  const ref = referenceFor(booking);
  const dp = Math.round((booking.total_price || 0) * 0.5);
  const html = wrapHtml(`
    <h3 style="margin-top:0;">Payment proof uploaded</h3>
    <p><strong>${booking.guest_name}</strong> uploaded their downpayment proof. Please verify the screenshot shows <strong>at least ${peso(dp)}</strong> and tap <strong>Mark Paid</strong> in the admin panel to lock the date.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0;">
      <tr><td style="padding:6px 0;color:#6b5a45;">Reference</td><td style="padding:6px 0;text-align:right;font-family:monospace;">${ref}</td></tr>
      <tr><td style="padding:6px 0;color:#6b5a45;">Dates</td><td style="padding:6px 0;text-align:right;">${formatDate(booking.check_in)} → ${formatDate(booking.check_out)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b5a45;">Total stay</td><td style="padding:6px 0;text-align:right;">${peso(booking.total_price)}</td></tr>
      <tr><td style="padding:6px 0;color:#3d5a3e;font-weight:600;">Expected DP (50%)</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#3d5a3e;font-size:16px;">${peso(dp)}</td></tr>
    </table>
    <p style="text-align:center;margin-top:20px;">
      <a href="${SITE_URL}/admin.html" style="background:#3d5a3e;color:#fff;padding:10px 22px;text-decoration:none;border-radius:6px;font-size:14px;">Review in Admin</a>
    </p>
  `);
  return sendMail({
    to: OWNER_EMAIL,
    toName: OWNER_NAME,
    subject: `Proof uploaded: ${booking.guest_name} — DP ${peso(dp)} — ${formatDate(booking.check_in)}`,
    html,
  });
}

async function notifyGuestConfirmed(booking) {
  const ref = referenceFor(booking);
  const dp = Math.round((booking.total_price || 0) * 0.5);
  const balance = (booking.total_price || 0) - dp;
  const html = wrapHtml(`
    <h3 style="margin-top:0;">🎉 Booking confirmed!</h3>
    <p>Hi <strong>${booking.guest_name}</strong>, your downpayment has been confirmed. Your date is locked in.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0;">
      <tr><td style="padding:6px 0;color:#6b5a45;">Reference</td><td style="padding:6px 0;text-align:right;font-family:monospace;">${ref}</td></tr>
      <tr><td style="padding:6px 0;color:#6b5a45;">Check-in</td><td style="padding:6px 0;text-align:right;">${formatDate(booking.check_in)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b5a45;">Check-out</td><td style="padding:6px 0;text-align:right;">${formatDate(booking.check_out)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b5a45;">Package</td><td style="padding:6px 0;text-align:right;">${booking.room_type}</td></tr>
      <tr><td style="padding:6px 0;color:#6b5a45;">Total stay</td><td style="padding:6px 0;text-align:right;">${peso(booking.total_price)}</td></tr>
      <tr><td style="padding:6px 0;color:#065f46;font-weight:600;">Downpayment paid</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#065f46;">${peso(dp)} ✓</td></tr>
      <tr><td style="padding:6px 0;color:#92400e;font-weight:600;">Remaining balance</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#92400e;">${peso(balance)}</td></tr>
    </table>
    <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:10px 12px;font-size:13px;color:#92400e;margin:12px 0;">
      <strong>Reminder:</strong> The remaining ${peso(balance)} + ₱3,000 security deposit must be settled online <strong>1–2 days before check-in</strong>.
    </div>
    <p>For on-site questions, contact our caretaker <strong>Edgar Sembrano at 0915-302-4203</strong>.</p>
    <p>Thank you and we can't wait to welcome you!</p>
  `);
  return sendMail({
    to: booking.email,
    toName: booking.guest_name,
    subject: `Booking confirmed — ${formatDate(booking.check_in)}`,
    html,
  });
}

async function notifyLoser(booking) {
  const html = wrapHtml(`
    <h3 style="margin-top:0;">Date already booked</h3>
    <p>Hi <strong>${booking.guest_name}</strong>,</p>
    <p>Another guest secured <strong>${formatDate(booking.check_in)} → ${formatDate(booking.check_out)}</strong> by paying the downpayment first. Your pending inquiry has been cancelled.</p>
    <p>If you sent a downpayment, please reach out via our Facebook page <a href="https://www.facebook.com/comariansplace">Comarian's Place</a> or contact our caretaker <strong>Edgar Sembrano at 0915-302-4203</strong> for a refund.</p>
    <p>We'd love to host you on another available date — feel free to pick new dates at <a href="${SITE_URL}">${SITE_URL}</a>.</p>
  `);
  return sendMail({
    to: booking.email,
    toName: booking.guest_name,
    subject: `Date no longer available — ${formatDate(booking.check_in)}`,
    html,
  });
}

module.exports = {
  sendMail,
  notifyOwnerNewInquiry,
  notifyOwnerProofUploaded,
  notifyGuestConfirmed,
  notifyLoser,
};

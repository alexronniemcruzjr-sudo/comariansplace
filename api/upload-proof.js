const { createClient } = require('@supabase/supabase-js');
const { notifyOwnerProofUploaded } = require('./_email');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { booking_id, image_data, file_name, email } = req.body;

  if (!image_data) {
    return res.status(400).json({ error: 'Missing image_data' });
  }

  const uploadId = booking_id || ('payment-' + Date.now());

  // Decode base64 image
  const matches = image_data.match(/^data:(.+);base64,(.+)$/);
  if (!matches) {
    return res.status(400).json({ error: 'Invalid image format. Send as base64 data URI.' });
  }

  const contentType = matches[1];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, 'base64');
  const ext = contentType.split('/')[1] || 'png';
  const fileName = `proofs/${uploadId}/${Date.now()}.${ext}`;

  // Upload to Supabase Storage
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('payment-proofs')
    .upload(fileName, buffer, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    return res.status(500).json({ error: 'Upload failed: ' + uploadError.message });
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('payment-proofs')
    .getPublicUrl(fileName);

  const publicUrl = urlData.publicUrl;

  // Update booking with proof URL — match by booking_id or email.
  // Presence of payment_proof_url extends the effective expiration window
  // (cleanup logic uses created_at + proof presence to decide).
  const proofUpdate = { payment_proof_url: publicUrl };

  let updatedBooking = null;
  if (booking_id && !booking_id.startsWith('payment-')) {
    const { data: updated } = await supabase
      .from('bookings')
      .update(proofUpdate)
      .eq('id', booking_id)
      .select()
      .single();
    updatedBooking = updated;
  } else if (email) {
    // Match most recent booking by email
    const { data: bookings } = await supabase
      .from('bookings')
      .select('id')
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1);

    if (bookings && bookings.length > 0) {
      const { data: updated } = await supabase
        .from('bookings')
        .update(proofUpdate)
        .eq('id', bookings[0].id)
        .select()
        .single();
      updatedBooking = updated;
    }
  }

  // Await the owner notification so it fires before Vercel reaps the function.
  if (updatedBooking) {
    try { await notifyOwnerProofUploaded(updatedBooking); } catch (_) {}
  }

  return res.status(200).json({ url: publicUrl });
};

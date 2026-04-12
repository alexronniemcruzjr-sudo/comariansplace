const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { booking_id, image_data, file_name } = req.body;

  if (!booking_id || !image_data) {
    return res.status(400).json({ error: 'Missing booking_id or image_data' });
  }

  // Decode base64 image
  const matches = image_data.match(/^data:(.+);base64,(.+)$/);
  if (!matches) {
    return res.status(400).json({ error: 'Invalid image format. Send as base64 data URI.' });
  }

  const contentType = matches[1];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, 'base64');
  const ext = contentType.split('/')[1] || 'png';
  const fileName = `proofs/${booking_id}/${Date.now()}.${ext}`;

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

  // Update booking with proof URL
  const { error: updateError } = await supabase
    .from('bookings')
    .update({ payment_proof_url: publicUrl })
    .eq('id', booking_id);

  if (updateError) {
    return res.status(500).json({ error: 'Failed to update booking: ' + updateError.message });
  }

  return res.status(200).json({ url: publicUrl });
};

// src/notifications/formatMessage.js
// Ubah payload notifikasi HR Platform (Pub/Sub contract v1) menjadi teks
// WhatsApp yang siap dikirim lewat Evolution API.

// Versi schema tertinggi yang dimengerti sender ini. Payload dengan version
// numerik lebih besar akan di-skip (log + ack) — lihat subscriber.js.
const SUPPORTED_VERSION = 1;

// Format satu payload jadi { phone, text } untuk sendText().
// Payload.recipient.phone sudah E.164 (mis. +6281234567890) — kirim apa adanya.
function formatMessage(payload) {
  const title = payload?.message?.title?.trim() || '';
  const body  = payload?.message?.body?.trim()  || '';
  const link  = payload?.message?.link?.trim()  || '';

  const parts = [];
  if (title) parts.push(`*${title}*`);
  if (body)  parts.push(body);
  if (link)  parts.push(link);

  return {
    phone: payload?.recipient?.phone || '',
    text: parts.join('\n\n'),
  };
}

module.exports = { formatMessage, SUPPORTED_VERSION };

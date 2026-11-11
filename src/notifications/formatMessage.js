// src/notifications/formatMessage.js
// Ubah payload notifikasi (Pub/Sub contract v1) menjadi teks
// WhatsApp yang siap dikirim lewat Evolution API.

// Versi schema tertinggi yang dimengerti sender ini. Payload dengan version
// numerik lebih besar akan di-skip (log + ack) — lihat subscriber.js.
const SUPPORTED_VERSION = 1;

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// Format satu payload jadi { groupId, phone, text }.
//
// • Pesan grup (recipient.groupId terisi): kirim ke grup, phone diabaikan, link
//   tidak dipakai (selalu "" di kontrak). Body bisa panjang (daftar nama) —
//   JANGAN dipotong.
// • Pesan individual: recipient.phone sudah E.164 (mis. +6281234567890).
//
// Teks: judul (bold) di baris pertama, baris kosong, lalu body (+ link).
function formatMessage(payload) {
  const title   = str(payload?.message?.title);
  const body    = str(payload?.message?.body);
  const link    = str(payload?.message?.link);
  const groupId = str(payload?.recipient?.groupId);

  const parts = [];
  if (title) parts.push(`*${title}*`);
  if (body)  parts.push(body);
  if (link && !groupId) parts.push(link);

  return {
    groupId,
    phone: groupId ? '' : str(payload?.recipient?.phone),
    text: parts.join('\n\n'),
  };
}

module.exports = { formatMessage, SUPPORTED_VERSION };

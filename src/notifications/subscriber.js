// src/notifications/subscriber.js
// WA Sender — subscriber Pub/Sub yang mengambil notifikasi dari topic
// dan mengirimkannya ke penerima lewat WhatsApp (Evolution API).
//
// Kontrak: docs Pub/Sub "WhatsApp Notifications". Ringkasnya:
//   • data pesan = UTF-8 JSON, schema version "1"
//   • delivery at-least-once → WAJIB dedup pada source.notificationId
//   • version lebih besar dari yang dimengerti → log + ack (skip), jangan crash
//   • sukses kirim → ack; gagal kirim → nack supaya Pub/Sub retry

const { PubSub } = require('@google-cloud/pubsub');
const logger = require('../utils/logger');
const db     = require('../db');
const { sendText } = require('../evolution/sender');
const { formatMessage, SUPPORTED_VERSION } = require('./formatMessage');

// ── Dedup (at-least-once) ─────────────────────────────────────────────────────

function seenRecently(notificationId) {
  if (!notificationId) return false;
  return !!db.prepare('SELECT 1 FROM notification_dedup WHERE notification_id = ?').get(notificationId);
}

function markSeen(notificationId, tenantId, type) {
  if (!notificationId) return;
  db.prepare(`
    INSERT OR IGNORE INTO notification_dedup (notification_id, tenant_id, type)
    VALUES (?, ?, ?)
  `).run(notificationId, tenantId || null, type || null);
}

// ── Handler satu pesan ────────────────────────────────────────────────────────

async function handleMessage(message) {
  let payload;
  try {
    payload = JSON.parse(message.data.toString('utf8'));
  } catch (err) {
    // Payload tak bisa di-parse tidak akan pernah sukses walau di-retry — ack.
    logger.error(`WA Sender: payload JSON tidak valid, skip (ack): ${err.message}`);
    message.ack();
    return;
  }

  const notificationId = payload?.source?.notificationId;
  const tenantId = payload?.tenantId;
  const type = payload?.source?.type;

  // Unknown version (lebih besar dari yang dimengerti) → skip, jangan crash.
  const version = parseInt(payload?.version, 10);
  if (Number.isFinite(version) && version > SUPPORTED_VERSION) {
    logger.warn(`WA Sender: version ${payload.version} > ${SUPPORTED_VERSION} (dimengerti), skip (ack) notif ${notificationId}`);
    message.ack();
    return;
  }

  // Dedup — pesan yang sama bisa dikirim >1x oleh Pub/Sub.
  if (seenRecently(notificationId)) {
    logger.info(`WA Sender: notif ${notificationId} sudah pernah dikirim, skip (ack)`);
    message.ack();
    return;
  }

  const { phone, text } = formatMessage(payload);
  if (!phone || !text) {
    logger.warn(`WA Sender: notif ${notificationId} tanpa phone/text yang valid, skip (ack)`);
    message.ack();
    return;
  }

  try {
    await sendText(phone, text);
    markSeen(notificationId, tenantId, type);
    logger.info(`WA Sender: notif ${notificationId} (${type}) terkirim ke ${phone}`);
    message.ack();
  } catch (err) {
    // Kegagalan transient — nack supaya Pub/Sub kirim ulang nanti.
    logger.error(`WA Sender: gagal kirim notif ${notificationId} ke ${phone}, nack untuk retry: ${err.message}`);
    message.nack();
  }
}

// ── Bootstrap subscriber ──────────────────────────────────────────────────────

// Pastikan subscription ada; buat kalau belum (idempoten). Node client meng-
// subscribe lewat subscription, bukan langsung ke topic.
async function ensureSubscription(pubsub, topicName, subscriptionName) {
  const subscription = pubsub.subscription(subscriptionName);
  const [exists] = await subscription.exists();
  if (exists) return subscription;

  logger.info(`WA Sender: subscription "${subscriptionName}" belum ada, membuat terhadap topic "${topicName}"`);
  const [created] = await pubsub
    .topic(topicName)
    .createSubscription(subscriptionName, { ackDeadlineSeconds: 30 });
  return created;
}

// Panggil dari index.js saat startup. Dormant (no-op) kalau WHATSAPP_TOPIC unset.
async function startSubscriber() {
  const topicName = process.env.WHATSAPP_TOPIC;
  if (!topicName) {
    logger.info('WA Sender: WHATSAPP_TOPIC tidak diset — dispatch WhatsApp nonaktif (dormant).');
    return null;
  }

  const subscriptionName = process.env.WHATSAPP_SUBSCRIPTION || `${topicName}-wa-sender`;

  // projectId opsional: diinfer dari ADC / GOOGLE_CLOUD_PROJECT / emulator.
  const clientOpts = {};
  if (process.env.GCP_PROJECT_ID) clientOpts.projectId = process.env.GCP_PROJECT_ID;
  const pubsub = new PubSub(clientOpts);

  try {
    const subscription = await ensureSubscription(pubsub, topicName, subscriptionName);

    subscription.on('message', (message) => {
      // handleMessage sudah menangani ack/nack sendiri; jangan lempar keluar.
      handleMessage(message).catch(err => {
        logger.error(`WA Sender: error tak tertangani saat proses pesan, nack: ${err.stack || err.message}`);
        message.nack();
      });
    });

    subscription.on('error', (err) => {
      logger.error(`WA Sender: subscription error: ${err.message}`);
    });

    logger.info(`WA Sender: mendengarkan topic "${topicName}" via subscription "${subscriptionName}"`);
    return subscription;
  } catch (err) {
    // Jangan sampai gagalnya subscriber menjatuhkan seluruh gateway.
    logger.error(`WA Sender: gagal start subscriber untuk topic "${topicName}": ${err.message}`);
    return null;
  }
}

module.exports = { startSubscriber, handleMessage };

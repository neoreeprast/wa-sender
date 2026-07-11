// index.js — WA Sender
// Konsumsi notifikasi HR Platform dari Google Cloud Pub/Sub dan kirim ke
// penerima lewat WhatsApp (Evolution API).
require('dotenv').config();

const logger = require('./src/utils/logger');

// Init DB dulu sebelum apapun (dipakai untuk dedup notifikasi + log outbound).
require('./src/db');

const { startSubscriber } = require('./src/notifications/subscriber');

logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
logger.info(`  WA Sender starting`);
logger.info(`  Instance : ${process.env.EVOLUTION_INSTANCE}`);
logger.info(`  Topic    : ${process.env.WHATSAPP_TOPIC || '(dormant)'}`);
logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

// Konsumsi notifikasi dari Pub/Sub (dormant kalau WHATSAPP_TOPIC tidak diset).
startSubscriber().catch(err =>
  logger.error(`WA Sender: gagal start: ${err.stack || err.message}`)
);

process.on('uncaughtException', err => logger.error(`Uncaught exception: ${err.stack || err.message}`));
process.on('unhandledRejection', err => logger.error(`Unhandled rejection: ${err?.stack || err?.message || err}`));

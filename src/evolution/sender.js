// src/evolution/sender.js
const axios = require('axios');
const logger = require('../utils/logger');
const db = require('../db');

const BASE_URL = () => process.env.EVOLUTION_API_URL;
const INSTANCE  = () => process.env.EVOLUTION_INSTANCE;
const API_KEY   = () => process.env.EVOLUTION_API_KEY;

function headers() {
  return { 'apikey': API_KEY(), 'Content-Type': 'application/json' };
}

// ── Retry wrapper untuk error transient (ECONNRESET, 5xx, 429, dll) ──────────

const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ECONNABORTED']);

function isRetryable(err) {
  if (RETRYABLE_CODES.has(err.code)) return true;
  const status = err.response?.status;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

async function postWithRetry(url, body, opts = {}, label = 'request') {
  const maxAttempts = 3;
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await axios.post(url, body, { headers: headers(), timeout: 30000, ...opts });
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isRetryable(err)) throw err;

      const delay = 500 * Math.pow(2, attempt - 1); // 500ms, 1000ms
      logger.warn(`${label} retry ${attempt}/${maxAttempts - 1} setelah ${formatAxiosError(err)} — tunggu ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ── Kirim teks ───────────────────────────────────────────────────────────────

async function sendText(phone, text) {
  const number = formatNumber(phone);

  try {
    const res = await postWithRetry(
      `${BASE_URL()}/message/sendText/${INSTANCE()}`,
      { number, text },
      {},
      `sendText to ${phone}`
    );

    logOutbound(phone, text, 'text');
    logger.info(`Text sent to ${phone}`);
    return res.data;

  } catch (err) {
    logger.error(`Failed to send text to ${phone}: ${formatAxiosError(err)}`);
    throw err;
  }
}

// ── Helper ───────────────────────────────────────────────────────────────────

function formatNumber(phone) {
  // Evolution API biasanya menerima nomor telanjang (628xxx). Untuk recipient LID
  // (akun WhatsApp yang hanya dikenal lewat @lid — belum di-claim), pertahankan
  // suffix @lid agar Evolution tetap routing lewat LID.
  const s = String(phone || '').trim();
  if (s.endsWith('@lid')) {
    const digits = s.replace(/@lid$/, '').replace(/[^\d]/g, '');
    return digits ? `${digits}@lid` : '';
  }
  return s.replace(/@(s\.whatsapp\.net|c\.us)$/, '').replace(/[^\d]/g, '');
}

function formatAxiosError(err) {
  if (err.response) {
    const data = err.response.data;
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    return `HTTP ${err.response.status} ${dataStr}`;
  }
  return err.code ? `${err.code} ${err.message}` : err.message;
}

function logOutbound(phone, content, mediaType) {
  try {
    db.prepare(`
      INSERT INTO message_log (phone, direction, content, media_type)
      VALUES (?, 'outbound', ?, ?)
    `).run(phone, content?.substring(0, 500), mediaType);
  } catch (_) {}
}

module.exports = { sendText };

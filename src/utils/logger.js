// src/utils/logger.js
const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs = require('fs');

const logDir = './logs';
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

function safeStringify(obj) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(obj, (key, value) => {
      if (value instanceof Error) {
        return { message: value.message, stack: value.stack, code: value.code };
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
  } catch (_) {
    return '[Unserializable]';
  }
}

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ' ' + safeStringify(meta) : '';
      return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
    })
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message }) =>
          `${timestamp} [${level}] ${message}`
        )
      )
    }),
    new transports.File({ filename: path.join(logDir, 'gateway.log'), maxsize: 5242880 })
  ]
});

module.exports = logger;

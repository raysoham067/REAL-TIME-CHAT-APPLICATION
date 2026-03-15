'use strict';

/**
 * Centralised, validated environment configuration.
 * Fail-fast on startup if required variables are missing or malformed.
 */

function requireEnv(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optionalEnv(key, defaultValue) {
  return process.env[key] ?? defaultValue;
}

function parsePositiveInt(key, defaultValue) {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) throw new Error(`${key} must be a positive integer, got: ${raw}`);
  return n;
}

const env = {
  NODE_ENV:       optionalEnv('NODE_ENV', 'development'),
  PORT:           parsePositiveInt('PORT', 3000),

  // CORS — restrict in production
  CLIENT_ORIGIN:  optionalEnv('CLIENT_ORIGIN', 'http://localhost:3000'),

  // Redis (optional) — if absent, the app uses in-memory stores
  REDIS_URL:      optionalEnv('REDIS_URL', null),

  // Message history cap per room
  MESSAGE_HISTORY_LIMIT: parsePositiveInt('MESSAGE_HISTORY_LIMIT', 500),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS:  parsePositiveInt('RATE_LIMIT_WINDOW_MS', 60_000),
  RATE_LIMIT_MAX:        parsePositiveInt('RATE_LIMIT_MAX', 120),
  SOCKET_MSG_RATE_LIMIT: parsePositiveInt('SOCKET_MSG_RATE_LIMIT', 20), // msgs/minute per socket

  // ── JWT ──────────────────────────────────────────────────────────────────────
  // Use: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  JWT_SECRET:          optionalEnv('JWT_SECRET', null),
  JWT_EXPIRES_IN:      optionalEnv('JWT_EXPIRES_IN', '15m'),    // short-lived access token

  REFRESH_SECRET:      optionalEnv('REFRESH_SECRET', null),
  REFRESH_EXPIRES_IN:  optionalEnv('REFRESH_EXPIRES_IN', '7d'), // long-lived refresh token

  BCRYPT_ROUNDS:       parsePositiveInt('BCRYPT_ROUNDS', 12),

  // Misc
  LOG_LEVEL: optionalEnv('LOG_LEVEL', 'info'),
};

const isProd = env.NODE_ENV === 'production';

// In production, wildcard CORS origin is forbidden
if (isProd && env.CLIENT_ORIGIN === '*') {
  throw new Error('CLIENT_ORIGIN must not be "*" in production');
}

// JWT secrets are mandatory — in dev we generate ephemeral ones so the server
// still starts without manual setup, but warn loudly about it.
if (!env.JWT_SECRET) {
  if (isProd) throw new Error('JWT_SECRET must be set in production');
  const crypto = require('crypto');
  env.JWT_SECRET     = crypto.randomBytes(64).toString('hex');
  env.REFRESH_SECRET = crypto.randomBytes(64).toString('hex');
  // eslint-disable-next-line no-console
  console.warn(
    '[config] JWT_SECRET / REFRESH_SECRET not set — using ephemeral keys. ' +
    'All tokens will be invalidated on restart. Set them in .env for persistence.',
  );
} else if (!env.REFRESH_SECRET) {
  throw new Error('REFRESH_SECRET must be set when JWT_SECRET is set');
}

module.exports = { env, isProd };

'use strict';

/**
 * TokenStore — JWT access + refresh token lifecycle.
 *
 * Access tokens   (JWT, short-lived, stateless — verified by signature only)
 * Refresh tokens  (JWT, long-lived, stored in Redis/Map so they can be revoked)
 *
 * Refresh token rotation:
 *   Every /auth/refresh call issues a NEW refresh token and immediately
 *   blacklists the old one. Re-use of a consumed token signals theft →
 *   all tokens for that user are revoked.
 *
 * Redis key schema
 * ──────────────────────────────────────────────────
 *  refresh:{jti}          → userId  (valid token registry, TTL = expiry)
 *  refresh:revoked:{jti}  → "1"     (blacklist, TTL = original expiry)
 * ──────────────────────────────────────────────────
 */

const jwt    = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { env } = require('../config/env');
const redis   = require('./redis');
const logger  = require('../utils/logger');

// ── In-memory fallbacks ───────────────────────────────────────────────────────
const memTokens  = new Map(); // jti → { userId, expiresAt }
const memRevoked = new Set(); // jti

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse a duration string ("15m", "7d") into seconds. */
function durationToSeconds(str) {
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid duration: ${str}`);
  const n = parseInt(match[1], 10);
  return { s: n, m: n * 60, h: n * 3600, d: n * 86400 }[match[2]];
}

const ACCESS_TTL_S  = durationToSeconds(env.JWT_EXPIRES_IN);
const REFRESH_TTL_S = durationToSeconds(env.REFRESH_EXPIRES_IN);

// ── Access tokens (stateless) ─────────────────────────────────────────────────

/**
 * Sign a short-lived access token.
 * @param {{ id, username, avatar }} user
 * @returns {string}  signed JWT
 */
function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, avatar: user.avatar },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN, algorithm: 'HS256' },
  );
}

/**
 * Verify an access token.
 * @returns {{ sub, username, avatar, iat, exp } | null}
 */
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

// ── Refresh tokens (stateful) ─────────────────────────────────────────────────

/**
 * Issue a refresh token for a user.
 * Stores it so it can later be verified or revoked.
 * @returns {Promise<string>}  signed JWT
 */
async function issueRefreshToken(userId) {
  const jti = uuidv4();
  const token = jwt.sign(
    { sub: userId, jti },
    env.REFRESH_SECRET,
    { expiresIn: env.REFRESH_EXPIRES_IN, algorithm: 'HS256' },
  );

  try {
    if (redis) {
      await redis.set(`refresh:${jti}`, userId, 'EX', REFRESH_TTL_S);
    } else {
      memTokens.set(jti, { userId, expiresAt: Date.now() + REFRESH_TTL_S * 1000 });
    }
  } catch (err) {
    logger.error({ err, userId }, 'issueRefreshToken: store failed');
  }

  return token;
}

/**
 * Consume a refresh token — verify signature, check it's not revoked,
 * then atomically revoke it and return the userId.
 *
 * Returns null (with a `reuse` flag) if the token was already consumed
 * (possible token theft — caller should invalidate all user tokens).
 *
 * @returns {Promise<{ userId: string } | { reuse: true } | null>}
 */
async function consumeRefreshToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.REFRESH_SECRET, { algorithms: ['HS256'] });
  } catch {
    return null; // invalid or expired
  }

  const { sub: userId, jti } = payload;

  // Check blacklist first
  const isRevoked = redis
    ? await redis.exists(`refresh:revoked:${jti}`)
    : memRevoked.has(jti);

  if (isRevoked) {
    logger.warn({ userId, jti }, 'Refresh token reuse detected — possible theft');
    return { reuse: true, userId };
  }

  // Check registry
  const stored = redis
    ? await redis.get(`refresh:${jti}`)
    : (memTokens.get(jti)?.expiresAt > Date.now() ? memTokens.get(jti)?.userId : null);

  if (!stored) return null; // never issued or expired

  // Revoke (rotate)
  try {
    if (redis) {
      await redis.del(`refresh:${jti}`);
      await redis.set(`refresh:revoked:${jti}`, '1', 'EX', REFRESH_TTL_S);
    } else {
      memTokens.delete(jti);
      memRevoked.add(jti);
    }
  } catch (err) {
    logger.error({ err, jti }, 'consumeRefreshToken: revoke failed');
  }

  return { userId };
}

/**
 * Revoke a specific refresh token (logout).
 */
async function revokeRefreshToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.REFRESH_SECRET, {
      algorithms: ['HS256'],
      ignoreExpiration: true, // allow revoking already-expired tokens
    });
  } catch {
    return; // can't parse — nothing to revoke
  }

  const { jti } = payload;
  try {
    if (redis) {
      await redis.del(`refresh:${jti}`);
      await redis.set(`refresh:revoked:${jti}`, '1', 'EX', REFRESH_TTL_S);
    } else {
      memTokens.delete(jti);
      memRevoked.add(jti);
    }
  } catch (err) {
    logger.error({ err, jti }, 'revokeRefreshToken failed');
  }
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  consumeRefreshToken,
  revokeRefreshToken,
};

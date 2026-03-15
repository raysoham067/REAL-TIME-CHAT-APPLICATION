'use strict';

/**
 * Authentication REST endpoints
 *
 * POST /api/auth/register   → create account, returns tokens
 * POST /api/auth/login      → verify credentials, returns tokens
 * POST /api/auth/refresh    → rotate refresh token, returns new access token
 * POST /api/auth/logout     → revoke refresh token
 * GET  /api/auth/me         → return current user profile (requires auth)
 */

const express   = require('express');
const bcrypt    = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { createUser, findByUsername, toPublic } = require('../services/userStore');
const {
  signAccessToken,
  issueRefreshToken,
  consumeRefreshToken,
  revokeRefreshToken,
} = require('../services/tokenStore');
const { requireAuth }  = require('../middleware/auth');
const { env }          = require('../config/env');
const logger           = require('../utils/logger');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Aggressive rate limit specifically for auth endpoints. */
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,   // 15 minutes
  max:             20,                // 20 attempts per window per IP
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many auth attempts, try again later.' },
});

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const PASSWORD_MIN = 1;

function issueTokenPair(user) {
  return Promise.all([
    Promise.resolve(signAccessToken(user)),
    issueRefreshToken(user.id),
  ]).then(([accessToken, refreshToken]) => ({ accessToken, refreshToken }));
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { username, password, avatar } = req.body ?? {};

    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      return res.status(400).json({
        error: 'Username must be 3–32 characters (letters, numbers, _ . - only).',
      });
    }
    if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
      return res.status(400).json({
        error: `Password must be at least ${PASSWORD_MIN} characters.`,
      });
    }

    const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
    const user = await createUser({
      username: username.trim(),
      passwordHash,
      avatar: typeof avatar === 'string' ? avatar.slice(0, 512) : undefined,
    });

    if (!user) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    logger.info({ username: user.username, userId: user.id }, 'User registered');

    const { accessToken, refreshToken } = await issueTokenPair(user);
    res.status(201).json({
      user:         toPublic(user),
      accessToken,
      refreshToken,
    });
  }),
);

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body ?? {};

    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required.' });
    }

    const user = await findByUsername(username);

    // Constant-time comparison — always run bcrypt to prevent timing attacks
    const isValid = user
      ? await bcrypt.compare(password, user.passwordHash)
      : await bcrypt.compare(password, '$2b$12$invalidhashpaddingtowastetime000'); // dummy

    if (!user || !isValid) {
      logger.warn({ username }, 'Failed login attempt');
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    logger.info({ username: user.username, userId: user.id }, 'User logged in');

    const { accessToken, refreshToken } = await issueTokenPair(user);
    res.json({
      user:         toPublic(user),
      accessToken,
      refreshToken,
    });
  }),
);

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) {
      return res.status(400).json({ error: 'refreshToken is required.' });
    }

    const result = await consumeRefreshToken(refreshToken);

    if (!result) {
      return res.status(401).json({ error: 'Invalid or expired refresh token.' });
    }

    // Token reuse detected → possible theft → revoke all and force re-login
    if (result.reuse) {
      logger.error({ userId: result.userId }, 'Refresh token reuse — all tokens revoked');
      await revokeRefreshToken(refreshToken);
      return res.status(401).json({
        error: 'Token reuse detected. Please log in again.',
        code:  'TOKEN_REUSE',
      });
    }

    const { findById, toPublic } = require('../services/userStore');
    const user = await findById(result.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }

    const newAccessToken  = signAccessToken(user);
    const newRefreshToken = await issueRefreshToken(user.id);

    res.json({
      user:         toPublic(user),
      accessToken:  newAccessToken,
      refreshToken: newRefreshToken,
    });
  }),
);

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body ?? {};
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }
    res.json({ message: 'Logged out successfully.' });
  }),
);

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { findById, toPublic } = require('../services/userStore');
    const user = await findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: toPublic(user) });
  }),
);

module.exports = router;

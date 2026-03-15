'use strict';

/**
 * REST API routes
 *
 * GET  /api/health                         → liveness probe (public)
 * GET  /api/rooms/:roomId/messages         → message history (protected)
 * GET  /api/users/online                   → snapshot of connected users (protected)
 */

const express = require('express');
const { getMessages, getOnlineUsers } = require('../services/messageStore');
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ── Routes ────────────────────────────────────────────────────────────────────

/** Liveness / readiness probe — public, no auth */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

/** Message history for a room — requires valid access token */
router.get(
  '/rooms/:roomId/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { roomId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

    if (!/^[\w-]{1,64}$/.test(roomId)) {
      return res.status(400).json({ error: 'Invalid roomId' });
    }

    const messages = await getMessages(roomId, limit);
    res.json({ roomId, messages, count: messages.length });
  }),
);

/** Online users snapshot — requires valid access token */
router.get(
  '/users/online',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const users = await getOnlineUsers();
    res.json({ users, count: users.length });
  }),
);

// ── 404 catch-all for /api/* ──────────────────────────────────────────────────
router.use((req, res) => {
  logger.warn({ method: req.method, url: req.originalUrl }, 'API 404');
  res.status(404).json({ error: 'Not found' });
});

module.exports = router;

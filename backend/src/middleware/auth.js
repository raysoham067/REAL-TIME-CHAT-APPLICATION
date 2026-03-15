'use strict';

/**
 * Authentication middleware for Express routes.
 *
 * requireAuth  — rejects requests without a valid access token (401)
 * optionalAuth — attaches user if token present, continues regardless
 *
 * Token is read from:
 *   1. Authorization: Bearer <token>  header   (preferred)
 *   2. ?token=<token>                 query param  (fallback for EventSource / SSE)
 */

const { verifyAccessToken } = require('../services/tokenStore');
const logger = require('../utils/logger');

function extractToken(req) {
  const header = req.headers['authorization'];
  if (header?.startsWith('Bearer ')) return header.slice(7);
  if (req.query?.token)              return String(req.query.token);
  return null;
}

/** Middleware: request must carry a valid, unexpired access token. */
function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing access token.' });
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired access token.' });
  }

  req.user = { id: payload.sub, username: payload.username, avatar: payload.avatar };
  next();
}

/** Middleware: attaches req.user if a valid token is present, otherwise continues. */
function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    const payload = verifyAccessToken(token);
    if (payload) {
      req.user = { id: payload.sub, username: payload.username, avatar: payload.avatar };
    }
  }
  next();
}

/**
 * Socket.io middleware: verify access token on initial handshake.
 *
 * The client passes the token in:
 *   io({ auth: { token: '<access_token>' } })
 *
 * On success, socket.data.jwtUser is set to the verified payload.
 */
function socketAuthMiddleware(socket, next) {
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization?.replace('Bearer ', '');

  if (!token) {
    logger.warn({ socketId: socket.id }, 'Socket rejected — no token');
    return next(new Error('AUTH_REQUIRED'));
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    logger.warn({ socketId: socket.id }, 'Socket rejected — invalid token');
    return next(new Error('AUTH_INVALID'));
  }

  // Attach verified identity to socket — used by all event handlers
  socket.data.jwtUser = {
    id:       payload.sub,
    username: payload.username,
    avatar:   payload.avatar,
  };

  next();
}

module.exports = { requireAuth, optionalAuth, socketAuthMiddleware };

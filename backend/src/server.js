'use strict';

require('dotenv').config({ path: '../.env' }); // Load env vars early 

/**
 * Relay — Real-Time Chat Backend
 * ──────────────────────────────────────────────────────────────────────────────
 * Entry point. Wires together Express, Socket.io, JWT auth middleware,
 * optional Redis pub/sub adapter, rate limiting, security headers,
 * and graceful shutdown.
 */

const path    = require('path');
const http    = require('http');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const { env, isProd }              = require('./config/env');
const logger                       = require('./utils/logger');
const authRouter                   = require('./routes/auth');
const apiRouter                    = require('./routes/api');
const { socketAuthMiddleware }     = require('./middleware/auth');
const { registerSocketHandlers }   = require('./socket');

// ── Express app ───────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: isProd ? undefined : false,
  }),
);

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = env.CLIENT_ORIGIN === '*'
  ? true
  : env.CLIENT_ORIGIN.split(',').map((o) => o.trim());

app.use(cors({ origin: allowedOrigins, credentials: true }));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '16kb' }));

// ── HTTP rate limiting (global) ───────────────────────────────────────────────
app.use(
  '/api',
  rateLimit({
    windowMs:        env.RATE_LIMIT_WINDOW_MS,
    max:             env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { error: 'Too many requests, please try again later.' },
  }),
);

// ── Static demo UI ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Auth routes (public — no token required) ──────────────────────────────────
app.use('/api/auth', authRouter);

// ── Protected REST API ────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  logger.error({ err, method: req.method, url: req.url }, 'Unhandled error');
  res.status(500).json({ error: isProd ? 'Internal server error' : err.message });
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin:      allowedOrigins,
    methods:     ['GET', 'POST'],
    credentials: true,
  },
  pingInterval: 25_000,
  pingTimeout:  20_000,
  transports:   ['websocket', 'polling'],
});

// JWT auth middleware — runs before any event handler
io.use(socketAuthMiddleware);

// Attach Redis pub/sub adapter for horizontal scaling (no-op if Redis absent)
(async () => {
  if (env.REDIS_URL) {
    try {
      const { createAdapter } = require('./services/redisAdapter');
      io.adapter(await createAdapter());
      logger.info('Socket.io: Redis pub/sub adapter enabled');
    } catch (err) {
      logger.error({ err }, 'Socket.io: Redis adapter failed — falling back to single-node');
    }
  }
})();

registerSocketHandlers(io);

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, redis: Boolean(env.REDIS_URL) },
    '🚀 Relay chat server started',
  );
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down gracefully…');

  server.close(async () => {
    logger.info('HTTP server closed');
    io.close(() => logger.info('Socket.io closed'));

    const redis = require('./services/redis');
    if (redis) {
      await redis.quit().catch(() => redis.disconnect());
      logger.info('Redis connection closed');
    }

    logger.info('Shutdown complete');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException',  (err)    => { logger.fatal({ err }, 'Uncaught exception');       shutdown('uncaughtException'); });
process.on('unhandledRejection', (reason) => { logger.fatal({ reason }, 'Unhandled rejection');   shutdown('unhandledRejection'); });

module.exports = { app, server, io };

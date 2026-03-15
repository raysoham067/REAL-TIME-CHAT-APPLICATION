'use strict';

/**
 * Redis pub/sub adapter factory for Socket.io.
 *
 * Enables multiple server instances (behind a load balancer) to fan-out
 * events across all nodes. Import and attach in server.js:
 *
 *   const { createAdapter } = require('./services/redisAdapter');
 *   io.adapter(await createAdapter());
 *
 * Requires: npm install @socket.io/redis-adapter ioredis
 */

const { createAdapter: socketIoRedisAdapter } = require('@socket.io/redis-adapter');
const Redis  = require('ioredis');
const { env } = require('../config/env');
const logger   = require('../utils/logger');

async function createAdapter() {
  const pubClient = new Redis(env.REDIS_URL, { lazyConnect: true });
  const subClient = pubClient.duplicate();

  await Promise.all([pubClient.connect(), subClient.connect()]);

  pubClient.on('error', (err) => logger.error({ err }, 'Redis pub client error'));
  subClient.on('error', (err) => logger.error({ err }, 'Redis sub client error'));

  logger.info('Redis pub/sub adapter ready');
  return socketIoRedisAdapter(pubClient, subClient);
}

module.exports = { createAdapter };

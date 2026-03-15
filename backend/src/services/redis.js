'use strict';

/**
 * Redis service — exports a connected ioredis client (or null when disabled).
 *
 * Centralises connection management so every other module imports the same
 * instance rather than spinning up independent connections.
 */

const { env } = require('../config/env');
const logger   = require('../utils/logger');

let redis = null;

if (env.REDIS_URL) {
  const Redis = require('ioredis');

  redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest:    3,
    enableReadyCheck:        true,
    lazyConnect:             false,
    retryStrategy(times) {
      if (times > 10) {
        logger.error('Redis: max reconnect attempts reached — giving up');
        return null; // stop retrying
      }
      const delay = Math.min(times * 150, 3000);
      logger.warn({ attempt: times, delay }, 'Redis: reconnecting…');
      return delay;
    },
  });

  redis.on('connect', () => logger.info('Redis: connected'));
  redis.on('ready',   () => logger.info('Redis: ready'));
  redis.on('error',   (err) => logger.error({ err }, 'Redis: error'));
  redis.on('close',   () => logger.warn('Redis: connection closed'));
  redis.on('end',     () => logger.warn('Redis: connection ended'));
} else {
  logger.info('Redis: disabled — running in in-memory mode');
}

module.exports = redis;

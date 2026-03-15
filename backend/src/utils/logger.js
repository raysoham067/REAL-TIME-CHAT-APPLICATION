'use strict';

const pino = require('pino');
const { env, isProd } = require('../config/env');

const logger = pino({
  level: env.LOG_LEVEL,
  ...(isProd
    ? {}                                            // structured JSON in production
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
        },
      }),
});

module.exports = logger;

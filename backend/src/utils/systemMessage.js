'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Builds a server-generated system message (join / leave / info).
 *
 * @param {string} text    - Human-readable event text
 * @param {string} roomId  - Target room
 * @returns {SystemMessage}
 */
function buildSystemMessage(text, roomId) {
  return {
    id:        uuidv4(),
    type:      'system',
    content:   text,
    roomId,
    createdAt: new Date().toISOString(),
  };
}

module.exports = { buildSystemMessage };

'use strict';

/**
 * MessageStore — unified interface for message & user persistence.
 *
 * Uses Redis when available; falls back to in-memory Maps so the server
 * starts and runs without any external dependencies in development.
 *
 * Redis key schema
 * ─────────────────────────────────────────────────────────
 *  room:{roomId}:messages  → Redis list  (JSON-serialised Message[])
 *  users:online            → Redis hash  (socketId → JSON UserInfo)
 *  msg:{msgId}:owner       → Redis string (userId, for ownership checks)
 * ─────────────────────────────────────────────────────────
 */

const redis  = require('./redis');
const logger = require('../utils/logger');
const { env } = require('../config/env');

// ── In-memory fallbacks ──────────────────────────────────────────────────────
const memMessages = new Map();  // roomId  → Message[]
const memUsers    = new Map();  // socketId → UserInfo
const memOwners   = new Map();  // msgId   → userId

// ── Messages ─────────────────────────────────────────────────────────────────

/**
 * Persist a message to the tail of a room's history.
 * Trims older messages beyond MESSAGE_HISTORY_LIMIT.
 */
async function saveMessage(roomId, message) {
  try {
    if (redis) {
      const key = `room:${roomId}:messages`;
      await redis.lpush(key, JSON.stringify(message));
      await redis.ltrim(key, 0, env.MESSAGE_HISTORY_LIMIT - 1);
    } else {
      if (!memMessages.has(roomId)) memMessages.set(roomId, []);
      const msgs = memMessages.get(roomId);
      msgs.push(message);
      if (msgs.length > env.MESSAGE_HISTORY_LIMIT) msgs.shift();
    }

    // Track message ownership for edit/delete authorisation
    await setMessageOwner(message.id, message.author?.id);
  } catch (err) {
    logger.error({ err, roomId, msgId: message.id }, 'saveMessage failed');
  }
}

/**
 * Retrieve the last `limit` messages for a room, in chronological order.
 */
async function getMessages(roomId, limit = 50) {
  try {
    if (redis) {
      const raw = await redis.lrange(`room:${roomId}:messages`, 0, limit - 1);
      return raw.map(JSON.parse).reverse();
    }
    const msgs = memMessages.get(roomId) ?? [];
    return msgs.slice(-limit);
  } catch (err) {
    logger.error({ err, roomId }, 'getMessages failed');
    return [];
  }
}

// ── Users ─────────────────────────────────────────────────────────────────────

async function setUserOnline(socketId, userInfo) {
  try {
    if (redis) {
      await redis.hset('users:online', socketId, JSON.stringify(userInfo));
    } else {
      memUsers.set(socketId, userInfo);
    }
  } catch (err) {
    logger.error({ err, socketId }, 'setUserOnline failed');
  }
}

async function removeUser(socketId) {
  try {
    if (redis) {
      await redis.hdel('users:online', socketId);
    } else {
      memUsers.delete(socketId);
    }
  } catch (err) {
    logger.error({ err, socketId }, 'removeUser failed');
  }
}

async function getOnlineUsers() {
  try {
    if (redis) {
      const raw = await redis.hgetall('users:online');
      return Object.values(raw ?? {}).map(JSON.parse);
    }
    return [...memUsers.values()];
  } catch (err) {
    logger.error({ err }, 'getOnlineUsers failed');
    return [];
  }
}

// ── Message ownership ─────────────────────────────────────────────────────────

async function setMessageOwner(msgId, userId) {
  if (!msgId || !userId) return;
  try {
    if (redis) {
      // TTL: 7 days — aligns with practical edit windows
      await redis.set(`msg:${msgId}:owner`, userId, 'EX', 60 * 60 * 24 * 7);
    } else {
      memOwners.set(msgId, userId);
    }
  } catch (err) {
    logger.error({ err, msgId }, 'setMessageOwner failed');
  }
}

async function isMessageOwner(msgId, userId) {
  if (!msgId || !userId) return false;
  try {
    if (redis) {
      const owner = await redis.get(`msg:${msgId}:owner`);
      return owner === userId;
    }
    return memOwners.get(msgId) === userId;
  } catch (err) {
    logger.error({ err, msgId }, 'isMessageOwner failed');
    return false;
  }
}

module.exports = {
  saveMessage,
  getMessages,
  setUserOnline,
  removeUser,
  getOnlineUsers,
  isMessageOwner,
};

'use strict';

/**
 * UserStore — registration / lookup for chat users.
 *
 * Passwords are never stored here — only bcrypt hashes.
 * Backed by Redis when available, in-memory Map in dev.
 *
 * Redis key schema
 * ────────────────────────────────────────────
 *  user:id:{userId}       → JSON UserRecord
 *  user:username:{lower}  → userId  (lookup index)
 * ────────────────────────────────────────────
 */

const { v4: uuidv4 } = require('uuid');
const redis  = require('./redis');
const logger = require('../utils/logger');

// ── In-memory fallbacks ──────────────────────────────────────────────────────
const memById       = new Map(); // userId       → UserRecord
const memByUsername = new Map(); // lowerUsername → userId

// ── Helpers ───────────────────────────────────────────────────────────────────

function userKey(userId)      { return `user:id:${userId}`; }
function usernameKey(username){ return `user:username:${username.toLowerCase()}`; }

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new user.
 * Returns null if the username is already taken.
 *
 * @param {{ username: string, passwordHash: string, avatar?: string }} params
 * @returns {Promise<UserRecord|null>}
 */
async function createUser({ username, passwordHash, avatar }) {
  const lower = username.toLowerCase();

  // Check uniqueness
  const exists = await findByUsername(username);
  if (exists) return null;

  const user = {
    id:           uuidv4(),
    username:     username.trim(),
    passwordHash,
    avatar:       avatar ?? `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(username)}`,
    createdAt:    new Date().toISOString(),
  };

  try {
    if (redis) {
      await redis.set(userKey(user.id), JSON.stringify(user));
      await redis.set(usernameKey(lower), user.id);
    } else {
      memById.set(user.id, user);
      memByUsername.set(lower, user.id);
    }
  } catch (err) {
    logger.error({ err, username }, 'createUser failed');
    throw err;
  }

  return user;
}

/**
 * Find a user by their unique ID.
 * @returns {Promise<UserRecord|null>}
 */
async function findById(userId) {
  try {
    if (redis) {
      const raw = await redis.get(userKey(userId));
      return raw ? JSON.parse(raw) : null;
    }
    return memById.get(userId) ?? null;
  } catch (err) {
    logger.error({ err, userId }, 'findById failed');
    return null;
  }
}

/**
 * Find a user by username (case-insensitive).
 * @returns {Promise<UserRecord|null>}
 */
async function findByUsername(username) {
  try {
    const lower = username.toLowerCase();
    if (redis) {
      const userId = await redis.get(usernameKey(lower));
      if (!userId) return null;
      const raw = await redis.get(userKey(userId));
      return raw ? JSON.parse(raw) : null;
    }
    const userId = memByUsername.get(lower);
    return userId ? (memById.get(userId) ?? null) : null;
  } catch (err) {
    logger.error({ err, username }, 'findByUsername failed');
    return null;
  }
}

/**
 * Return a user record safe to expose externally (no passwordHash).
 */
function toPublic(user) {
  if (!user) return null;
  const { passwordHash: _omit, ...pub } = user;
  return pub;
}

module.exports = { createUser, findById, findByUsername, toPublic };

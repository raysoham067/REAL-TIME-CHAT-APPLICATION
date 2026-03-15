'use strict';

/**
 * Socket.io event handlers.
 *
 * JWT auth is enforced at the connection level via socketAuthMiddleware
 * (registered in server.js). By the time any event fires here, every
 * socket has a verified socket.data.jwtUser.
 *
 * The user:join event now only carries roomId — identity comes from the token.
 */

const { v4: uuidv4 } = require('uuid');
const {
  saveMessage,
  getMessages,
  setUserOnline,
  removeUser,
  getOnlineUsers,
  isMessageOwner,
} = require('../services/messageStore');
const { buildSystemMessage } = require('../utils/systemMessage');
const { env } = require('../config/env');
const logger = require('../utils/logger');

// ── Constants ─────────────────────────────────────────────────────────────────
const ROOM_ID_RE     = /^[\w-]{1,64}$/;
const MAX_MSG_LEN    = 2_000;
const TYPING_TIMEOUT = 8_000;

// ── Typing state ──────────────────────────────────────────────────────────────
const typingState = new Map(); // roomId → Map<username, timeoutHandle>

// ── Rate limiter ──────────────────────────────────────────────────────────────
const msgRateLimiters = new Map(); // socketId → { count, resetAt }

function isRateLimited(socketId) {
  const now  = Date.now();
  const slot = msgRateLimiters.get(socketId) ?? { count: 0, resetAt: now + 60_000 };
  if (now > slot.resetAt) { slot.count = 0; slot.resetAt = now + 60_000; }
  slot.count++;
  msgRateLimiters.set(socketId, slot);
  return slot.count > env.SOCKET_MSG_RATE_LIMIT;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitise(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

async function broadcastOnlineUsers(io, roomId) {
  const all = await getOnlineUsers();
  io.to(roomId).emit('users:online', { users: all.filter((u) => u.roomId === roomId) });
}

function addTyping(io, roomId, username) {
  if (!typingState.has(roomId)) typingState.set(roomId, new Map());
  const room = typingState.get(roomId);
  if (room.has(username)) clearTimeout(room.get(username));
  room.set(username, setTimeout(() => removeTyping(io, roomId, username), TYPING_TIMEOUT));
  broadcastTyping(io, roomId);
}

function removeTyping(io, roomId, username) {
  const room = typingState.get(roomId);
  if (!room) return;
  clearTimeout(room.get(username));
  room.delete(username);
  if (room.size === 0) typingState.delete(roomId);
  broadcastTyping(io, roomId);
}

function broadcastTyping(io, roomId) {
  const room  = typingState.get(roomId);
  const users = room ? [...room.keys()] : [];
  io.to(roomId).emit('typing:update', { roomId, users });
}

// ── Main registration ─────────────────────────────────────────────────────────

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    // jwtUser is guaranteed by socketAuthMiddleware
    const { id: userId, username, avatar } = socket.data.jwtUser;
    const log = logger.child({ socketId: socket.id, userId, username });
    log.info('Authenticated socket connected');

    // ── 1. Join a room ───────────────────────────────────────────────────────
    // Identity comes from the verified JWT — only roomId is accepted from client.
    socket.on('user:join', async (payload = {}) => {
      if (socket.data.user) {
        return socket.emit('error', { message: 'Already joined a room.' });
      }

      const roomId = sanitise(payload.roomId ?? 'general', 64);
      if (!ROOM_ID_RE.test(roomId)) {
        return socket.emit('error', { message: 'Invalid room ID.' });
      }

      const userInfo = {
        id:       userId,
        socketId: socket.id,
        username,
        avatar,
        roomId,
        joinedAt: new Date().toISOString(),
      };

      socket.data.user = userInfo;
      socket.join(roomId);
      await setUserOnline(socket.id, userInfo);

      const history = await getMessages(roomId);
      socket.emit('room:history', { roomId, messages: history });
      await broadcastOnlineUsers(io, roomId);

      const sysMsg = buildSystemMessage(`${username} joined the room`, roomId);
      await saveMessage(roomId, sysMsg);
      io.to(roomId).emit('message:new', sysMsg);

      socket.emit('user:joined', { user: userInfo });
      log.info({ roomId }, 'User joined room');
    });

    // ── 2. Send message ──────────────────────────────────────────────────────
    socket.on('message:send', async (payload = {}) => {
      const user = socket.data.user;
      if (!user) return socket.emit('error', { message: 'Join a room first.' });
      if (isRateLimited(socket.id)) {
        return socket.emit('error', { message: 'Sending messages too fast.' });
      }

      const content = sanitise(payload.content, MAX_MSG_LEN);
      const roomId  = sanitise(payload.roomId, 64);

      if (!content)                         return;
      if (!ROOM_ID_RE.test(roomId))         return socket.emit('error', { message: 'Invalid room ID.' });
      if (!socket.rooms.has(roomId))        return socket.emit('error', { message: 'Not in that room.' });

      const message = {
        id:      uuidv4(),
        type:    'chat',
        content,
        roomId,
        author:  { id: user.id, username: user.username, avatar: user.avatar },
        replyTo: payload.replyTo ?? null,
        createdAt: new Date().toISOString(),
        edited:  false,
      };

      await saveMessage(roomId, message);
      io.to(roomId).emit('message:new', message);
      removeTyping(io, roomId, user.username);
    });

    // ── 3. Edit message ──────────────────────────────────────────────────────
    socket.on('message:edit', async (payload = {}) => {
      const user = socket.data.user;
      if (!user) return socket.emit('error', { message: 'Not in a room.' });

      const { messageId, roomId } = payload;
      const content = sanitise(payload.content, MAX_MSG_LEN);

      if (!content || !messageId || !ROOM_ID_RE.test(roomId ?? '')) {
        return socket.emit('error', { message: 'Invalid edit payload.' });
      }
      if (!socket.rooms.has(roomId)) return socket.emit('error', { message: 'Not in that room.' });
      if (!(await isMessageOwner(messageId, user.id))) {
        return socket.emit('error', { message: 'You can only edit your own messages.' });
      }

      io.to(roomId).emit('message:updated', { messageId, content, editedAt: new Date().toISOString() });
    });

    // ── 4. Delete message ────────────────────────────────────────────────────
    socket.on('message:delete', async (payload = {}) => {
      const user = socket.data.user;
      if (!user) return socket.emit('error', { message: 'Not in a room.' });

      const { messageId, roomId } = payload;
      if (!messageId || !ROOM_ID_RE.test(roomId ?? '')) {
        return socket.emit('error', { message: 'Invalid delete payload.' });
      }
      if (!socket.rooms.has(roomId)) return socket.emit('error', { message: 'Not in that room.' });
      if (!(await isMessageOwner(messageId, user.id))) {
        return socket.emit('error', { message: 'You can only delete your own messages.' });
      }

      io.to(roomId).emit('message:deleted', { messageId });
    });

    // ── 5. Typing indicators ─────────────────────────────────────────────────
    socket.on('typing:start', ({ roomId } = {}) => {
      const user = socket.data.user;
      if (!user || !ROOM_ID_RE.test(roomId ?? '')) return;
      addTyping(io, roomId, user.username);
    });

    socket.on('typing:stop', ({ roomId } = {}) => {
      const user = socket.data.user;
      if (!user || !ROOM_ID_RE.test(roomId ?? '')) return;
      removeTyping(io, roomId, user.username);
    });

    // ── 6. Reactions ─────────────────────────────────────────────────────────
    socket.on('reaction:add', (payload = {}) => {
      const user = socket.data.user;
      if (!user) return;
      const { messageId, roomId, emoji } = payload;
      if (!messageId || !ROOM_ID_RE.test(roomId ?? '') || !emoji) return;
      if (!socket.rooms.has(roomId)) return;

      io.to(roomId).emit('reaction:updated', {
        messageId,
        emoji:    emoji.slice(0, 10),
        userId:   user.id,
        username: user.username,
      });
    });

    // ── 7. Room switch ───────────────────────────────────────────────────────
    socket.on('room:switch', async (payload = {}) => {
      const user = socket.data.user;
      if (!user) return socket.emit('error', { message: 'Join a room first.' });

      const newRoomId = sanitise(payload.newRoomId, 64);
      if (!ROOM_ID_RE.test(newRoomId)) return socket.emit('error', { message: 'Invalid room ID.' });
      if (newRoomId === user.roomId)   return;

      const oldRoomId = user.roomId;
      socket.leave(oldRoomId);
      removeTyping(io, oldRoomId, user.username);

      user.roomId = newRoomId;
      socket.data.user = user;
      await setUserOnline(socket.id, user);
      socket.join(newRoomId);

      await broadcastOnlineUsers(io, oldRoomId);
      await broadcastOnlineUsers(io, newRoomId);

      const history = await getMessages(newRoomId);
      socket.emit('room:history', { roomId: newRoomId, messages: history });
      log.info({ from: oldRoomId, to: newRoomId }, 'User switched room');
    });

    // ── 8. Disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      log.info({ reason }, 'Socket disconnected');
      msgRateLimiters.delete(socket.id);

      const user = socket.data.user;
      if (!user) return;

      await removeUser(socket.id);
      removeTyping(io, user.roomId, user.username);

      const sysMsg = buildSystemMessage(`${user.username} left the room`, user.roomId);
      await saveMessage(user.roomId, sysMsg);
      io.to(user.roomId).emit('message:new', sysMsg);
      await broadcastOnlineUsers(io, user.roomId);
    });
  });
}

module.exports = { registerSocketHandlers };

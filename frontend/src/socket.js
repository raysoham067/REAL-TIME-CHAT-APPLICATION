/**
 * socket.js — Socket.io client with JWT auth.
 *
 * Exports a single managed socket instance.
 * The access token is passed in the handshake auth object.
 * On reconnect the latest token is used automatically.
 */

import { io } from 'socket.io-client';
import { getTokens, storeTokens, clearTokens } from './auth.js';
import { apiRefresh } from './api.js';

const BASE = import.meta.env.VITE_API_URL ?? '';

let socket = null;

// ── Connect ───────────────────────────────────────────────────────────────────

export function connectSocket() {
  if (socket?.connected) return socket;

  const { accessToken } = getTokens();
  if (!accessToken) throw new Error('No access token — log in first.');

  socket = io(BASE, {
    auth:             { token: accessToken },
    autoConnect:      true,
    reconnection:     true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 8_000,
    transports:       ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    console.info('[Socket] Connected:', socket.id);
  });

  socket.on('disconnect', (reason) => {
    console.info('[Socket] Disconnected:', reason);
  });

  socket.on('connect_error', async (err) => {
    console.warn('[Socket] Connect error:', err.message);

    // Server rejected our token → try a silent refresh then reconnect
    if (err.message === 'AUTH_INVALID' || err.message === 'AUTH_REQUIRED') {
      const { refreshToken } = getTokens();
      if (!refreshToken) {
        clearTokens();
        window.dispatchEvent(new CustomEvent('auth:expired'));
        return;
      }
      try {
        const data = await apiRefresh(refreshToken);
        storeTokens(data);
        socket.auth.token = data.accessToken;
        // Socket.io will auto-reconnect; token is now updated
      } catch {
        clearTokens();
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
    }
  });

  socket.on('reconnect', () => {
    // Push the latest token on every reconnect attempt
    const { accessToken: tok } = getTokens();
    if (tok) socket.auth.token = tok;
  });

  return socket;
}

// ── Disconnect ────────────────────────────────────────────────────────────────

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

// ── Accessor ──────────────────────────────────────────────────────────────────

export function getSocket() { return socket; }

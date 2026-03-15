/**
 * api.js — REST client for the Relay backend.
 *
 * Centralises all fetch calls, handles:
 *  - Authorization header injection
 *  - 401 → silent token refresh → retry once
 *  - Consistent error shape { message, status }
 */

import { getTokens, storeTokens, clearTokens } from './auth.js';

const BASE = import.meta.env.VITE_API_URL ?? '';   // empty = same origin (Vite proxy)

// ── Core fetch wrapper ────────────────────────────────────────────────────────

async function request(method, path, body, retry = true) {
  const { accessToken } = getTokens();
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Silent token refresh on 401 — retry the original request once
  if (res.status === 401 && retry) {
    const refreshed = await silentRefresh();
    if (refreshed) return request(method, path, body, false);
    // Refresh failed — user must log in again
    clearTokens();
    window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new ApiError('Session expired. Please log in again.', 401);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data;
}

async function silentRefresh() {
  const { refreshToken } = getTokens();
  if (!refreshToken) return false;
  try {
    const data = await request('POST', '/api/auth/refresh', { refreshToken }, false);
    storeTokens(data);
    return true;
  } catch {
    return false;
  }
}

// ── Error type ────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name   = 'ApiError';
  }
}

// ── Auth endpoints ────────────────────────────────────────────────────────────

export async function apiRegister({ username, password }) {
  return request('POST', '/api/auth/register', { username, password });
}

export async function apiLogin({ username, password }) {
  return request('POST', '/api/auth/login', { username, password });
}

export async function apiRefresh(refreshToken) {
  return request('POST', '/api/auth/refresh', { refreshToken }, false);
}

export async function apiLogout(refreshToken) {
  return request('POST', '/api/auth/logout', { refreshToken }, false).catch(() => {});
}

export async function apiMe() {
  return request('GET', '/api/auth/me');
}

// ── Chat endpoints ────────────────────────────────────────────────────────────

export async function apiGetMessages(roomId, limit = 50) {
  return request('GET', `/api/rooms/${encodeURIComponent(roomId)}/messages?limit=${limit}`);
}

export async function apiGetOnlineUsers() {
  return request('GET', '/api/users/online');
}

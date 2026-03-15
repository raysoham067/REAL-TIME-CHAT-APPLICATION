/**
 * auth.js — Client-side token lifecycle manager.
 *
 * Stores access + refresh tokens in memory (never localStorage for security).
 * Schedules a silent refresh 60 s before the access token expires.
 *
 * Note: tokens are lost on page refresh → user must re-login.
 * For "remember me" behaviour, store only the refresh token in an
 * httpOnly cookie (requires backend changes — see README for guidance).
 */

import { apiRefresh } from './api.js';

// ── In-memory token state ─────────────────────────────────────────────────────
let _accessToken   = null;
let _refreshToken  = null;
let _currentUser   = null;
let _refreshTimer  = null;

const REFRESH_BUFFER_MS = 60_000; // refresh 60 s before expiry

// ── Public API ────────────────────────────────────────────────────────────────

export function getTokens() {
  return { accessToken: _accessToken, refreshToken: _refreshToken };
}

export function getCurrentUser() {
  return _currentUser;
}

export function isAuthenticated() {
  return Boolean(_accessToken && _currentUser);
}

/** Called after login / register / refresh */
export function storeTokens({ user, accessToken, refreshToken }) {
  _accessToken  = accessToken;
  _refreshToken = refreshToken;
  _currentUser  = user;
  _scheduleRefresh(accessToken);
}

/** Clear all auth state (logout) */
export function clearTokens() {
  _accessToken  = null;
  _refreshToken = null;
  _currentUser  = null;
  clearTimeout(_refreshTimer);
}

// ── Silent refresh scheduling ─────────────────────────────────────────────────

function _scheduleRefresh(accessToken) {
  clearTimeout(_refreshTimer);
  try {
    const payload   = JSON.parse(atob(accessToken.split('.')[1]));
    const expiresMs = payload.exp * 1000;
    const delay     = Math.max(expiresMs - Date.now() - REFRESH_BUFFER_MS, 5_000);

    _refreshTimer = setTimeout(async () => {
      if (!_refreshToken) return;
      try {
        const data = await apiRefresh(_refreshToken);
        storeTokens(data);
      } catch {
        clearTokens();
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
    }, delay);
  } catch {
    // Non-parseable token — let it expire naturally
  }
}

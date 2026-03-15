/**
 * main.js — Application entry point.
 *
 * Wires together:
 *   1. Global styles
 *   2. Auth form → token storage
 *   3. Socket connection
 *   4. Sidebar + chat UI
 *   5. Session expiry handling
 */

// ── Styles ────────────────────────────────────────────────────────────────────
import './styles/global.css';
import './styles/auth.css';
import './styles/sidebar.css';
import './styles/chat.css';

// ── Modules ───────────────────────────────────────────────────────────────────
import { storeTokens, clearTokens, getCurrentUser } from './auth.js';
import { apiLogout } from './api.js';
import { connectSocket, disconnectSocket, getSocket } from './socket.js';
import { renderAuthForm } from './ui/auth-form.js';
import { renderSidebar }  from './ui/sidebar.js';
import { renderChat }     from './ui/chat.js';

// ── Config ────────────────────────────────────────────────────────────────────
const ROOMS = ['general', 'random', 'dev'];

// ── State ─────────────────────────────────────────────────────────────────────
let sidebarCtrl = null;
let chatCtrl    = null;
let activeRoom  = 'general';

// ── Boot ──────────────────────────────────────────────────────────────────────
function boot() {
  renderAuthForm(onAuthSuccess);

  // If session token expires mid-session, tear down and show auth again
  window.addEventListener('auth:expired', () => {
    clearTokens();
    teardownChat();
    renderAuthForm(onAuthSuccess);
  });
}

// ── Auth success ──────────────────────────────────────────────────────────────
function onAuthSuccess(tokenData) {
  storeTokens(tokenData);

  const socket = connectSocket();
  const user   = getCurrentUser();

  // Build UI
  sidebarCtrl = renderSidebar({
    currentUser: user.username,
    rooms:       ROOMS,
    activeRoom,
    onRoomSwitch: switchRoom,
    onLogout:     handleLogout,
  });

  chatCtrl = renderChat({
    currentUser: user,
    activeRoom,
    socket,
    onMenuClick: () => sidebarCtrl.toggle(),
  });

  // Join initial room
  socket.emit('user:join', { roomId: activeRoom });

  // Wire shared socket events that update both sidebar + chat
  socket.on('users:online', ({ users }) => {
    sidebarCtrl.updateOnlineUsers(users);
    chatCtrl.updateOnlineCount(users.length);
  });
}

// ── Room switching ────────────────────────────────────────────────────────────
function switchRoom(roomId) {
  if (!getSocket()?.connected) return;
  activeRoom = roomId;
  sidebarCtrl.setActiveRoom(roomId);
  chatCtrl.switchRoom(roomId);
  sidebarCtrl.close();                      // close sidebar on mobile after switch
  getSocket().emit('room:switch', { newRoomId: roomId });
}

// ── Logout ────────────────────────────────────────────────────────────────────
async function handleLogout() {
  const { refreshToken } = (await import('./auth.js')).getTokens();
  await apiLogout(refreshToken);
  clearTokens();
  disconnectSocket();
  teardownChat();
  renderAuthForm(onAuthSuccess);
}

// ── Teardown ──────────────────────────────────────────────────────────────────
function teardownChat() {
  sidebarCtrl?.el?.remove();
  chatCtrl?.el?.remove();
  sidebarCtrl = null;
  chatCtrl    = null;
  activeRoom  = 'general';
}

// ── Start ─────────────────────────────────────────────────────────────────────
boot();

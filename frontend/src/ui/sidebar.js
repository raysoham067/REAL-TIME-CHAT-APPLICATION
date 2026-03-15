/**
 * ui/sidebar.js — Sidebar with room list and online users.
 *
 * @param {object} opts
 * @param {string}   opts.currentUser  - logged-in username
 * @param {string[]} opts.rooms        - available room IDs
 * @param {string}   opts.activeRoom   - initially active room
 * @param {function} opts.onRoomSwitch - (roomId) => void
 * @param {function} opts.onLogout     - () => void
 */

export function renderSidebar({ currentUser, rooms, activeRoom, onRoomSwitch, onLogout }) {
  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  sidebar.id = 'sidebar';

  sidebar.innerHTML = `
    <div class="sidebar-logo">
      <span class="logo-text">Re<span>lay</span></span>
      <button class="logout-btn" id="logoutBtn" title="Sign out">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        Sign out
      </button>
    </div>

    <div class="sidebar-section">Channels</div>
    <div class="room-list" id="roomList"></div>

    <div class="sidebar-section" style="margin-top:8px">
      Online — <span id="onlineCount">0</span>
    </div>
    <div class="users-section" id="userList"></div>
  `;

  document.getElementById('app').appendChild(sidebar);

  // ── Room list ─────────────────────────────────────────────────────────────────
  const roomListEl = sidebar.querySelector('#roomList');
  let _activeRoom  = activeRoom;

  function renderRooms() {
    roomListEl.innerHTML = rooms.map(room => `
      <div class="room-item ${room === _activeRoom ? 'active' : ''}" data-room="${room}">
        <span class="room-hash">#</span>${room}
      </div>
    `).join('');

    roomListEl.querySelectorAll('.room-item').forEach(item => {
      item.addEventListener('click', () => {
        const roomId = item.dataset.room;
        if (roomId === _activeRoom) return;
        _activeRoom = roomId;
        renderRooms();
        onRoomSwitch(roomId);
      });
    });
  }
  renderRooms();

  // ── Online users ──────────────────────────────────────────────────────────────
  function updateOnlineUsers(users) {
    const count = users.length;
    sidebar.querySelector('#onlineCount').textContent = count;

    const listEl = sidebar.querySelector('#userList');
    listEl.innerHTML = users.map(u => {
      const isMe = u.username === currentUser;
      return `
        <div class="user-item ${isMe ? 'user-me' : ''}">
          <div class="user-avatar" style="background:${hashColor(u.username)}">
            <span>${u.username[0].toUpperCase()}</span>
          </div>
          ${escHtml(u.username)}
          ${isMe ? '<span class="user-me-tag">you</span>' : ''}
          <div class="user-dot"></div>
        </div>
      `;
    }).join('');
  }

  // ── Logout ────────────────────────────────────────────────────────────────────
  sidebar.querySelector('#logoutBtn').addEventListener('click', onLogout);

  // ── Mobile toggle ─────────────────────────────────────────────────────────────
  function toggle() { sidebar.classList.toggle('open'); }
  function close()  { sidebar.classList.remove('open'); }

  // Public API
  return {
    el: sidebar,
    setActiveRoom(roomId) {
      _activeRoom = roomId;
      renderRooms();
    },
    updateOnlineUsers,
    toggle,
    close,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashColor(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffff;
  const hue = (h % 360 + 360) % 360;
  return `hsl(${hue}, 50%, 28%)`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

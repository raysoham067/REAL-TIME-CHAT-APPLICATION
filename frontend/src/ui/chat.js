/**
 * ui/chat.js — Main chat panel.
 *
 * Renders the topbar, message list, typing indicator and composer.
 * Communicates via the socket passed in; does not import socket.js directly
 * so it stays testable and reusable.
 *
 * @param {object} opts
 * @param {object}   opts.currentUser  - { id, username, avatar }
 * @param {string}   opts.activeRoom   - initial room ID
 * @param {object}   opts.socket       - connected socket.io socket
 * @param {function} opts.onMenuClick  - () => void  (mobile sidebar toggle)
 */

export function renderChat({ currentUser, activeRoom, socket, onMenuClick }) {
  const main = document.createElement('div');
  main.className = 'main';

  main.innerHTML = `
    <!-- Topbar -->
    <div class="topbar">
      <button class="topbar-menu-btn" id="menuBtn" title="Channels">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="3" y1="6"  x2="21" y2="6"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
      <div class="topbar-room">
        <span class="hash">#</span>
        <span id="roomName">${activeRoom}</span>
      </div>
      <div class="topbar-divider"></div>
      <div class="topbar-count">
        <div class="online-dot"></div>
        <span id="onlineCountTop">0 online</span>
      </div>
      <div class="conn-badge disconnected" id="connBadge">● disconnected</div>
    </div>

    <!-- Messages -->
    <div class="messages" id="messages"></div>

    <!-- Typing indicator -->
    <div class="typing-bar" id="typingBar"></div>

    <!-- Composer -->
    <div class="composer">
      <div class="composer-inner">
        <textarea
          class="composer-input"
          id="msgInput"
          placeholder="Message #${activeRoom}…"
          rows="1"
          maxlength="2000"
        ></textarea>
        <button class="composer-send" id="sendBtn" title="Send (Enter)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  document.getElementById('app').appendChild(main);

  // ── DOM refs ──────────────────────────────────────────────────────────────────
  const messagesEl      = main.querySelector('#messages');
  const msgInput        = main.querySelector('#msgInput');
  const sendBtn         = main.querySelector('#sendBtn');
  const typingBar       = main.querySelector('#typingBar');
  const connBadge       = main.querySelector('#connBadge');
  const roomNameEl      = main.querySelector('#roomName');
  const onlineCountTop  = main.querySelector('#onlineCountTop');
  const menuBtn         = main.querySelector('#menuBtn');

  let _activeRoom   = activeRoom;
  let _typingTimer  = null;

  menuBtn.addEventListener('click', onMenuClick);

  // ── Socket events ─────────────────────────────────────────────────────────────

  socket.on('connect',    () => setBadge(true));
  socket.on('disconnect', () => setBadge(false));

  socket.on('room:history', ({ messages }) => {
    messagesEl.innerHTML = '';
    messages.forEach(renderMessage);
    scrollToBottom(false);
  });

  socket.on('message:new', (msg) => {
    const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
    renderMessage(msg);
    if (atBottom) scrollToBottom();
  });

  socket.on('message:updated', ({ messageId, content, editedAt }) => {
    const bubble = messagesEl.querySelector(`[data-id="${messageId}"] .msg-bubble`);
    if (bubble) bubble.textContent = content;

    // Show or update edited tag
    let edited = messagesEl.querySelector(`[data-id="${messageId}"] .msg-edited`);
    if (!edited) {
      edited = document.createElement('div');
      edited.className = 'msg-edited';
      messagesEl.querySelector(`[data-id="${messageId}"] .msg-bubble-wrap`)?.appendChild(edited);
    }
    const time = new Date(editedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    edited.textContent = `edited ${time}`;
  });

  socket.on('message:deleted', ({ messageId }) => {
    const el = messagesEl.querySelector(`[data-id="${messageId}"]`);
    if (el) {
      el.style.opacity = '0';
      el.style.transition = 'opacity .3s';
      setTimeout(() => el.remove(), 300);
    }
  });

  socket.on('typing:update', ({ users }) => {
    const others = users.filter(u => u !== currentUser.username);
    if (!others.length) {
      typingBar.innerHTML = '';
    } else {
      const names = others.slice(0, 3).join(', ');
      const verb  = others.length === 1 ? 'is' : 'are';
      typingBar.innerHTML = `
        <span class="typing-dots"><span></span><span></span><span></span></span>
        <span>${escHtml(names)} ${verb} typing…</span>
      `;
    }
  });

  socket.on('users:online', ({ users }) => {
    onlineCountTop.textContent = `${users.length} online`;
  });

  socket.on('error', ({ message }) => {
    console.error('[Chat] Server error:', message);
  });

  // Reflect connection state on mount
  if (socket.connected) setBadge(true);

  // ── Send message ──────────────────────────────────────────────────────────────

  function sendMessage() {
    const content = msgInput.value.trim();
    if (!content) return;
    socket.emit('message:send', { content, roomId: _activeRoom });
    socket.emit('typing:stop',  { roomId: _activeRoom });
    msgInput.value = '';
    msgInput.style.height = '22px';
  }

  sendBtn.addEventListener('click', sendMessage);
  msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize + typing indicator
  msgInput.addEventListener('input', () => {
    msgInput.style.height = '22px';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 140) + 'px';

    socket.emit('typing:start', { roomId: _activeRoom });
    clearTimeout(_typingTimer);
    _typingTimer = setTimeout(() => {
      socket.emit('typing:stop', { roomId: _activeRoom });
    }, 2_000);
  });

  // ── Render helpers ────────────────────────────────────────────────────────────

  function renderMessage(msg) {
    if (msg.type === 'system') {
      const el = document.createElement('div');
      el.className = 'msg-system';
      el.innerHTML = `<span class="msg-system-text">— ${escHtml(msg.content)} —</span>`;
      messagesEl.appendChild(el);
      return;
    }

    const isMe     = msg.author?.id === currentUser.id;
    const initial  = (msg.author?.username?.[0] ?? '?').toUpperCase();
    const time     = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const bgColor  = hashColor(msg.author?.username ?? '');

    const wrap = document.createElement('div');
    wrap.className = 'msg-group';
    wrap.dataset.id = msg.id;

    wrap.innerHTML = `
      <div class="msg-row ${isMe ? 'mine' : ''}">
        <div class="msg-avatar" style="background:${bgColor}">
          <span>${initial}</span>
        </div>
        <div class="msg-bubble-wrap">
          <div class="msg-meta">
            <span class="msg-username">${escHtml(msg.author?.username ?? 'Unknown')}</span>
            <span class="msg-time">${time}</span>
          </div>
          <div class="msg-bubble">${escHtml(msg.content)}</div>
          ${msg.edited ? `<div class="msg-edited">edited</div>` : ''}
        </div>
      </div>
    `;

    messagesEl.appendChild(wrap);
  }

  function scrollToBottom(smooth = true) {
    requestAnimationFrame(() => {
      messagesEl.scrollTo({
        top:      messagesEl.scrollHeight,
        behavior: smooth ? 'smooth' : 'instant',
      });
    });
  }

  function setBadge(connected) {
    connBadge.className = `conn-badge ${connected ? 'connected' : 'disconnected'}`;
    connBadge.textContent = connected ? '● connected' : '● disconnected';
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  return {
    el: main,

    /** Called when the user switches rooms */
    switchRoom(roomId) {
      _activeRoom = roomId;
      roomNameEl.textContent   = roomId;
      msgInput.placeholder     = `Message #${roomId}…`;
      messagesEl.innerHTML     = '';
      typingBar.innerHTML      = '';
    },

    /** Update online count in topbar */
    updateOnlineCount(count) {
      onlineCountTop.textContent = `${count} online`;
    },
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffff;
  return `hsl(${(h % 360 + 360) % 360}, 50%, 28%)`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

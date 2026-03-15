/**
 * ui/auth-form.js — Login / Register UI component.
 */

import { apiLogin, apiRegister } from '../api.js';

// Eye icons (show / hide)
const EYE_OPEN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
  <circle cx="12" cy="12" r="3"/>
</svg>`;

const EYE_CLOSED = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
  <line x1="1" y1="1" x2="23" y2="23"/>
</svg>`;

export function renderAuthForm(onSuccess) {
  const overlay = document.createElement('div');
  overlay.className = 'auth-overlay';
  overlay.id = 'authOverlay';

  overlay.innerHTML = `
    <div class="auth-box">
      <div class="auth-logo">Re<span>lay</span></div>
      <div class="auth-sub">// real-time chat</div>

      <div class="auth-tabs">
        <button class="auth-tab active" data-tab="login">Sign In</button>
        <button class="auth-tab"        data-tab="register">Register</button>
      </div>

      <div id="authError" class="auth-error"></div>

      <!-- Login form -->
      <div id="loginForm">
        <div class="auth-field">
          <label class="auth-label">Username</label>
          <input class="auth-input" id="loginUsername" type="text"
            placeholder="your_username" autocomplete="username" maxlength="32" />
        </div>
        <div class="auth-field">
          <label class="auth-label">Password</label>
          <div class="password-wrap">
            <input class="auth-input" id="loginPassword" type="password"
              placeholder="your password" autocomplete="current-password" />
            <button class="pw-toggle" type="button" data-target="loginPassword" title="Show / hide password">
              ${EYE_OPEN}
            </button>
          </div>
        </div>
        <button class="auth-btn" id="loginBtn">
          <div class="spinner"></div>
          <span class="btn-text">Sign In →</span>
        </button>
      </div>

      <!-- Register form -->
      <div id="registerForm" style="display:none">
        <div class="auth-field">
          <label class="auth-label">Username</label>
          <input class="auth-input" id="regUsername" type="text"
            placeholder="choose_a_username" autocomplete="username" maxlength="32" />
        </div>
        <div class="auth-field">
          <label class="auth-label">Password</label>
          <div class="password-wrap">
            <input class="auth-input" id="regPassword" type="password"
              placeholder="choose a password" autocomplete="new-password" />
            <button class="pw-toggle" type="button" data-target="regPassword" title="Show / hide password">
              ${EYE_OPEN}
            </button>
          </div>
        </div>
        <div class="auth-field">
          <label class="auth-label">Confirm Password</label>
          <div class="password-wrap">
            <input class="auth-input" id="regConfirm" type="password"
              placeholder="repeat password" autocomplete="new-password" />
            <button class="pw-toggle" type="button" data-target="regConfirm" title="Show / hide password">
              ${EYE_OPEN}
            </button>
          </div>
        </div>
        <button class="auth-btn" id="registerBtn">
          <div class="spinner"></div>
          <span class="btn-text">Create Account →</span>
        </button>
      </div>

      <div class="auth-notice">
        Username: 3–32 chars (letters, numbers, _ . -)
      </div>
    </div>
  `;

  document.getElementById('app').appendChild(overlay);

  // ── Show / hide password toggles ─────────────────────────────────────────────
  overlay.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = overlay.querySelector(`#${btn.dataset.target}`);
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.innerHTML = showing ? EYE_OPEN : EYE_CLOSED;
      btn.classList.toggle('active', !showing);
      input.focus();
    });
  });

  // ── DOM refs ──────────────────────────────────────────────────────────────────
  const tabs         = overlay.querySelectorAll('.auth-tab');
  const errorEl      = overlay.querySelector('#authError');
  const loginForm    = overlay.querySelector('#loginForm');
  const registerForm = overlay.querySelector('#registerForm');
  const loginBtn     = overlay.querySelector('#loginBtn');
  const registerBtn  = overlay.querySelector('#registerBtn');

  let activeTab = 'login';

  // ── Tab switching ─────────────────────────────────────────────────────────────
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      activeTab = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === activeTab));
      loginForm.style.display    = activeTab === 'login'    ? '' : 'none';
      registerForm.style.display = activeTab === 'register' ? '' : 'none';
      hideError();
    });
  });

  // ── Error helpers ─────────────────────────────────────────────────────────────
  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.add('visible');
  }
  function hideError() {
    errorEl.classList.remove('visible');
  }

  function setLoading(btn, loading) {
    btn.classList.toggle('loading', loading);
    btn.disabled = loading;
  }

  // ── Login ─────────────────────────────────────────────────────────────────────
  async function handleLogin() {
    hideError();
    const username = overlay.querySelector('#loginUsername').value.trim();
    const password = overlay.querySelector('#loginPassword').value;

    if (!username || !password) return showError('Please enter username and password.');

    setLoading(loginBtn, true);
    try {
      const data = await apiLogin({ username, password });
      overlay.remove();
      onSuccess(data);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(loginBtn, false);
    }
  }

  // ── Register ──────────────────────────────────────────────────────────────────
  async function handleRegister() {
    hideError();
    const username = overlay.querySelector('#regUsername').value.trim();
    const password = overlay.querySelector('#regPassword').value;
    const confirm  = overlay.querySelector('#regConfirm').value;

    if (!username) return showError('Username is required.');
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
      return showError('Username: 3–32 chars (letters, numbers, _ . - only).');
    }
    if (!password) return showError('Password is required.');
    if (password !== confirm) return showError('Passwords do not match.');

    setLoading(registerBtn, true);
    try {
      const data = await apiRegister({ username, password });
      overlay.remove();
      onSuccess(data);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(registerBtn, false);
    }
  }

  // ── Event bindings ────────────────────────────────────────────────────────────
  loginBtn.addEventListener('click', handleLogin);
  registerBtn.addEventListener('click', handleRegister);

  overlay.querySelector('#loginPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
  overlay.querySelector('#regConfirm').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleRegister();
  });

  // Focus username on open
  setTimeout(() => overlay.querySelector('#loginUsername')?.focus(), 100);
}

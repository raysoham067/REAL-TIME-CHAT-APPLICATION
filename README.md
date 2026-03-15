# Relay — Real-Time Chat App

Full-stack monorepo: **Node.js backend** + **Vite frontend**, JWT authentication, Socket.io, optional Redis.

```
relay/
├── backend/          Node.js + Express + Socket.io + JWT + Redis
└── frontend/         Vite + Vanilla JS (modular, no framework required)
```

---

## Quick Start

```bash
# 1. Install all dependencies
npm run install:all

# 2. Generate JWT secrets
cd backend && npm run keygen
# Paste the two values into backend/.env

# 3. Start both servers (hot-reload on both sides)
npm run dev
```

| Service | URL | Notes |
|---|---|---|
| **Frontend** | http://localhost:5173 | Vite dev server with HMR |
| **Backend**  | http://localhost:3000 | Node.js + Socket.io |

The Vite dev server proxies `/api/*` and WebSocket connections to the backend automatically — no CORS config needed in development.

---

## Project Structure

```
relay/
├── package.json              ← Monorepo root (npm workspaces + concurrently)
├── .gitignore
│
├── backend/
│   ├── src/
│   │   ├── server.js         ← Express + Socket.io entry point
│   │   ├── config/
│   │   │   └── env.js        ← Validated env config (fail-fast)
│   │   ├── middleware/
│   │   │   └── auth.js       ← requireAuth / socketAuthMiddleware
│   │   ├── routes/
│   │   │   ├── auth.js       ← POST /api/auth/{register,login,refresh,logout}
│   │   │   └── api.js        ← GET /api/rooms/:id/messages, /users/online
│   │   ├── services/
│   │   │   ├── redis.js      ← Singleton Redis client
│   │   │   ├── redisAdapter.js ← Socket.io horizontal-scaling adapter
│   │   │   ├── messageStore.js ← Message + presence persistence
│   │   │   ├── userStore.js  ← User registration & lookup
│   │   │   └── tokenStore.js ← JWT issue / verify / rotate / blacklist
│   │   ├── socket/
│   │   │   └── index.js      ← All Socket.io event handlers
│   │   └── utils/
│   │       ├── logger.js     ← Pino structured logger
│   │       └── systemMessage.js
│   ├── .env                  ← Backend secrets (gitignored)
│   └── package.json
│
└── frontend/
    ├── index.html            ← Vite entry point
    ├── vite.config.js        ← Dev proxy config
    ├── .env                  ← VITE_API_URL 
    ├── package.json
    └── src/
        ├── main.js           ← App bootstrap — wires auth → chat
        ├── auth.js           ← Token lifecycle (store, refresh timer)
        ├── api.js            ← REST client with auto 401 retry
        ├── socket.js         ← Socket.io client with JWT handshake
        ├── styles/
        │   ├── global.css    ← Design tokens + reset + animations
        │   ├── auth.css      ← Login / register overlay
        │   ├── sidebar.css   ← Room list + user presence
        │   └── chat.css      ← Topbar + messages + composer
        └── ui/
            ├── auth-form.js  ← Login / register component
            ├── sidebar.js    ← Sidebar component
            └── chat.js       ← Chat panel component
```

---

## Available Scripts

From the **root** (`relay/`):

| Command | Description |
|---|---|
| `npm run dev` | Start both backend and frontend with hot-reload |
| `npm run dev:backend` | Backend only |
| `npm run dev:frontend` | Frontend only |
| `npm run build` | Build frontend for production (`frontend/dist/`) |
| `npm run start` | Start backend in production mode |
| `npm run install:all` | Install all workspace dependencies |

From **`backend/`** only:

| Command | Description |
|---|---|
| `npm run keygen` | Generate JWT_SECRET + REFRESH_SECRET |
| `npm run dev` | Hot-reload with nodemon |
| `npm start` | Production start |

---

## Auth Flow

```
User clicks "Register" or "Sign In"
        │
        ▼
POST /api/auth/register  or  POST /api/auth/login
        │
        ▼
Response: { user, accessToken (15m), refreshToken (7d) }
        │
        ├─ storeTokens() ← tokens in memory (never localStorage)
        ├─ scheduleRefresh() ← silent refresh 60s before expiry
        │
        ▼
io({ auth: { token: accessToken } })
        │
        ▼
socketAuthMiddleware verifies JWT on handshake
        │
        ▼
socket.emit('user:join', { roomId: 'general' })
        │
        ▼
Identity = JWT claims (username, id) — client cannot spoof
```

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Default | |
|---|---|---|
| `NODE_ENV` | `development` | |
| `PORT` | `3000` | |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Change to your frontend domain in prod |
| `JWT_SECRET` | ephemeral in dev | **Required in prod** — `npm run keygen` |
| `REFRESH_SECRET` | ephemeral in dev | **Required in prod** |
| `JWT_EXPIRES_IN` | `15m` | Access token lifetime |
| `REFRESH_EXPIRES_IN` | `7d` | Refresh token lifetime |
| `BCRYPT_ROUNDS` | `12` | Password hashing cost |
| `REDIS_URL` | none | Enables persistence + horizontal scaling |
| `LOG_LEVEL` | `info` | `trace`/`debug`/`info`/`warn`/`error`/`fatal` |

### Frontend (`frontend/.env`)

| Variable | Default | |
|---|---|---|
| `VITE_API_URL` | `` (empty) | Empty = same origin via Vite proxy. In prod set to your backend URL. |



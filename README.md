# LAKSH-s-ERP — Kirana ERP System

A full-stack billing and inventory management system for Kirana (grocery) stores.

## Architecture

| Layer       | Directory    | Hosted On | URL                                              |
| ----------- | ------------ | --------- | ------------------------------------------------ |
| **Frontend** | `/frontend`  | Vercel    | https://laksh-s-erp.vercel.app                   |
| **Backend**  | `/backend`   | Render    | https://laksh-s-erp-1.onrender.com               |

## Setup

### Backend (Render)

```bash
cd backend
cp .env.example .env   # fill in your JWT_SECRET
npm install
npm start              # starts on PORT 8000
```

**Render Settings:**
- **Root Directory:** `backend`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Environment Variables:** Set `JWT_SECRET`, `FRONTEND_URL`, `NODE_ENV=production`

### Frontend (Vercel)

The frontend is pure HTML/CSS/JS. Vercel rewrites `/api/*` requests to the Render backend.

**Vercel Settings:**
- **Root Directory:** `frontend`
- **Framework Preset:** Other
- **Build Command:** _(leave empty)_
- **Output Directory:** `.`

## Environment Variables (Backend)

| Variable       | Required | Default | Description                 |
| -------------- | -------- | ------- | --------------------------- |
| `JWT_SECRET`   | ✅       | —       | Secret key for JWT tokens   |
| `PORT`         | ❌       | 8000    | Server port                 |
| `FRONTEND_URL` | ❌       | Vercel  | Allowed CORS origin         |
| `NODE_ENV`     | ❌       | dev     | `development` / `production`|
| `JWT_EXPIRES_IN` | ❌     | 8h      | Token expiry duration       |

## ⚠️ Note on Database

This app uses **SQLite** which stores data in a local file. On Render's free tier, the filesystem resets on each deploy. For persistent data, consider using Render's Persistent Disk or switching to PostgreSQL.

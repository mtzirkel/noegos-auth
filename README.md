# NoEgos Auth

Lightweight authentication service for No Egos Underwater apps. TOTP-only, no passwords, no email.

## How it works

1. User visits any app, gets redirected to auth service login
2. No account? Click "Request Access" -- enter a username and optional message
3. Admin approves the request, assigns which apps the user can access
4. User receives a one-time setup link, scans QR code with authenticator app
5. User logs in with username + 6-digit TOTP code
6. JWT cookie set on `.noegosunderwater.com` -- user is authenticated across all apps

## Stack

- **SvelteKit** (TypeScript) -- UI + API
- **Postgres** -- users, sessions, app registry, access control
- **otpauth** -- TOTP generation and verification
- **jose** -- JWT signing (Ed25519) and verification
- **qrcode** -- QR code generation for authenticator setup
- **Tailwind CSS + DaisyUI** -- styling
- **adapter-node** -- production deployment

## Features

- TOTP-only authentication (no passwords, no email, no SMTP)
- Admin approval workflow for new users
- Per-app access control with roles
- Cross-subdomain JWT cookies (*.noegosunderwater.com)
- JWKS endpoint for local token verification by consuming apps
- Long-lived sessions (90 days default)
- Auto-generated Ed25519 signing keys (stored in Postgres)

## Setup

```bash
npm install
createdb noegos_auth
cp .env.example .env
# Edit .env with your DATABASE_URL
npm run dev
# Visit /admin/seed to create the admin account
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Postgres connection string | required |
| `COOKIE_DOMAIN` | Cookie domain (`.noegosunderwater.com` in prod) | `localhost` |
| `AUTH_URL` | Base URL of this auth service | `http://localhost:5173` |
| `SESSION_DAYS` | JWT/session lifetime in days | `90` |

## Consuming Apps

Read the `noegos_auth` cookie in your app's middleware/hooks, verify the JWT using the JWKS endpoint at `/api/jwks`, and check the user's app access list includes your app's slug.

### API Endpoints

- `GET /api/verify` -- verify token, returns user info + app access
- `GET /api/jwks` -- public signing keys for local JWT verification
- `POST /login` -- username + TOTP code
- `POST /request-access` -- submit access request
- `GET /setup/:token` -- TOTP setup page (one-time link)

## Data Model

- **apps** -- registered applications (slug, name, url)
- **users** -- accounts (username, totp_secret, is_admin)
- **access_requests** -- pending/approved/denied requests
- **app_access** -- user-to-app access with per-app roles
- **sessions** -- active JWT sessions (for revocation)

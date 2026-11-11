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

## OAuth 2.1 for agents (MCP)

noegos-auth is also an OAuth 2.1 authorization server, so AI agents (Claude.ai /
Claude Desktop custom connectors, ChatGPT, Hermes/Flow, Claude Code) can act on a
user's behalf in ONE app without cookies.

- Metadata: `GET /.well-known/oauth-authorization-server`
- Dynamic client registration (public clients only): `POST /oauth/register`
- Authorize (TOTP login + consent): `GET /oauth/authorize` — PKCE S256 and `resource` are required
- Token (authorization_code, refresh_token): `POST /oauth/token`
- Revoke: `POST /oauth/revoke`
- Users manage connected agents at `/connections`; admins cut access via `/admin/users`.

**Tokens.** Access tokens are EdDSA JWTs (`typ: at+jwt`, 1h) signed with the same key as
session cookies:
`{ iss, sub, aud: <resource>, username, client_id, scope: "read write", apps: [{slug, name, role}] }`.
Refresh tokens are opaque, rotate on every use, and replaying an old one revokes the chain.

### Making your app an OAuth resource server (e.g. an MCP endpoint)

1. In `/admin/apps`, set the app's **URL** (e.g. `https://ww-journal.noegosunderwater.com`).
   Any `resource` under that URL (like `/mcp`) maps to the app.
2. Serve `GET /.well-known/oauth-protected-resource` (RFC 9728) from the app:
   `{ "resource": "<origin>/mcp", "authorization_servers": ["https://auth.noegosunderwater.com"], "scopes_supported": ["read","write"] }`
3. On the protected endpoint, require `Authorization: Bearer <jwt>` and verify with the JWKS:
   `issuer = AUTH_URL`, `audience = <origin>/mcp`, header `typ = at+jwt`, then check
   `apps[].slug` and `scope`. On failure return `401` with
   `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`.
4. Don't let your cookie middleware redirect those paths to `/login`.

`read` / `write` are the only scopes; because tokens are audience-bound they mean "read/write in this app".

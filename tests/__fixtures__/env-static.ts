// Stub for $env/static/private — used by vitest when running outside the SvelteKit
// build pipeline. Tests that need different values can vi.mock() this module.
export const DATABASE_URL = 'postgres://localhost/noegos_auth_test';
export const COOKIE_DOMAIN = 'localhost';
export const AUTH_URL = 'http://localhost:5173';
export const SESSION_DAYS = '90';

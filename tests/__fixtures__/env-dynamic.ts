// Stub for $env/dynamic/private — used by vitest when running outside the SvelteKit
// build pipeline. Tests that need different values can vi.mock() this module.
export const env = {
	DATABASE_URL: 'postgres://localhost/noegos_auth_test',
	COOKIE_DOMAIN: 'localhost',
	AUTH_URL: 'http://localhost:5173',
	SESSION_DAYS: '90'
};

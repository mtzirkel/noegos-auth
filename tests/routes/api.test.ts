/**
 * Route handler tests for noegos-auth API endpoints
 *
 * Strategy: import the GET handler functions directly and call them with
 * minimal mock RequestEvent objects. This tests route behavior (status codes,
 * response shapes) without needing a running HTTP server.
 *
 * The db module is mocked so no Postgres connection is required.
 * The auth module's initKeys() is called once to generate an in-memory keypair.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

// Must mock db before any auth imports fire
vi.mock('$lib/server/db.js', () => {
	const mockSql = Object.assign(vi.fn().mockResolvedValue([]), {
		json: (v: unknown) => v
	});
	return { sql: mockSql };
});

import { initKeys, createToken } from '$lib/server/auth.js';

// ---------------------------------------------------------------------------
// GET /api/jwks
// ---------------------------------------------------------------------------

describe('GET /api/jwks', () => {
	beforeAll(async () => {
		// Generate ephemeral keys so getPublicJwk() returns a value
		await initKeys();
	});

	it('returns 200 with a JWKS object containing the public key', async () => {
		// Requirement: consuming apps call this endpoint to fetch the public key
		// for local JWT verification. Must return a valid JWKS structure.
		const { GET } = await import('../../src/routes/api/jwks/+server.js');

		// Minimal mock event — jwks route only uses the return value of getPublicJwk()
		const event = {} as Parameters<typeof GET>[0];
		const response = await GET(event);

		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.keys).toBeInstanceOf(Array);
		expect(body.keys).toHaveLength(1);

		const key = body.keys[0];
		expect(key.kid).toBe('noegos-auth-signing');
		expect(key.use).toBe('sig');
		expect(key.alg).toBe('EdDSA');
		expect(key.kty).toBe('OKP');
		// Must be the PUBLIC key only — no private key material
		expect(key.d).toBeUndefined();
	});

	it('sets CORS and Cache-Control headers', async () => {
		// Requirement: consuming apps on other subdomains must be able to fetch
		// this endpoint, and CDN/browser caching should reduce load
		const { GET } = await import('../../src/routes/api/jwks/+server.js');
		const event = {} as Parameters<typeof GET>[0];
		const response = await GET(event);

		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(response.headers.get('Cache-Control')).toContain('max-age=3600');
	});
});

// ---------------------------------------------------------------------------
// GET /api/verify
// ---------------------------------------------------------------------------

describe('GET /api/verify', () => {
	beforeAll(async () => {
		await initKeys();
	});

	function makeEvent(overrides: {
		authHeader?: string;
		cookieToken?: string;
	} = {}): Parameters<import('../../src/routes/api/verify/+server.js')['GET']>[0] {
		return {
			request: {
				headers: {
					get: (name: string) =>
						name === 'authorization' ? (overrides.authHeader ?? null) : null
				}
			},
			cookies: {
				get: (name: string) =>
					name === 'noegos_auth' ? (overrides.cookieToken ?? undefined) : undefined
			}
		} as unknown as Parameters<import('../../src/routes/api/verify/+server.js')['GET']>[0];
	}

	it('returns 401 when no token is present (no header, no cookie)', async () => {
		// Requirement: unauthenticated requests must get a 401, not a 500 or 200.
		// This is the guard that all consuming apps rely on.
		const { GET } = await import('../../src/routes/api/verify/+server.js');

		const response = await GET(makeEvent());
		expect(response.status).toBe(401);

		const body = await response.json();
		expect(body.authenticated).toBe(false);
	});

	it('returns 401 for a garbage token in Authorization header', async () => {
		// Requirement: malformed tokens from bad actors must be rejected gracefully
		const { GET } = await import('../../src/routes/api/verify/+server.js');

		const response = await GET(makeEvent({ authHeader: 'Bearer this.is.garbage' }));
		expect(response.status).toBe(401);

		const body = await response.json();
		expect(body.authenticated).toBe(false);
	});

	it('returns 401 for a garbage token in cookie', async () => {
		// Requirement: corrupted cookies must be rejected, not cause a 500 error
		const { GET } = await import('../../src/routes/api/verify/+server.js');

		const response = await GET(makeEvent({ cookieToken: 'corrupted-token' }));
		expect(response.status).toBe(401);
	});

	it('returns 200 with user info for a valid Bearer token', async () => {
		// Requirement: a valid JWT presented as a Bearer token must return the
		// authenticated user's id, username, admin flag, and app access list
		const { GET } = await import('../../src/routes/api/verify/+server.js');
		const { sql } = await import('$lib/server/db.js');

		// createToken inserts a session row — mock that insert
		vi.mocked(sql).mockResolvedValueOnce([]);
		const appAccess = [{ slug: 'test-app', name: 'Test App', role: 'user' }];
		const { jwt } = await createToken('user-abc', 'diana', false, appAccess);

		// verifyToken looks up the session — mock it as found
		vi.mocked(sql).mockResolvedValueOnce([{ id: 'session-1' }]);

		const response = await GET(makeEvent({ authHeader: `Bearer ${jwt}` }));
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.authenticated).toBe(true);
		expect(body.user.username).toBe('diana');
		expect(body.user.id).toBe('user-abc');
		expect(body.user.isAdmin).toBe(false);
		expect(body.user.apps).toEqual(appAccess);
	});

	it('returns 200 with user info for a valid cookie token', async () => {
		// Requirement: the JWT cookie set at login must also be accepted by /api/verify
		// (not just the Authorization header) so server-side rendering works
		const { GET } = await import('../../src/routes/api/verify/+server.js');
		const { sql } = await import('$lib/server/db.js');

		vi.mocked(sql).mockResolvedValueOnce([]);
		const { jwt } = await createToken('user-def', 'eve', true, []);

		vi.mocked(sql).mockResolvedValueOnce([{ id: 'session-2' }]);

		const response = await GET(makeEvent({ cookieToken: jwt }));
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.authenticated).toBe(true);
		expect(body.user.username).toBe('eve');
		expect(body.user.isAdmin).toBe(true);
	});

	it('returns 401 when token is valid but session was revoked (not in DB)', async () => {
		// Requirement: revoked sessions must not authenticate even with a valid JWT signature.
		// This is the defense-in-depth that makes logout actually work.
		const { GET } = await import('../../src/routes/api/verify/+server.js');
		const { sql } = await import('$lib/server/db.js');

		vi.mocked(sql).mockResolvedValueOnce([]);
		const { jwt } = await createToken('user-ghi', 'frank', false, []);

		// Session lookup returns empty — token was revoked
		vi.mocked(sql).mockResolvedValueOnce([]);

		const response = await GET(makeEvent({ authHeader: `Bearer ${jwt}` }));
		expect(response.status).toBe(401);
	});
});

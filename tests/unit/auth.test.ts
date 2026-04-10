/**
 * Unit tests for src/lib/server/auth.ts
 *
 * Strategy:
 * - TOTP and cookieOptions are pure/near-pure — test them directly
 * - JWT signing/verification requires a keypair but no DB query for generation;
 *   we mock the `sql` db module so initKeys() can be called in isolation
 * - createToken and verifyToken both touch the sessions table, so sql is mocked
 *   to return controlled results
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock the database module before importing auth so the module-level `sql`
// reference never tries to open a real Postgres connection
vi.mock('$lib/server/db.js', () => {
	const mockSql = Object.assign(
		// The tagged-template call used for queries
		vi.fn().mockResolvedValue([]),
		{
			// sql.json() helper used when inserting JSONB values
			json: (v: unknown) => v
		}
	);
	return { sql: mockSql };
});

import {
	generateTotpSecret,
	verifyTotp,
	cookieOptions,
	initKeys,
	createToken,
	verifyToken,
	getPublicJwk
} from '$lib/server/auth.js';

// ---------------------------------------------------------------------------
// TOTP — requirements: generate a secret, verify a code against it
// ---------------------------------------------------------------------------

describe('TOTP generation', () => {
	it('returns a base32 secret and an otpauth URI', () => {
		// Requirement: generateTotpSecret must return the data needed to bootstrap
		// an authenticator app — a storable secret and a scannable URI.
		const result = generateTotpSecret('testuser');

		expect(result.secret).toBeTruthy();
		expect(result.secret).toMatch(/^[A-Z2-7]+=*$/); // base32 alphabet
		expect(result.uri).toMatch(/^otpauth:\/\/totp\//);
		expect(result.uri).toContain('testuser');
		expect(result.uri).toContain('NoEgos%20Auth');
	});

	it('generates a different secret each call', () => {
		// Requirement: secrets must be unique per user to prevent replay across accounts
		const a = generateTotpSecret('alice');
		const b = generateTotpSecret('bob');
		expect(a.secret).not.toBe(b.secret);
	});

	it('secret length is sufficient for security (≥16 bytes = 26 base32 chars)', () => {
		// Requirement: TOTP secrets must be at least 16 bytes per RFC 6238 recommendations.
		// The code uses size:20 (160-bit secret), which base32-encodes to 32 chars.
		const { secret } = generateTotpSecret('user');
		// Remove padding, count significant chars
		const significantChars = secret.replace(/=/g, '').length;
		expect(significantChars).toBeGreaterThanOrEqual(26);
	});
});

describe('TOTP verification', () => {
	it('accepts a freshly generated TOTP code', () => {
		// Requirement: a code produced right now from the secret must verify successfully.
		// We import TOTP from otpauth directly to generate a valid current token.
		const { secret } = generateTotpSecret('testuser');

		// Generate the current valid token using the same library the auth module uses
		const { TOTP, Secret } = require('otpauth');
		const totp = new TOTP({
			secret: Secret.fromBase32(secret),
			algorithm: 'SHA1',
			digits: 6,
			period: 30
		});
		const currentCode = totp.generate();

		expect(verifyTotp(secret, currentCode)).toBe(true);
	});

	it('rejects an obviously wrong code', () => {
		// Requirement: incorrect codes must fail — basic brute-force protection
		const { secret } = generateTotpSecret('testuser');
		expect(verifyTotp(secret, '000000')).toBe(false);
	});

	it('rejects an empty string code', () => {
		// Requirement: malformed input should not authenticate anyone
		const { secret } = generateTotpSecret('testuser');
		expect(verifyTotp(secret, '')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Cookie options — requirement: correct security flags for prod vs dev
// ---------------------------------------------------------------------------

describe('cookieOptions', () => {
	it('sets httpOnly and sameSite:lax on all cookies', () => {
		// Requirement: JWT cookies must not be accessible from JS (httpOnly) and
		// must not be sent on cross-site POSTs (sameSite:lax) to prevent CSRF/XSS
		const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
		const opts = cookieOptions(expires);

		expect(opts.httpOnly).toBe(true);
		expect(opts.sameSite).toBe('lax');
		expect(opts.path).toBe('/');
		expect(opts.expires).toBe(expires);
	});

	it('does NOT set secure flag when COOKIE_DOMAIN is localhost (dev mode)', () => {
		// Requirement: dev workflow must work over plain HTTP. The env fixture sets
		// COOKIE_DOMAIN=localhost so secure should be false.
		const opts = cookieOptions(new Date());
		// In test environment COOKIE_DOMAIN is 'localhost' per the env fixture
		expect(opts.secure).toBe(false);
	});

	it('sets domain from COOKIE_DOMAIN env', () => {
		// Requirement: cross-subdomain sharing requires a domain attribute.
		// In production COOKIE_DOMAIN=.noegosunderwater.com
		const opts = cookieOptions(new Date());
		// Our test fixture sets COOKIE_DOMAIN='localhost'
		expect(opts.domain).toBe('localhost');
	});
});

// ---------------------------------------------------------------------------
// JWT signing and verification — requires a keypair (from initKeys)
// ---------------------------------------------------------------------------

describe('JWT signing and verification', () => {
	// initKeys() normally persists/loads keys from Postgres. With the db mocked to
	// return an empty array, it will generate a fresh ephemeral keypair — which is
	// exactly what we want for isolated unit tests.
	beforeAll(async () => {
		await initKeys();
	});

	it('getPublicJwk returns a JWK after initKeys', () => {
		// Requirement: JWKS endpoint depends on this returning a valid JWK object
		const jwk = getPublicJwk();
		expect(jwk).toBeTruthy();
		expect(jwk.kty).toBe('OKP'); // EdDSA key type
		expect(jwk.crv).toBe('Ed25519');
		// Public JWK must NOT expose the private key material
		expect(jwk.d).toBeUndefined();
	});

	it('createToken returns a JWT string', async () => {
		// Requirement: successful login must produce a signed JWT
		const appAccess = [{ slug: 'test-app', name: 'Test App', role: 'user' }];
		const { jwt } = await createToken('user-123', 'alice', false, appAccess);

		expect(typeof jwt).toBe('string');
		// JWTs are three base64url segments separated by dots
		const parts = jwt.split('.');
		expect(parts).toHaveLength(3);
	});

	it('verifyToken returns the payload for a freshly created token', async () => {
		// Requirement: a token just issued by this service must pass verification.
		// This tests the full round-trip: sign → verify → payload intact.

		// Make the mock return a session row (token found, not expired)
		const { sql } = await import('$lib/server/db.js');
		vi.mocked(sql).mockResolvedValueOnce([{ id: 'session-1' }]);

		const appAccess = [{ slug: 'ww-journal', name: 'WW Journal', role: 'user' }];
		const { jwt } = await createToken('user-456', 'bob', false, appAccess);

		// Reset mock for the verifyToken session lookup
		vi.mocked(sql).mockResolvedValueOnce([{ id: 'session-1' }]);

		const payload = await verifyToken(jwt);
		expect(payload).not.toBeNull();
		expect(payload!.username).toBe('bob');
		expect(payload!.sub).toBe('user-456');
		expect(payload!.admin).toBe(false);
		expect(payload!.apps).toEqual(appAccess);
	});

	it('verifyToken returns null when session not found in DB (revoked token)', async () => {
		// Requirement: revoking a session must invalidate the JWT even if the
		// signature is cryptographically valid. The session table check enforces this.
		const { sql } = await import('$lib/server/db.js');

		const { jwt } = await createToken('user-789', 'carol', false, []);

		// Session lookup returns empty — simulates a revoked or expired session
		vi.mocked(sql).mockResolvedValueOnce([]);

		const payload = await verifyToken(jwt);
		expect(payload).toBeNull();
	});

	it('verifyToken returns null for a garbage token string', async () => {
		// Requirement: invalid tokens must never authenticate a user — error handling
		// in verifyToken must catch jose parse/verification errors
		const payload = await verifyToken('not.a.jwt');
		expect(payload).toBeNull();
	});

	it('verifyToken returns null for an empty string', async () => {
		// Requirement: missing/empty token values (e.g. unset cookie) must not authenticate
		const payload = await verifyToken('');
		expect(payload).toBeNull();
	});

	it('createToken embeds isAdmin:true for admin users', async () => {
		// Requirement: admin flag must be preserved in the JWT so consuming apps
		// can enforce admin-only features without a separate DB call
		const { sql } = await import('$lib/server/db.js');

		const { jwt } = await createToken('admin-1', 'admin', true, []);

		vi.mocked(sql).mockResolvedValueOnce([{ id: 'session-admin' }]);
		const payload = await verifyToken(jwt);

		expect(payload!.admin).toBe(true);
	});
});

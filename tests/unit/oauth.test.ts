/**
 * OAuth 2.1 authorization server — behaviour tests against an in-memory store.
 * Covers: DCR validation, authorize validation (fatal vs redirect errors),
 * PKCE, code single-use + replay, refresh rotation + reuse detection,
 * access revocation, resource→app mapping, token claims.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('$lib/server/db.js', () => {
	const mockSql = Object.assign(vi.fn().mockResolvedValue([]), { json: (v: unknown) => v });
	return { sql: mockSql };
});

import { initKeys, verifyIssuedJwt } from '$lib/server/auth.js';
import {
	registerClient,
	validateAuthorize,
	issueCode,
	exchangeToken,
	revokeToken,
	resolveResource,
	redirectUriMatches,
	isAllowedRedirectUri,
	normalizeScope,
	pkceChallengeS256,
	verifyPkce,
	OAuthError,
	type AuthorizeParams,
	type ValidatedAuthorize
} from '$lib/server/oauth.js';
import { memoryStore } from '../__fixtures__/oauth-memory-store.js';

const APP = { id: 'app-1', slug: 'ww-journal', name: 'Whitewater Journal', url: 'https://ww-journal.example.com' };
const OTHER = { id: 'app-2', slug: 'coop', name: 'Coop', url: 'https://coop.example.com' };
const ALICE = { id: 'u-alice', username: 'alice' };
const BOB = { id: 'u-bob', username: 'bob' };
const RESOURCE = 'https://ww-journal.example.com/mcp';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'a'.repeat(20) + 'B'.repeat(20) + '-._~123'; // 47 chars, valid charset

let store: ReturnType<typeof memoryStore>;
let clientId: string;

function params(over: Partial<AuthorizeParams> = {}): AuthorizeParams {
	return {
		response_type: 'code',
		client_id: clientId,
		redirect_uri: REDIRECT,
		code_challenge: pkceChallengeS256(VERIFIER),
		code_challenge_method: 'S256',
		state: 'xyz',
		scope: 'read write',
		resource: RESOURCE,
		...over
	};
}

async function validated(over: Partial<AuthorizeParams> = {}): Promise<ValidatedAuthorize> {
	const c = await validateAuthorize(store, params(over));
	if (!c.ok) throw new Error('expected ok: ' + JSON.stringify(c));
	return c.value;
}

function tokenForm(fields: Record<string, string>) {
	return new URLSearchParams({ client_id: clientId, ...fields });
}

async function codeFlow(userId = ALICE.id, over: Partial<AuthorizeParams> = {}) {
	const code = await issueCode(store, await validated(over), userId);
	return exchangeToken(
		store,
		tokenForm({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: over.redirect_uri ?? REDIRECT })
	);
}

beforeAll(async () => {
	await initKeys();
});

beforeEach(async () => {
	store = memoryStore({
		apps: [APP, OTHER],
		users: [ALICE, BOB],
		access: [{ user_id: ALICE.id, app_id: APP.id, role: 'user' }]
	});
	clientId = (await registerClient(store, { client_name: 'Claude', redirect_uris: [REDIRECT, 'http://localhost:33418/callback'] })).client_id;
});

// ---------------------------------------------------------------- helpers

describe('redirect URI rules', () => {
	it('allows https and loopback http, rejects others', () => {
		expect(isAllowedRedirectUri('https://claude.ai/cb')).toBe(true);
		expect(isAllowedRedirectUri('http://127.0.0.1:9999/cb')).toBe(true);
		expect(isAllowedRedirectUri('http://localhost/cb')).toBe(true);
		expect(isAllowedRedirectUri('http://evil.com/cb')).toBe(false);
		expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
		expect(isAllowedRedirectUri('https://x.com/cb#frag')).toBe(false);
	});

	it('matches exactly, but lets loopback vary the port only', () => {
		const reg = ['https://a.com/cb', 'http://localhost:1234/callback'];
		expect(redirectUriMatches(reg, 'https://a.com/cb')).toBe(true);
		expect(redirectUriMatches(reg, 'https://a.com/cb2')).toBe(false);
		expect(redirectUriMatches(reg, 'http://localhost:5555/callback')).toBe(true);
		expect(redirectUriMatches(reg, 'http://localhost:5555/other')).toBe(false);
		expect(redirectUriMatches(reg, 'http://127.0.0.1:5555/callback')).toBe(false);
	});
});

describe('resolveResource', () => {
	it('maps a URL under the app to that app', () => {
		expect(resolveResource(RESOURCE, [APP, OTHER])?.slug).toBe('ww-journal');
		expect(resolveResource('https://ww-journal.example.com', [APP])?.slug).toBe('ww-journal');
	});
	it('rejects other origins, lookalike hosts and http', () => {
		expect(resolveResource('https://ww-journal.example.com.evil.com/mcp', [APP])).toBeNull();
		expect(resolveResource('http://ww-journal.example.com/mcp', [APP])).toBeNull();
		expect(resolveResource('https://nope.example.com/mcp', [APP])).toBeNull();
		expect(resolveResource('not a url', [APP])).toBeNull();
	});
	it('respects an app path prefix', () => {
		const sub = { ...APP, id: 'p', url: 'https://host.example.com/journal' };
		expect(resolveResource('https://host.example.com/journal/mcp', [sub])?.id).toBe('p');
		expect(resolveResource('https://host.example.com/journalx/mcp', [sub])).toBeNull();
	});
});

describe('scopes and PKCE', () => {
	it('defaults to read write and rejects unknown scopes', () => {
		expect(normalizeScope(null)).toBe('read write');
		expect(normalizeScope('write read read')).toBe('read write');
		expect(normalizeScope('read')).toBe('read');
		expect(() => normalizeScope('admin')).toThrow(OAuthError);
	});
	it('verifies S256 and rejects malformed verifiers', () => {
		expect(verifyPkce(VERIFIER, pkceChallengeS256(VERIFIER))).toBe(true);
		expect(verifyPkce(VERIFIER + 'x', pkceChallengeS256(VERIFIER))).toBe(false);
		expect(verifyPkce('short', pkceChallengeS256('short'))).toBe(false);
	});
});

// ---------------------------------------------------------------- DCR

describe('dynamic client registration', () => {
	it('registers a public client', async () => {
		const c = await registerClient(store, { client_name: 'Flow', redirect_uris: ['http://127.0.0.1:8765/callback'] });
		expect(c.client_id).toMatch(/^nec_/);
		expect(c.token_endpoint_auth_method).toBe('none');
		expect(await store.getClient(c.client_id)).not.toBeNull();
	});
	it('rejects bad redirect URIs, confidential clients and junk', async () => {
		await expect(registerClient(store, { redirect_uris: ['http://evil.com/cb'] })).rejects.toThrow(OAuthError);
		await expect(registerClient(store, { redirect_uris: [] })).rejects.toThrow(OAuthError);
		await expect(
			registerClient(store, { redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic' })
		).rejects.toThrow(OAuthError);
		await expect(registerClient(store, null)).rejects.toThrow(OAuthError);
	});
});

// ---------------------------------------------------------------- authorize

describe('authorize validation', () => {
	it('accepts a well-formed request and resolves the app', async () => {
		const v = await validated();
		expect(v.app.slug).toBe('ww-journal');
		expect(v.scope).toBe('read write');
	});
	it('never redirects for unknown client or unregistered redirect_uri', async () => {
		const a = await validateAuthorize(store, params({ client_id: 'nope' }));
		expect(a.ok === false && a.fatal).toBe(true);
		const b = await validateAuthorize(store, params({ redirect_uri: 'https://attacker.example/cb' }));
		expect(b.ok === false && b.fatal).toBe(true);
	});
	it('redirects errors for missing PKCE, plain PKCE, bad resource, bad scope', async () => {
		for (const over of [
			{ code_challenge: null },
			{ code_challenge_method: 'plain' },
			{ resource: null },
			{ resource: 'https://unknown.example.com/mcp' },
			{ scope: 'admin' },
			{ response_type: 'token' }
		]) {
			const c = await validateAuthorize(store, params(over));
			expect(c.ok).toBe(false);
			if (!c.ok) expect(c.fatal).toBe(false);
		}
	});
	it('refuses to issue a code to a user without app access', async () => {
		await expect(issueCode(store, await validated(), BOB.id)).rejects.toMatchObject({ code: 'access_denied' });
	});
});

// ---------------------------------------------------------------- token

describe('authorization_code grant', () => {
	it('issues an audience-bound access token and a refresh token', async () => {
		const t = await codeFlow();
		expect(t.token_type).toBe('Bearer');
		expect(t.expires_in).toBe(3600);
		const { payload, protectedHeader } = await verifyIssuedJwt(t.access_token, RESOURCE);
		expect(protectedHeader.typ).toBe('at+jwt');
		expect(payload.sub).toBe(ALICE.id);
		expect(payload.aud).toBe(RESOURCE);
		expect(payload.scope).toBe('read write');
		expect(payload.client_id).toBe(clientId);
		expect(payload.apps).toEqual([{ slug: 'ww-journal', name: 'Whitewater Journal', role: 'user' }]);
	});

	it('access token is rejected for a different audience', async () => {
		const t = await codeFlow();
		await expect(verifyIssuedJwt(t.access_token, 'https://coop.example.com/mcp')).rejects.toThrow();
	});

	it('rejects a wrong PKCE verifier', async () => {
		const code = await issueCode(store, await validated(), ALICE.id);
		await expect(
			exchangeToken(store, tokenForm({ grant_type: 'authorization_code', code, code_verifier: 'z'.repeat(43), redirect_uri: REDIRECT }))
		).rejects.toMatchObject({ code: 'invalid_grant' });
	});

	it('rejects a redirect_uri different from the one authorized', async () => {
		const code = await issueCode(store, await validated(), ALICE.id);
		await expect(
			exchangeToken(store, tokenForm({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: 'http://localhost:33418/callback' }))
		).rejects.toMatchObject({ code: 'invalid_grant' });
	});

	it('rejects a code presented by another client', async () => {
		const code = await issueCode(store, await validated(), ALICE.id);
		const other = await registerClient(store, { redirect_uris: [REDIRECT] });
		await expect(
			exchangeToken(store, new URLSearchParams({ client_id: other.client_id, grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT }))
		).rejects.toMatchObject({ code: 'invalid_grant' });
	});

	it('codes are single use; replay revokes tokens minted from it', async () => {
		const code = await issueCode(store, await validated(), ALICE.id);
		const form = tokenForm({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT });
		const first = await exchangeToken(store, form);
		await expect(exchangeToken(store, form)).rejects.toMatchObject({ code: 'invalid_grant' });
		await expect(
			exchangeToken(store, tokenForm({ grant_type: 'refresh_token', refresh_token: first.refresh_token }))
		).rejects.toMatchObject({ code: 'invalid_grant' });
	});

	it('rejects an expired code', async () => {
		const code = await issueCode(store, await validated(), ALICE.id);
		for (const c of store._codes.values()) c.expires_at = new Date(Date.now() - 1000);
		await expect(
			exchangeToken(store, tokenForm({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT }))
		).rejects.toMatchObject({ code: 'invalid_grant' });
	});

	it('rejects unknown client and unsupported grant types', async () => {
		await expect(exchangeToken(store, new URLSearchParams({ client_id: 'x', grant_type: 'authorization_code' }))).rejects.toMatchObject({ code: 'invalid_client' });
		await expect(exchangeToken(store, tokenForm({ grant_type: 'password' }))).rejects.toMatchObject({ code: 'unsupported_grant_type' });
	});
});

describe('refresh_token grant', () => {
	it('rotates the refresh token', async () => {
		const t1 = await codeFlow();
		const t2 = await exchangeToken(store, tokenForm({ grant_type: 'refresh_token', refresh_token: t1.refresh_token }));
		expect(t2.refresh_token).not.toBe(t1.refresh_token);
		const t3 = await exchangeToken(store, tokenForm({ grant_type: 'refresh_token', refresh_token: t2.refresh_token }));
		expect(t3.access_token).toBeTruthy();
	});

	it('reuse of a rotated token revokes the whole family', async () => {
		const t1 = await codeFlow();
		const t2 = await exchangeToken(store, tokenForm({ grant_type: 'refresh_token', refresh_token: t1.refresh_token }));
		await expect(
			exchangeToken(store, tokenForm({ grant_type: 'refresh_token', refresh_token: t1.refresh_token }))
		).rejects.toMatchObject({ code: 'invalid_grant' });
		// legit holder of t2 is now cut off too
		await expect(
			exchangeToken(store, tokenForm({ grant_type: 'refresh_token', refresh_token: t2.refresh_token }))
		).rejects.toMatchObject({ code: 'invalid_grant' });
	});

	it('can narrow but not widen scope', async () => {
		const t1 = await codeFlow(ALICE.id, { scope: 'read' });
		await expect(
			exchangeToken(store, tokenForm({ grant_type: 'refresh_token', refresh_token: t1.refresh_token, scope: 'read write' }))
		).rejects.toMatchObject({ code: 'invalid_scope' });
		const t2 = await codeFlow();
		const narrowed = await exchangeToken(store, tokenForm({ grant_type: 'refresh_token', refresh_token: t2.refresh_token, scope: 'read' }));
		expect(narrowed.scope).toBe('read');
	});

	it('stops working once the user loses app access', async () => {
		const t1 = await codeFlow();
		store._access.length = 0;
		await expect(
			exchangeToken(store, tokenForm({ grant_type: 'refresh_token', refresh_token: t1.refresh_token }))
		).rejects.toMatchObject({ code: 'invalid_grant' });
	});

	it('revoke endpoint kills the family; grants list reflects it', async () => {
		const t1 = await codeFlow();
		expect(await store.listGrants(ALICE.id)).toHaveLength(1);
		await revokeToken(store, new URLSearchParams({ token: t1.refresh_token, client_id: clientId }));
		expect(await store.listGrants(ALICE.id)).toHaveLength(0);
		await expect(
			exchangeToken(store, tokenForm({ grant_type: 'refresh_token', refresh_token: t1.refresh_token }))
		).rejects.toMatchObject({ code: 'invalid_grant' });
	});
});

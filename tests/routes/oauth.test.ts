/**
 * Route tests for the OAuth endpoints: metadata, DCR, token, revoke,
 * authorize page (login redirect / fatal errors / consent / approve / deny),
 * connections page, and the custom CSRF guard.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('$lib/server/db.js', () => {
	const mockSql = Object.assign(vi.fn().mockResolvedValue([]), { json: (v: unknown) => v });
	return { sql: mockSql };
});

import { initKeys } from '$lib/server/auth.js';
import { setStore, pkceChallengeS256 } from '$lib/server/oauth.js';
import { isCsrfViolation } from '$lib/server/csrf.js';
import { memoryStore } from '../__fixtures__/oauth-memory-store.js';

const APP = { id: 'app-1', slug: 'ww-journal', name: 'Whitewater Journal', url: 'https://ww-journal.example.com' };
const ALICE = { id: 'u-alice', username: 'alice' };
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const RESOURCE = 'https://ww-journal.example.com/mcp';
const VERIFIER = 'v'.repeat(50);

let store: ReturnType<typeof memoryStore>;

beforeAll(async () => {
	await initKeys();
});

beforeEach(() => {
	store = memoryStore({ apps: [APP], users: [ALICE], access: [{ user_id: ALICE.id, app_id: APP.id, role: 'user' }] });
	setStore(store);
});

async function register(): Promise<string> {
	const { POST } = await import('../../src/routes/oauth/register/+server.js');
	const res = await POST({
		request: new Request('http://x/oauth/register', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] })
		})
	} as never);
	return (await res.json()).client_id;
}

function authorizeUrl(clientId: string, over: Record<string, string> = {}) {
	const u = new URL('http://localhost:5173/oauth/authorize');
	const p = {
		response_type: 'code',
		client_id: clientId,
		redirect_uri: REDIRECT,
		code_challenge: pkceChallengeS256(VERIFIER),
		code_challenge_method: 'S256',
		state: 'st8',
		resource: RESOURCE,
		...over
	};
	for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
	return u;
}

async function catchRedirect(fn: () => unknown): Promise<{ status: number; location: string }> {
	try {
		await fn();
	} catch (e) {
		const r = e as { status: number; location: string };
		if (r.location) return r;
		throw e;
	}
	throw new Error('expected redirect');
}

describe('GET /.well-known/oauth-authorization-server', () => {
	it('advertises endpoints, PKCE S256 and public clients', async () => {
		const { GET } = await import('../../src/routes/.well-known/oauth-authorization-server/+server.js');
		const res = await GET({} as never);
		expect(res.status).toBe(200);
		const m = await res.json();
		expect(m.issuer).toBe('http://localhost:5173');
		expect(m.token_endpoint).toBe('http://localhost:5173/oauth/token');
		expect(m.registration_endpoint).toBe('http://localhost:5173/oauth/register');
		expect(m.code_challenge_methods_supported).toEqual(['S256']);
		expect(m.token_endpoint_auth_methods_supported).toEqual(['none']);
		expect(res.headers.get('access-control-allow-origin')).toBe('*');
	});
});

describe('POST /oauth/register', () => {
	it('returns 201 with a client_id', async () => {
		expect(await register()).toMatch(/^nec_/);
	});
	it('returns 400 invalid_redirect_uri for a non-https redirect', async () => {
		const { POST } = await import('../../src/routes/oauth/register/+server.js');
		const res = await POST({
			request: new Request('http://x', { method: 'POST', body: JSON.stringify({ redirect_uris: ['http://evil.com/cb'] }) })
		} as never);
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe('invalid_redirect_uri');
	});
	it('returns 400 for non-JSON', async () => {
		const { POST } = await import('../../src/routes/oauth/register/+server.js');
		const res = await POST({ request: new Request('http://x', { method: 'POST', body: 'nope' }) } as never);
		expect(res.status).toBe(400);
	});
});

describe('/oauth/authorize page', () => {
	it('sends signed-out users to login with return_to', async () => {
		const clientId = await register();
		const { load } = await import('../../src/routes/oauth/authorize/+page.server.js');
		const url = authorizeUrl(clientId);
		const r = await catchRedirect(() => load({ url, locals: {} } as never));
		expect(r.location).toMatch(/^\/login\?return_to=%2Foauth%2Fauthorize%3F/);
	});

	it('shows an error page (no redirect) for an unknown client', async () => {
		const { load } = await import('../../src/routes/oauth/authorize/+page.server.js');
		await expect(load({ url: authorizeUrl('nope'), locals: { user: { id: ALICE.id } } } as never)).rejects.toMatchObject({ status: 400 });
	});

	it('redirects back with an error when PKCE is missing', async () => {
		const clientId = await register();
		const { load } = await import('../../src/routes/oauth/authorize/+page.server.js');
		const url = authorizeUrl(clientId, { code_challenge_method: 'plain' });
		const r = await catchRedirect(() => load({ url, locals: { user: { id: ALICE.id } } } as never));
		const loc = new URL(r.location);
		expect(loc.origin + loc.pathname).toBe(REDIRECT);
		expect(loc.searchParams.get('error')).toBe('invalid_request');
		expect(loc.searchParams.get('state')).toBe('st8');
	});

	it('renders consent data for a signed-in user', async () => {
		const clientId = await register();
		const { load } = await import('../../src/routes/oauth/authorize/+page.server.js');
		const data = (await load({ url: authorizeUrl(clientId), locals: { user: { id: ALICE.id, username: 'alice' } } } as never)) as Record<string, unknown>;
		expect(data.clientName).toBe('Claude');
		expect(data.appName).toBe('Whitewater Journal');
		expect(data.hasAccess).toBe(true);
		expect(data.scopes).toEqual(['read', 'write']);
	});

	async function submit(clientId: string, decision: string) {
		const { actions } = await import('../../src/routes/oauth/authorize/+page.server.js');
		const fd = new FormData();
		for (const [k, v] of authorizeUrl(clientId).searchParams) fd.set(k, v);
		fd.set('decision', decision);
		return catchRedirect(() =>
			actions.default({ request: new Request('http://x', { method: 'POST', body: fd }), locals: { user: { id: ALICE.id } } } as never)
		);
	}

	it('approve → redirect with code, state and iss; code exchanges at /oauth/token', async () => {
		const clientId = await register();
		const r = await submit(clientId, 'approve');
		const loc = new URL(r.location);
		expect(loc.searchParams.get('state')).toBe('st8');
		expect(loc.searchParams.get('iss')).toBe('http://localhost:5173');
		const code = loc.searchParams.get('code')!;
		expect(code).toBeTruthy();

		const { POST } = await import('../../src/routes/oauth/token/+server.js');
		const res = await POST({
			request: new Request('http://x/oauth/token', {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: VERIFIER, redirect_uri: REDIRECT })
			})
		} as never);
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		const body = await res.json();
		expect(body.token_type).toBe('Bearer');
		expect(body.refresh_token).toBeTruthy();

		const { POST: REVOKE } = await import('../../src/routes/oauth/revoke/+server.js');
		const rv = await REVOKE({
			request: new Request('http://x', { method: 'POST', body: new URLSearchParams({ token: body.refresh_token, client_id: clientId }) })
		} as never);
		expect(rv.status).toBe(200);
		expect(await store.listGrants(ALICE.id)).toHaveLength(0);
	});

	it('deny → redirect with access_denied', async () => {
		const clientId = await register();
		const r = await submit(clientId, 'deny');
		expect(new URL(r.location).searchParams.get('error')).toBe('access_denied');
	});
});

describe('POST /oauth/token errors', () => {
	it('returns RFC 6749 JSON errors', async () => {
		const { POST } = await import('../../src/routes/oauth/token/+server.js');
		const res = await POST({
			request: new Request('http://x', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'nope' }) })
		} as never);
		expect(res.status).toBe(401);
		expect((await res.json()).error).toBe('invalid_client');
	});
});

describe('/connections', () => {
	it('redirects signed-out users to login', async () => {
		const { load } = await import('../../src/routes/connections/+page.server.js');
		const r = await catchRedirect(() => load({ locals: {}, url: new URL('http://x/connections') } as never));
		expect(r.location).toContain('/login');
	});
	it('refuses to revoke a grant that is not yours', async () => {
		const { actions } = await import('../../src/routes/connections/+page.server.js');
		const fd = new FormData();
		fd.set('family_id', 'someone-elses');
		const res = await actions.revoke({ request: new Request('http://x', { method: 'POST', body: fd }), locals: { user: { id: ALICE.id } } } as never);
		expect((res as { status: number }).status).toBe(404);
	});
});

describe('CSRF guard', () => {
	const url = new URL('https://auth.example.com/login');
	const form = (path: string, origin?: string) =>
		isCsrfViolation(
			new Request('https://auth.example.com' + path, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}) },
				body: 'a=b'
			}),
			new URL('https://auth.example.com' + path)
		);
	it('blocks cross-site and origin-less form posts to normal routes', () => {
		expect(form('/login', 'https://evil.com')).toBe(true);
		expect(form('/login')).toBe(true);
		expect(form('/oauth/authorize', 'https://evil.com')).toBe(true);
	});
	it('allows same-origin form posts', () => {
		expect(form('/login', url.origin)).toBe(false);
	});
	it('allows server-to-server posts to token/revoke', () => {
		expect(form('/oauth/token')).toBe(false);
		expect(form('/oauth/revoke', 'https://claude.ai')).toBe(false);
	});
});

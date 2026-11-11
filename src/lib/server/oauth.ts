/**
 * OAuth 2.1 authorization server for NoEgos apps.
 *
 * Lets agent clients (MCP: Claude, ChatGPT, Hermes/Flow, Claude Code …) get
 * short-lived access tokens for ONE app, on behalf of a user who signs in with
 * the normal TOTP login and approves a consent screen.
 *
 *  - Public clients only (no client secrets), registered via RFC 7591 DCR.
 *  - Authorization code + PKCE S256 (mandatory).
 *  - RFC 8707 `resource` picks the app: it must sit under a registered app's url.
 *  - Access token: EdDSA JWT (typ at+jwt), aud = resource, 1h, verified via JWKS.
 *  - Refresh token: opaque, hashed at rest, rotated on every use; replaying a
 *    used refresh token revokes the whole family (RFC 9700 §4.14.2).
 *
 * Persistence goes through `OAuthStore` so the flow is unit-testable without
 * Postgres (see tests/unit/oauth.test.ts for the in-memory store).
 */
import crypto from 'node:crypto';
import { sql } from './db.js';
import { signAccessToken } from './auth.js';

export const ACCESS_TOKEN_TTL = 60 * 60; // 1h
export const REFRESH_TOKEN_TTL = 90 * 24 * 60 * 60; // 90d
export const CODE_TTL = 60; // seconds
export const SUPPORTED_SCOPES = ['read', 'write'] as const;
export const DEFAULT_SCOPE = 'read write';

// ---------------------------------------------------------------- types

export interface OAuthClient {
	client_id: string;
	client_name: string;
	redirect_uris: string[];
}

export interface AppRecord {
	id: string;
	slug: string;
	name: string;
	url: string;
}

export interface CodeRecord {
	code_hash: string;
	client_id: string;
	user_id: string;
	app_id: string;
	redirect_uri: string;
	code_challenge: string;
	resource: string;
	scope: string;
	expires_at: Date;
	used_at: Date | null;
}

export interface RefreshRecord {
	token_hash: string;
	family_id: string;
	client_id: string;
	user_id: string;
	app_id: string;
	resource: string;
	scope: string;
	expires_at: Date;
	used_at: Date | null;
	revoked_at: Date | null;
}

export interface UserForToken {
	id: string;
	username: string;
}

export interface GrantSummary {
	family_id: string;
	client_id: string;
	client_name: string;
	app_name: string;
	scope: string;
	created_at: Date;
	last_used_at: Date | null;
}

export interface OAuthStore {
	createClient(c: OAuthClient): Promise<void>;
	getClient(clientId: string): Promise<OAuthClient | null>;
	touchClient(clientId: string): Promise<void>;
	listAppsWithUrl(): Promise<AppRecord[]>;
	getAppRole(userId: string, appId: string): Promise<string | null>;
	getUser(userId: string): Promise<UserForToken | null>;
	saveCode(c: CodeRecord): Promise<void>;
	/** Atomically mark a code used; returns the record as it was BEFORE (used_at may already be set). */
	consumeCode(codeHash: string): Promise<CodeRecord | null>;
	saveRefresh(r: RefreshRecord): Promise<void>;
	/** Atomically mark a refresh token used; returns the record as it was BEFORE. */
	consumeRefresh(tokenHash: string): Promise<RefreshRecord | null>;
	getRefresh(tokenHash: string): Promise<RefreshRecord | null>;
	revokeFamily(familyId: string): Promise<void>;
	revokeUserApp(userId: string, appId?: string): Promise<void>;
	listGrants(userId: string): Promise<GrantSummary[]>;
}

// ---------------------------------------------------------------- errors

export class OAuthError extends Error {
	constructor(
		public code:
			| 'invalid_request'
			| 'invalid_client'
			| 'invalid_grant'
			| 'unauthorized_client'
			| 'unsupported_grant_type'
			| 'invalid_scope'
			| 'invalid_target'
			| 'access_denied'
			| 'invalid_redirect_uri'
			| 'invalid_client_metadata',
		public description: string,
		public status = 400
	) {
		super(description);
	}
	toJSON() {
		return { error: this.code, error_description: this.description };
	}
}

// ---------------------------------------------------------------- helpers

export function sha256(s: string): string {
	return crypto.createHash('sha256').update(s).digest('hex');
}

export function randomToken(bytes = 32): string {
	return crypto.randomBytes(bytes).toString('base64url');
}

export function pkceChallengeS256(verifier: string): string {
	return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function verifyPkce(verifier: string, challenge: string): boolean {
	if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
	const a = Buffer.from(pkceChallengeS256(verifier));
	const b = Buffer.from(challenge);
	return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Redirect URIs allowed at registration: https, or http on loopback (RFC 8252). */
export function isAllowedRedirectUri(uri: string): boolean {
	let u: URL;
	try {
		u = new URL(uri);
	} catch {
		return false;
	}
	if (u.hash) return false;
	if (u.protocol === 'https:') return true;
	if (u.protocol === 'http:' && LOOPBACK.has(u.hostname)) return true;
	return false;
}

/**
 * Exact string match, except loopback redirects may use any port
 * (native apps pick an ephemeral port — RFC 8252 §7.3).
 */
export function redirectUriMatches(registered: string[], requested: string): boolean {
	if (registered.includes(requested)) return true;
	let req: URL;
	try {
		req = new URL(requested);
	} catch {
		return false;
	}
	if (req.protocol !== 'http:' || !LOOPBACK.has(req.hostname)) return false;
	return registered.some((r) => {
		try {
			const reg = new URL(r);
			return (
				reg.protocol === 'http:' &&
				reg.hostname === req.hostname &&
				reg.pathname === req.pathname &&
				reg.search === req.search
			);
		} catch {
			return false;
		}
	});
}

export function normalizeScope(scope: string | null | undefined): string {
	const raw = (scope ?? '').trim();
	if (!raw) return DEFAULT_SCOPE;
	const parts = [...new Set(raw.split(/\s+/))];
	for (const p of parts) {
		if (!(SUPPORTED_SCOPES as readonly string[]).includes(p)) {
			throw new OAuthError('invalid_scope', `Unsupported scope "${p}". Supported: ${SUPPORTED_SCOPES.join(' ')}`);
		}
	}
	return SUPPORTED_SCOPES.filter((s) => parts.includes(s)).join(' ');
}

/** True if `scope` is a subset of `granted`. */
export function scopeWithin(scope: string, granted: string): boolean {
	const g = new Set(granted.split(' '));
	return scope.split(' ').every((s) => g.has(s));
}

/**
 * Map an RFC 8707 resource indicator to a registered app. The resource must be
 * an https URL (http allowed for localhost dev) on the same origin as the app's
 * url, with the app's path as a prefix. Longest match wins.
 */
export function resolveResource(resource: string, apps: AppRecord[]): AppRecord | null {
	let r: URL;
	try {
		r = new URL(resource);
	} catch {
		return null;
	}
	if (r.hash) return null;
	if (r.protocol !== 'https:' && !(r.protocol === 'http:' && LOOPBACK.has(r.hostname))) return null;
	let best: AppRecord | null = null;
	let bestLen = -1;
	for (const app of apps) {
		let a: URL;
		try {
			a = new URL(app.url);
		} catch {
			continue;
		}
		if (a.origin !== r.origin) continue;
		const base = a.pathname.endsWith('/') ? a.pathname : a.pathname + '/';
		const path = r.pathname.endsWith('/') ? r.pathname : r.pathname + '/';
		if (!path.startsWith(base)) continue;
		if (base.length > bestLen) {
			best = app;
			bestLen = base.length;
		}
	}
	return best;
}

// ---------------------------------------------------------------- registration

export async function registerClient(store: OAuthStore, body: unknown): Promise<OAuthClient & Record<string, unknown>> {
	if (!body || typeof body !== 'object') {
		throw new OAuthError('invalid_client_metadata', 'Body must be a JSON object');
	}
	const b = body as Record<string, unknown>;
	const uris = b.redirect_uris;
	if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) {
		throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be a non-empty array (max 10)');
	}
	for (const u of uris) {
		if (typeof u !== 'string' || u.length > 2000 || !isAllowedRedirectUri(u)) {
			throw new OAuthError('invalid_redirect_uri', `Redirect URI not allowed: ${String(u).slice(0, 200)}`);
		}
	}
	const method = b.token_endpoint_auth_method ?? 'none';
	if (method !== 'none') {
		throw new OAuthError('invalid_client_metadata', 'Only public clients (token_endpoint_auth_method "none") are supported');
	}
	const grantTypes = (b.grant_types as string[] | undefined) ?? ['authorization_code', 'refresh_token'];
	if (!Array.isArray(grantTypes) || grantTypes.some((g) => !['authorization_code', 'refresh_token'].includes(g))) {
		throw new OAuthError('invalid_client_metadata', 'grant_types may only include authorization_code and refresh_token');
	}
	const rawName = typeof b.client_name === 'string' ? b.client_name.trim() : '';
	const client: OAuthClient = {
		client_id: 'nec_' + randomToken(18),
		client_name: (rawName || 'Unnamed client').slice(0, 100),
		redirect_uris: uris as string[]
	};
	await store.createClient(client);
	return {
		...client,
		client_id_issued_at: Math.floor(Date.now() / 1000),
		token_endpoint_auth_method: 'none',
		grant_types: grantTypes,
		response_types: ['code']
	};
}

// ---------------------------------------------------------------- authorize

export interface AuthorizeParams {
	response_type: string | null;
	client_id: string | null;
	redirect_uri: string | null;
	code_challenge: string | null;
	code_challenge_method: string | null;
	state: string | null;
	scope: string | null;
	resource: string | null;
}

export function readAuthorizeParams(src: URLSearchParams | FormData): AuthorizeParams {
	const g = (k: string) => {
		const v = src.get(k);
		return v === null ? null : v.toString();
	};
	return {
		response_type: g('response_type'),
		client_id: g('client_id'),
		redirect_uri: g('redirect_uri'),
		code_challenge: g('code_challenge'),
		code_challenge_method: g('code_challenge_method'),
		state: g('state'),
		scope: g('scope'),
		resource: g('resource')
	};
}

export interface ValidatedAuthorize {
	client: OAuthClient;
	redirect_uri: string;
	code_challenge: string;
	state: string | null;
	scope: string;
	resource: string;
	app: AppRecord;
}

/**
 * Errors are split in two kinds:
 *  - `fatal`: client_id / redirect_uri can't be trusted → show an error page, NEVER redirect.
 *  - `redirect`: everything else → send the error back to the (validated) redirect_uri.
 */
export type AuthorizeCheck =
	| { ok: true; value: ValidatedAuthorize }
	| { ok: false; fatal: true; message: string }
	| { ok: false; fatal: false; redirect_uri: string; state: string | null; error: OAuthError };

export async function validateAuthorize(store: OAuthStore, p: AuthorizeParams): Promise<AuthorizeCheck> {
	if (!p.client_id) return { ok: false, fatal: true, message: 'Missing client_id' };
	const client = await store.getClient(p.client_id);
	if (!client) return { ok: false, fatal: true, message: 'Unknown client. Ask your app to reconnect.' };
	if (!p.redirect_uri || !redirectUriMatches(client.redirect_uris, p.redirect_uri)) {
		return { ok: false, fatal: true, message: 'redirect_uri does not match this client\'s registration' };
	}
	const fail = (e: OAuthError): AuthorizeCheck => ({
		ok: false,
		fatal: false,
		redirect_uri: p.redirect_uri!,
		state: p.state,
		error: e
	});
	if (p.response_type !== 'code') return fail(new OAuthError('invalid_request', 'response_type must be "code"'));
	if (!p.code_challenge || p.code_challenge_method !== 'S256') {
		return fail(new OAuthError('invalid_request', 'PKCE with code_challenge_method=S256 is required'));
	}
	if (!/^[A-Za-z0-9\-_]{43}$/.test(p.code_challenge)) {
		return fail(new OAuthError('invalid_request', 'code_challenge must be a base64url SHA-256 digest'));
	}
	if (!p.resource) {
		return fail(new OAuthError('invalid_target', 'resource parameter (RFC 8707) is required'));
	}
	const app = resolveResource(p.resource, await store.listAppsWithUrl());
	if (!app) return fail(new OAuthError('invalid_target', 'resource is not a registered NoEgos app'));
	let scope: string;
	try {
		scope = normalizeScope(p.scope);
	} catch (e) {
		return fail(e as OAuthError);
	}
	return {
		ok: true,
		value: {
			client,
			redirect_uri: p.redirect_uri,
			code_challenge: p.code_challenge,
			state: p.state,
			scope,
			resource: p.resource,
			app
		}
	};
}

export function buildRedirect(redirectUri: string, params: Record<string, string | null | undefined>): string {
	const u = new URL(redirectUri);
	for (const [k, v] of Object.entries(params)) {
		if (v !== null && v !== undefined) u.searchParams.set(k, v);
	}
	return u.toString();
}

/** Called after the user approves. Returns the code to send back to the client. */
export async function issueCode(store: OAuthStore, v: ValidatedAuthorize, userId: string): Promise<string> {
	const role = await store.getAppRole(userId, v.app.id);
	if (!role) throw new OAuthError('access_denied', `You don't have access to ${v.app.name}`);
	const code = randomToken(32);
	await store.saveCode({
		code_hash: sha256(code),
		client_id: v.client.client_id,
		user_id: userId,
		app_id: v.app.id,
		redirect_uri: v.redirect_uri,
		code_challenge: v.code_challenge,
		resource: v.resource,
		scope: v.scope,
		expires_at: new Date(Date.now() + CODE_TTL * 1000),
		used_at: null
	});
	return code;
}

// ---------------------------------------------------------------- token

export interface TokenResponse {
	access_token: string;
	token_type: 'Bearer';
	expires_in: number;
	refresh_token: string;
	scope: string;
}

async function mintTokens(
	store: OAuthStore,
	grant: { client_id: string; user_id: string; app_id: string; resource: string; scope: string },
	familyId: string
): Promise<TokenResponse> {
	const user = await store.getUser(grant.user_id);
	if (!user) throw new OAuthError('invalid_grant', 'User no longer exists');
	const role = await store.getAppRole(grant.user_id, grant.app_id);
	if (!role) {
		await store.revokeFamily(familyId);
		throw new OAuthError('invalid_grant', 'User no longer has access to this app');
	}
	const apps = await store.listAppsWithUrl();
	const app = apps.find((a) => a.id === grant.app_id);
	if (!app) throw new OAuthError('invalid_grant', 'App no longer exists');

	const access_token = await signAccessToken(
		{
			sub: user.id,
			aud: grant.resource,
			username: user.username,
			client_id: grant.client_id,
			scope: grant.scope,
			apps: [{ slug: app.slug, name: app.name, role }]
		},
		ACCESS_TOKEN_TTL
	);
	const refresh_token = randomToken(32);
	await store.saveRefresh({
		token_hash: sha256(refresh_token),
		family_id: familyId,
		client_id: grant.client_id,
		user_id: grant.user_id,
		app_id: grant.app_id,
		resource: grant.resource,
		scope: grant.scope,
		expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL * 1000),
		used_at: null,
		revoked_at: null
	});
	await store.touchClient(grant.client_id);
	return { access_token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL, refresh_token, scope: grant.scope };
}

export async function exchangeToken(store: OAuthStore, form: URLSearchParams | FormData): Promise<TokenResponse> {
	const get = (k: string) => form.get(k)?.toString() ?? null;
	const grantType = get('grant_type');
	const clientId = get('client_id');
	if (!clientId) throw new OAuthError('invalid_client', 'client_id is required', 401);
	const client = await store.getClient(clientId);
	if (!client) throw new OAuthError('invalid_client', 'Unknown client', 401);

	if (grantType === 'authorization_code') {
		const code = get('code');
		const verifier = get('code_verifier');
		const redirectUri = get('redirect_uri');
		if (!code || !verifier || !redirectUri) {
			throw new OAuthError('invalid_request', 'code, code_verifier and redirect_uri are required');
		}
		const rec = await store.consumeCode(sha256(code));
		if (!rec || rec.client_id !== clientId) throw new OAuthError('invalid_grant', 'Invalid authorization code');
		if (rec.used_at) {
			// Code replay: kill anything minted from it (RFC 6749 §4.1.2)
			await store.revokeUserApp(rec.user_id, rec.app_id);
			throw new OAuthError('invalid_grant', 'Authorization code already used');
		}
		if (rec.expires_at.getTime() < Date.now()) throw new OAuthError('invalid_grant', 'Authorization code expired');
		if (rec.redirect_uri !== redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri mismatch');
		if (!verifyPkce(verifier, rec.code_challenge)) throw new OAuthError('invalid_grant', 'PKCE verification failed');
		const resource = get('resource');
		if (resource && resource !== rec.resource) throw new OAuthError('invalid_target', 'resource does not match the authorization');
		return mintTokens(store, rec, crypto.randomUUID());
	}

	if (grantType === 'refresh_token') {
		const token = get('refresh_token');
		if (!token) throw new OAuthError('invalid_request', 'refresh_token is required');
		const rec = await store.consumeRefresh(sha256(token));
		if (!rec || rec.client_id !== clientId) throw new OAuthError('invalid_grant', 'Invalid refresh token');
		if (rec.revoked_at) throw new OAuthError('invalid_grant', 'Refresh token revoked');
		if (rec.used_at) {
			// Reuse of a rotated token → assume theft, revoke the whole chain
			await store.revokeFamily(rec.family_id);
			throw new OAuthError('invalid_grant', 'Refresh token already used; session revoked');
		}
		if (rec.expires_at.getTime() < Date.now()) throw new OAuthError('invalid_grant', 'Refresh token expired');
		const resource = get('resource');
		if (resource && resource !== rec.resource) throw new OAuthError('invalid_target', 'resource does not match the grant');
		let scope = rec.scope;
		const requested = get('scope');
		if (requested) {
			scope = normalizeScope(requested);
			if (!scopeWithin(scope, rec.scope)) throw new OAuthError('invalid_scope', 'Cannot widen scope on refresh');
		}
		return mintTokens(store, { ...rec, scope }, rec.family_id);
	}

	throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
}

/** RFC 7009. Always succeeds from the client's point of view. */
export async function revokeToken(store: OAuthStore, form: URLSearchParams | FormData): Promise<void> {
	const token = form.get('token')?.toString();
	const clientId = form.get('client_id')?.toString();
	if (!token) return;
	const rec = await store.getRefresh(sha256(token));
	if (rec && (!clientId || rec.client_id === clientId)) await store.revokeFamily(rec.family_id);
	// Access tokens are stateless JWTs; they expire within ACCESS_TOKEN_TTL.
}

export function authServerMetadata(issuer: string) {
	return {
		issuer,
		authorization_endpoint: `${issuer}/oauth/authorize`,
		token_endpoint: `${issuer}/oauth/token`,
		registration_endpoint: `${issuer}/oauth/register`,
		revocation_endpoint: `${issuer}/oauth/revoke`,
		jwks_uri: `${issuer}/api/jwks`,
		response_types_supported: ['code'],
		response_modes_supported: ['query'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'],
		revocation_endpoint_auth_methods_supported: ['none'],
		scopes_supported: [...SUPPORTED_SCOPES],
		authorization_response_iss_parameter_supported: true,
		service_documentation: `${issuer}/`
	};
}

// ---------------------------------------------------------------- Postgres store

function toCode(r: Record<string, unknown>): CodeRecord {
	return r as unknown as CodeRecord;
}

export const pgStore: OAuthStore = {
	async createClient(c) {
		await sql`
			INSERT INTO oauth_clients (client_id, client_name, redirect_uris)
			VALUES (${c.client_id}, ${c.client_name}, ${c.redirect_uris})
		`;
	},
	async getClient(clientId) {
		const rows = await sql`SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ${clientId}`;
		return (rows[0] as unknown as OAuthClient) ?? null;
	},
	async touchClient(clientId) {
		await sql`UPDATE oauth_clients SET last_used_at = now() WHERE client_id = ${clientId}`;
	},
	async listAppsWithUrl() {
		const rows = await sql`SELECT id, slug, name, url FROM apps WHERE url IS NOT NULL`;
		return rows as unknown as AppRecord[];
	},
	async getAppRole(userId, appId) {
		const rows = await sql`SELECT role FROM app_access WHERE user_id = ${userId} AND app_id = ${appId}`;
		return (rows[0]?.role as string) ?? null;
	},
	async getUser(userId) {
		const rows = await sql`SELECT id, username FROM users WHERE id = ${userId}`;
		return (rows[0] as unknown as UserForToken) ?? null;
	},
	async saveCode(c) {
		await sql`
			INSERT INTO oauth_codes (code_hash, client_id, user_id, app_id, redirect_uri, code_challenge, resource, scope, expires_at)
			VALUES (${c.code_hash}, ${c.client_id}, ${c.user_id}, ${c.app_id}, ${c.redirect_uri}, ${c.code_challenge}, ${c.resource}, ${c.scope}, ${c.expires_at})
		`;
		// opportunistic cleanup
		await sql`DELETE FROM oauth_codes WHERE expires_at < now() - interval '1 day'`;
	},
	async consumeCode(codeHash) {
		// Return the pre-update row so callers can detect replay.
		const rows = await sql`
			UPDATE oauth_codes c SET used_at = COALESCE(c.used_at, now())
			FROM (SELECT code_hash, used_at FROM oauth_codes WHERE code_hash = ${codeHash} FOR UPDATE) old
			WHERE c.code_hash = old.code_hash
			RETURNING c.code_hash, c.client_id, c.user_id, c.app_id, c.redirect_uri, c.code_challenge,
				c.resource, c.scope, c.expires_at, old.used_at
		`;
		return rows[0] ? toCode(rows[0]) : null;
	},
	async saveRefresh(r) {
		await sql`
			INSERT INTO oauth_refresh_tokens (token_hash, family_id, client_id, user_id, app_id, resource, scope, expires_at)
			VALUES (${r.token_hash}, ${r.family_id}, ${r.client_id}, ${r.user_id}, ${r.app_id}, ${r.resource}, ${r.scope}, ${r.expires_at})
		`;
	},
	async consumeRefresh(tokenHash) {
		const rows = await sql`
			UPDATE oauth_refresh_tokens t SET used_at = COALESCE(t.used_at, now())
			FROM (SELECT token_hash, used_at FROM oauth_refresh_tokens WHERE token_hash = ${tokenHash} FOR UPDATE) old
			WHERE t.token_hash = old.token_hash
			RETURNING t.token_hash, t.family_id, t.client_id, t.user_id, t.app_id, t.resource, t.scope,
				t.expires_at, t.revoked_at, old.used_at
		`;
		return (rows[0] as unknown as RefreshRecord) ?? null;
	},
	async getRefresh(tokenHash) {
		const rows = await sql`SELECT * FROM oauth_refresh_tokens WHERE token_hash = ${tokenHash}`;
		return (rows[0] as unknown as RefreshRecord) ?? null;
	},
	async revokeFamily(familyId) {
		await sql`UPDATE oauth_refresh_tokens SET revoked_at = now() WHERE family_id = ${familyId} AND revoked_at IS NULL`;
	},
	async revokeUserApp(userId, appId) {
		if (appId) {
			await sql`UPDATE oauth_refresh_tokens SET revoked_at = now() WHERE user_id = ${userId} AND app_id = ${appId} AND revoked_at IS NULL`;
		} else {
			await sql`UPDATE oauth_refresh_tokens SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`;
		}
	},
	async listGrants(userId) {
		const rows = await sql`
			SELECT t.family_id, t.client_id, c.client_name, a.name AS app_name,
				(array_agg(t.scope ORDER BY t.created_at DESC))[1] AS scope,
				min(t.created_at) AS created_at, max(t.used_at) AS last_used_at
			FROM oauth_refresh_tokens t
			JOIN oauth_clients c ON c.client_id = t.client_id
			JOIN apps a ON a.id = t.app_id
			WHERE t.user_id = ${userId}
			GROUP BY t.family_id, t.client_id, c.client_name, a.name
			HAVING bool_or(t.revoked_at IS NULL AND t.used_at IS NULL AND t.expires_at > now())
			ORDER BY max(t.created_at) DESC
		`;
		return rows as unknown as GrantSummary[];
	}
};

let activeStore: OAuthStore = pgStore;
export function getStore(): OAuthStore {
	return activeStore;
}
/** Test hook. */
export function setStore(s: OAuthStore): void {
	activeStore = s;
}

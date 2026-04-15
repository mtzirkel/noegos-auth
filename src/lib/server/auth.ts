import { SignJWT, jwtVerify, importJWK, exportJWK, generateKeyPair, type JWK } from 'jose';
import { TOTP, Secret } from 'otpauth';
import * as QRCode from 'qrcode';
import { sql } from './db.js';
import { COOKIE_DOMAIN, SESSION_DAYS, AUTH_URL } from '$env/static/private';
import crypto from 'node:crypto';

let privateKey: CryptoKey;
let publicKey: CryptoKey;
let publicJwk: JWK;

export async function initKeys() {
	const row = await sql`
		CREATE TABLE IF NOT EXISTS auth_keys (
			id TEXT PRIMARY KEY,
			private_jwk JSONB NOT NULL,
			public_jwk JSONB NOT NULL
		)
	`.then(() => sql`SELECT private_jwk, public_jwk FROM auth_keys WHERE id = 'signing'`);

	if (row.length > 0) {
		privateKey = await importJWK(row[0].private_jwk as JWK, 'EdDSA') as CryptoKey;
		publicKey = await importJWK(row[0].public_jwk as JWK, 'EdDSA') as CryptoKey;
		publicJwk = row[0].public_jwk as JWK;
	} else {
		const pair = await generateKeyPair('EdDSA', { extractable: true });
		privateKey = pair.privateKey;
		publicKey = pair.publicKey;
		const privJwk = await exportJWK(pair.privateKey);
		publicJwk = await exportJWK(pair.publicKey);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await sql`INSERT INTO auth_keys (id, private_jwk, public_jwk) VALUES ('signing', ${sql.json(privJwk as any)}, ${sql.json(publicJwk as any)})`;
	}
}

export function getPublicJwk() {
	return publicJwk;
}

export async function createToken(userId: string, username: string, isAdmin: boolean, appAccess: AppAccess[]) {
	const days = parseInt(SESSION_DAYS || '90');
	const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

	const jwt = await new SignJWT({
		sub: userId,
		username,
		admin: isAdmin,
		apps: appAccess
	})
		.setProtectedHeader({ alg: 'EdDSA', kid: 'noegos-auth-signing' })
		.setIssuedAt()
		.setExpirationTime(expiresAt)
		.setIssuer(AUTH_URL)
		.sign(privateKey);

	const tokenHash = crypto.createHash('sha256').update(jwt).digest('hex');
	await sql`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (${userId}, ${tokenHash}, ${expiresAt})`;

	return { jwt, expiresAt };
}

export async function verifyToken(jwt: string) {
	try {
		const { payload } = await jwtVerify(jwt, publicKey, { issuer: AUTH_URL });

		const tokenHash = crypto.createHash('sha256').update(jwt).digest('hex');
		const session = await sql`SELECT id FROM sessions WHERE token_hash = ${tokenHash} AND expires_at > now()`;
		if (session.length === 0) return null;

		return payload as unknown as TokenPayload;
	} catch {
		return null;
	}
}

export async function revokeSession(jwt: string) {
	const tokenHash = crypto.createHash('sha256').update(jwt).digest('hex');
	await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
}

export async function revokeAllUserSessions(userId: string) {
	await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
}

export function generateTotpSecret(username: string): { secret: string; uri: string } {
	const secret = new Secret({ size: 20 });
	const totp = new TOTP({
		issuer: 'NoEgos Auth',
		label: username,
		algorithm: 'SHA1',
		digits: 6,
		period: 30,
		secret
	});
	return { secret: secret.base32, uri: totp.toString() };
}

export async function generateQrCode(uri: string): Promise<string> {
	return QRCode.toDataURL(uri, { width: 256, margin: 2 });
}

export function verifyTotp(secret: string, code: string): boolean {
	const totp = new TOTP({
		secret: Secret.fromBase32(secret),
		algorithm: 'SHA1',
		digits: 6,
		period: 30
	});
	const delta = totp.validate({ token: code, window: 1 });
	return delta !== null;
}

export async function getUserAppAccess(userId: string): Promise<AppAccess[]> {
	const rows = await sql`
		SELECT a.slug, a.name, aa.role
		FROM app_access aa
		JOIN apps a ON a.id = aa.app_id
		WHERE aa.user_id = ${userId}
	`;
	return rows.map((r) => ({ slug: r.slug, name: r.name, role: r.role }));
}

/**
 * Validate a return_to URL for post-login redirect.
 *
 * Rules:
 * - Relative paths (starting with /) are allowed for in-app redirects
 * - Absolute URLs must be HTTPS and their hostname must be a registered app's URL
 *   OR a subdomain of COOKIE_DOMAIN (e.g. .noegosunderwater.com)
 * - Anything else returns null so the caller falls back to a safe default
 */
export async function validateReturnTo(returnTo: string | null): Promise<string | null> {
	if (!returnTo) return null;

	// Relative path — safe, belongs to auth itself
	if (returnTo.startsWith('/') && !returnTo.startsWith('//')) {
		return returnTo;
	}

	let parsed: URL;
	try {
		parsed = new URL(returnTo);
	} catch {
		return null;
	}

	// Must be HTTPS in production
	if (COOKIE_DOMAIN !== 'localhost' && parsed.protocol !== 'https:') {
		return null;
	}

	// Allow anything under the cookie domain (e.g. .noegosunderwater.com)
	if (COOKIE_DOMAIN && COOKIE_DOMAIN !== 'localhost') {
		const cookieHost = COOKIE_DOMAIN.replace(/^\./, '');
		if (parsed.hostname === cookieHost || parsed.hostname.endsWith('.' + cookieHost)) {
			return parsed.toString();
		}
	}

	// Allow exact matches against registered apps
	const apps = await sql`SELECT url FROM apps WHERE url IS NOT NULL`;
	for (const app of apps) {
		if (!app.url) continue;
		try {
			const appUrl = new URL(app.url as string);
			if (parsed.hostname === appUrl.hostname) {
				return parsed.toString();
			}
		} catch {
			// ignore invalid app URLs
		}
	}

	return null;
}

export function cookieOptions(expiresAt: Date) {
	return {
		path: '/',
		domain: COOKIE_DOMAIN || undefined,
		httpOnly: true,
		secure: COOKIE_DOMAIN !== 'localhost',
		sameSite: 'lax' as const,
		expires: expiresAt
	};
}

export interface AppAccess {
	slug: string;
	name: string;
	role: string;
}

export interface TokenPayload {
	sub: string;
	username: string;
	admin: boolean;
	apps: AppAccess[];
	iat: number;
	exp: number;
	iss: string;
}

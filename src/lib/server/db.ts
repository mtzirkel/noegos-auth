import postgres from 'postgres';
import { env } from '$env/dynamic/private';

function createConnection() {
	const url = env.DATABASE_URL || '';
	// Support Unix socket connections (peer auth, no password)
	if (url.includes('host=') || url.includes('/var/run')) {
		const params = new URLSearchParams(url.replace(/^postgres:\/\/\?/, ''));
		return postgres({
			host: params.get('host') || '/var/run/postgresql',
			port: parseInt(params.get('port') || '5432'),
			database: params.get('database') || 'noegos_auth',
			username: params.get('user') || undefined,
			onnotice: () => {}
		});
	}
	return postgres(url);
}

export const sql = createConnection();

export async function migrate() {
	await sql`
		CREATE TABLE IF NOT EXISTS apps (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			slug TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			url TEXT,
			created_at TIMESTAMPTZ DEFAULT now()
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS users (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			username TEXT UNIQUE NOT NULL,
			display_name TEXT,
			totp_secret TEXT,
			totp_verified BOOLEAN DEFAULT FALSE,
			is_admin BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMPTZ DEFAULT now(),
			last_login TIMESTAMPTZ
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS access_requests (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			username TEXT NOT NULL,
			display_name TEXT,
			message TEXT,
			status TEXT DEFAULT 'pending',
			reviewed_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT now()
		)
	`;

	// Tracks which app the requester wants access to. Nullable because legacy
	// requests pre-date this column and the column is informational (the admin
	// still confirms apps at approve time).
	await sql`
		ALTER TABLE access_requests
		ADD COLUMN IF NOT EXISTS requested_app_id UUID REFERENCES apps(id) ON DELETE SET NULL
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS app_access (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
			role TEXT DEFAULT 'user',
			granted_at TIMESTAMPTZ DEFAULT now(),
			UNIQUE(user_id, app_id)
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS sessions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			token_hash TEXT NOT NULL,
			expires_at TIMESTAMPTZ NOT NULL,
			created_at TIMESTAMPTZ DEFAULT now()
		)
	`;

	// --- OAuth 2.1 authorization server (MCP / agent clients) ---
	await sql`
		CREATE TABLE IF NOT EXISTS oauth_clients (
			client_id TEXT PRIMARY KEY,
			client_name TEXT NOT NULL,
			redirect_uris TEXT[] NOT NULL,
			created_at TIMESTAMPTZ DEFAULT now(),
			last_used_at TIMESTAMPTZ
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS oauth_codes (
			code_hash TEXT PRIMARY KEY,
			client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
			redirect_uri TEXT NOT NULL,
			code_challenge TEXT NOT NULL,
			resource TEXT NOT NULL,
			scope TEXT NOT NULL,
			expires_at TIMESTAMPTZ NOT NULL,
			used_at TIMESTAMPTZ
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
			token_hash TEXT PRIMARY KEY,
			family_id UUID NOT NULL,
			client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
			resource TEXT NOT NULL,
			scope TEXT NOT NULL,
			created_at TIMESTAMPTZ DEFAULT now(),
			expires_at TIMESTAMPTZ NOT NULL,
			used_at TIMESTAMPTZ,
			revoked_at TIMESTAMPTZ
		)
	`;
	await sql`CREATE INDEX IF NOT EXISTS oauth_refresh_family_idx ON oauth_refresh_tokens(family_id)`;
	await sql`CREATE INDEX IF NOT EXISTS oauth_refresh_user_idx ON oauth_refresh_tokens(user_id)`;
}

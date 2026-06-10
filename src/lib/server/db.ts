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
}

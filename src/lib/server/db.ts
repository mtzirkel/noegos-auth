import postgres from 'postgres';
import { DATABASE_URL } from '$env/static/private';

export const sql = postgres(DATABASE_URL);

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

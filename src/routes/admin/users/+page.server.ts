import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { sql } from '$lib/server/db.js';
import { revokeAllUserSessions } from '$lib/server/auth.js';
import { AUTH_URL } from '$env/static/private';

export const load: PageServerLoad = async () => {
	const users = await sql`
		SELECT u.*,
			coalesce(json_agg(json_build_object('slug', a.slug, 'name', a.name, 'role', aa.role))
				FILTER (WHERE a.id IS NOT NULL), '[]') as app_access
		FROM users u
		LEFT JOIN app_access aa ON aa.user_id = u.id
		LEFT JOIN apps a ON a.id = aa.app_id
		GROUP BY u.id
		ORDER BY u.created_at DESC
	`;

	const apps = await sql`SELECT id, slug, name FROM apps ORDER BY name`;

	return { users, apps };
};

export const actions: Actions = {
	toggle_admin: async ({ request }) => {
		const form = await request.formData();
		const userId = form.get('user_id')?.toString();
		if (!userId) return fail(400);

		await sql`UPDATE users SET is_admin = NOT is_admin WHERE id = ${userId}`;
		return { updated: true };
	},

	grant_app: async ({ request }) => {
		const form = await request.formData();
		const userId = form.get('user_id')?.toString();
		const appId = form.get('app_id')?.toString();
		const role = form.get('role')?.toString() || 'user';

		if (!userId || !appId) return fail(400);

		await sql`
			INSERT INTO app_access (user_id, app_id, role)
			VALUES (${userId}, ${appId}, ${role})
			ON CONFLICT (user_id, app_id) DO UPDATE SET role = ${role}
		`;

		// Revoke sessions so user gets a fresh JWT with updated claims
		await revokeAllUserSessions(userId);

		return { updated: true };
	},

	revoke_app: async ({ request }) => {
		const form = await request.formData();
		const userId = form.get('user_id')?.toString();
		const appSlug = form.get('app_slug')?.toString();

		if (!userId || !appSlug) return fail(400);

		await sql`
			DELETE FROM app_access
			WHERE user_id = ${userId}
			AND app_id = (SELECT id FROM apps WHERE slug = ${appSlug})
		`;

		await revokeAllUserSessions(userId);

		return { updated: true };
	},

	delete_user: async ({ request }) => {
		const form = await request.formData();
		const userId = form.get('user_id')?.toString();
		if (!userId) return fail(400);

		await sql`DELETE FROM users WHERE id = ${userId}`;
		return { deleted: true };
	},

	gen_setup_link: async ({ request }) => {
		const form = await request.formData();
		const userId = form.get('user_id')?.toString();
		if (!userId) return fail(400, { error: 'Missing user ID' });

		const users = await sql`
			SELECT id, username, totp_verified FROM users WHERE id = ${userId}
		`;
		if (users.length === 0) return fail(404, { error: 'User not found' });

		// Generate a fresh 7-day setup token
		const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
		const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
		const payload = Buffer.from(JSON.stringify({ sub: userId, purpose: 'totp-setup', exp })).toString('base64url');
		const setupToken = `${header}.${payload}.`;
		const setupUrl = `${AUTH_URL}/setup/${setupToken}`;

		return { setupUrl, username: users[0].username, totp_verified: users[0].totp_verified };
	}
};

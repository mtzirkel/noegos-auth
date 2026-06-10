import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { sql } from '$lib/server/db.js';
import { revokeAllUserSessions, generateTotpSecret } from '$lib/server/auth.js';
import { AUTH_URL } from '$env/static/private';

export const load: PageServerLoad = async ({ locals }) => {
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

	const apps = await sql`SELECT id, slug, name, roles FROM apps ORDER BY name`;

	return { users, apps, currentUserId: locals.user?.id ?? null };
};

function buildSetupUrl(userId: string): string {
	const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
	const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
	const payload = Buffer.from(JSON.stringify({ sub: userId, purpose: 'totp-setup', exp })).toString('base64url');
	return `${AUTH_URL}/setup/${header}.${payload}.`;
}

export const actions: Actions = {
	add_user: async ({ request }) => {
		const form = await request.formData();
		const username = form.get('username')?.toString()?.trim()?.toLowerCase();
		const displayName = form.get('display_name')?.toString()?.trim() || null;
		const isAdmin = form.get('is_admin')?.toString() === 'on';
		const appIds = form.getAll('app_ids').map((v) => v.toString()).filter(Boolean);
		const roles = form.getAll('roles').map((v) => v.toString());

		if (!username) return fail(400, { error: 'Username required' });
		if (!/^[a-z0-9_-]+$/.test(username)) {
			return fail(400, { error: 'Username may only contain lowercase letters, numbers, dashes, and underscores' });
		}

		const existing = await sql`SELECT id FROM users WHERE username = ${username}`;
		if (existing.length > 0) return fail(400, { error: `User "${username}" already exists` });

		// Validate roles against each app's allowed roles
		if (appIds.length > 0) {
			const appRows = await sql`SELECT id, roles FROM apps WHERE id = ANY(${sql.array(appIds)}::uuid[])`;
			const appRolesMap = new Map((appRows as unknown as { id: string; roles: string[] }[]).map((a) => [a.id, a.roles]));
			for (let i = 0; i < appIds.length; i++) {
				const allowed = appRolesMap.get(appIds[i]) ?? ['user'];
				const role = roles[i] || 'user';
				if (!allowed.includes(role)) {
					return fail(400, { error: `Invalid role "${role}" for this app. Allowed: ${allowed.join(', ')}` });
				}
			}
		}

		const { secret } = generateTotpSecret(username);

		const users = await sql`
			INSERT INTO users (username, display_name, totp_secret, is_admin)
			VALUES (${username}, ${displayName}, ${secret}, ${isAdmin})
			RETURNING id
		`;
		const userId = users[0].id;

		for (let i = 0; i < appIds.length; i++) {
			const role = roles[i] || 'user';
			await sql`
				INSERT INTO app_access (user_id, app_id, role)
				VALUES (${userId}, ${appIds[i]}, ${role})
				ON CONFLICT (user_id, app_id) DO UPDATE SET role = ${role}
			`;
		}

		return { added: true, setupUrl: buildSetupUrl(userId), username, totp_verified: false };
	},

	toggle_admin: async ({ request, locals }) => {
		const form = await request.formData();
		const userId = form.get('user_id')?.toString();
		if (!userId) return fail(400);
		if (userId === locals.user?.id) {
			return fail(400, { error: 'You cannot change your own admin status' });
		}

		await sql`UPDATE users SET is_admin = NOT is_admin WHERE id = ${userId}`;
		return { updated: true };
	},

	grant_app: async ({ request }) => {
		const form = await request.formData();
		const userId = form.get('user_id')?.toString();
		const appId = form.get('app_id')?.toString();
		const role = form.get('role')?.toString() || 'user';

		if (!userId || !appId) return fail(400);

		// Validate role against that app's allowed roles
		const appRows = await sql`SELECT roles FROM apps WHERE id = ${appId}`;
		if (appRows.length > 0) {
			const allowed: string[] = appRows[0].roles ?? ['user'];
			if (!allowed.includes(role)) {
				return fail(400, { error: `Invalid role "${role}". Allowed: ${allowed.join(', ')}` });
			}
		}

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

	delete_user: async ({ request, locals }) => {
		const form = await request.formData();
		const userId = form.get('user_id')?.toString();
		if (!userId) return fail(400);
		if (userId === locals.user?.id) {
			return fail(400, { error: 'You cannot delete your own account' });
		}

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

		return {
			setupUrl: buildSetupUrl(userId),
			username: users[0].username,
			totp_verified: users[0].totp_verified
		};
	}
};

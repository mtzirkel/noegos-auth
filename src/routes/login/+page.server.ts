import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { sql } from '$lib/server/db.js';
import { verifyTotp, createToken, getUserAppAccess, cookieOptions } from '$lib/server/auth.js';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(302, '/');
	return { returnTo: url.searchParams.get('return') };
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const username = form.get('username')?.toString()?.trim()?.toLowerCase();
		const code = form.get('code')?.toString()?.trim();

		if (!username || !code) {
			return fail(400, { error: 'Username and code are required', username });
		}

		const users = await sql`
			SELECT id, username, totp_secret, totp_verified, is_admin
			FROM users WHERE username = ${username}
		`;

		if (users.length === 0 || !users[0].totp_verified || !users[0].totp_secret) {
			return fail(400, { error: 'Invalid username or code', username });
		}

		const user = users[0];
		if (!verifyTotp(user.totp_secret, code)) {
			return fail(400, { error: 'Invalid username or code', username });
		}

		await sql`UPDATE users SET last_login = now() WHERE id = ${user.id}`;

		const appAccess = await getUserAppAccess(user.id);
		const { jwt, expiresAt } = await createToken(user.id, user.username, user.is_admin, appAccess);

		cookies.set('noegos_auth', jwt, cookieOptions(expiresAt));

		const returnTo = url.searchParams.get('return') || '/';
		redirect(302, returnTo);
	}
};

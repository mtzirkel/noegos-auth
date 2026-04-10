import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { sql } from '$lib/server/db.js';

export const load: PageServerLoad = async () => {
	return {};
};

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const username = form.get('username')?.toString()?.trim()?.toLowerCase();
		const displayName = form.get('display_name')?.toString()?.trim() || null;
		const message = form.get('message')?.toString()?.trim() || null;

		if (!username) {
			return fail(400, { error: 'Username is required', username: '', displayName: displayName ?? '', message: message ?? '' });
		}

		if (!/^[a-z0-9_-]{3,30}$/.test(username)) {
			return fail(400, {
				error: 'Username must be 3-30 characters, lowercase letters, numbers, hyphens, or underscores',
				username, displayName: displayName ?? '', message: message ?? ''
			});
		}

		const existing = await sql`SELECT id FROM users WHERE username = ${username}`;
		if (existing.length > 0) {
			return fail(400, { error: 'Username is already taken', username, displayName: displayName ?? '', message: message ?? '' });
		}

		const pending = await sql`
			SELECT id FROM access_requests WHERE username = ${username} AND status = 'pending'
		`;
		if (pending.length > 0) {
			return fail(400, { error: 'A request for this username is already pending', username, displayName: displayName ?? '', message: message ?? '' });
		}

		await sql`
			INSERT INTO access_requests (username, display_name, message)
			VALUES (${username}, ${displayName}, ${message})
		`;

		return { success: true };
	}
};

import type { Actions } from './$types';
import { redirect } from '@sveltejs/kit';
import { revokeSession, cookieOptions } from '$lib/server/auth.js';

export const actions: Actions = {
	default: async ({ cookies }) => {
		const token = cookies.get('noegos_auth');
		if (token) {
			await revokeSession(token);
		}
		cookies.delete('noegos_auth', { path: '/' });
		redirect(302, '/');
	}
};

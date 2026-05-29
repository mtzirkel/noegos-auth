import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { sql } from '$lib/server/db.js';
import { generateTotpSecret } from '$lib/server/auth.js';
import { AUTH_URL } from '$env/static/private';

export const load: PageServerLoad = async () => {
	const requests = await sql`
		SELECT id, username, display_name, message, status, created_at, reviewed_at
		FROM access_requests
		ORDER BY
			CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
			created_at ASC
	`;

	const apps = await sql`SELECT id, slug, name FROM apps ORDER BY name`;

	return { requests, apps };
};

export const actions: Actions = {
	approve: async ({ request }) => {
		const form = await request.formData();
		const requestId = form.get('request_id')?.toString();
		const appIds = form.getAll('app_ids').map((v) => v.toString());
		const roles = form.getAll('roles').map((v) => v.toString());

		if (!requestId) return fail(400, { error: 'Missing request ID' });

		const requests = await sql`
			SELECT id, username, display_name FROM access_requests WHERE id = ${requestId} AND status = 'pending'
		`;
		if (requests.length === 0) return fail(404, { error: 'Request not found' });

		const req = requests[0];
		const { secret } = generateTotpSecret(req.username);

		// Create user
		const users = await sql`
			INSERT INTO users (username, display_name, totp_secret)
			VALUES (${req.username}, ${req.display_name}, ${secret})
			RETURNING id
		`;
		const userId = users[0].id;

		// Grant app access
		for (let i = 0; i < appIds.length; i++) {
			const role = roles[i] || 'user';
			await sql`
				INSERT INTO app_access (user_id, app_id, role)
				VALUES (${userId}, ${appIds[i]}, ${role})
				ON CONFLICT (user_id, app_id) DO UPDATE SET role = ${role}
			`;
		}

		// Mark request as approved
		await sql`
			UPDATE access_requests SET status = 'approved', reviewed_at = now()
			WHERE id = ${requestId}
		`;

		// Generate a short-lived setup token (7 days)
		// Simple base64url-encoded payload — verifySetupToken() decodes it manually anyway
		const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
		const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
		const payload = Buffer.from(JSON.stringify({ sub: userId, purpose: 'totp-setup', exp })).toString('base64url');
		const setupToken = `${header}.${payload}.`;

		const setupUrl = `${AUTH_URL}/setup/${setupToken}`;

		return { approved: true, setupUrl, username: req.username };
	},

	deny: async ({ request }) => {
		const form = await request.formData();
		const requestId = form.get('request_id')?.toString();

		if (!requestId) return fail(400, { error: 'Missing request ID' });

		await sql`
			UPDATE access_requests SET status = 'denied', reviewed_at = now()
			WHERE id = ${requestId}
		`;

		return { denied: true };
	}
};

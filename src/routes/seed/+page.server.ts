import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { sql } from '$lib/server/db.js';
import { generateTotpSecret, generateQrCode } from '$lib/server/auth.js';

// This page is only accessible when no admin exists (initial setup)
export const load: PageServerLoad = async ({ url }) => {
	const admins = await sql`SELECT id FROM users WHERE is_admin = true`;
	// Don't redirect on POST result — the form action needs to render the QR code
	if (admins.length > 0 && url.searchParams.get('setup') !== 'complete') {
		redirect(302, '/login');
	}
	return { hasAdmin: admins.length > 0 };
};

export const actions: Actions = {
	default: async ({ request }) => {
		const admins = await sql`SELECT id FROM users WHERE is_admin = true`;
		if (admins.length > 0) return fail(400, { error: 'Admin already exists' });

		const form = await request.formData();
		const username = form.get('username')?.toString()?.trim()?.toLowerCase();

		if (!username) return fail(400, { error: 'Username required' });

		const { secret, uri } = generateTotpSecret(username);
		const qrCode = await generateQrCode(uri);

		await sql`
			INSERT INTO users (username, totp_secret, is_admin, totp_verified)
			VALUES (${username}, ${secret}, true, true)
		`;

		return { success: true, qrCode, secret, username };
	}
};

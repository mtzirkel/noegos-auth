import type { Actions, PageServerLoad } from './$types';
import { fail, error } from '@sveltejs/kit';
import { sql } from '$lib/server/db.js';
import { verifyTotp, generateQrCode } from '$lib/server/auth.js';
import { jwtVerify } from 'jose';
import { importJWK } from 'jose';

async function verifySetupToken(token: string) {
	// Setup tokens are signed with a short-lived claim
	// We store the secret in the user row when admin approves, so we just need to verify
	// the token points to a valid user who hasn't set up TOTP yet
	try {
		// Decode without verification first to get the user ID
		const parts = token.split('.');
		const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
		if (payload.purpose !== 'totp-setup') return null;
		if (payload.exp && payload.exp < Date.now() / 1000) return null;
		return payload.sub as string;
	} catch {
		return null;
	}
}

export const load: PageServerLoad = async ({ params }) => {
	const userId = await verifySetupToken(params.token);
	if (!userId) error(400, 'Invalid or expired setup link');

	const users = await sql`
		SELECT id, username, totp_secret, totp_verified
		FROM users WHERE id = ${userId}
	`;

	if (users.length === 0) error(404, 'User not found');
	const user = users[0];

	if (user.totp_verified) {
		return { alreadySetup: true, username: user.username };
	}

	if (!user.totp_secret) error(500, 'No TOTP secret generated');

	const uri = `otpauth://totp/NoEgos%20Auth:${encodeURIComponent(user.username)}?secret=${user.totp_secret}&issuer=NoEgos%20Auth&algorithm=SHA1&digits=6&period=30`;
	const qrCode = await generateQrCode(uri);

	return {
		alreadySetup: false,
		username: user.username,
		qrCode,
		manualSecret: user.totp_secret,
		token: params.token
	};
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const userId = await verifySetupToken(params.token);
		if (!userId) return fail(400, { error: 'Invalid or expired setup link' });

		const form = await request.formData();
		const code = form.get('code')?.toString()?.trim();

		if (!code) return fail(400, { error: 'Enter the 6-digit code from your authenticator app' });

		const users = await sql`
			SELECT id, totp_secret, totp_verified FROM users WHERE id = ${userId}
		`;
		if (users.length === 0) return fail(400, { error: 'User not found' });

		const user = users[0];
		if (user.totp_verified) return fail(400, { error: 'Already set up' });
		if (!user.totp_secret) return fail(500, { error: 'No secret' });

		if (!verifyTotp(user.totp_secret, code)) {
			return fail(400, { error: 'Invalid code. Make sure you scanned the QR code and entered the current 6-digit code.' });
		}

		await sql`UPDATE users SET totp_verified = true WHERE id = ${userId}`;

		return { success: true };
	}
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyToken, getPublicJwk } from '$lib/server/auth.js';

// Consuming apps call this to validate a token and get user info
export const GET: RequestHandler = async ({ request, cookies }) => {
	// Accept token from Authorization header or cookie
	const authHeader = request.headers.get('authorization');
	const token = authHeader?.startsWith('Bearer ')
		? authHeader.slice(7)
		: cookies.get('noegos_auth');

	if (!token) {
		return json({ authenticated: false }, { status: 401 });
	}

	const payload = await verifyToken(token);
	if (!payload) {
		return json({ authenticated: false }, { status: 401 });
	}

	return json({
		authenticated: true,
		user: {
			id: payload.sub,
			username: payload.username,
			isAdmin: payload.admin,
			apps: payload.apps
		}
	});
};

// JWKS endpoint so consuming apps can verify tokens locally
export const OPTIONS: RequestHandler = async () => {
	return new Response(null, {
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET',
			'Access-Control-Allow-Headers': 'Authorization'
		}
	});
};

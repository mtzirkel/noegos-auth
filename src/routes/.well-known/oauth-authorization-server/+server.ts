import type { RequestHandler } from './$types';
import { AUTH_URL } from '$env/static/private';
import { authServerMetadata } from '$lib/server/oauth.js';
import { CORS_HEADERS, preflight } from '$lib/server/oauth-http.js';

export const GET: RequestHandler = async () =>
	new Response(JSON.stringify(authServerMetadata(AUTH_URL)), {
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', ...CORS_HEADERS }
	});

export const OPTIONS: RequestHandler = async () => preflight();

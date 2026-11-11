import type { RequestHandler } from './$types';
import { getStore, registerClient, OAuthError } from '$lib/server/oauth.js';
import { oauthJson, oauthErrorResponse, preflight } from '$lib/server/oauth-http.js';

// RFC 7591 dynamic client registration (public clients only).
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json().catch(() => {
			throw new OAuthError('invalid_client_metadata', 'Body must be JSON');
		});
		return oauthJson(await registerClient(getStore(), body), 201);
	} catch (e) {
		return oauthErrorResponse(e);
	}
};

export const OPTIONS: RequestHandler = async () => preflight();

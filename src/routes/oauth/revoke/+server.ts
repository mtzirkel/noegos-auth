import type { RequestHandler } from './$types';
import { getStore, revokeToken } from '$lib/server/oauth.js';
import { oauthJson, oauthErrorResponse, preflight, readForm } from '$lib/server/oauth-http.js';

export const POST: RequestHandler = async ({ request }) => {
	try {
		await revokeToken(getStore(), await readForm(request));
		return oauthJson({});
	} catch (e) {
		return oauthErrorResponse(e);
	}
};

export const OPTIONS: RequestHandler = async () => preflight();

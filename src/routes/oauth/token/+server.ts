import type { RequestHandler } from './$types';
import { getStore, exchangeToken } from '$lib/server/oauth.js';
import { oauthJson, oauthErrorResponse, preflight, readForm } from '$lib/server/oauth-http.js';

export const POST: RequestHandler = async ({ request }) => {
	try {
		return oauthJson(await exchangeToken(getStore(), await readForm(request)));
	} catch (e) {
		return oauthErrorResponse(e);
	}
};

export const OPTIONS: RequestHandler = async () => preflight();

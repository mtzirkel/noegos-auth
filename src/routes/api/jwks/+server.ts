import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPublicJwk } from '$lib/server/auth.js';

// Public JWKS endpoint — consuming apps can fetch the public key
// to verify JWTs locally without calling /api/verify every request
export const GET: RequestHandler = async () => {
	const jwk = getPublicJwk();
	return json(
		{ keys: [{ ...jwk, kid: 'noegos-auth-signing', use: 'sig', alg: 'EdDSA' }] },
		{
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Cache-Control': 'public, max-age=3600'
			}
		}
	);
};

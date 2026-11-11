import { OAuthError } from './oauth.js';

export const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
	'Access-Control-Max-Age': '86400'
};

export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			Pragma: 'no-cache',
			...CORS_HEADERS,
			...extra
		}
	});
}

export function oauthErrorResponse(e: unknown): Response {
	if (e instanceof OAuthError) return oauthJson(e.toJSON(), e.status);
	console.error('oauth: unexpected error', e);
	return oauthJson({ error: 'server_error', error_description: 'Unexpected error' }, 500);
}

export function preflight(): Response {
	return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Token/revoke bodies are form-encoded per spec; accept JSON too for lenient clients. */
export async function readForm(request: Request): Promise<URLSearchParams> {
	const type = (request.headers.get('content-type') ?? '').toLowerCase();
	if (type.includes('application/json')) {
		const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
		const p = new URLSearchParams();
		for (const [k, v] of Object.entries(body)) if (typeof v === 'string') p.set(k, v);
		return p;
	}
	return new URLSearchParams(await request.text());
}

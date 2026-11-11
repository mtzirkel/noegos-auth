/**
 * Replacement for SvelteKit's built-in form CSRF check (disabled in
 * svelte.config.js). Same rule, except for endpoints that are called
 * cross-origin / server-to-server by design and don't rely on cookies.
 */
export const CSRF_EXEMPT_PATHS = new Set(['/oauth/token', '/oauth/revoke', '/oauth/register']);

const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isCsrfViolation(request: Request, url: URL): boolean {
	if (!UNSAFE.has(request.method)) return false;
	if (CSRF_EXEMPT_PATHS.has(url.pathname)) return false;
	const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (!FORM_TYPES.includes(type)) return false;
	return request.headers.get('origin') !== url.origin;
}

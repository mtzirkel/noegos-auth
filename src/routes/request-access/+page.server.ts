import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { sql } from '$lib/server/db.js';

export const load: PageServerLoad = async ({ url }) => {
	const apps = await sql`SELECT id, slug, name, url FROM apps ORDER BY name`;

	// Prefer an explicit ?app=<slug>, fall back to matching the hostname of
	// ?return_to=<url> against a registered app — that's how randos who got
	// bounced from an app to login → request-access carry their context.
	let preselectedAppId: string | null = null;
	const requestedSlug = url.searchParams.get('app');
	if (requestedSlug) {
		preselectedAppId = apps.find((a) => a.slug === requestedSlug)?.id ?? null;
	}
	if (!preselectedAppId) {
		const returnTo = url.searchParams.get('return_to');
		if (returnTo) {
			try {
				const target = new URL(returnTo, url.origin);
				preselectedAppId = apps.find((a) => {
					if (!a.url) return false;
					try {
						return new URL(a.url as string).hostname === target.hostname;
					} catch {
						return false;
					}
				})?.id ?? null;
			} catch {
				// invalid return_to — ignore
			}
		}
	}

	// Strip url from the returned apps; the form only needs id/slug/name
	return {
		apps: apps.map((a) => ({ id: a.id, slug: a.slug, name: a.name })),
		preselectedAppId
	};
};

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const username = form.get('username')?.toString()?.trim()?.toLowerCase();
		const displayName = form.get('display_name')?.toString()?.trim() || null;
		const message = form.get('message')?.toString()?.trim() || null;
		const requestedAppId = form.get('requested_app_id')?.toString()?.trim() || null;

		const echo = {
			username: username ?? '',
			displayName: displayName ?? '',
			message: message ?? '',
			requestedAppId: requestedAppId ?? ''
		};

		if (!username) {
			return fail(400, { error: 'Username is required', ...echo, username: '' });
		}

		if (!/^[a-z0-9_-]{3,30}$/.test(username)) {
			return fail(400, {
				error: 'Username must be 3-30 characters, lowercase letters, numbers, hyphens, or underscores',
				...echo
			});
		}

		if (!requestedAppId) {
			return fail(400, { error: 'Please pick which app you want access to', ...echo });
		}

		const validApp = await sql`SELECT id FROM apps WHERE id = ${requestedAppId}`;
		if (validApp.length === 0) {
			return fail(400, { error: 'That app does not exist', ...echo, requestedAppId: '' });
		}

		const existing = await sql`SELECT id FROM users WHERE username = ${username}`;
		if (existing.length > 0) {
			return fail(400, { error: 'Username is already taken', ...echo });
		}

		const pending = await sql`
			SELECT id FROM access_requests WHERE username = ${username} AND status = 'pending'
		`;
		if (pending.length > 0) {
			return fail(400, { error: 'A request for this username is already pending', ...echo });
		}

		await sql`
			INSERT INTO access_requests (username, display_name, message, requested_app_id)
			VALUES (${username}, ${displayName}, ${message}, ${requestedAppId})
		`;

		return { success: true };
	}
};

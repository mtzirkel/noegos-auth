import type { Handle } from '@sveltejs/kit';
import { migrate } from '$lib/server/db.js';
import { initKeys, verifyToken } from '$lib/server/auth.js';

let initialized = false;

async function init() {
	if (initialized) return;
	await migrate();
	await initKeys();
	initialized = true;
}

export const handle: Handle = async ({ event, resolve }) => {
	await init();

	const token = event.cookies.get('noegos_auth');
	if (token) {
		const payload = await verifyToken(token);
		if (payload) {
			event.locals.user = {
				id: payload.sub,
				username: payload.username,
				isAdmin: payload.admin,
				apps: payload.apps
			};
		}
	}

	return resolve(event);
};

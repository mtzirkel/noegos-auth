import type { PageServerLoad } from './$types';
import { sql } from '$lib/server/db.js';

export const load: PageServerLoad = async () => {
	const pendingRequests = await sql`
		SELECT id, username, display_name, message, created_at
		FROM access_requests WHERE status = 'pending'
		ORDER BY created_at ASC
	`;

	const userCount = await sql`SELECT count(*)::int as count FROM users`;
	const appCount = await sql`SELECT count(*)::int as count FROM apps`;

	return {
		pendingRequests,
		userCount: userCount[0].count,
		appCount: appCount[0].count
	};
};

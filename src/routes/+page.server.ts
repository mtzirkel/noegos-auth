import type { PageServerLoad } from './$types';
import { sql } from '$lib/server/db.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || locals.user.apps.length === 0) {
		return { apps: [] };
	}

	// Fetch URLs for the user's apps — not in the JWT, so query here
	const slugs = locals.user.apps.map((a: { slug: string }) => a.slug);
	const rows = await sql`
		SELECT slug, url FROM apps WHERE slug = ANY(${sql.array(slugs)})
	`;
	const urlBySlug = new Map(rows.map((r) => [r.slug as string, r.url as string | null]));

	const apps = locals.user.apps.map((a: { slug: string; name: string; role: string }) => ({
		slug: a.slug,
		name: a.name,
		role: a.role,
		url: urlBySlug.get(a.slug) ?? null
	}));

	return { apps };
};

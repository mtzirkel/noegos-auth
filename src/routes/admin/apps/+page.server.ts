import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { sql } from '$lib/server/db.js';

export const load: PageServerLoad = async () => {
	const apps = await sql`
		SELECT a.id, a.slug, a.name, a.url, count(aa.id)::int as user_count
		FROM apps a
		LEFT JOIN app_access aa ON aa.app_id = a.id
		GROUP BY a.id
		ORDER BY a.name
	`;
	return { apps };
};

export const actions: Actions = {
	create: async ({ request }) => {
		const form = await request.formData();
		const name = form.get('name')?.toString()?.trim();
		const slug = form.get('slug')?.toString()?.trim()?.toLowerCase();
		const url = form.get('url')?.toString()?.trim() || null;

		if (!name || !slug) return fail(400, { error: 'Name and slug are required' });
		if (!/^[a-z0-9-]+$/.test(slug)) return fail(400, { error: 'Slug must be lowercase letters, numbers, and hyphens' });

		const existing = await sql`SELECT id FROM apps WHERE slug = ${slug}`;
		if (existing.length > 0) return fail(400, { error: 'Slug already exists' });

		await sql`INSERT INTO apps (name, slug, url) VALUES (${name}, ${slug}, ${url})`;
		return { created: true };
	},

	delete: async ({ request }) => {
		const form = await request.formData();
		const appId = form.get('app_id')?.toString();
		if (!appId) return fail(400, { error: 'Missing app ID' });

		await sql`DELETE FROM apps WHERE id = ${appId}`;
		return { deleted: true };
	}
};

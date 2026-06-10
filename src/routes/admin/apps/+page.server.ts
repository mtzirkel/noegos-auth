import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { sql } from '$lib/server/db.js';

export const load: PageServerLoad = async () => {
	const apps = await sql`
		SELECT a.*, count(aa.id)::int as user_count
		FROM apps a
		LEFT JOIN app_access aa ON aa.app_id = a.id
		GROUP BY a.id
		ORDER BY a.name
	`;
	return { apps };
};

function parseRoles(raw: string): string[] | null {
	const roles = raw.split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
	if (roles.length === 0) return null;
	if (!roles.includes('user')) return null;
	return roles;
}

export const actions: Actions = {
	create: async ({ request }) => {
		const form = await request.formData();
		const name = form.get('name')?.toString()?.trim();
		const slug = form.get('slug')?.toString()?.trim()?.toLowerCase();
		const url = form.get('url')?.toString()?.trim() || null;
		const rolesRaw = form.get('roles')?.toString()?.trim() || 'user';
		const roles = parseRoles(rolesRaw);

		if (!name || !slug) return fail(400, { error: 'Name and slug are required' });
		if (!/^[a-z0-9-]+$/.test(slug)) return fail(400, { error: 'Slug must be lowercase letters, numbers, and hyphens' });
		if (!roles) return fail(400, { error: 'Roles must be a comma-separated list that includes "user"' });

		const existing = await sql`SELECT id FROM apps WHERE slug = ${slug}`;
		if (existing.length > 0) return fail(400, { error: 'Slug already exists' });

		await sql`INSERT INTO apps (name, slug, url, roles) VALUES (${name}, ${slug}, ${url}, ${sql.array(roles)})`;
		return { created: true };
	},

	update_roles: async ({ request }) => {
		const form = await request.formData();
		const appId = form.get('app_id')?.toString();
		const rolesRaw = form.get('roles')?.toString()?.trim() || '';
		const roles = parseRoles(rolesRaw);

		if (!appId) return fail(400, { error: 'Missing app ID' });
		if (!roles) return fail(400, { error: 'Roles must be a comma-separated list that includes "user"' });

		await sql`UPDATE apps SET roles = ${sql.array(roles)} WHERE id = ${appId}`;
		return { roles_updated: true };
	},

	delete: async ({ request }) => {
		const form = await request.formData();
		const appId = form.get('app_id')?.toString();
		if (!appId) return fail(400, { error: 'Missing app ID' });

		await sql`DELETE FROM apps WHERE id = ${appId}`;
		return { deleted: true };
	}
};

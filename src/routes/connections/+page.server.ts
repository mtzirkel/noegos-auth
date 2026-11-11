import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getStore } from '$lib/server/oauth.js';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(302, `/login?return_to=${encodeURIComponent(url.pathname)}`);
	return { grants: await getStore().listGrants(locals.user.id) };
};

export const actions: Actions = {
	revoke: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { error: 'Sign in first' });
		const familyId = (await request.formData()).get('family_id')?.toString();
		if (!familyId) return fail(400, { error: 'Missing grant' });
		const mine = (await getStore().listGrants(locals.user.id)).some((g) => g.family_id === familyId);
		if (!mine) return fail(404, { error: 'Not found' });
		await getStore().revokeFamily(familyId);
		return { revoked: true };
	}
};

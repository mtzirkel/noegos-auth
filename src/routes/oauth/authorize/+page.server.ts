import type { Actions, PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { AUTH_URL } from '$env/static/private';
import {
	getStore,
	validateAuthorize,
	readAuthorizeParams,
	buildRedirect,
	issueCode,
	OAuthError,
	type AuthorizeCheck
} from '$lib/server/oauth.js';

function bounceError(check: Extract<AuthorizeCheck, { ok: false; fatal: false }>): never {
	redirect(
		302,
		buildRedirect(check.redirect_uri, {
			error: check.error.code,
			error_description: check.error.description,
			state: check.state,
			iss: AUTH_URL
		})
	);
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const check = await validateAuthorize(getStore(), readAuthorizeParams(url.searchParams));
	if (!check.ok && check.fatal) error(400, check.message);
	if (!check.ok) bounceError(check);

	if (!locals.user) {
		redirect(302, `/login?return_to=${encodeURIComponent(url.pathname + url.search)}`);
	}

	const v = check.value;
	const role = await getStore().getAppRole(locals.user.id, v.app.id);
	return {
		clientName: v.client.client_name,
		redirectHost: new URL(v.redirect_uri).host,
		appName: v.app.name,
		appSlug: v.app.slug,
		scopes: v.scope.split(' '),
		hasAccess: !!role,
		username: locals.user.username,
		params: Object.fromEntries(url.searchParams)
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		const check = await validateAuthorize(getStore(), readAuthorizeParams(form));
		if (!check.ok && check.fatal) error(400, check.message);
		if (!check.ok) bounceError(check);
		const v = check.value;

		if (!locals.user) error(401, 'Sign in first');

		if (form.get('decision') !== 'approve') {
			redirect(302, buildRedirect(v.redirect_uri, { error: 'access_denied', state: v.state, iss: AUTH_URL }));
		}

		let code: string;
		try {
			code = await issueCode(getStore(), v, locals.user.id);
		} catch (e) {
			if (e instanceof OAuthError) {
				redirect(302, buildRedirect(v.redirect_uri, { error: e.code, error_description: e.description, state: v.state, iss: AUTH_URL }));
			}
			throw e;
		}
		redirect(302, buildRedirect(v.redirect_uri, { code, state: v.state, iss: AUTH_URL }));
	}
};

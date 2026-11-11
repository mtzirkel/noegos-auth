import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter(),
		// The built-in origin check 403s any form POST without a same-origin
		// Origin header, which would break server-to-server OAuth token requests
		// (they send no Origin). We disable it here and enforce the same check in
		// src/hooks.server.ts (csrfGuard) with an allow-list for /oauth/token and
		// /oauth/revoke, which carry no cookies and are protected by PKCE instead.
		csrf: { trustedOrigins: ['*'] }
	}
};

export default config;

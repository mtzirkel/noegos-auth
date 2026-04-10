import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	test: {
		environment: 'node',
		globals: true,
		// Each test file gets a fresh module registry so mocks don't bleed between files
		isolate: true
	},
	resolve: {
		alias: {
			// SvelteKit path aliases — vitest runs outside the SvelteKit build pipeline
			// so we map them manually to the actual source directories
			$lib: path.resolve('./src/lib'),
			// $env/static/private and $env/dynamic/private are SvelteKit virtual modules;
			// we stub them with a fixture file so tests can control env values
			'$env/static/private': path.resolve('./tests/__fixtures__/env-static.ts'),
			'$env/dynamic/private': path.resolve('./tests/__fixtures__/env-dynamic.ts')
		}
	}
});

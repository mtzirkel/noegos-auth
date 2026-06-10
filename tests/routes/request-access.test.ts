/**
 * Tests for /request-access — the public form where randos request access
 * to a specific app.
 *
 * Strategy mirrors admin-users.test.ts: mock the db module, feed canned
 * results in queue order, then call the action handler directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlCalls: Array<{ values: unknown[] }> = [];
let sqlResults: unknown[][] = [];

vi.mock('$lib/server/db.js', () => {
	const mockSql = Object.assign(
		vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
			sqlCalls.push({ values });
			return Promise.resolve(sqlResults.shift() ?? []);
		}),
		{ json: (v: unknown) => v }
	);
	return { sql: mockSql };
});

import { actions, load } from '../../src/routes/request-access/+page.server.js';

const APP_ID = 'aaaa1111-aaaa-1111-aaaa-111111111111';
const OTHER_APP_ID = 'bbbb2222-bbbb-2222-bbbb-222222222222';

function makeRequest(body: Record<string, string>): Request {
	const form = new FormData();
	for (const [k, v] of Object.entries(body)) form.append(k, v);
	return new Request('http://localhost/request-access', { method: 'POST', body: form });
}

beforeEach(() => {
	sqlCalls.length = 0;
	sqlResults = [];
});

describe('request-access load', () => {
	it('preselects the app whose slug matches ?app=', async () => {
		// Requirement: when a user explicitly says which app via the URL,
		// preselect it so the dropdown is correct on first paint.
		sqlResults = [[
			{ id: APP_ID, slug: 'lobster', name: 'Lobster', url: 'https://lobster.example' },
			{ id: OTHER_APP_ID, slug: 'journal', name: 'Journal', url: 'https://journal.example' }
		]];

		const result = await load({
			url: new URL('http://localhost/request-access?app=journal')
		} as never);

		expect(result.preselectedAppId).toBe(OTHER_APP_ID);
		expect(result.apps).toHaveLength(2);
	});

	it('preselects the app whose URL hostname matches ?return_to=', async () => {
		// Requirement: a rando bounced from app → login → request-access carries
		// return_to. We map that URL back to the registered app.
		sqlResults = [[
			{ id: APP_ID, slug: 'lobster', name: 'Lobster', url: 'https://lobster.example' },
			{ id: OTHER_APP_ID, slug: 'journal', name: 'Journal', url: 'https://journal.example' }
		]];

		const result = await load({
			url: new URL('http://localhost/request-access?return_to=https://journal.example/dashboard')
		} as never);

		expect(result.preselectedAppId).toBe(OTHER_APP_ID);
	});

	it('returns null preselection when no app matches', async () => {
		sqlResults = [[{ id: APP_ID, slug: 'lobster', name: 'Lobster', url: 'https://lobster.example' }]];

		const result = await load({
			url: new URL('http://localhost/request-access')
		} as never);

		expect(result.preselectedAppId).toBeNull();
	});
});

describe('request-access default action', () => {
	it('requires the requester to pick an app', async () => {
		// Requirement: every request must name an app so the admin knows what
		// to grant. Form action fails with a clear error if missing.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.default!({
			request: makeRequest({ username: 'jane' })
		} as never);

		expect(result.status).toBe(400);
		expect(result.data.error).toMatch(/pick which app/i);
	});

	it('rejects a non-existent requested_app_id', async () => {
		// Requirement: the FK must be a real app — defend against tampered form data.
		sqlResults = [[]]; // validApp lookup returns empty

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.default!({
			request: makeRequest({ username: 'jane', requested_app_id: 'not-a-real-id' })
		} as never);

		expect(result.status).toBe(400);
		expect(result.data.error).toMatch(/does not exist/i);
	});

	it('inserts the requested_app_id into access_requests on success', async () => {
		// Requirement: the chosen app id must end up on the row so the admin
		// can see it on the requests page and pre-check it at approve time.
		sqlResults = [
			[{ id: APP_ID }], // validApp lookup
			[], // username taken check
			[], // pending duplicate check
			[] // INSERT
		];

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.default!({
			request: makeRequest({ username: 'jane', requested_app_id: APP_ID })
		} as never);

		expect(result.success).toBe(true);
		// The last SQL call is the INSERT; its values should include APP_ID.
		const insertCall = sqlCalls.at(-1)!;
		expect(insertCall.values).toContain(APP_ID);
		expect(insertCall.values).toContain('jane');
	});

	it('echoes the chosen app id back on validation failure so the dropdown stays selected', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.default!({
			request: makeRequest({ username: 'X', requested_app_id: APP_ID })
		} as never);

		expect(result.status).toBe(400);
		expect(result.data.requestedAppId).toBe(APP_ID);
	});
});

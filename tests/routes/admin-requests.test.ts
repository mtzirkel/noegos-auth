/**
 * Tests for /admin/requests — approving and denying access requests.
 *
 * Strategy mirrors admin-users.test.ts: mock the db module, feed canned
 * results in queue order, then call the action handler directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlCalls: Array<{ strings: TemplateStringsArray; values: unknown[] }> = [];
let sqlResults: unknown[][] = [];

vi.mock('$lib/server/db.js', () => {
	const mockSql = Object.assign(
		vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
			sqlCalls.push({ strings, values });
			return Promise.resolve(sqlResults.shift() ?? []);
		}),
		{
			json: (v: unknown) => v,
			array: (v: unknown[]) => v
		}
	);
	return { sql: mockSql };
});

vi.mock('$lib/server/auth.js', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/auth.js')>('$lib/server/auth.js');
	return {
		...actual,
		generateTotpSecret: () => ({ secret: 'TESTSECRET', uri: 'otpauth://test' })
	};
});

vi.mock('$env/static/private', () => ({ AUTH_URL: 'https://auth.example.com' }));

import { actions } from '../../src/routes/admin/requests/+page.server.js';

const REQUEST_ID = 'aaaa1111-aaaa-1111-aaaa-111111111111';
const APP_ID     = 'bbbb2222-bbbb-2222-bbbb-222222222222';
const USER_ID    = 'cccc3333-cccc-3333-cccc-333333333333';

function makeRequest(body: Record<string, string | string[]>): Request {
	const form = new FormData();
	for (const [k, v] of Object.entries(body)) {
		if (Array.isArray(v)) {
			for (const item of v) form.append(k, item);
		} else {
			form.append(k, v);
		}
	}
	return new Request('http://localhost/admin/requests', { method: 'POST', body: form });
}

beforeEach(() => {
	sqlCalls.length = 0;
	sqlResults = [];
});

describe('approve action', () => {
	it('approves a request with no app access', async () => {
		sqlResults = [
			[{ id: REQUEST_ID, username: 'alice', display_name: null }], // fetch request
			[{ id: USER_ID }]                                             // INSERT user
		];

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.approve!({
			request: makeRequest({ request_id: REQUEST_ID })
		} as never);

		expect(result.approved).toBe(true);
		expect(result.username).toBe('alice');
		expect(result.setupUrl).toMatch(/\/setup\//);
	});

	it('approves with app access when role is valid', async () => {
		sqlResults = [
			[{ id: REQUEST_ID, username: 'alice', display_name: null }], // fetch request
			[{ id: USER_ID }],                                            // INSERT user
			[]                                                            // INSERT app_access
		];

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.approve!({
			request: makeRequest({
				request_id: REQUEST_ID,
				app_ids: [APP_ID],
				roles: ['user']
			})
		} as never);

		expect(result.approved).toBe(true);
	});

	it('rejects an invalid role for an app', async () => {
		// Requirement: free-text role entry (e.g. "wizard") must be rejected.
		// Validation is now in-memory against VALID_ROLES — only 1 DB query (fetch request).
		sqlResults = [
			[{ id: REQUEST_ID, username: 'alice', display_name: null }] // fetch request
		];

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.approve!({
			request: makeRequest({
				request_id: REQUEST_ID,
				app_ids: [APP_ID],
				roles: ['wizard']
			})
		} as never);

		expect(result.status).toBe(400);
		expect(result.data.error).toMatch(/wizard/);
		// Must not have created the user — only fetch-request query ran
		expect(sqlCalls.length).toBe(1);
	});

	it('falls back to "user" when no role submitted', async () => {
		sqlResults = [
			[{ id: REQUEST_ID, username: 'alice', display_name: null }],
			[{ id: USER_ID }],
			[]
		];

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.approve!({
			request: makeRequest({
				request_id: REQUEST_ID,
				app_ids: [APP_ID],
				roles: ['']   // empty role string → falls back to 'user'
			})
		} as never);

		expect(result.approved).toBe(true);
	});

	it('returns 404 for a non-existent request', async () => {
		sqlResults = [[]]; // no pending request found

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.approve!({
			request: makeRequest({ request_id: 'nonexistent' })
		} as never);

		expect(result.status).toBe(404);
	});

	it('returns 400 when request_id is missing', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.approve!({
			request: makeRequest({})
		} as never);

		expect(result.status).toBe(400);
	});
});

describe('deny action', () => {
	it('denies a pending request', async () => {
		sqlResults = [[]]; // UPDATE

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.deny!({
			request: makeRequest({ request_id: REQUEST_ID })
		} as never);

		expect(result.denied).toBe(true);
		expect(sqlCalls.length).toBe(1);
	});

	it('returns 400 when request_id is missing', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.deny!({
			request: makeRequest({})
		} as never);

		expect(result.status).toBe(400);
	});
});

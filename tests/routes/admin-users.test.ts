/**
 * Tests for /admin/users actions.
 *
 * Strategy: mock the db module so we can capture queries and return canned
 * results, then invoke each action handler with a synthetic FormData and
 * locals object. We don't spin up SvelteKit — we call the action functions
 * directly the same way the request handler does.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture all SQL calls so we can assert on them.
const sqlCalls: Array<{ strings: TemplateStringsArray; values: unknown[] }> = [];
// queue of results — each tagged-template call shifts one off
let sqlResults: unknown[][] = [];

vi.mock('$lib/server/db.js', () => {
	const mockSql = Object.assign(
		vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
			sqlCalls.push({ strings, values });
			const next = sqlResults.shift() ?? [];
			return Promise.resolve(next);
		}),
		{ json: (v: unknown) => v }
	);
	return { sql: mockSql };
});

// auth module also touches sql via initKeys/createToken — none of those run in
// these tests, but we still need a stable export shape.
vi.mock('$lib/server/auth.js', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/auth.js')>('$lib/server/auth.js');
	return {
		...actual,
		generateTotpSecret: () => ({ secret: 'TESTSECRET', uri: 'otpauth://test' }),
		revokeAllUserSessions: vi.fn().mockResolvedValue(undefined)
	};
});

import { actions } from '../../src/routes/admin/users/+page.server.js';

function makeRequest(body: Record<string, string | string[]>): Request {
	const form = new FormData();
	for (const [k, v] of Object.entries(body)) {
		if (Array.isArray(v)) {
			for (const item of v) form.append(k, item);
		} else {
			form.append(k, v);
		}
	}
	return new Request('http://localhost/admin/users', { method: 'POST', body: form });
}

const SELF_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ID = '22222222-2222-2222-2222-222222222222';

const selfLocals = { user: { id: SELF_ID, username: 'me', isAdmin: true, apps: [] } };

beforeEach(() => {
	sqlCalls.length = 0;
	sqlResults = [];
});

describe('add_user action', () => {
	it('creates a user with no app access and returns a setup link', async () => {
		// Requirement: admins can add users directly without a request flow,
		// receiving a setup link to share with the new user.
		sqlResults = [
			[], // existing-user check → none
			[{ id: OTHER_ID }] // INSERT users RETURNING id
		];

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.add_user!({
			request: makeRequest({ username: 'jane' }),
			locals: selfLocals
		} as never);

		expect(result.added).toBe(true);
		expect(result.username).toBe('jane');
		expect(result.setupUrl).toMatch(/\/setup\//);
		expect(result.totp_verified).toBe(false);
		// Two SQL calls: existence check + insert
		expect(sqlCalls.length).toBe(2);
	});

	it('grants app access when app_ids are provided', async () => {
		sqlResults = [
			[],
			[{ id: OTHER_ID }],
			[], // first app insert
			[] // second app insert
		];

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.add_user!({
			request: makeRequest({
				username: 'jane',
				app_ids: ['app-1', 'app-2'],
				roles: ['user', 'admin']
			}),
			locals: selfLocals
		} as never);

		expect(result.added).toBe(true);
		// existence + insert + 2 app_access inserts
		expect(sqlCalls.length).toBe(4);
	});

	it('rejects an empty username', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.add_user!({
			request: makeRequest({ username: '' }),
			locals: selfLocals
		} as never);

		expect(result.status).toBe(400);
		expect(result.data.error).toMatch(/required/i);
	});

	it('rejects usernames with invalid characters', async () => {
		// Requirement: usernames are used as TOTP labels and in URLs; keep them tame.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.add_user!({
			request: makeRequest({ username: 'Jane Smith!' }),
			locals: selfLocals
		} as never);

		expect(result.status).toBe(400);
		expect(result.data.error).toMatch(/lowercase|characters/i);
	});

	it('rejects a duplicate username', async () => {
		sqlResults = [[{ id: 'existing' }]];

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.add_user!({
			request: makeRequest({ username: 'jane' }),
			locals: selfLocals
		} as never);

		expect(result.status).toBe(400);
		expect(result.data.error).toMatch(/already exists/);
	});
});

describe('self-protection on destructive actions', () => {
	it('toggle_admin refuses to act on the current user', async () => {
		// Requirement: an admin must not be able to demote themselves and lose
		// access to the admin panel.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.toggle_admin!({
			request: makeRequest({ user_id: SELF_ID }),
			locals: selfLocals
		} as never);

		expect(result.status).toBe(400);
		expect(result.data.error).toMatch(/own admin status/);
		// Must not have issued the UPDATE
		expect(sqlCalls.length).toBe(0);
	});

	it('toggle_admin acts on other users normally', async () => {
		await actions.toggle_admin!({
			request: makeRequest({ user_id: OTHER_ID }),
			locals: selfLocals
		} as never);

		expect(sqlCalls.length).toBe(1);
	});

	it('delete_user refuses to delete the current user', async () => {
		// Requirement: prevent self-deletion lockout.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await actions.delete_user!({
			request: makeRequest({ user_id: SELF_ID }),
			locals: selfLocals
		} as never);

		expect(result.status).toBe(400);
		expect(result.data.error).toMatch(/own account/);
		expect(sqlCalls.length).toBe(0);
	});

	it('delete_user deletes other users normally', async () => {
		await actions.delete_user!({
			request: makeRequest({ user_id: OTHER_ID }),
			locals: selfLocals
		} as never);

		expect(sqlCalls.length).toBe(1);
	});
});

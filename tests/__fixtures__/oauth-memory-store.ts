import type {
	OAuthStore,
	OAuthClient,
	AppRecord,
	CodeRecord,
	RefreshRecord,
	GrantSummary
} from '../../src/lib/server/oauth.js';

/** In-memory OAuthStore mirroring pgStore semantics (incl. consume-returns-previous-state). */
export function memoryStore(seed: {
	apps?: AppRecord[];
	users?: { id: string; username: string }[];
	access?: { user_id: string; app_id: string; role: string }[];
} = {}) {
	const clients = new Map<string, OAuthClient>();
	const codes = new Map<string, CodeRecord>();
	const refresh = new Map<string, RefreshRecord & { created_at: Date }>();
	const apps = [...(seed.apps ?? [])];
	const users = [...(seed.users ?? [])];
	const access = [...(seed.access ?? [])];

	const store: OAuthStore & {
		_codes: typeof codes;
		_refresh: typeof refresh;
		_access: typeof access;
	} = {
		_codes: codes,
		_refresh: refresh,
		_access: access,
		async createClient(c) {
			clients.set(c.client_id, { ...c });
		},
		async getClient(id) {
			return clients.get(id) ?? null;
		},
		async touchClient() {},
		async listAppsWithUrl() {
			return apps.filter((a) => a.url);
		},
		async getAppRole(userId, appId) {
			return access.find((a) => a.user_id === userId && a.app_id === appId)?.role ?? null;
		},
		async getUser(id) {
			return users.find((u) => u.id === id) ?? null;
		},
		async saveCode(c) {
			codes.set(c.code_hash, { ...c });
		},
		async consumeCode(hash) {
			const c = codes.get(hash);
			if (!c) return null;
			const before = { ...c };
			c.used_at = c.used_at ?? new Date();
			return before;
		},
		async saveRefresh(r) {
			refresh.set(r.token_hash, { ...r, created_at: new Date() });
		},
		async consumeRefresh(hash) {
			const r = refresh.get(hash);
			if (!r) return null;
			const before = { ...r };
			r.used_at = r.used_at ?? new Date();
			return before;
		},
		async getRefresh(hash) {
			return refresh.get(hash) ?? null;
		},
		async revokeFamily(fam) {
			for (const r of refresh.values()) if (r.family_id === fam && !r.revoked_at) r.revoked_at = new Date();
		},
		async revokeUserApp(userId, appId) {
			for (const r of refresh.values()) {
				if (r.user_id === userId && (!appId || r.app_id === appId) && !r.revoked_at) r.revoked_at = new Date();
			}
		},
		async listGrants(userId) {
			const fams = new Map<string, GrantSummary & { live: boolean }>();
			for (const r of refresh.values()) {
				if (r.user_id !== userId) continue;
				const live = !r.revoked_at && !r.used_at && r.expires_at > new Date();
				const g = fams.get(r.family_id) ?? {
					family_id: r.family_id,
					client_id: r.client_id,
					client_name: clients.get(r.client_id)?.client_name ?? '?',
					app_name: apps.find((a) => a.id === r.app_id)?.name ?? '?',
					scope: r.scope,
					created_at: r.created_at,
					last_used_at: null,
					live: false
				};
				g.live = g.live || live;
				fams.set(r.family_id, g);
			}
			return [...fams.values()].filter((g) => g.live).map(({ live: _l, ...g }) => g);
		}
	};
	return store;
}

# noegos-auth — Handoff for Deploy

Changes are committed to neither git nor anywhere else yet — all live in the working tree on `master`. Ready to commit, push to `origin/master` (github.com/mtzirkel/noegos-auth), and deploy.

## What changed

Three user-facing improvements to the admin/auth flow:

### 1. Admin can add users directly (no request needed)

`/admin/users` now has an **+ Add User** button that opens an inline form: username, optional display name, optional admin toggle, optional checkboxes for which apps to grant + role per app. On submit it creates the user, grants app access, and returns a 7-day TOTP setup link to share — same shape as approving a request.

- Server: `src/routes/admin/users/+page.server.ts` — new `add_user` action with username validation (`/^[a-z0-9_-]+$/`), duplicate check, app-access grants.
- UI: `src/routes/admin/users/+page.svelte` — collapsible add-user card at the top.

### 2. Current admin is protected from self-lockout

Your own row on `/admin/users` is now:
- Marked with a `you` badge and a subtle primary border
- "Delete" and "Make/Remove admin" buttons are replaced with a disabled "Locked" pill
- "Get setup link" / "Reset TOTP link" stays available (you may still need to re-scan)

Server actions also reject self-targeting as defense in depth:
- `toggle_admin` returns 400 "You cannot change your own admin status" if `user_id === locals.user.id`
- `delete_user` returns 400 "You cannot delete your own account" same condition

### 3. Access requests now capture which app the rando wants

Previously a request was just username/message and the admin guessed which apps to grant. Now:

- **Schema:** added `access_requests.requested_app_id UUID REFERENCES apps(id) ON DELETE SET NULL`. Nullable so legacy rows survive. Migration is `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `src/lib/server/db.ts`, runs on first request via `hooks.server.ts`.
- **Request form** (`/request-access`): required "Which app?" dropdown. Pre-selects from `?app=<slug>` or by matching `?return_to=<url>` hostname against a registered app's URL.
- **Login → request-access link** now carries `?return_to=` so the bounced-from-app context survives the click.
- **Admin requests page** (`/admin/requests`): each pending request shows a "Requesting access to: [App]" badge, and that app's checkbox in the approve form is pre-checked and labeled "(requested)". Admin can still uncheck or add others.

## Files touched

```
modified:   src/lib/server/db.ts                            # new column
modified:   src/routes/admin/requests/+page.server.ts       # JOIN apps for requested app
modified:   src/routes/admin/requests/+page.svelte          # show + pre-check requested app
modified:   src/routes/admin/users/+page.server.ts          # add_user action + self-protection
modified:   src/routes/admin/users/+page.svelte             # add-user form + "you" badge + Locked pill
modified:   src/routes/login/+page.svelte                   # propagate return_to to request-access
modified:   src/routes/request-access/+page.server.ts       # requested_app_id field + preselect logic
modified:   src/routes/request-access/+page.svelte          # app dropdown
new:        tests/routes/admin-users.test.ts                # 9 tests
new:        tests/routes/request-access.test.ts             # 7 tests
```

## Verification

```
npm test       # 47/47 passing (16 new)
npm run check  # 0 errors (only 2 pre-existing a11y warnings, neither in files I touched)
```

## Deploy notes / things to watch

- **Migration runs on first request.** `migrate()` is called from `hooks.server.ts` on cold start. The `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` is additive and nullable, so it's safe on a populated `access_requests` table, but flagging it so it's not a surprise.
- **No env var changes.** Same `DATABASE_URL`, `AUTH_URL`, `COOKIE_DOMAIN`, `SESSION_DAYS`.
- **No new dependencies.** `package.json` untouched.
- **Existing pending requests** will display "No specific app requested" until/unless re-submitted — fine, they remain approvable normally.

## Suggested commit

Either one bundled commit or three logical ones:

```
admin: add direct add-user flow with TOTP setup link
admin: prevent self-demotion and self-delete on users page
auth: capture requested app on access requests, surface on approve
```

Single-commit version if your agent prefers that.

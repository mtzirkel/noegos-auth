<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	// form is a union of all action return types — cast to access gen_setup_link fields
	const setupResult = form as { setupUrl?: string; username?: string; totp_verified?: boolean } | null;
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="text-3xl font-bold">Users</h1>
	<a href="/admin" class="btn btn-ghost btn-sm">&larr; Back</a>
</div>

{#if setupResult?.setupUrl}
	<div class="alert alert-info mb-6">
		<div class="w-full">
			<p class="font-semibold mb-1">Setup link for {setupResult.username}{setupResult.totp_verified ? ' (TOTP already active — link will let them re-scan)' : ''}:</p>
			<div class="flex gap-2 items-center mt-1">
				<input
					type="text"
					readonly
					value={setupResult.setupUrl}
					class="input input-bordered input-sm flex-1 font-mono text-xs"
					onclick={(e) => (e.target as HTMLInputElement).select()}
				/>
				<button
					class="btn btn-sm btn-outline"
					onclick={() => navigator.clipboard.writeText(setupResult!.setupUrl!)}
				>Copy</button>
			</div>
		</div>
	</div>
{/if}

{#if data.users.length === 0}
	<p class="text-center text-base-content/50 py-8">No users yet.</p>
{:else}
	<div class="space-y-4">
		{#each data.users as user}
			<div class="card bg-base-100 shadow">
				<div class="card-body">
					<div class="flex items-center justify-between">
						<div>
							<h3 class="font-bold text-lg">
								{user.username}
								{#if user.is_admin}<span class="badge badge-primary badge-sm ml-1">admin</span>{/if}
							</h3>
							{#if user.display_name}
								<p class="text-sm text-base-content/60">{user.display_name}</p>
							{/if}
							<p class="text-xs text-base-content/40">
								TOTP: {user.totp_verified ? 'active' : 'pending setup'}
								{#if user.last_login}
									&middot; Last login: {new Date(user.last_login).toLocaleDateString()}
								{/if}
							</p>
						</div>
						<div class="flex gap-1 flex-wrap justify-end">
							<form method="POST" action="?/gen_setup_link" use:enhance>
								<input type="hidden" name="user_id" value={user.id} />
								<button class="btn btn-ghost btn-xs">
									{user.totp_verified ? 'Reset TOTP link' : 'Get setup link'}
								</button>
							</form>
							<form method="POST" action="?/toggle_admin" use:enhance>
								<input type="hidden" name="user_id" value={user.id} />
								<button class="btn btn-ghost btn-xs">
									{user.is_admin ? 'Remove admin' : 'Make admin'}
								</button>
							</form>
							<form method="POST" action="?/delete_user" use:enhance>
								<input type="hidden" name="user_id" value={user.id} />
								<button class="btn btn-ghost btn-xs text-error"
									onclick={(e) => { if (!confirm(`Delete ${user.username}?`)) e.preventDefault(); }}>
									Delete
								</button>
							</form>
						</div>
					</div>

					<!-- App access -->
					<div class="mt-3">
						<p class="text-sm font-semibold mb-1">App Access:</p>
						<div class="flex flex-wrap gap-2 mb-2">
							{#each user.app_access as access}
								<span class="badge badge-outline gap-1">
									{access.name} ({access.role})
									<form method="POST" action="?/revoke_app" use:enhance class="inline">
										<input type="hidden" name="user_id" value={user.id} />
										<input type="hidden" name="app_slug" value={access.slug} />
										<button class="text-error font-bold">&times;</button>
									</form>
								</span>
							{/each}
							{#if user.app_access.length === 0}
								<span class="text-sm text-base-content/40">No apps</span>
							{/if}
						</div>

						<!-- Grant new app access -->
						{#if data.apps.length > 0}
							<form method="POST" action="?/grant_app" use:enhance class="flex gap-2 items-end">
								<input type="hidden" name="user_id" value={user.id} />
								<select name="app_id" class="select select-bordered select-xs">
									{#each data.apps as app}
										<option value={app.id}>{app.name}</option>
									{/each}
								</select>
								<input type="text" name="role" value="user" class="input input-bordered input-xs w-20" />
								<button type="submit" class="btn btn-xs btn-outline">Grant</button>
							</form>
						{/if}
					</div>
				</div>
			</div>
		{/each}
	</div>
{/if}

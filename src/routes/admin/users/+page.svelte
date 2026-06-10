<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	// form is a union of all action return types — cast to access fields used in the UI
	const formResult = $derived(form as {
		setupUrl?: string;
		username?: string;
		totp_verified?: boolean;
		error?: string;
	} | null);

	let showAddUser = $state(false);
	let selectedAppIds = $state<string[]>([]);

	// Per-user-row: tracks which app is selected in the grant_app dropdown
	// so the role select can show that app's allowed roles.
	// Key: user.id, Value: app.id
	const grantAppSelection = $state<Record<string, string>>({});

	function grantAppRoles(userId: string): string[] {
		const appId = grantAppSelection[userId] ?? data.apps[0]?.id;
		return data.apps.find((a) => a.id === appId)?.roles ?? ['user'];
	}
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="text-3xl font-bold">Users</h1>
	<div class="flex gap-2">
		<button class="btn btn-primary btn-sm" onclick={() => (showAddUser = !showAddUser)}>
			{showAddUser ? 'Cancel' : '+ Add User'}
		</button>
		<a href="/admin" class="btn btn-ghost btn-sm">&larr; Back</a>
	</div>
</div>

{#if formResult?.error}
	<div class="alert alert-error mb-6">
		<span>{formResult.error}</span>
	</div>
{/if}

{#if formResult?.setupUrl}
	<div class="alert alert-info mb-6">
		<div class="w-full">
			<p class="font-semibold mb-1">Setup link for {formResult.username}{formResult.totp_verified ? ' (TOTP already active — link will let them re-scan)' : ''}:</p>
			<div class="flex gap-2 items-center mt-1">
				<input
					type="text"
					readonly
					value={formResult.setupUrl}
					class="input input-bordered input-sm flex-1 font-mono text-xs"
					onclick={(e) => (e.target as HTMLInputElement).select()}
				/>
				<button
					class="btn btn-sm btn-outline"
					onclick={() => navigator.clipboard.writeText(formResult!.setupUrl!)}
				>Copy</button>
			</div>
		</div>
	</div>
{/if}

{#if showAddUser}
	<div class="card bg-base-100 shadow mb-6">
		<div class="card-body">
			<h2 class="card-title">Add User</h2>
			<p class="text-sm text-base-content/60 mb-2">Create a user directly without requiring them to submit a request. You'll get a setup link to share.</p>
			<form
				method="POST"
				action="?/add_user"
				use:enhance={() => async ({ update }) => {
					await update();
					showAddUser = false;
					selectedAppIds = [];
				}}
				class="space-y-3"
			>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
					<label class="form-control">
						<span class="label-text">Username</span>
						<input name="username" required class="input input-bordered" placeholder="jane" />
					</label>
					<label class="form-control">
						<span class="label-text">Display name (optional)</span>
						<input name="display_name" class="input input-bordered" placeholder="Jane Smith" />
					</label>
				</div>

				<label class="label cursor-pointer justify-start gap-2 w-fit">
					<input type="checkbox" name="is_admin" class="checkbox checkbox-sm" />
					<span class="label-text">Admin</span>
				</label>

				{#if data.apps.length > 0}
					<div>
						<p class="font-semibold mb-1">App access</p>
						<div class="space-y-2">
							{#each data.apps as app}
								{@const checked = selectedAppIds.includes(app.id)}
								<div class="flex items-center gap-2">
									<input
										type="checkbox"
										class="checkbox checkbox-sm"
										checked={checked}
										onchange={(e) => {
											if ((e.target as HTMLInputElement).checked) {
												selectedAppIds = [...selectedAppIds, app.id];
											} else {
												selectedAppIds = selectedAppIds.filter((id) => id !== app.id);
											}
										}}
									/>
									<span class="w-40">{app.name}</span>
									{#if checked}
												<input type="hidden" name="app_ids" value={app.id} />
												<select name="roles" class="select select-bordered select-xs w-28">
													{#each app.roles as role}
														<option value={role}>{role}</option>
													{/each}
												</select>
											{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<button type="submit" class="btn btn-primary btn-sm">Create user</button>
			</form>
		</div>
	</div>
{/if}

{#if data.users.length === 0}
	<p class="text-center text-base-content/50 py-8">No users yet.</p>
{:else}
	<div class="space-y-4">
		{#each data.users as user}
			{@const isSelf = user.id === data.currentUserId}
			<div class="card bg-base-100 shadow {isSelf ? 'border border-primary/30' : ''}">
				<div class="card-body">
					<div class="flex items-center justify-between">
						<div>
							<h3 class="font-bold text-lg">
								{user.username}
								{#if isSelf}<span class="badge badge-secondary badge-sm ml-1">you</span>{/if}
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
							{#if isSelf}
								<span class="btn btn-ghost btn-xs btn-disabled" title="You cannot change your own admin status or delete yourself">
									Locked
								</span>
							{:else}
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
							{/if}
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
									<select
										name="app_id"
										class="select select-bordered select-xs"
										onchange={(e) => { grantAppSelection[user.id] = (e.target as HTMLSelectElement).value; }}
									>
										{#each data.apps as app}
											<option value={app.id}>{app.name}</option>
										{/each}
									</select>
									<select name="role" class="select select-bordered select-xs w-28">
										{#each grantAppRoles(user.id) as role}
											<option value={role}>{role}</option>
										{/each}
									</select>
									<button type="submit" class="btn btn-xs btn-outline">Grant</button>
								</form>
							{/if}
					</div>
				</div>
			</div>
		{/each}
	</div>
{/if}

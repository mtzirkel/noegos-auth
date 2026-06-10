<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="text-3xl font-bold">Apps</h1>
	<a href="/admin" class="btn btn-ghost btn-sm">&larr; Back</a>
</div>

{#if form?.error}
	<div class="alert alert-error mb-4"><span>{form.error}</span></div>
{/if}
{#if form?.created}
	<div class="alert alert-success mb-4"><span>App created.</span></div>
{/if}
{#if form?.roles_updated}
	<div class="alert alert-success mb-4"><span>Roles updated.</span></div>
{/if}

<div class="card bg-base-100 shadow mb-6">
	<div class="card-body">
		<h2 class="card-title text-lg">Register New App</h2>
		<form method="POST" action="?/create" use:enhance class="space-y-3">
			<div class="flex gap-2">
				<input type="text" name="name" placeholder="App Name" class="input input-bordered flex-1" required />
				<input type="text" name="slug" placeholder="slug" class="input input-bordered w-32" required />
			</div>
			<input type="text" name="url" placeholder="https://app.noegosunderwater.com (optional)" class="input input-bordered w-full" />
			<div class="form-control">
				<label class="label pb-1" for="new-app-roles">
					<span class="label-text">Roles <span class="text-base-content/50 font-normal">(comma-separated, must include "user")</span></span>
				</label>
				<input id="new-app-roles" type="text" name="roles" value="user" class="input input-bordered w-full" placeholder="user, admin, moderator" />
			</div>
			<button type="submit" class="btn btn-primary btn-sm">Add App</button>
		</form>
	</div>
</div>

{#if data.apps.length === 0}
	<p class="text-center text-base-content/50 py-8">No apps registered yet.</p>
{:else}
	<div class="space-y-3">
		{#each data.apps as app}
			<div class="card bg-base-100 shadow">
				<div class="card-body py-4">
					<div class="flex items-center justify-between">
						<div>
							<h3 class="font-bold">{app.name}</h3>
							<p class="text-sm text-base-content/60">
								<code>{app.slug}</code>
								{#if app.url} &middot; <a href={app.url} class="link text-xs">{app.url}</a>{/if}
								&middot; {app.user_count} users
							</p>
							<div class="flex items-center gap-2 mt-2">
								<span class="text-xs text-base-content/50">Roles:</span>
								{#each app.roles as role}
									<span class="badge badge-sm badge-outline">{role}</span>
								{/each}
							</div>
						</div>
						<form method="POST" action="?/delete" use:enhance>
							<input type="hidden" name="app_id" value={app.id} />
							<button type="submit" class="btn btn-ghost btn-xs text-error"
								onclick={(e) => { if (!confirm('Delete this app?')) e.preventDefault(); }}>
								Delete
							</button>
						</form>
					</div>
					<!-- Edit roles inline -->
					<form method="POST" action="?/update_roles" use:enhance class="flex gap-2 items-end mt-2">
						<input type="hidden" name="app_id" value={app.id} />
						<div class="form-control flex-1">
							<label class="label pb-0" for="roles-{app.id}">
								<span class="label-text text-xs">Edit roles</span>
							</label>
							<input
								id="roles-{app.id}"
								type="text"
								name="roles"
								value={app.roles.join(', ')}
								class="input input-bordered input-xs"
								placeholder="user, admin"
							/>
						</div>
						<button type="submit" class="btn btn-xs btn-outline">Save</button>
					</form>
				</div>
			</div>
		{/each}
	</div>
{/if}

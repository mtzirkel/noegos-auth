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
{#if form?.updated}
	<div class="alert alert-success mb-4"><span>App updated.</span></div>
{/if}
{#if form?.created}
	<div class="alert alert-success mb-4"><span>App created.</span></div>
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
				<div class="card-body py-4 flex-row items-center justify-between">
					<div>
						<h3 class="font-bold">{app.name}</h3>
						<p class="text-sm text-base-content/60">
							<code>{app.slug}</code>
							{#if app.url} &middot; <a href={app.url} class="link text-xs">{app.url}</a>{/if}
							&middot; {app.user_count} users
						</p>
					</div>
					<details class="dropdown dropdown-end">
						<summary class="btn btn-ghost btn-xs">Edit</summary>
						<form method="POST" action="?/update" use:enhance
							class="dropdown-content z-10 card bg-base-100 shadow p-3 w-80 space-y-2">
							<input type="hidden" name="app_id" value={app.id} />
							<input type="text" name="name" value={app.name} class="input input-bordered input-sm w-full" required />
							<input type="text" name="url" value={app.url ?? ''} placeholder="https://app.noegosunderwater.com"
								class="input input-bordered input-sm w-full" />
							<p class="text-xs opacity-60">The URL is also the OAuth resource: agents can request tokens for anything under it (e.g. /mcp).</p>
							<button type="submit" class="btn btn-primary btn-xs">Save</button>
						</form>
					</details>
					<form method="POST" action="?/delete" use:enhance>
						<input type="hidden" name="app_id" value={app.id} />
						<button type="submit" class="btn btn-ghost btn-xs text-error"
							onclick={(e) => { if (!confirm('Delete this app?')) e.preventDefault(); }}>
							Delete
						</button>
					</form>
				</div>
			</div>
		{/each}
	</div>
{/if}

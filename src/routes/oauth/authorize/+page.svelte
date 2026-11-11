<script lang="ts">
	let { data } = $props();
	const scopeText: Record<string, string> = {
		read: 'Read your data',
		write: 'Create and edit your data'
	};
</script>

<div class="card bg-base-100 shadow-xl">
	<div class="card-body">
		{#if !data.hasAccess}
			<h2 class="card-title text-xl">No access to {data.appName}</h2>
			<p class="text-sm opacity-80">
				<strong>{data.clientName}</strong> wants to connect to {data.appName}, but your account
				(<code>{data.username}</code>) doesn't have access to it yet.
			</p>
			<a class="btn btn-primary mt-4" href="/request-access?app={data.appSlug}">Request access</a>
			<form method="POST" class="mt-2">
				{#each Object.entries(data.params) as [k, v]}<input type="hidden" name={k} value={v} />{/each}
				<button class="btn btn-ghost w-full" name="decision" value="deny">Cancel</button>
			</form>
		{:else}
			<h2 class="card-title text-xl">Connect {data.clientName}?</h2>
			<p class="text-sm opacity-80">
				<strong>{data.clientName}</strong> wants to access <strong>{data.appName}</strong> as
				<code>{data.username}</code>.
			</p>
			<ul class="my-3 space-y-1">
				{#each data.scopes as s}
					<li class="flex items-center gap-2"><span class="badge badge-outline">{s}</span>{scopeText[s] ?? s}</li>
				{/each}
			</ul>
			<p class="text-xs opacity-60">
				You'll be sent back to <code>{data.redirectHost}</code>. You can disconnect it any time from
				<a class="link" href="/connections">Connected apps</a>.
			</p>
			<form method="POST" class="mt-4 flex gap-2">
				{#each Object.entries(data.params) as [k, v]}<input type="hidden" name={k} value={v} />{/each}
				<button class="btn btn-ghost flex-1" name="decision" value="deny">Deny</button>
				<button class="btn btn-primary flex-1" name="decision" value="approve">Allow</button>
			</form>
		{/if}
	</div>
</div>

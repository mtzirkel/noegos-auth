<script lang="ts">
	let { data } = $props();
</script>

<div class="text-center py-12">
	{#if data.user}
		<h1 class="text-3xl font-bold mb-4">Welcome, {data.user.username}</h1>
		<p class="text-base-content/60 mb-8">You're signed in to NoEgos Auth.</p>
		{#if data.user.apps.length > 0}
			<div class="space-y-2">
				<p class="font-semibold">Your apps:</p>
				{#each data.user.apps as app}
					<div class="badge badge-lg badge-primary gap-2">{app.name} ({app.role})</div>
				{/each}
			</div>
		{:else}
			<p class="text-base-content/50">No apps assigned yet.</p>
		{/if}
	{:else}
		<h1 class="text-3xl font-bold mb-4">NoEgos Auth</h1>
		<p class="text-base-content/60 mb-8">Authentication for No Egos Underwater apps.</p>
		<div class="flex justify-center gap-4">
			<a href="/login" class="btn btn-primary">Login</a>
			<a href="/request-access" class="btn btn-outline">Request Access</a>
		</div>
	{/if}
</div>

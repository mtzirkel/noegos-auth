<script lang="ts">
	let { data } = $props();
</script>

{#if data.user}
	<div class="text-center py-12">
		<h1 class="text-3xl font-bold mb-2">Welcome, {data.user.username}</h1>

		{#if data.apps.length > 0}
			<p class="text-base-content/60 mb-8">Head to your app:</p>
			<div class="flex flex-col items-center gap-3">
				{#each data.apps as app}
					{#if app.url}
						<a href={app.url} class="btn btn-primary btn-wide text-lg">{app.name}</a>
					{:else}
						<div class="btn btn-disabled btn-wide">{app.name} <span class="text-xs opacity-60 ml-2">(no URL configured)</span></div>
					{/if}
				{/each}
			</div>
		{:else}
			<p class="text-base-content/50 mt-8">No apps assigned yet. Contact your administrator.</p>
		{/if}

		{#if data.user.isAdmin}
			<div class="mt-10">
				<a href="/admin" class="btn btn-outline btn-sm">Admin Panel</a>
			</div>
		{/if}
	</div>
{:else}
	<div class="text-center py-12">
		<h1 class="text-3xl font-bold mb-4">NoEgos Auth</h1>
		<p class="text-base-content/60 mb-8">Authentication for No Egos Underwater apps.</p>
		<div class="flex justify-center gap-4">
			<a href="/login" class="btn btn-primary">Login</a>
			<a href="/request-access" class="btn btn-outline">Request Access</a>
		</div>
	</div>
{/if}

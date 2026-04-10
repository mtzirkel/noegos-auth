<script lang="ts">
	import '../app.css';
	let { children, data } = $props();
</script>

<div class="min-h-screen bg-base-200">
	<div class="navbar bg-base-100 shadow-sm">
		<div class="flex-1">
			<a href="/" class="btn btn-ghost text-xl">NoEgos Auth</a>
		</div>
		<div class="flex-none gap-2">
			{#if data.user}
				{#if data.user.isAdmin}
					<a href="/admin" class="btn btn-sm btn-ghost">Admin</a>
				{/if}
				<span class="text-sm opacity-70">{data.user.username}</span>
				<form method="POST" action="/logout">
					<button class="btn btn-sm btn-ghost">Logout</button>
				</form>
			{:else}
				<a href="/login" class="btn btn-sm btn-primary">Login</a>
			{/if}
		</div>
	</div>
	<main class="container mx-auto px-4 py-8 max-w-lg">
		{@render children()}
	</main>
</div>

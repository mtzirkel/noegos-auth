<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	const fmt = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString() : 'never');
</script>

<h1 class="text-3xl font-bold mb-2">Connected apps</h1>
<p class="text-sm opacity-70 mb-6">
	AI agents and other apps you've allowed to act on your behalf. Disconnecting stops them within an hour.
</p>

{#if form?.error}<div class="alert alert-error mb-4"><span>{form.error}</span></div>{/if}
{#if form?.revoked}<div class="alert alert-success mb-4"><span>Disconnected.</span></div>{/if}

{#if data.grants.length === 0}
	<p class="text-center opacity-50 py-8">Nothing connected.</p>
{:else}
	<div class="space-y-3">
		{#each data.grants as g (g.family_id)}
			<div class="card bg-base-100 shadow">
				<div class="card-body py-4 flex-row items-center justify-between">
					<div>
						<h3 class="font-bold">{g.client_name}</h3>
						<p class="text-sm opacity-60">
							{g.app_name} · {g.scope} · connected {fmt(g.created_at)} · last refresh {fmt(g.last_used_at)}
						</p>
					</div>
					<form method="POST" action="?/revoke" use:enhance>
						<input type="hidden" name="family_id" value={g.family_id} />
						<button class="btn btn-ghost btn-xs text-error">Disconnect</button>
					</form>
				</div>
			</div>
		{/each}
	</div>
{/if}

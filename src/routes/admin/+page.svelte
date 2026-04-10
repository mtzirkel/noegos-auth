<script lang="ts">
	let { data } = $props();
</script>

<h1 class="text-3xl font-bold mb-6">Admin Dashboard</h1>

<div class="stats shadow mb-8 w-full">
	<div class="stat">
		<div class="stat-title">Pending Requests</div>
		<div class="stat-value text-warning">{data.pendingRequests.length}</div>
	</div>
	<div class="stat">
		<div class="stat-title">Users</div>
		<div class="stat-value">{data.userCount}</div>
	</div>
	<div class="stat">
		<div class="stat-title">Apps</div>
		<div class="stat-value">{data.appCount}</div>
	</div>
</div>

<div class="flex flex-col gap-4">
	<a href="/admin/requests" class="btn btn-outline w-full justify-between">
		Pending Requests
		{#if data.pendingRequests.length > 0}
			<span class="badge badge-warning">{data.pendingRequests.length}</span>
		{/if}
	</a>
	<a href="/admin/users" class="btn btn-outline w-full">Manage Users</a>
	<a href="/admin/apps" class="btn btn-outline w-full">Manage Apps</a>
</div>

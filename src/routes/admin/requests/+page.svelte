<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
</script>

<div class="flex items-center justify-between mb-6">
	<h1 class="text-3xl font-bold">Access Requests</h1>
	<a href="/admin" class="btn btn-ghost btn-sm">&larr; Back</a>
</div>

{#if form?.approved}
	<div class="alert alert-success mb-6">
		<div>
			<h3 class="font-bold">Approved: {form.username}</h3>
			<p class="text-sm">Send them this setup link:</p>
			<code class="block mt-1 text-xs break-all select-all bg-base-200 p-2 rounded">{form.setupUrl}</code>
		</div>
	</div>
{/if}

{#if form?.denied}
	<div class="alert alert-info mb-6">
		<span>Request denied.</span>
	</div>
{/if}

{#if data.requests.length === 0}
	<div class="text-center py-12 text-base-content/50">
		<p>No access requests.</p>
	</div>
{:else}
	<div class="space-y-4">
		{#each data.requests as req}
			<div class="card bg-base-100 shadow" class:opacity-50={req.status !== 'pending'}>
				<div class="card-body">
					<div class="flex items-center justify-between">
						<div>
							<h3 class="font-bold text-lg">{req.username}</h3>
							{#if req.display_name}
								<p class="text-sm text-base-content/60">{req.display_name}</p>
							{/if}
						</div>
						{#if req.status !== 'pending'}
							<span class="badge" class:badge-success={req.status === 'approved'} class:badge-error={req.status === 'denied'}>
								{req.status}
							</span>
						{/if}
					</div>

					{#if req.requested_app_name}
						<p class="text-sm mt-2">
							<span class="text-base-content/60">Requesting access to:</span>
							<span class="badge badge-primary badge-sm ml-1">{req.requested_app_name}</span>
						</p>
					{:else}
						<p class="text-sm mt-2 text-base-content/40 italic">No specific app requested</p>
					{/if}

					{#if req.message}
						<p class="text-sm bg-base-200 p-3 rounded-lg mt-2">"{req.message}"</p>
					{/if}

					<p class="text-xs text-base-content/40">
						Requested {new Date(req.created_at).toLocaleDateString()}
					</p>

					{#if req.status === 'pending'}
						<form method="POST" action="?/approve" use:enhance class="mt-4">
							<input type="hidden" name="request_id" value={req.id} />

							{#if data.apps.length > 0}
								<div class="form-control mb-3">
									<label class="label">
										<span class="label-text font-semibold">Grant access to:</span>
									</label>
									{#each data.apps as app}
											<label class="label cursor-pointer justify-start gap-3">
												<input
													type="checkbox"
													name="app_ids"
													value={app.id}
													class="checkbox checkbox-sm"
													checked={app.id === req.requested_app_id}
												/>
												<span>{app.name}{app.id === req.requested_app_id ? ' (requested)' : ''}</span>
												<select name="roles" class="select select-bordered select-xs w-28">
													{#each app.roles as role}
														<option value={role}>{role}</option>
													{/each}
												</select>
											</label>
										{/each}
								</div>
							{:else}
								<p class="text-sm text-warning mb-3">No apps registered yet. <a href="/admin/apps" class="link">Add one first.</a></p>
							{/if}

							<div class="flex gap-2">
								<button type="submit" class="btn btn-success btn-sm flex-1">Approve</button>
								<button formaction="?/deny" class="btn btn-error btn-outline btn-sm flex-1">Deny</button>
							</div>
						</form>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}

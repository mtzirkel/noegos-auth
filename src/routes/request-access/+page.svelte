<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	const selectedAppId = $derived(
		(form as { requestedAppId?: string } | null)?.requestedAppId || data.preselectedAppId || ''
	);
</script>

<div class="card bg-base-100 shadow-xl">
	<div class="card-body">
		<h2 class="card-title text-2xl justify-center mb-4">Request Access</h2>

		{#if form?.success}
			<div class="alert alert-success">
				<div>
					<h3 class="font-bold">Request Submitted</h3>
					<p>Your request has been sent. You'll receive a setup link once approved.</p>
				</div>
			</div>
		{:else}
			{#if form?.error}
				<div class="alert alert-error mb-4">
					<span>{form.error}</span>
				</div>
			{/if}

			<form method="POST" use:enhance>
				<div class="form-control mb-4">
					<label class="label" for="username">
						<span class="label-text">Pick a username</span>
					</label>
					<input
						type="text"
						id="username"
						name="username"
						value={(form as any)?.username ?? ''}
						autocapitalize="none"
						class="input input-bordered w-full"
						placeholder="paddler42"
						required
					/>
					<label class="label">
						<span class="label-text-alt">Lowercase, 3-30 chars, letters/numbers/hyphens</span>
					</label>
				</div>

				<div class="form-control mb-4">
					<label class="label" for="display_name">
						<span class="label-text">Display name (optional)</span>
					</label>
					<input
						type="text"
						id="display_name"
						name="display_name"
						value={form?.displayName ?? ''}
						class="input input-bordered w-full"
						placeholder="Jake"
					/>
				</div>

				<div class="form-control mb-4">
					<label class="label" for="requested_app_id">
						<span class="label-text">Which app do you want access to?</span>
					</label>
					{#if data.apps.length === 0}
						<p class="text-sm text-warning">No apps are registered yet. Ask the admin to add one before requesting access.</p>
					{:else}
						<select
							id="requested_app_id"
							name="requested_app_id"
							class="select select-bordered w-full"
							required
						>
							<option value="" disabled selected={!selectedAppId}>Pick an app…</option>
							{#each data.apps as app}
								<option value={app.id} selected={app.id === selectedAppId}>{app.name}</option>
							{/each}
						</select>
					{/if}
				</div>

				<div class="form-control mb-6">
					<label class="label" for="message">
						<span class="label-text">Message to admin (optional)</span>
					</label>
					<textarea
						id="message"
						name="message"
						class="textarea textarea-bordered w-full"
						placeholder="Hey Travis, I paddle with you on the Clark Fork..."
						rows="3"
					>{form?.message ?? ''}</textarea>
				</div>

				<button type="submit" class="btn btn-primary w-full">Submit Request</button>
			</form>

			<div class="divider">OR</div>

			<a href="/login" class="btn btn-outline btn-sm w-full">Already have an account? Sign in</a>
		{/if}
	</div>
</div>

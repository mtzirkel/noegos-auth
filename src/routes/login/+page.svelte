<script lang="ts">
	import { enhance } from '$app/forms';
	let { form } = $props();
</script>

<div class="card bg-base-100 shadow-xl">
	<div class="card-body">
		<h2 class="card-title text-2xl justify-center mb-4">Sign In</h2>

		{#if form?.error}
			<div class="alert alert-error mb-4">
				<span>{form.error}</span>
			</div>
		{/if}

		<form method="POST" use:enhance>
			<div class="form-control mb-4">
				<label class="label" for="username">
					<span class="label-text">Username</span>
				</label>
				<input
					type="text"
					id="username"
					name="username"
					value={form?.username ?? ''}
					autocomplete="username"
					autocapitalize="none"
					class="input input-bordered w-full"
					required
				/>
			</div>

			<div class="form-control mb-6">
				<label class="label" for="code">
					<span class="label-text">Authenticator Code</span>
				</label>
				<input
					type="text"
					id="code"
					name="code"
					inputmode="numeric"
					pattern="[0-9]*"
					maxlength="6"
					autocomplete="one-time-code"
					class="input input-bordered w-full text-center text-2xl tracking-widest"
					placeholder="000000"
					required
				/>
			</div>

			<button type="submit" class="btn btn-primary w-full">Sign In</button>
		</form>

		<div class="divider">OR</div>

		<a href="/request-access" class="btn btn-outline btn-sm w-full">Request Access</a>
	</div>
</div>

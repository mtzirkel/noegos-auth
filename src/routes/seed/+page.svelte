<script lang="ts">
	import { enhance } from '$app/forms';
	let { form } = $props();
</script>

<div class="card bg-base-100 shadow-xl">
	<div class="card-body">
		<h2 class="card-title text-2xl justify-center mb-4">Initial Setup</h2>
		<p class="text-center text-base-content/60 mb-4">Create the admin account for NoEgos Auth.</p>

		{#if form?.success}
			<div class="text-center">
				<h3 class="text-xl font-bold text-success mb-4">Admin Created: {form.username}</h3>
				<p class="mb-4">Scan this QR code with your authenticator app:</p>
				<div class="flex justify-center mb-4">
					<img src={form.qrCode} alt="TOTP QR Code" class="rounded-lg" />
				</div>
				<div class="collapse collapse-arrow bg-base-200 mb-4">
					<input type="checkbox" />
					<div class="collapse-title font-medium">Manual entry key</div>
					<div class="collapse-content">
						<code class="block text-center text-lg tracking-wider break-all">{form.secret}</code>
					</div>
				</div>
				<p class="text-sm text-warning mb-4">Save this now! You won't see it again.</p>
				<a href="/login" class="btn btn-primary">Go to Login</a>
			</div>
		{:else}
			{#if form?.error}
				<div class="alert alert-error mb-4"><span>{form.error}</span></div>
			{/if}

			<form method="POST" use:enhance>
				<div class="form-control mb-4">
					<label class="label" for="username">
						<span class="label-text">Admin username</span>
					</label>
					<input
						type="text"
						id="username"
						name="username"
						class="input input-bordered w-full"
						placeholder="travis"
						autocapitalize="none"
						required
					/>
				</div>
				<button type="submit" class="btn btn-primary w-full">Create Admin</button>
			</form>
		{/if}
	</div>
</div>

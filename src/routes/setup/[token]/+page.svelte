<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
</script>

<div class="card bg-base-100 shadow-xl">
	<div class="card-body">
		{#if data.alreadySetup}
			<div class="text-center">
				<h2 class="text-2xl font-bold mb-4">Already Set Up</h2>
				<p class="mb-4">Your account <strong>{data.username}</strong> is already configured.</p>
				<a href="/login" class="btn btn-primary">Go to Login</a>
			</div>
		{:else if form?.success}
			<div class="text-center">
				<h2 class="text-2xl font-bold mb-4 text-success">You're All Set</h2>
				<p class="mb-4">Your authenticator is configured. You can now sign in.</p>
				<a href="/login" class="btn btn-primary">Sign In</a>
			</div>
		{:else}
			<h2 class="card-title text-2xl justify-center mb-2">Set Up Authenticator</h2>
			<p class="text-center text-base-content/60 mb-4">
				Welcome, <strong>{data.username}</strong>! Scan this QR code with your authenticator app.
			</p>

			{#if form?.error}
				<div class="alert alert-error mb-4">
					<span>{form.error}</span>
				</div>
			{/if}

			<div class="flex justify-center mb-4">
				<img src={data.qrCode} alt="TOTP QR Code" class="rounded-lg" />
			</div>

			<div class="collapse collapse-arrow bg-base-200 mb-4">
				<input type="checkbox" />
				<div class="collapse-title font-medium">Can't scan? Enter manually</div>
				<div class="collapse-content">
					<code class="block text-center text-lg tracking-wider break-all">{data.manualSecret}</code>
				</div>
			</div>

			<form method="POST" use:enhance>
				<div class="form-control mb-4">
					<label class="label" for="code">
						<span class="label-text">Enter the 6-digit code to verify</span>
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
				<button type="submit" class="btn btn-primary w-full">Verify & Activate</button>
			</form>
		{/if}
	</div>
</div>

import type { AppAccess } from '$lib/server/auth.js';

declare global {
	namespace App {
		interface Locals {
			user?: {
				id: string;
				username: string;
				isAdmin: boolean;
				apps: AppAccess[];
			};
		}
	}
}

export {};

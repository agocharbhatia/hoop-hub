import { json } from '@sveltejs/kit';
import { usageSummary } from '$lib/server/beta/limits';
export const GET = () => json(usageSummary());

import { json } from '@sveltejs/kit';
import { readinessChecks } from '$lib/server/beta/readiness';
export const GET = () => {
	const ready = readinessChecks().every((check) => check.ok);
	return json({ status: ready ? 'ready' : 'not_ready' }, { status: ready ? 200 : 503 });
};

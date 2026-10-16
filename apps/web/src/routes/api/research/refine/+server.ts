import { json } from '@sveltejs/kit';
import { admitResearch } from '$lib/server/beta/limits';
import { BetaError } from '$lib/server/beta/config';
import { createStatsEndpointFetcher } from '$lib/server/data/adapters/stats-endpoint-client';
import { BoardError } from '$lib/server/research/boards';
import { researchRepository } from '$lib/server/research/repository';
import { validateRefinement, refinementQuestion, refineShooting } from '$lib/server/research/refinement';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		let body: unknown; try { body = await request.json(); } catch { throw new BoardError('Invalid JSON body.'); }
		const input = validateRefinement(body);
		const artifact = researchRepository.getTurn(input.sessionId, input.turnId)?.response.artifacts[input.artifactIndex];
		if (!artifact) throw new BoardError('Saved evidence was not found.', 404);
		if (artifact.type !== 'scatter_chart') return json({ question: refinementQuestion(input), sessionId: input.sessionId });
		const permit = admitResearch();
		try { return json(await permit.run(() => refineShooting(input, createStatsEndpointFetcher(), { signal: request.signal }))); }
		finally { permit.release(); }
	} catch (error) {
		if (error instanceof BoardError || error instanceof BetaError) return json({ error: error.message }, { status: error.status });
		if (request.signal.aborted) return new Response(null, { status: 499 });
		throw error;
	}
};

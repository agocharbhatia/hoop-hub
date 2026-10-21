import assert from 'node:assert/strict';
import { test } from 'node:test';
import { researchIntent, type ResearchIntent } from './research-intent';
import { composeResearch } from './research-composition';
import { splitUIFixtures } from '$lib/server/research/split-fixtures';
import { researchUIFixtures } from '$lib/server/research/ui-fixtures';
import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
import { artifactCsv, artifactSvg } from './artifact-export';
import { splitDelta } from './split-comparison';

const questionCases: Array<[string, ResearchIntent]> = [
	['What changed in Barnes scoring before and after 2025-01-01?', 'change'],
	['Compare Toronto at home versus away.', 'change'],
	['Compare Barnes in wins and losses.', 'change'],
	['Compare first half and second half of the season.', 'change'],
	['Compare Barnes in 2023-24 with 2024-25.', 'change'],
	['Show season-over-season changes in scoring.', 'change'],
	['Rank the top 10 three-point shooters by efficiency and volume.', 'ranking'],
	['Who leads the NBA in assists?', 'ranking'],
	['Show the qualified lineup leaderboard.', 'ranking'],
	['Chart Curry points over the last 20 games.', 'trend'],
	['Show the game-by-game trajectory in assists.', 'trend'],
	['Plot three-point volume against efficiency.', 'relationship'],
	['Show a scatterplot of three-point shooting.', 'relationship'],
	['Compare Barnes and Tatum on points, rebounds and assists.', 'comparison'],
	['Show Curry clips from the left corner.', 'film'],
	['Watch Barnes driving layups.', 'film'],
	['Show a shot chart of Barnes mid-range attempts.', 'shots'],
	['Map Curry shot zones.', 'shots'],
	['Give me a table of scoring and efficiency.', 'table'],
	['Compare Barnes and Tatum as a table.', 'table']
];

for (const [question, expected] of questionCases) test(`analyst intent: ${question}`, () => assert.equal(researchIntent(question), expected));

test('mixed evidence follows the analytical task, preserves indices, and demotes empty surfaces', () => {
	const split = splitUIFixtures()[0].response.artifacts[0], base = researchUIFixtures();
	const ranking: QueryAnswerArtifact = { type: 'table', shape: 'ranking', columns: ['player', 'PTS'], rows: [{ player: 'Stephen Curry', PTS: 20 }] };
	const shots: QueryAnswerArtifact = { type: 'shot_chart', title: 'Shots', shots: [{ locX: 0, locY: 0, made: true }] };
	const film: QueryAnswerArtifact = { type: 'video_playlist', title: 'Film', clips: [{ url: 'https://example.invalid/clip.mp4', description: 'Clip', thumbnailUrl: null, gameDate: null, gameId: null }] };
	const artifacts = [base[0].response.artifacts[1], base[0].response.artifacts[2], base[1].response.artifacts[0], split, ranking, shots, film];
	for (const [question, type] of [['Rank the top 10 players.', 'table'], ['What changed before and after January 1?', 'split_comparison'], ['Chart points over the last 20 games.', 'line_chart'], ['Show a scatterplot.', 'scatter_chart'], ['Show a shot chart.', 'shot_chart'], ['Watch clips of the shots.', 'video_playlist']] as const) {
		const composed = composeResearch(artifacts, question);
		assert.equal(composed[0].artifact.type, type); assert.equal(composed.filter(entry => entry.role === 'primary').length, 1);
		assert.ok(composed.every(entry => artifacts[entry.index] === entry.artifact));
	}
	assert.ok(composeResearch(artifacts, 'Table only.').every(entry => entry.artifact.type === 'table'));
	assert.notEqual(composeResearch([{ ...film, clips: [] }, shots], 'Watch the clips.')[0].artifact.type, 'video_playlist');
});

test('numeric coincidence does not suppress a chart for a different metric', () => {
	const source = { toolName: 'aggregate_endpoint_rows' as const, endpointId: 'test', resultSetName: 'test', request: {} };
	const table: QueryAnswerArtifact = { type: 'table', shape: 'table', columns: ['name', 'REB'], rows: [{ name: 'Barnes', REB: 7 }], source };
	const chart: QueryAnswerArtifact = { type: 'bar_chart', title: 'Assists', xLabel: 'Name', yLabel: 'AST', bars: [{ label: 'Barnes', value: 7 }], source };
	assert.equal(composeResearch([table, chart], 'Compare assists and rebounds.').length, 2);
});

test('split exports keep cohort counts, units, exact deltas and source counts; unknown favorable direction stays neutral', () => {
	const artifact = splitUIFixtures()[0].response.artifacts[0]; assert.equal(artifact.type, 'split_comparison');
	const csv = artifactCsv(artifact), svg = artifactSvg(artifact);
	assert.ok(csv.includes('First cohort games')); assert.ok(csv.includes('Supporting counts')); assert.ok(csv.includes('TS%')); assert.ok(csv.includes('Change unit')); assert.ok(csv.includes('pp'));
	assert.ok(svg.includes('Scottie Barnes')); assert.ok(svg.includes('10 games')); assert.ok(!svg.includes('Δ'));
	const volume = artifact.metrics.find(metric => metric.key === 'FGA')!;
	assert.equal(splitDelta(volume).tone, 'neutral');
	assert.equal(splitDelta({ ...volume, values: [null, 10] }).value, null);
});

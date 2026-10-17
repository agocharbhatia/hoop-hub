import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shootingFixture } from '$lib/server/research/ui-fixtures';
import { shootingView } from './shooting-analysis';
import { entityPlotMarkers, MAX_ENTITY_MARKERS } from './entity-markers';
import { artifactSvg } from './artifact-export';

const coordinates = { x: (value: number) => value * 100, y: (value: number) => value * 100 };

test('entity markers use canonical identities and leave measured coordinates and populations unchanged', () => {
	for (const entity of ['player', 'team'] as const) {
		const points = shootingView(shootingFixture(entity).plot).points;
		const original = structuredClone(points), markers = entityPlotMarkers(entity, points, coordinates);
		assert.ok(markers.length > 0); assert.ok(markers.length <= MAX_ENTITY_MARKERS);
		assert.ok(markers.every(marker => marker.entity.kind === entity && marker.x === coordinates.x(points.find(point => point.id === marker.id)!.volume)));
		assert.deepEqual(points, original);
		assert.deepEqual(entityPlotMarkers(entity, [...points].reverse(), coordinates), markers);
		assert.deepEqual(entityPlotMarkers(entity, [{ ...points[0], name: 'Wrong identity' }], coordinates), []);
	}
});

test('crowded coordinates retain every data point while prioritizing selected and inspected images', () => {
	const points = shootingView(shootingFixture().plot).points;
	const options = { x: () => 100, y: () => 100, selectedIds: [points[1].id], activeId: points[2].id };
	const crowded = entityPlotMarkers('player', points, options);
	assert.equal(crowded.length, 2); assert.ok(crowded.some(marker => marker.id === points[1].id)); assert.ok(crowded.some(marker => marker.id === points[2].id));
	assert.equal(points.length, shootingView(shootingFixture().plot).points.length);
});

test('portable markers embed PNG bytes only; remote or untrusted markup never enters the export', () => {
	const plot = shootingFixture().plot, point = plot.points[0];
	const context = { view: { selectedIds: [point.id] } };
	const data = 'data:image/png;base64,aGVsbG8=';
	assert.ok(artifactSvg(plot, context, new Map([[point.id, data]])).includes(data));
	assert.ok(!artifactSvg(plot, context, new Map([[point.id, 'https://example.invalid/fake.svg']])).includes('example.invalid'));
	assert.ok(!artifactSvg(plot, context).includes('cdn.nba.com'));
	assert.ok(artifactSvg(plot, context).includes('Stephen Curry'));
});

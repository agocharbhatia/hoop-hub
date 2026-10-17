import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
import type { ArtifactViewState } from '$lib/contracts/research-views';
import type { QueryEffectiveScope } from '$lib/contracts/query-context';
import type { Citation } from '$lib/contracts/chat';
import { buildEntityComparison, comparisonDelta } from '$lib/components/charts/entity-comparison';
import { displayForCell } from './table-display';
import { formatTableCell, tableColumnLabel } from '$lib/components/charts/table-utils';
import { shootingView, shootingTable, shootingDomain } from './shooting-analysis';
import { niceTicks } from '$lib/components/charts/chart-utils';
import { rollingSeries, seriesMean, trendObservationUnit } from './trend-analysis';
import { splitExportRows, splitValue, splitDelta, cohortLabel } from './split-comparison';
import { entityPlotMarkers, type EntityPlotMarker } from './entity-markers';

export type ArtifactExportContext = { question?: string; citations?: Citation[]; scope?: QueryEffectiveScope; view?: ArtifactViewState; savedAt?: string };
type ExportRows = { columns: string[]; rows: Array<Array<string | number | boolean | null | undefined>> };

/* Portable data and drawing helpers */

const xml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
const compact = (value: number, digits = 1) => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits }) : 'N/A';
const shorten = (value: string, max = 52) => value.length > max ? `${value.slice(0, max - 1)}…` : value;
const text = (x: number, y: number, value: unknown, size = 16, fill = '#dadde4', anchor = 'start') => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${xml(value)}</text>`;
const line = (x1: number, y1: number, x2: number, y2: number, stroke = '#ffffff15', dash = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
const title = (artifact: QueryAnswerArtifact) => 'title' in artifact ? artifact.title : artifact.type === 'table' ? artifact.display?.title ?? 'Research results' : 'Research finding';

function scaleValue(value: number, scale: number): number {
	if (scale === 1) return value;
	if (scale === 100 && Number.isFinite(value)) { const [mantissa, exponent = '0'] = String(value).split('e'); return Number(`${mantissa}e${Number(exponent) + 2}`); }
	return value * scale;
}

function scopeLabel(scope?: QueryEffectiveScope): string {
	if (!scope) return '';
	return [...scope.seasons, ...scope.seasonTypes ?? [], ...(scope.dateFrom || scope.dateTo ? [`${scope.dateFrom || 'Season start'} to ${scope.dateTo || 'Season end'}`] : []), ...(scope.period ? [`Q${scope.period}`] : []), ...scope.shotFilters ?? [], ...(scope.opponents?.length ? [`vs ${scope.opponents.map(opponent => opponent.name).join(', ')}`] : [])].join(' · ');
}

function csvCell(value: unknown): string {
	const raw = value === null || value === undefined || typeof value === 'number' && !Number.isFinite(value) ? '' : String(value);
	const safe = typeof value === 'string' && /^[\s]*[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
	return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function tabular(artifact: QueryAnswerArtifact, view: ArtifactViewState = {}): ExportRows {
	if (artifact.type === 'split_comparison') return splitExportRows(artifact);
	if (artifact.type === 'scatter_chart') { const analysis = shootingView(artifact, view); return { columns: [artifact.entity, 'ID', analysis.volumeLabel, '3P% [%]', '3PM', '3PA', 'Games', 'Percentile in qualified group', 'Highlighted'], rows: analysis.points.map(point => [point.name, point.id, point.volume, point.percentage, point.makes, point.attempts, point.games, point.percentile, (view.selectedIds ?? []).includes(point.id)]) }; }
	if (artifact.type === 'table') {
		const rowUnits = artifact.columns.includes('metric') && !artifact.columns.includes('unit');
		return { columns: [...artifact.columns.map(column => { const definition = artifact.display?.columns[column]; return `${tableColumnLabel(column, artifact.display)}${definition?.unit ? ` [${definition.unit}]` : ''} (${column})`; }), ...(rowUnits ? ['Value unit'] : [])], rows: artifact.rows.map(row => [...artifact.columns.map(column => { const value = row[column]; return typeof value === 'number' ? scaleValue(value, displayForCell(column, row, artifact.display).scale ?? 1) : value; }), ...(rowUnits ? [displayForCell('value', row, artifact.display).unit ?? ''] : [])]) };
	}
	if (artifact.type === 'line_chart') return { columns: ['Series', artifact.xLabel, artifact.yLabel, `${view.rollingWindow ?? 1}-${trendObservationUnit(artifact)} average`, 'Window mean'], rows: artifact.series.flatMap(series => { const rolling = new Map(rollingSeries(series, view.rollingWindow ?? 1).points.map(point => [String(point.x), point.y])); return series.points.map(point => [series.name, point.x, point.y, rolling.get(String(point.x)) ?? null, seriesMean(series)]); }) };
	if (artifact.type === 'bar_chart') return { columns: [artifact.xLabel, artifact.yLabel], rows: artifact.bars.map(bar => [bar.label, bar.value]) };
	if (artifact.type === 'shot_chart') return { columns: ['Game ID', 'Event ID', 'Date', 'Period', 'X', 'Y', 'Made', 'Shot value', 'Label'], rows: artifact.shots.map(shot => [shot.gameId, shot.eventId, shot.gameDate, shot.period, shot.locX, shot.locY, shot.made, shot.value, shot.label]) };
	if (artifact.type === 'video_playlist') return { columns: ['Game ID', 'Event ID', 'Date', 'Description', 'Video URL'], rows: artifact.clips.map(clip => [clip.gameId, clip.eventId, clip.gameDate, clip.description, clip.url]) };
	return { columns: ['Finding'], rows: [[artifact.text]] };
}

function scatterExportMarkers(artifact: Extract<QueryAnswerArtifact, { type: 'scatter_chart' }>, view?: ArtifactViewState) {
	const analysis = shootingView(artifact, view), domain = shootingDomain(analysis.points);
	return entityPlotMarkers(artifact.entity, analysis.points, { x: value => 105 + value / domain.xMax * 1000, y: value => 640 - (value - domain.yMin) / (domain.yMax - domain.yMin || 1) * 415, selectedIds: view?.selectedIds });
}

function exportMarker(marker: EntityPlotMarker, selected: boolean, image?: string): string {
	const { x, y, radius } = marker, clipId = `entity-${marker.entity.kind}-${marker.id}`;
	const embedded = image && /^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(image) ? `<image href="${image}" x="${x - radius}" y="${y - radius}" width="${radius * 2}" height="${radius * 2}" clip-path="url(#${clipId})"/>` : text(x, y + 4, marker.entity.initials, 11, '#bed0e5', 'middle');
	return `<g opacity="${selected ? 1 : .75}"><defs><clipPath id="${clipId}"><circle cx="${x}" cy="${y}" r="${radius}"/></clipPath></defs><circle cx="${x}" cy="${y}" r="${radius}" fill="#202831"/>${embedded}<circle cx="${x}" cy="${y}" r="${radius + .5}" fill="none" stroke="${selected ? '#99c7ff' : '#72869e'}" stroke-width="${selected ? 2 : 1}"/></g>`;
}

/* End portable data and drawing helpers */

/** Export displayed units at full precision and keep scope/source attached to every portable row. */
export function artifactCsv(artifact: QueryAnswerArtifact, context: ArtifactExportContext = {}): string {
	const data = tabular(artifact, context.view);
	const scope = artifact.type === 'scatter_chart' ? `${artifact.scope.season} · ${artifact.scope.seasonType}${artifact.scope.dateFrom || artifact.scope.dateTo ? ` · ${artifact.scope.dateFrom || 'Season start'} to ${artifact.scope.dateTo || 'Season end'}` : ''}` : scopeLabel(context.scope);
	const source = context.citations?.map(citation => `${citation.source}${citation.detail ? `: ${citation.detail}` : ''}`).join(' | ') || ('source' in artifact && artifact.source ? `${artifact.source.providerId ?? 'nba_stats'}:${artifact.source.endpointId}` : 'Saved research');
	const analysis = artifact.type === 'scatter_chart' ? shootingView(artifact, context.view) : null;
	const verifiedRequest = 'source' in artifact && artifact.source ? JSON.stringify(artifact.source.request) : '';
	const metadata = [context.question ?? '', scope, source, context.savedAt ?? '', analysis?.minimumAttempts ?? '', analysis?.rate ?? '', analysis?.populationCount ?? '', context.scope ? JSON.stringify(context.scope) : '', verifiedRequest];
	return '\uFEFF' + [[...data.columns, 'Research question', 'Scope', 'Source', 'Saved at', 'Minimum 3PA', 'Rate basis', 'Qualified population', 'Resolved scope', 'Verified request'], ...data.rows.map(row => [...row, ...metadata])].map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function artifactDataTable(artifact: QueryAnswerArtifact, view: ArtifactViewState = {}): Extract<QueryAnswerArtifact, { type: 'table' }> {
	if (artifact.type === 'table') return artifact;
	if (artifact.type === 'scatter_chart') return shootingTable(artifact, view);
	const data = tabular(artifact, view), columns = data.columns.map((_, index) => `field${index}`);
	return { type: 'table', shape: 'table', columns, rows: data.rows.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index] ?? null]))), display: { title: 'Underlying data', primaryColumns: columns.slice(0, artifact.type === 'split_comparison' ? 7 : 6), metricColumns: [], columns: Object.fromEntries(columns.map((column, index) => [column, { label: data.columns[index], role: index === 0 ? 'identity' : 'metric' }])) } };
}

/** A deliberate export frame stays legible outside the app without depending on screenshots or remote media. */
export function artifactSvg(artifact: QueryAnswerArtifact, context: ArtifactExportContext = {}, entityImages: ReadonlyMap<string, string> = new Map()): string {
	const width = 1200, height = 800;
	let body = '';
	if (artifact.type === 'split_comparison') {
		body += text(60, 193, artifact.subject.name, 21) + text(525, 193, cohortLabel(artifact.cohorts[0]), 15, '#aab7c8', 'end') + text(900, 193, cohortLabel(artifact.cohorts[1]), 15, '#cce2fc', 'end') + text(1140, 193, 'Change', 13, '#9ca7b6', 'end');
		artifact.cohorts.forEach((cohort, index) => body += text(index ? 900 : 525, 218, `${cohort.games} games · ${cohort.season}`, 12, '#9ca7b6', 'end'));
		const spacing = Math.min(72, 430 / Math.max(1, artifact.metrics.length));
		artifact.metrics.forEach((metric, index) => {
			const yy = 268 + index * spacing, delta = splitDelta(metric);
			body += line(60, yy - 27, 1140, yy - 27) + text(60, yy, metric.label, 16) + text(525, yy, splitValue(metric.values[0], metric), 26, '#aab7c8', 'end') + text(900, yy, splitValue(metric.values[1], metric), 26, '#e0ecfb', 'end') + text(1140, yy, delta.text, 18, delta.tone === 'positive' ? '#75d8ba' : delta.tone === 'negative' ? '#ed9ca8' : '#aab7c8', 'end');
		});
		body += text(60, 710, shorten(artifact.limitations.join(' · ') || `${artifact.rate === 'PerGame' ? 'Per game' : 'Totals'} · ${artifact.seasonType}`, 130), 13, '#9ca7b6');
	} else if (artifact.type === 'scatter_chart') {
		const analysis = shootingView(artifact, context.view), domain = shootingDomain(analysis.points);
		const x = (value: number) => 105 + value / domain.xMax * 1000, y = (value: number) => 640 - (value - domain.yMin) / (domain.yMax - domain.yMin || 1) * 415;
		for (const tick of niceTicks(domain.yMin, domain.yMax, 4)) body += line(105, y(tick), 1105, y(tick)) + text(85, y(tick) + 5, `${tick}%`, 13, '#9ca7b6', 'end');
		for (const tick of niceTicks(0, domain.xMax, 5)) body += text(x(tick), 672, compact(tick), 13, '#9ca7b6', 'middle');
		if (context.view?.showReference !== false && analysis.meanVolume !== null && analysis.combinedPercentage !== null) body += line(x(analysis.meanVolume), 220, x(analysis.meanVolume), 640, '#98a5b577', '5 7') + line(105, y(analysis.combinedPercentage), 1105, y(analysis.combinedPercentage), '#98a5b577', '5 7');
		const markers = scatterExportMarkers(artifact, context.view).sort((a, b) => Number(context.view?.selectedIds?.includes(a.id)) - Number(context.view?.selectedIds?.includes(b.id)));
		for (const point of analysis.points) { const selected = context.view?.selectedIds?.includes(point.id); body += `<circle cx="${x(point.volume)}" cy="${y(point.percentage)}" r="${selected ? 7 : 4}" fill="${selected ? '#b9daff' : '#5799e6'}" opacity="${context.view?.selectedIds?.length && !selected ? .25 : .85}"/>`; }
		for (const marker of markers) body += exportMarker(marker, context.view?.selectedIds?.includes(marker.id) ?? false, entityImages.get(marker.id));
		for (const point of analysis.points.filter(point => context.view?.selectedIds?.includes(point.id))) body += text(x(point.volume) > 950 ? x(point.volume) - 21 : x(point.volume) + 21, y(point.percentage) - 24, point.name, 14, '#dfedff', x(point.volume) > 950 ? 'end' : 'start');
		body += text(105, 201, '3P%', 14, '#9ca7b6') + text(1105, 702, analysis.volumeLabel, 14, '#9ca7b6', 'end') + text(105, 702, `${analysis.populationCount} ${artifact.entity === 'team' ? 'teams' : 'players'} · min. ${analysis.minimumAttempts} 3PA · ${analysis.attempts.toLocaleString()} attempts`, 14, '#9ca7b6');
	} else if (artifact.type === 'line_chart') {
		const all = artifact.series.flatMap(series => series.points.map(point => point.y)).filter(Number.isFinite), low = Math.min(0, ...all), high = Math.max(1, ...all), xs = [...new Set(artifact.series.flatMap(series => series.points.map(point => String(point.x))))];
		const x = (index: number) => 100 + index / Math.max(1, xs.length - 1) * 1000, y = (value: number) => 640 - (value - low) / (high - low || 1) * 390;
		for (let index = 0; index <= 4; index++) { const value = low + (high - low) * index / 4; body += line(100, y(value), 1100, y(value)) + text(82, y(value) + 5, compact(value), 13, '#9ca7b6', 'end'); }
		artifact.series.forEach((series, index) => { const color = ['#5799e6', '#59b69a', '#e4b46d', '#ae9fe3'][index % 4]; const path = (points: typeof series.points) => points.map((point, i) => `${i ? 'L' : 'M'}${x(xs.indexOf(String(point.x)))},${y(point.y)}`).join(' '); body += `<path d="${path(series.points)}" fill="none" stroke="${color}" stroke-width="2" opacity="${(context.view?.rollingWindow ?? 1) > 1 ? .25 : 1}"/>`; if ((context.view?.rollingWindow ?? 1) > 1) body += `<path d="${path(rollingSeries(series, context.view!.rollingWindow!).points)}" fill="none" stroke="${color}" stroke-width="3"/>`; const mean = seriesMean(series); if (context.view?.showReference && mean !== null) body += line(100, y(mean), 1100, y(mean), color, '5 7'); body += text(100, 190 + index * 23, shorten(series.name, 90), 14, color); });
		for (const index of [...new Set([0, Math.floor((xs.length - 1) / 2), xs.length - 1])]) if (index >= 0) body += text(x(index), 673, xs[index], 13, '#9ca7b6', index === 0 ? 'start' : index === xs.length - 1 ? 'end' : 'middle');
		body += text(100, 704, `${artifact.yLabel}${(context.view?.rollingWindow ?? 1) > 1 ? ` · ${context.view!.rollingWindow}-${trendObservationUnit(artifact)} rolling average` : ''}${context.view?.showReference ? ' · dashed window mean' : ''}`, 14, '#9ca7b6');
	} else if (artifact.type === 'bar_chart') {
		const visible = artifact.bars.slice(0, 12), low = Math.min(0, ...visible.map(bar => bar.value)), high = Math.max(1, ...visible.map(bar => bar.value));
		const x = (value: number) => 350 + (value - low) / (high - low || 1) * 700;
		const rowHeight = Math.min(38, 445 / Math.max(1, visible.length));
		body += line(x(0), 214, x(0), 235 + visible.length * rowHeight, '#a9bfd94d', '4 5') + text(350, 200, artifact.yLabel, 14, '#9ca7b6');
		visible.forEach((bar, index) => { const yy = 240 + index * rowHeight; body += text(60, yy + 5, shorten(bar.label, 31), 14) + `<rect x="${Math.min(x(0), x(bar.value))}" y="${yy - 11}" width="${Math.abs(x(bar.value) - x(0))}" height="20" rx="3" fill="#5799e6" opacity=".7"/>` + text(1125, yy + 5, compact(bar.value, 2), 15, '#dce8f8', 'end'); });
		if (artifact.bars.length > visible.length) body += text(60, 710, `${visible.length} of ${artifact.bars.length} categories · full data in CSV`, 13, '#9ca7b6');
	} else if (artifact.type === 'table' && buildEntityComparison(artifact)) {
		const comparison = buildEntityComparison(artifact)!;
		body += text(60, 194, comparison.subjects[0].name, 22) + text(1140, 194, comparison.subjects[1].name, 22, '#dadde4', 'end');
		const visible = comparison.metrics.slice(0, 7), spacing = Math.min(65, 440 / Math.max(1, visible.length));
		visible.forEach((metric, index) => { const yy = 274 + index * spacing, delta = comparisonDelta(metric); body += line(60, yy - 25, 1140, yy - 25) + text(70, yy + 8, formatTableCell(metric.cells[0].value, { row: metric.cells[0].row, column: metric.cells[0].column, display: comparison.display }), 29) + text(1130, yy + 8, formatTableCell(metric.cells[1].value, { row: metric.cells[1].row, column: metric.cells[1].column, display: comparison.display }), 29, '#dadde4', 'end') + text(600, yy - 4, `${metric.label}${metric.unit && metric.unit !== '%' ? ` · ${metric.unit}` : ''}`, 14, '#cbd3df', 'middle') + text(600, yy + 21, delta.text, 15, delta.tone === 'positive' ? '#6ee7b7' : delta.tone === 'negative' ? '#fda4af' : '#9ca7b6', 'middle'); });
		if (comparison.metrics.length > visible.length) body += text(60, 710, `${visible.length} of ${comparison.metrics.length} metrics · full data in CSV`, 13, '#9ca7b6');
	} else if (artifact.type === 'shot_chart') {
		body += `<g transform="translate(600 245) scale(.88)"><rect x="-250" y="-52.5" width="500" height="475" rx="5" fill="#ffffff03" stroke="#ffffff25"/><path d="M-80,-52.5 V137.5 H80 V-52.5 M-220,-52.5 V92.5 A237.5,237.5 0 0 0 220,92.5 V-52.5" fill="none" stroke="#ffffff35"/><circle r="7.5" fill="none" stroke="#ffffff60"/>${artifact.shots.filter(shot => Number.isFinite(shot.locX) && Number.isFinite(shot.locY)).map(shot => `<circle cx="${shot.locX}" cy="${shot.locY}" r="3" fill="${shot.made ? '#5799e6' : '#e58484'}" opacity=".65"/>`).join('')}</g>`;
		const makes = artifact.shots.filter(shot => shot.made).length;
		body += text(60, 208, `${makes}/${artifact.shots.length} FG${artifact.shots.length ? ` · ${(makes / artifact.shots.length * 100).toFixed(1)}%` : ''}`, 18, '#bac5d4') + text(60, 704, 'Blue: makes · Rose: misses', 14, '#9ca7b6');
	} else {
		const data = tabular(artifact, context.view), columns = Math.min(data.columns.length, 6), rows = data.rows.slice(0, 14), cellWidth = 1080 / Math.max(1, columns);
		data.columns.slice(0, columns).forEach((column, index) => body += text(60 + index * cellWidth, 208, shorten(column, 24), 12, '#9ca7b6'));
		rows.forEach((row, index) => { const yy = 246 + index * 31; body += line(60, yy - 20, 1140, yy - 20); row.slice(0, columns).forEach((value, column) => body += text(60 + column * cellWidth, yy, shorten(typeof value === 'number' ? compact(value, 2) : String(value ?? 'N/A'), 24), 13)); });
		body += text(60, 710, `${rows.length} of ${data.rows.length} rows shown · full precision and all fields in CSV`, 13, '#9ca7b6');
	}
	const scope = artifact.type === 'scatter_chart' ? `${artifact.scope.season} · ${artifact.scope.seasonType}${artifact.scope.dateFrom || artifact.scope.dateTo ? ` · ${artifact.scope.dateFrom || 'Season start'} to ${artifact.scope.dateTo || 'Season end'}` : ''}` : scopeLabel(context.scope);
	const source = context.citations?.map(citation => citation.source).join(' · ') || ('source' in artifact && artifact.source ? artifact.source.endpointId : 'Saved research');
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="1200" height="800" fill="#151719"/><g font-family="Geist,sans-serif">${text(60, 56, 'HOOP HUB', 15, '#8cb8eb')}${text(60, 105, shorten(title(artifact), 70), 30, '#f0f2f5')}${text(60, 138, scope, 15, '#9ca7b6')}${body}${line(60, 744, 1140, 744)}${text(60, 773, shorten(`Source: ${source}`, 110), 12, '#9ca7b6')}${text(1140, 773, context.savedAt ? context.savedAt.slice(0, 10) : 'Research snapshot', 12, '#9ca7b6', 'end')}</g></svg>`;
}

export function downloadArtifactCsv(artifact: QueryAnswerArtifact, context: ArtifactExportContext = {}): void { download(new Blob([artifactCsv(artifact, context)], { type: 'text/csv;charset=utf-8' }), `${exportName(artifact)}.csv`); }

export async function downloadArtifactPng(artifact: QueryAnswerArtifact, context: ArtifactExportContext = {}): Promise<void> {
	await document.fonts.ready;
	const font = await exportFont();
	const images = artifact.type === 'scatter_chart' ? await exportEntityImages(scatterExportMarkers(artifact, context.view)) : new Map<string, string>();
	const markup = artifactSvg(artifact, context, images).replace('<g font-family=', `${font}<g font-family=`);
	const svg = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
	const url = URL.createObjectURL(svg), image = new Image();
	try {
		await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('The image could not be prepared. Please retry.')); image.src = url; });
		const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1600;
		const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image export is unavailable in this browser.');
		ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('The image could not be created.')), 'image/png'));
		download(blob, `${exportName(artifact)}.png`);
	} finally { URL.revokeObjectURL(url); }
}

/* Browser download helpers */

/** Rasterized, bounded CDN media keeps exported SVG self-contained and falls back to identity initials when CORS or images fail. */
async function exportEntityImages(markers: readonly EntityPlotMarker[]): Promise<Map<string, string>> {
	const images = new Map<string, string>(), controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 6000);
	let next = 0;
	async function worker() {
		while (next < markers.length && !controller.signal.aborted) {
			const marker = markers[next++]; let url: string | undefined;
			try {
				const response = await fetch(`/api/entity-media/${marker.entity.kind}/${marker.entity.id}`, { signal: controller.signal, credentials: 'same-origin' });
				if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) continue;
				const blob = await response.blob(); if (blob.size > 1_048_576) continue;
				url = URL.createObjectURL(blob); const source = new Image(); source.src = url; await source.decode();
				if (controller.signal.aborted) continue;
				const canvas = document.createElement('canvas'); canvas.width = canvas.height = 72;
				const context = canvas.getContext('2d'); if (!context || !source.naturalWidth || !source.naturalHeight) continue;
				const scale = (marker.entity.kind === 'team' ? Math.min : Math.max)(72 / source.naturalWidth, 72 / source.naturalHeight), width = source.naturalWidth * scale, height = source.naturalHeight * scale;
				context.drawImage(source, (72 - width) / 2, marker.entity.kind === 'team' ? (72 - height) / 2 : 0, width, height);
				images.set(marker.id, canvas.toDataURL('image/png'));
			} catch { /* Optional decoration must never prevent exporting the source data. */ }
			finally { if (url) URL.revokeObjectURL(url); }
		}
	}
	try { await Promise.all(Array.from({ length: Math.min(4, markers.length) }, worker)); }
	finally { clearTimeout(deadline); }
	return images;
}

let exportFontPromise: Promise<string> | undefined;
function exportFont(): Promise<string> {
	return exportFontPromise ??= (async () => {
		try { const { default: fontUrl } = await import('@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url'); const response = await fetch(fontUrl); if (!response.ok) return ''; const bytes = new Uint8Array(await response.arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return `<style>@font-face{font-family:Geist;src:url(data:font/woff2;base64,${btoa(binary)}) format('woff2');font-weight:100 900;}</style>`; }
		catch { return ''; }
	})();
}

function exportName(artifact: QueryAnswerArtifact): string { return `hoop-hub-${title(artifact).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'finding'}`; }
export function download(blob: Blob, name: string): void { const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

/* End browser download helpers */

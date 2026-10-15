import type { QueryAnswerArtifact } from '$lib/contracts/answer-response';
import type { StatsQueryRow } from '$lib/contracts/semantic-query';
import type { TableColumnDisplay, TableDisplay } from '$lib/contracts/table-display';

export type TableArtifact = Extract<QueryAnswerArtifact, { type: 'table' }>;
export type TableDisplayIntent = { question?: string; metrics?: readonly string[]; perMode?: string; entity?: 'player' | 'team' };
type Metric = { key?: string; aliases: string[]; label: string; unit: string; direction?: 'higher' | 'lower'; support?: string[]; cue: RegExp };

const METRICS: Metric[] = [
	{ aliases: ['pts', 'points', 'points_per_game', 'ppg'], label: 'Points', unit: 'points', direction: 'higher', support: ['fga', 'fta'], cue: /\b(?:points?|scoring|ppg)\b/i },
	{ aliases: ['reb', 'rebounds', 'rebounds_per_game', 'rpg'], label: 'Rebounds', unit: 'rebounds', direction: 'higher', support: ['oreb', 'dreb'], cue: /\b(?:rebounds?|rebounding|rpg)\b/i },
	{ aliases: ['ast', 'assists', 'assists_per_game', 'apg'], label: 'Assists', unit: 'assists', direction: 'higher', cue: /\b(?:assists?|apg)\b/i },
	{ aliases: ['tov', 'to', 'turnovers', 'turnovers_per_game'], label: 'Turnovers', unit: 'turnovers', direction: 'lower', cue: /\b(?:turnovers?|tov)\b/i },
	{ aliases: ['stl', 'steals', 'steals_per_game'], label: 'Steals', unit: 'steals', direction: 'higher', cue: /\bsteals?\b/i },
	{ aliases: ['blk', 'blocks', 'blocks_per_game'], label: 'Blocks', unit: 'blocks', direction: 'higher', cue: /\bblocks?\b/i },
	{ aliases: ['fg3pct', 'fg3_pct', 'three_point_percentage', '3p_pct'], label: '3P%', unit: '%', direction: 'higher', support: ['fg3m', 'fg3a'], cue: /\b(?:three[- ]point|3[- ]point|3p|3pt)\s*(?:percentage|percent|%)|\bthree[- ]point shooting\b/i },
	{ aliases: ['fgpct', 'fg_pct', 'field_goal_percentage'], label: 'FG%', unit: '%', direction: 'higher', support: ['fgm', 'fga'], cue: /\bfg\s*%|\b(?:field[- ]goal percentage|shooting percentage)\b/i },
	{ aliases: ['ts_pct', 'tsPct', 'true_shooting_percentage'], label: 'TS%', unit: '%', direction: 'higher', support: ['pts', 'fga', 'fta'], cue: /\btrue shooting\b|\bts\s*%/i },
	{ aliases: ['efg_pct', 'efgPct', 'effective_field_goal_percentage'], label: 'eFG%', unit: '%', direction: 'higher', support: ['fgm', 'fg3m', 'fga'], cue: /\beffective field[- ]goal\b|\befg\s*%/i },
	{ aliases: ['ftpct', 'ft_pct', 'free_throw_percentage'], label: 'FT%', unit: '%', direction: 'higher', support: ['ftm', 'fta'], cue: /\b(?:free[- ]throw|ft)\s*(?:percentage|percent|%)/i },
	{ key: 'fgpct', aliases: ['fgpercent', 'fg_percentage'], label: 'FG%', unit: '%', direction: 'higher', support: ['makes', 'attempts'], cue: /\bfg\s*%/i },
	{ aliases: ['fgm', 'field_goals_made', 'makes'], label: 'FGM', unit: 'makes', cue: /\bfield[- ]goals? made\b/i },
	{ aliases: ['fga', 'field_goal_attempts', 'attempts'], label: 'FGA', unit: 'attempts', cue: /\b(?:field[- ]goal attempts?|fga)\b/i },
	{ aliases: ['fg3m', 'three_pointers_made', '3pm'], label: '3PM', unit: 'makes', cue: /\b(?:made threes|three[- ]pointers? made|3pm)\b/i },
	{ aliases: ['fg3a', 'three_point_attempts', '3pa'], label: '3PA', unit: 'attempts', cue: /\b(?:three[- ]point attempts?|3pa)\b/i },
	{ aliases: ['ftm'], label: 'FTM', unit: 'makes', cue: /\bftm\b/i },
	{ aliases: ['fta'], label: 'FTA', unit: 'attempts', cue: /\bfta\b/i },
	{ aliases: ['min', 'minutes'], label: 'Minutes', unit: 'minutes', cue: /\bminutes?\b/i },
	{ aliases: ['oreb'], label: 'OREB', unit: 'rebounds', direction: 'higher', cue: /\boffensive rebounds?\b/i },
	{ aliases: ['dreb'], label: 'DREB', unit: 'rebounds', direction: 'higher', cue: /\bdefensive rebounds?\b/i },
	{ aliases: ['offensiveRating', 'off_rating', 'ortg'], label: 'Off. rating', unit: 'points / 100 possessions', direction: 'higher', cue: /\boffensive (?:rating|efficiency)\b|\bortg\b/i },
	{ aliases: ['defensiveRating', 'def_rating', 'drtg'], label: 'Def. rating', unit: 'points / 100 possessions', direction: 'lower', cue: /\bdefensive (?:rating|efficiency)\b|\bdrtg\b/i },
	{ aliases: ['netRating', 'net_rating'], label: 'Net rating', unit: 'points / 100 possessions', direction: 'higher', cue: /\bnet rating\b/i },
	{ aliases: ['partialPossessions'], label: 'Matchup poss.', unit: 'partial possessions', cue: /\bmatchup possessions?\b/i },
	{ aliases: ['possessions'], label: 'Possessions', unit: 'possessions', cue: /\bpossessions?\b/i },
	{ aliases: ['wins', 'w'], label: 'Wins', unit: 'games', direction: 'higher', cue: /\bwins?\b/i },
	{ aliases: ['losses', 'l'], label: 'Losses', unit: 'games', direction: 'lower', cue: /\blosses\b/i },
	{ aliases: ['win_pct', 'wpct'], label: 'Win%', unit: '%', direction: 'higher', cue: /\bwin(?:ning)? percentage\b/i }
];

const METRIC_BY_KEY = new Map(METRICS.flatMap(metric => metric.aliases.map(alias => [columnKey(alias), metric] as const)));
const IDENTITY = ['subject', 'lineup', 'offensiveplayer', 'player', 'playername', 'team', 'teamname', 'name', 'metric', 'split', 'result', 'outcome', 'gamedate', 'date', 'start'];
const SAMPLES = new Set(['gp', 'games', 'samplesize', 'count', 'earliergames', 'recentgames', 'minuteson', 'minutesoff', 'offensivepossessions', 'defensivepossessions']);
const CONTEXT = new Set(['season', 'seasonid', 'seasontype', 'scope', 'unit', 'permode', 'defensiveplayer', 'teamid']);
const LABELS: Record<string, string> = { subject: 'Subject', playername: 'Player', teamname: 'Team', offensiveplayer: 'Offense', defensiveplayer: 'Defense', gp: 'Games', rank: 'Rank', games: 'Games', gamedate: 'Game date', gameid: 'Game ID', gameeventid: 'Event ID', seasontype: 'Season type', samplesize: 'Sample', matchupminutes: 'Matchup min.', earlieraverage: 'Earlier', recentaverage: 'Recent', change: 'Δ', difference: 'Δ', value: 'Value', average: 'Average', wl: 'Result' };

/* Metric and source presentation helpers */

export function columnKey(column: string): string { return column.replace(/[^a-z0-9]/gi, '').toLowerCase(); }
function metricFor(column: string): Metric | undefined {
	const key = columnKey(column.replace(/^(?:avg|sum|min|max):/i, ''));
	return METRIC_BY_KEY.get(key) ?? (key.endsWith('pergame') ? METRIC_BY_KEY.get(key.slice(0, -7)) : undefined);
}
export function metricKey(column: string): string {
	const name = column.replace(/^(?:avg|sum|min|max):/i, '');
	const metric = metricFor(name);
	return columnKey(metric?.key ?? metric?.aliases[0] ?? name);
}
export function metricSupport(column: string): readonly string[] { return metricFor(column)?.support ?? []; }
function readableLabel(column: string): string { return LABELS[columnKey(column)] ?? column.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase()); }
function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function modeUnit(unit: string, perMode?: string): string { return unit === '%' || unit === 'games' || unit.includes(' / ') ? unit : perMode === 'PerGame' ? `${unit} / game` : perMode === 'Per100Possessions' ? `${unit} / 100 poss.` : unit; }

/** Unknown numeric fields keep their original scale; only explicit metric contracts establish percentage units. */
export function columnDisplay(column: string, perMode?: string): TableColumnDisplay {
	const aggregate = /^(avg|sum|min|max):(.+)$/i.exec(column);
	if (aggregate) {
		if (columnKey(aggregate[2]) === 'shotmadeflag' && aggregate[1].toLowerCase() === 'sum') return { label: 'FGM', unit: 'makes', precision: 0, role: 'metric' };
		const base = columnDisplay(aggregate[2], perMode);
		const label = { avg: 'Avg.', sum: 'Sum', min: 'Min.', max: 'Max.' }[aggregate[1].toLowerCase()];
		return { ...base, label: `${label} ${base.label}`, ...(aggregate[1].toLowerCase() === 'avg' ? { precision: 1 } : {}) };
	}
	const key = columnKey(column);
	const metric = metricFor(column);
	if (metric) {
		const explicitPerGame = /pergame$|^[pars]pg$/.test(key);
		const percentScale = ['fgpercent', 'fgpercentage'].includes(key) ? 1 : 100;
		return { label: metric.label, unit: modeUnit(metric.unit, explicitPerGame ? 'PerGame' : perMode), scale: metric.unit === '%' ? percentScale : 1, precision: metric.unit === '%' || perMode === 'PerGame' || explicitPerGame || metric.unit.includes(' / ') ? 1 : 2, preferredDirection: metric.direction, role: 'metric' };
	}
	const role = IDENTITY.includes(key) ? 'identity' : SAMPLES.has(key) ? 'sample' : CONTEXT.has(key) ? 'context' : /id$|rank$/.test(key) ? 'detail' : 'metric';
	return { label: readableLabel(column), role, ...(SAMPLES.has(key) || key === 'rank' ? { precision: 0 } : {}) };
}

/** Long-form rows carry the metric and unit alongside their value instead of in a wide column name. */
export function displayForCell(column: string, row: StatsQueryRow, display?: TableDisplay): TableColumnDisplay {
	const base = display?.columns[column] ?? columnDisplay(column, display?.perMode);
	if (!['value', 'average', 'earlieraverage', 'recentaverage', 'change', 'difference', 'on', 'off'].includes(columnKey(column))) return base;
	const metric = typeof row.metric === 'string' ? columnDisplay(row.metric, display?.perMode) : null;
	const explicitUnit = typeof row.unit === 'string' && row.unit.trim() ? row.unit.trim() : undefined;
	return { ...base, ...(metric?.unit ? { unit: metric.unit, scale: metric.scale, precision: metric.precision, preferredDirection: metric.preferredDirection } : {}), ...(explicitUnit ? { unit: explicitUnit, scale: 1, precision: 1 } : {}) };
}

function readIntent(artifact: TableArtifact, intent: TableDisplayIntent): TableDisplayIntent {
	const request = artifact.source?.request;
	const params = record(request?.params) ? request.params : {};
	const order = record(request?.orderBy) ? request.orderBy : {};
	return { ...intent, metrics: intent.metrics?.length ? intent.metrics : typeof order.column === 'string' ? [order.column] : undefined, perMode: intent.perMode ?? (typeof params.PerMode === 'string' ? params.PerMode : undefined) };
}

function requestedColumns(columns: readonly string[], question: string): string[] {
	const requested = METRICS.flatMap(metric => { const match = metric.cue.exec(question); return match ? [{ metric, index: match.index }] : []; }).sort((a, b) => a.index - b.index);
	return [...new Set(requested.flatMap(({ metric }) => columns.filter(column => metricKey(column) === metricKey(metric.aliases[0]))))];
}

/* End metric and source presentation helpers */

/** Order fields by the verified operation and requested metrics, preserving every extra field for inspection. */
export function buildTableDisplay(artifact: TableArtifact, intent: TableDisplayIntent = {}): TableDisplay {
	const context = readIntent(artifact, intent);
	const definitions = Object.fromEntries(artifact.columns.map(column => [column, columnDisplay(column, context.perMode)]));
	if (context.entity) {
		for (const column of artifact.columns.filter(column => columnKey(column) === 'subject')) definitions[column].label = context.entity === 'team' ? 'Team' : 'Player';
	}
	if (artifact.rows.length && typeof artifact.rows[0].metric === 'string' && artifact.rows.every(row => row.metric === artifact.rows[0].metric && row.unit === artifact.rows[0].unit)) {
		for (const column of artifact.columns.filter(column => ['value', 'average', 'earlieraverage', 'recentaverage', 'change', 'difference'].includes(columnKey(column)))) {
			const cell = displayForCell(column, artifact.rows[0], { title: '', primaryColumns: [], metricColumns: [], columns: definitions, perMode: context.perMode });
			definitions[column] = { ...cell, label: columnKey(column) === 'value' ? columnDisplay(String(artifact.rows[0].metric), context.perMode).label : cell.label };
		}
	}
	const find = (keys: readonly string[]) => keys.flatMap(key => artifact.columns.filter(column => metricKey(column) === metricKey(key)));
	const identities = find(IDENTITY).filter(column => definitions[column].role === 'identity');
	const isGame = artifact.columns.some(column => ['gameid', 'gamedate', 'gameeventid'].includes(columnKey(column)));
	const identity = isGame ? find(['gamedate', 'date', 'matchup', 'playername', 'subject'])[0] ?? identities[0] : identities[0];
	const requested = context.metrics?.length ? context.metrics.flatMap(metric => artifact.columns.filter(column => metricKey(column) === metricKey(metric))) : requestedColumns(artifact.columns, context.question ?? '');
	const metricColumns = artifact.columns.filter(column => definitions[column].role === 'metric' && artifact.rows.some(row => isFiniteNumber(row[column])));
	const orderedMetrics = [...new Set([...requested, ...metricColumns])];
	const support = requested.flatMap(column => find(metricSupport(column)));
	const profile = artifact.columns.some(column => columnKey(column) === 'offensiveplayer') ? find(['fgpct', 'fgm', 'fga', 'fg3pct', 'fg3m', 'fg3a', 'partialpossessions', 'games'])
		: isGame ? find(['matchup', 'wl', 'status', 'points', 'pts', 'ast', 'reb'])
		: find(['value', 'on', 'off', 'difference', 'recentaverage', 'earlieraverage', 'change', 'pts', 'ast', 'reb', 'fgpct', 'fga', 'games']);
	const leading = [...new Set([...(artifact.shape === 'ranking' ? find(['rank']) : []), ...(identity ? [identity] : []), ...find(['metric']), ...requested, ...support])];
	const samples = find(['gp', 'games', 'samplesize', 'partialpossessions']);
	const primaryColumns = requested.length ? [...new Set([...leading, ...samples])]
		: [...new Set([...leading, ...profile, ...orderedMetrics, ...samples, ...artifact.columns.filter(column => definitions[column].role !== 'detail' && definitions[column].role !== 'context')])].slice(0, 6);
	const supportingCounts = new Set(['fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta', 'oreb', 'dreb']);
	const mainMetrics = orderedMetrics.filter(column => !supportingCounts.has(columnKey(column)));
	const metricOrder = [...new Set(requested.length ? requested : [...mainMetrics, ...(mainMetrics.length ? [] : orderedMetrics)])];
	return { title: artifact.shape === 'ranking' ? (find(['offensiveplayer']).length ? 'Matchup rankings' : 'Rankings') : find(['offensiveplayer']).length ? 'Player matchup' : artifact.shape === 'comparison' ? 'Comparison' : isGame ? 'Game results' : 'Results', primaryColumns, metricColumns: metricOrder, columns: definitions, ...(context.perMode ? { perMode: context.perMode } : {}) };
}

export function presentTable(artifact: TableArtifact, intent: TableDisplayIntent = {}): TableArtifact {
	return { ...artifact, display: buildTableDisplay(artifact, intent) };
}

export function presentTables(artifacts: QueryAnswerArtifact[], question: string): QueryAnswerArtifact[] {
	return artifacts.map(artifact => artifact.type === 'table' ? artifact.display ? artifact : presentTable(artifact, { question }) : artifact);
}

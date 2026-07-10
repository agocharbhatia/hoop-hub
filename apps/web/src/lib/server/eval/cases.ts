import type { EvalCase } from './types';

const SHOT_CHART_PARAMS = {
	PlayerID: '1630567',
	Season: '2025-26',
	SeasonType: 'Regular Season'
};

export const DYNAMIC_AGENT_EVAL_CASES: EvalCase[] = [
	{
		id: 'scottie-pullup-midrange-fg-pct',
		tags: ['grounding', 'shot-chart', 'aggregation', 'hygiene'],
		prompts: [
			'What is Scottie Barnes’ pull-up mid-range field-goal percentage this season? Show a shot chart.',
			'Scottie Barnes pull-up mid-range FG% in 2025-26, with the matching shot chart.'
		],
		repetitions: { local: 1, live: 3 },
		expectedStatus: 'ok',
		requiredTools: ['resolve_players', 'aggregate_endpoint_rows'],
		forbiddenTools: ['find_video_clips', 'analyze_time_series'],
		artifactExpectations: [{ type: 'shot_chart', count: 1, minItems: 73, maxItems: 73 }],
		warningExpectations: { maxCount: 0 },
		assertions: [
			{
				kind: 'value',
				label: 'full filtered attempt count',
				source: { type: 'tool_result', toolName: 'aggregate_endpoint_rows' },
				path: 'data.matchedRows',
				operator: 'equals',
				expected: 73
			},
			{
				kind: 'value',
				label: 'full filtered make count',
				source: { type: 'tool_result', toolName: 'aggregate_endpoint_rows' },
				path: 'data.groups.0.aggregates.sum:SHOT_MADE_FLAG',
				operator: 'equals',
				expected: 29
			},
			{ kind: 'answer_includes', values: ['29', '73'] },
			{ kind: 'shot_chart_matches_aggregate', toolName: 'aggregate_endpoint_rows' }
		],
		limits: { maxToolCalls: 5, maxLatencyMs: 90_000 },
		local: {
			fixtureId: 'scottie_pullup_midrange',
			turns: [
				{
					kind: 'tools',
					calls: [{ name: 'resolve_players', arguments: { names: ['Scottie Barnes'] } }]
				},
				{
					kind: 'tools',
					calls: [
						{
							name: 'aggregate_endpoint_rows',
							arguments: {
								endpointId: 'shotchartdetail',
								params: SHOT_CHART_PARAMS,
								resultSetName: 'Shot Chart Detail',
								filters: [
									{ column: 'SHOT_ZONE_BASIC', op: 'eq', value: 'Mid-Range' },
									{ column: 'ACTION_TYPE', op: 'contains', value: 'pull' }
								],
								selectColumns: ['LOC_X', 'LOC_Y', 'SHOT_MADE_FLAG', 'SHOT_TYPE', 'ACTION_TYPE'],
								rowLimit: 500,
								aggregations: [{ op: 'count' }, { op: 'sum', column: 'SHOT_MADE_FLAG' }]
							}
						}
					]
				},
				{ kind: 'stop' }
			],
			finalOutput: {
				answer: 'Scottie Barnes made 29 of 73 pull-up mid-range attempts (39.7%) in the 2025-26 regular season.',
				artifacts: [
					{
						type: 'shot_chart',
						title: 'Scottie Barnes pull-up mid-range attempts',
						shots: [{ locX: 0, locY: 0, made: false, value: 2, label: 'reconciled by server' }]
					}
				],
				warnings: []
			}
		}
	},
	{
		id: 'jokic-latest-ten-rebound-trend',
		tags: ['grounding', 'trend', 'line-chart', 'chronology', 'hygiene'],
		prompts: [
			'Are Nikola Jokić’s rebounds trending up or down over his latest ten games? Show the series.',
			'Jokic rebound trend over the last 10 games, with earlier and recent five-game averages.'
		],
		repetitions: { local: 1, live: 3 },
		expectedStatus: 'ok',
		requiredTools: ['resolve_players', 'analyze_time_series'],
		forbiddenTools: ['find_video_clips', 'aggregate_endpoint_rows'],
		artifactExpectations: [{ type: 'line_chart', count: 1, minItems: 10, maxItems: 10 }],
		warningExpectations: { maxCount: 0 },
		assertions: [
			{
				kind: 'value',
				label: 'chronological ordering',
				source: { type: 'tool_result', toolName: 'analyze_time_series' },
				path: 'data.ordering',
				operator: 'equals',
				expected: 'oldest_to_newest'
			},
			{
				kind: 'value',
				label: 'earlier window average',
				source: { type: 'tool_result', toolName: 'analyze_time_series' },
				path: 'data.earlierWindow.average',
				operator: 'equals',
				expected: 16.4
			},
			{
				kind: 'value',
				label: 'recent window average',
				source: { type: 'tool_result', toolName: 'analyze_time_series' },
				path: 'data.recentWindow.average',
				operator: 'equals',
				expected: 12.6
			},
			{
				kind: 'value',
				label: 'computed trend direction',
				source: { type: 'tool_result', toolName: 'analyze_time_series' },
				path: 'data.direction',
				operator: 'equals',
				expected: 'down'
			},
			{ kind: 'answer_includes', values: ['16.4', '12.6', 'down'] },
			{ kind: 'time_series_dates_ascending', toolName: 'analyze_time_series' },
			{ kind: 'time_series_direction_matches_windows', toolName: 'analyze_time_series' },
			{ kind: 'line_chart_matches_time_series', toolName: 'analyze_time_series' }
		],
		limits: { maxToolCalls: 5, maxLatencyMs: 90_000 },
		local: {
			fixtureId: 'jokic_rebound_trend',
			turns: [
				{
					kind: 'tools',
					calls: [{ name: 'resolve_players', arguments: { names: ['Nikola Jokic'] } }]
				},
				{
					kind: 'tools',
					calls: [
						{
							name: 'analyze_time_series',
							arguments: {
								endpointId: 'playergamelogs',
								params: { PlayerID: '203999', Season: '2025-26', SeasonType: 'Regular Season' },
								resultSetName: 'PlayerGameLogs',
								dateColumn: 'GAME_DATE',
								valueColumn: 'REB',
								labelColumns: ['MATCHUP'],
								lastN: 10
							}
						}
					]
				},
				{ kind: 'stop' }
			],
			finalOutput: {
				answer: 'The earlier five-game average was 16.4 rebounds and the recent five-game average was 12.6, so the trend is down.',
				artifacts: [
					{
						type: 'line_chart',
						title: 'Nikola Jokić rebounds — latest 10',
						xLabel: 'Game date',
						yLabel: 'Rebounds',
						series: [{ name: 'REB', points: [{ x: 'wrong-order', y: 999 }] }]
					}
				],
				warnings: []
			}
		}
	},
	{
		id: 'top-five-assists',
		tags: ['ranking', 'bar-chart', 'truncation', 'hygiene'],
		prompts: [
			'Who are the top five NBA players in assists per game this season? Show a bar chart.',
			'Top 5 assists-per-game leaders for 2025-26, with a chart.'
		],
		repetitions: { local: 1, live: 3 },
		expectedStatus: 'ok',
		requiredTools: ['call_nba_stats_endpoint'],
		forbiddenTools: ['find_video_clips', 'analyze_time_series'],
		artifactExpectations: [{ type: 'bar_chart', count: 1, minItems: 5, maxItems: 5 }],
		warningExpectations: { maxCount: 0, forbiddenMessagePatterns: ['truncat', 'row cap', '150 rows'] },
		assertions: [
			{
				kind: 'value',
				label: 'fixture proves a larger source result was capped',
				source: { type: 'tool_result', toolName: 'call_nba_stats_endpoint' },
				path: 'data.resultSets.0.truncated',
				operator: 'equals',
				expected: true
			},
			{
				kind: 'bar_chart_grounded_in_rows',
				toolName: 'call_nba_stats_endpoint',
				labelColumn: 'PLAYER',
				valueColumn: 'AST'
			}
		],
		limits: { maxToolCalls: 3, maxLatencyMs: 90_000 },
		local: {
			fixtureId: 'top_five_assists',
			turns: [
				{
					kind: 'tools',
					calls: [
						{
							name: 'call_nba_stats_endpoint',
							arguments: {
								endpointId: 'leaguedashplayerstats',
								params: { Season: '2025-26', SeasonType: 'Regular Season', PerMode: 'PerGame' }
							}
						}
					]
				},
				{ kind: 'stop' }
			],
			finalOutput: {
				answer: 'The top five are Tyrese Haliburton (11.2), Trae Young (11.0), Nikola Jokić (10.2), Luka Dončić (9.8), and James Harden (9.1) assists per game.',
				artifacts: [
					{
						type: 'bar_chart',
						title: '2025-26 assists per game leaders',
						xLabel: 'Player',
						yLabel: 'Assists per game',
						bars: [
							{ label: 'Tyrese Haliburton', value: 11.2 },
							{ label: 'Trae Young', value: 11 },
							{ label: 'Nikola Jokić', value: 10.2 },
							{ label: 'Luka Dončić', value: 9.8 },
							{ label: 'James Harden', value: 9.1 }
						]
					}
				],
				warnings: []
			}
		}
	},
	{
		id: 'scottie-made-threes-vs-boston',
		tags: ['clips', 'made-three', 'semantic-intent', 'nondeterministic', 'hygiene'],
		prompts: [
			'Show me Scottie Barnes made threes against Boston this season.',
			'Find clips of Scottie Barnes 3-pointers versus the Celtics in 2025-26.'
		],
		repetitions: { local: 2, live: 20 },
		expectedStatus: 'ok',
		requiredTools: ['resolve_players', 'resolve_teams', 'find_video_clips'],
		forbiddenTools: ['analyze_time_series', 'aggregate_endpoint_rows'],
		artifactExpectations: [{ type: 'video_playlist', count: 1, minItems: 1 }],
		warningExpectations: { maxCount: 0 },
		assertions: [
			{
				kind: 'value',
				label: 'semantic clip intent',
				source: { type: 'tool_request', toolName: 'find_video_clips' },
				path: 'eventType',
				operator: 'equals',
				expected: 'made_three'
			},
			{
				kind: 'value',
				label: 'canonical NBA context measure',
				source: { type: 'endpoint_request', endpointId: 'videodetailsasset' },
				path: 'params.ContextMeasure',
				operator: 'equals',
				expected: 'FG3M'
			},
			{ kind: 'playlist_descriptions_match', pattern: '\\b3PT\\b' }
		],
		limits: { maxToolCalls: 6, maxLatencyMs: 90_000 },
		local: {
			fixtureId: 'scottie_made_threes_boston',
			turns: [
				{
					kind: 'tools',
					calls: [{ name: 'resolve_players', arguments: { names: ['Scottie Barnes'] } }]
				},
				{
					kind: 'tools',
					calls: [{ name: 'resolve_teams', arguments: { names: ['Boston Celtics'] } }]
				},
				{
					kind: 'tools',
					calls: [
						{
							name: 'find_video_clips',
							arguments: {
								playerId: '1630567',
								eventType: 'made_three',
								season: '2025-26',
								seasonType: 'Regular Season',
								opponentTeamId: '1610612738'
							}
						}
					]
				},
				{ kind: 'stop' }
			],
			finalOutput: {
				answer: 'Found two Scottie Barnes made threes against Boston in the 2025-26 regular season.',
				artifacts: [
					{
						type: 'video_playlist',
						title: 'Scottie Barnes made threes vs. Boston',
						clips: [
							{
								url: 'https://videos.nba.com/eval-three-1.mp4',
								description: "Barnes 26' 3PT Running Jump Shot",
								thumbnailUrl: null,
								gameDate: '2026-01-08',
								gameId: 'eval-2'
							},
							{
								url: 'https://videos.nba.com/eval-three-2.mp4',
								description: "Barnes 24' 3PT Pullup Jump Shot",
								thumbnailUrl: null,
								gameDate: '2026-02-02',
								gameId: 'eval-3'
							}
						]
					}
				],
				warnings: []
			}
		}
	},
	{
		id: 'named-defender-no-team-fallback',
		tags: ['clips', 'named-defender', 'capability', 'safety', 'hygiene'],
		prompts: [
			'Show me Scottie Barnes made shots against Bam Adebayo.',
			'Find clips where Scottie Barnes scores with Bam Adebayo as the defender.'
		],
		repetitions: { local: 2, live: 5 },
		expectedStatus: 'coverage_gap',
		requiredTools: ['resolve_players', 'find_video_clips'],
		forbiddenTools: ['analyze_time_series', 'aggregate_endpoint_rows'],
		artifactExpectations: [{ type: 'video_playlist', count: 0 }],
		warningExpectations: {
			requiredCodes: ['dynamic_agent_capability_limit'],
			maxCount: 1
		},
		assertions: [
			{ kind: 'no_endpoint_calls' },
			{
				kind: 'value',
				label: 'named-defender guard rejects the clip request',
				source: { type: 'tool_result', toolName: 'find_video_clips' },
				path: 'ok',
				operator: 'equals',
				expected: false
			},
			{
				kind: 'value',
				label: 'guard names the requested defender',
				source: { type: 'tool_result', toolName: 'find_video_clips' },
				path: 'error',
				operator: 'includes',
				expected: 'Bam Adebayo'
			},
			{ kind: 'answer_includes', values: ['Bam Adebayo', 'team'] }
		],
		limits: { maxToolCalls: 5, maxLatencyMs: 90_000 },
		local: {
			fixtureId: 'named_defender',
			turns: [
				{
					kind: 'tools',
					calls: [{ name: 'resolve_players', arguments: { names: ['Scottie Barnes', 'Bam Adebayo'] } }]
				},
				{
					kind: 'tools',
					calls: [
						{
							name: 'find_video_clips',
							arguments: {
								playerId: '1630567',
								eventType: 'made_field_goal',
								season: '2025-26',
								seasonType: 'Regular Season',
								opponentTeamId: '1610612748'
							}
						}
					]
				},
				{ kind: 'stop' }
			],
			finalOutput: {
				answer:
					'The available clip feed cannot identify Bam Adebayo as the named defender. I can search Miami team-level clips only if you approve that broader scope.',
				artifacts: [],
				warnings: [
					{
						kind: 'capability_limit',
						message: 'Named-defender clip filtering is unavailable; team-level clips require explicit approval.'
					}
				]
			}
		}
	}
];

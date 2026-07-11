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
		id: 'semantic-player-season-lookup',
		tags: ['semantic', 'lookup', 'table', 'grounding', 'stored-data'],
		prompts: [
			'What is Scottie Barnes averaging this season? Show the grounded row.',
			'Scottie Barnes points per game for 2025-26 in a table.'
		],
		repetitions: { local: 1, live: 2 },
		expectedStatus: 'ok',
		requiredTools: ['execute_semantic_query'],
		forbiddenTools: ['call_nba_stats_endpoint', 'aggregate_endpoint_rows', 'find_video_clips'],
		artifactExpectations: [{ type: 'table', count: 1, minItems: 1, maxItems: 1 }],
		warningExpectations: { maxCount: 0 },
		assertions: [
			{ kind: 'no_endpoint_calls' },
			{
				kind: 'value', label: 'typed semantic operation',
				source: { type: 'tool_request', toolName: 'execute_semantic_query' },
				path: 'query.operation', operator: 'equals', expected: 'lookup'
			},
			{
				kind: 'value', label: 'grounded semantic result',
				source: { type: 'tool_result', toolName: 'execute_semantic_query' },
				path: 'data.result.rows.0.pts', operator: 'equals', expected: 20.1
			},
			{
				kind: 'value', label: 'server-reconciled table value',
				source: { type: 'artifact', artifactType: 'table' },
				path: 'rows.0.pts', operator: 'equals', expected: 20.1
			},
			{ kind: 'answer_includes', values: ['20.1'] }
		],
		limits: { maxToolCalls: 3, maxLatencyMs: 90_000 },
		local: {
			fixtureId: 'semantic_only',
			turns: [
				{
					kind: 'tools',
					calls: [{
						name: 'execute_semantic_query',
						arguments: {
							question: 'What is Scottie Barnes averaging this season?',
							query: {
								operation: 'lookup', entity: 'player',
								subject: { names: ['Scottie Barnes'] }, metrics: ['pts'],
								filters: { season: null, seasonType: 'Regular Season' }, outputMode: 'table'
							}
						}
					}]
				},
				{ kind: 'stop' }
			],
			finalOutput: {
				answer: 'Scottie Barnes averages 20.1 points per game in 2025-26.',
				artifacts: [{ type: 'table', shape: 'table', columns: ['wrong'], rows: [{ wrong: 999 }] }],
				warnings: []
			},
			semanticResponses: [
				{
					status: 'ok',
					result: {
						shape: 'table', columns: ['playerName', 'season', 'pts'],
						rows: [{ playerName: 'Scottie Barnes', season: '2025-26', pts: 20.1 }]
					},
					citations: [{ source: 'stats.nba.com', detail: 'Stored player season row.' }],
					provenance: {
						executor: 'semantic_executor',
						resolvedQuery: {
							operation: 'lookup', entity: 'player', subject: { names: ['Scottie Barnes'], ids: ['1630567'] },
							metrics: ['pts'], filters: { season: '2025-26', seasonType: 'Regular Season' }, outputMode: 'table'
						},
						dataFreshnessMode: 'nightly', sourceCalls: []
					},
					warnings: [], traceId: 'eval-semantic-lookup'
				}
			]
		}
	},
	{
		id: 'semantic-player-win-loss-split',
		tags: ['semantic', 'split', 'win-loss', 'table', 'grounding', 'stored-data'],
		prompts: [
			'How many points and rebounds does Nikola Jokic average in wins versus losses this season? Show a table.',
			'Split Jokic PTS and REB by wins and losses for 2025-26.'
		],
		repetitions: { local: 1, live: 2 },
		expectedStatus: 'ok',
		requiredTools: ['execute_semantic_query'],
		forbiddenTools: ['call_nba_stats_endpoint', 'aggregate_endpoint_rows', 'find_video_clips'],
		artifactExpectations: [{ type: 'table', count: 1, minItems: 2, maxItems: 2 }],
		warningExpectations: { maxCount: 0 },
		assertions: [
			{ kind: 'no_endpoint_calls' },
			{
				kind: 'value', label: 'typed split operation',
				source: { type: 'tool_request', toolName: 'execute_semantic_query' },
				path: 'query.operation', operator: 'equals', expected: 'split'
			},
			{
				kind: 'value', label: 'typed split dimension',
				source: { type: 'tool_request', toolName: 'execute_semantic_query' },
				path: 'query.filters.splitBy', operator: 'equals', expected: 'win_loss'
			},
			{
				kind: 'value', label: 'server-reconciled wins average',
				source: { type: 'artifact', artifactType: 'table' },
				path: 'rows.0.pts', operator: 'equals', expected: 27.75
			},
			{ kind: 'answer_includes', values: ['27.75', '25'] }
		],
		limits: { maxToolCalls: 3, maxLatencyMs: 90_000 },
		local: {
			fixtureId: 'semantic_only',
			turns: [
				{
					kind: 'tools',
					calls: [{
						name: 'execute_semantic_query',
						arguments: {
							question: 'How many points and rebounds does Nikola Jokic average in wins versus losses this season?',
							query: {
								operation: 'split', entity: 'player',
								subject: { names: ['Nikola Jokic'] }, metrics: ['pts', 'reb'],
								filters: { season: null, seasonType: 'Regular Season', splitBy: 'win_loss' }, outputMode: 'table'
							}
						}
					}]
				},
				{ kind: 'stop' }
			],
			finalOutput: {
				answer: 'Nikola Jokic averages 27.75 points in wins and 25 points in losses.',
				artifacts: [{ type: 'table', shape: 'table', columns: ['wrong'], rows: [{ wrong: 999 }] }],
				warnings: []
			},
			semanticResponses: [
				{
					status: 'ok',
					result: {
						shape: 'table', columns: ['split', 'games', 'pts', 'reb'],
						rows: [
							{ split: 'Wins', games: 4, pts: 27.75, reb: 13 },
							{ split: 'Losses', games: 1, pts: 25, reb: 13 }
						]
					},
					citations: [{ source: 'stats.nba.com', detail: 'Stored player game log.' }],
					provenance: {
						executor: 'semantic_executor',
						resolvedQuery: {
							operation: 'split', entity: 'player', subject: { names: ['Nikola Jokic'], ids: ['203999'] },
							metrics: ['pts', 'reb'],
							filters: { season: '2025-26', seasonType: 'Regular Season', splitBy: 'win_loss' }, outputMode: 'table'
						},
						dataFreshnessMode: 'nightly', sourceCalls: []
					},
					warnings: [], traceId: 'eval-semantic-split'
				}
			]
		}
	},
	{
		id: 'sga-30-point-record',
		tags: ['aggregation', 'conditional', 'win-loss', 'grounding', 'hygiene'],
		prompts: [
			"What is Shai Gilgeous-Alexander's record when he scores at least 30 points this season?",
			'SGA win-loss record in 30-point games in 2025-26.'
		],
		repetitions: { local: 1, live: 2 },
		expectedStatus: 'ok',
		requiredTools: ['resolve_players', 'aggregate_endpoint_rows'],
		forbiddenTools: ['find_video_clips', 'analyze_time_series'],
		artifactExpectations: [],
		warningExpectations: { maxCount: 0 },
		assertions: [
			{
				kind: 'value',
				label: '30-point game population',
				source: { type: 'tool_result', toolName: 'aggregate_endpoint_rows' },
				path: 'data.matchedRows',
				operator: 'equals',
				expected: 8
			},
			{
				kind: 'value',
				label: 'wins in matching games',
				source: { type: 'tool_result', toolName: 'aggregate_endpoint_rows' },
				path: 'data.groups.0.rowCount',
				operator: 'equals',
				expected: 6
			},
			{
				kind: 'value',
				label: 'losses in matching games',
				source: { type: 'tool_result', toolName: 'aggregate_endpoint_rows' },
				path: 'data.groups.1.rowCount',
				operator: 'equals',
				expected: 2
			},
			{ kind: 'answer_matches', pattern: '6\\s*[-–]\\s*2' }
		],
		limits: { maxToolCalls: 5, maxLatencyMs: 90_000 },
		local: {
			fixtureId: 'sga_scoring_record',
			turns: [
				{ kind: 'tools', calls: [{ name: 'resolve_players', arguments: { names: ['Shai Gilgeous-Alexander'] } }] },
				{
					kind: 'tools',
					calls: [
						{
							name: 'aggregate_endpoint_rows',
							arguments: {
								endpointId: 'playergamelogs',
								params: { PlayerID: '1628983', Season: '2025-26', SeasonType: 'Regular Season' },
								resultSetName: 'PlayerGameLogs',
								filters: [{ column: 'PTS', op: 'gte', value: 30 }],
								groupBy: ['WL'],
								aggregations: [{ op: 'count' }]
							}
						}
					]
				},
				{ kind: 'stop' }
			],
			finalOutput: { answer: 'Shai Gilgeous-Alexander is 6-2 when scoring at least 30 points.', artifacts: [], warnings: [] }
		}
	},
	{
		id: 'wemby-blocks-wins-vs-losses',
		tags: ['aggregation', 'split', 'win-loss', 'grounding', 'hygiene'],
		prompts: [
			"Compare Victor Wembanyama's blocks per game in wins versus losses this season.",
			'Wemby average blocks in wins vs losses for 2025-26.'
		],
		repetitions: { local: 1, live: 2 },
		expectedStatus: 'ok',
		requiredTools: ['resolve_players', 'aggregate_endpoint_rows'],
		forbiddenTools: ['find_video_clips', 'analyze_time_series'],
		artifactExpectations: [],
		warningExpectations: { maxCount: 0 },
		assertions: [
			{
				kind: 'value', label: 'win blocks average',
				source: { type: 'tool_result', toolName: 'aggregate_endpoint_rows' },
				path: 'data.groups.0.aggregates.avg:BLK', operator: 'equals', expected: 4
			},
			{
				kind: 'value', label: 'loss blocks average',
				source: { type: 'tool_result', toolName: 'aggregate_endpoint_rows' },
				path: 'data.groups.1.aggregates.avg:BLK', operator: 'equals', expected: 2
			},
			{ kind: 'answer_includes', values: ['4', '2', 'wins', 'losses'] }
		],
		limits: { maxToolCalls: 5, maxLatencyMs: 90_000 },
		local: {
			fixtureId: 'wemby_blocks_split',
			turns: [
				{ kind: 'tools', calls: [{ name: 'resolve_players', arguments: { names: ['Victor Wembanyama'] } }] },
				{
					kind: 'tools',
					calls: [
						{
							name: 'aggregate_endpoint_rows',
							arguments: {
								endpointId: 'playergamelogs',
								params: { PlayerID: '1641705', Season: '2025-26', SeasonType: 'Regular Season' },
								resultSetName: 'PlayerGameLogs',
								groupBy: ['WL'], aggregations: [{ op: 'avg', column: 'BLK' }]
							}
						}
					]
				},
				{ kind: 'stop' }
			],
			finalOutput: { answer: 'Wembanyama averaged 4 blocks in wins and 2 blocks in losses.', artifacts: [], warnings: [] }
		}
	},
	{
		id: 'endpoint-failure-product-hygiene',
		tags: ['failure', 'partial-data', 'hygiene', 'upstream'],
		prompts: [
			'Who leads the NBA in points per game this season?',
			'Show the current scoring leader.'
		],
		repetitions: { local: 1, live: 1 },
		expectedStatus: 'coverage_gap',
		requiredTools: ['call_nba_stats_endpoint'],
		forbiddenTools: ['find_video_clips', 'analyze_time_series'],
		artifactExpectations: [],
		warningExpectations: {
			requiredCodes: ['dynamic_agent_partial_data'],
			forbiddenMessagePatterns: ['transport=', 'timeout_ms=', 'retry_count=', 'proxy_count=', 'HTTP 500'],
			maxCount: 1
		},
		assertions: [{ kind: 'answer_matches', pattern: 'could not|unavailable|unable' }],
		limits: { maxToolCalls: 3, maxLatencyMs: 90_000 },
		local: {
			fixtureId: 'endpoint_failure',
			turns: [
				{
					kind: 'tools',
					calls: [{
						name: 'call_nba_stats_endpoint',
						arguments: { endpointId: 'leaguedashplayerstats', params: { Season: '2025-26', SeasonType: 'Regular Season', PerMode: 'PerGame' } }
					}]
				},
				{ kind: 'stop' }
			],
			finalOutput: {
				answer: 'The current scoring-leader data is unavailable, so I could not answer reliably.',
				artifacts: [],
				warnings: [{ kind: 'partial_data', message: 'Scoring-leader data is temporarily unavailable.' }]
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
		id: 'tatum-fg-pct-guarded-by-scottie',
		tags: ['matchup', 'defender', 'tracking', 'table', 'grounding', 'small-sample'],
		prompts: [
			'What is Jayson Tatum’s field-goal percentage when guarded by Scottie Barnes this season? Show the matchup sample.',
			'Tatum FG% against Scottie Barnes as his defender in 2025-26, with the tracked matchup row.'
		],
		repetitions: { local: 1, live: 3 },
		expectedStatus: 'ok',
		requiredTools: ['resolve_players', 'analyze_player_matchup'],
		forbiddenTools: ['aggregate_endpoint_rows', 'find_video_clips'],
		artifactExpectations: [{ type: 'table', count: 1, minItems: 1, maxItems: 1 }],
		warningExpectations: { maxCount: 0 },
		assertions: [
			{
				kind: 'value', label: 'offensive player role',
				source: { type: 'tool_request', toolName: 'analyze_player_matchup' },
				path: 'offensivePlayerId', operator: 'equals', expected: '1628369'
			},
			{
				kind: 'value', label: 'defensive player role',
				source: { type: 'tool_request', toolName: 'analyze_player_matchup' },
				path: 'defensivePlayerId', operator: 'equals', expected: '1630567'
			},
			{
				kind: 'value', label: 'tracking evidence level',
				source: { type: 'tool_result', toolName: 'analyze_player_matchup' },
				path: 'data.attribution.level', operator: 'equals', expected: 'tracking_derived'
			},
			{
				kind: 'value', label: 'grounded matchup fg percentage',
				source: { type: 'tool_result', toolName: 'analyze_player_matchup' },
				path: 'data.rows.0.fgPct', operator: 'equals', expected: 1
			},
			{
				kind: 'value', label: 'server-reconciled matchup attempts',
				source: { type: 'artifact', artifactType: 'table' },
				path: 'rows.0.fga', operator: 'equals', expected: 3
			},
			{ kind: 'answer_includes', values: ['tracking', '3-for-3', 'small sample'] }
		],
		limits: { maxToolCalls: 3, maxLatencyMs: 90_000 },
		local: {
			fixtureId: 'tatum_scottie_matchup',
			turns: [
				{ kind: 'tools', calls: [{ name: 'resolve_players', arguments: { names: ['Jayson Tatum', 'Scottie Barnes'] } }] },
				{
					kind: 'tools',
					calls: [{
						name: 'analyze_player_matchup',
						arguments: {
							offensivePlayerId: '1628369', defensivePlayerId: '1630567',
							season: '2025-26', seasonType: 'Regular Season'
						}
					}]
				},
				{ kind: 'stop' }
			],
			finalOutput: {
				answer: 'NBA Advanced Stats Player Tracking credits Scottie Barnes as Tatum’s matchup for 3-for-3 shooting (100%). It is a one-game small sample with 15.1 partial matchup possessions.',
				artifacts: [{ type: 'table', shape: 'table', columns: ['wrong'], rows: [{ wrong: 999 }] }],
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

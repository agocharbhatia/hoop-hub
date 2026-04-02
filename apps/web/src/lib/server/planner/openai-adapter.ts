import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { PlannerAdapter } from './service';

const PLANNER_OUTPUT_SCHEMA = {
	name: 'stats_planner_decision',
	strict: true,
	schema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			type: {
				type: 'string',
				enum: ['planned', 'coverage_gap', 'clarification_needed']
			},
			query: {
				type: ['object', 'null'],
				additionalProperties: false,
				properties: {
					operation: {
						type: 'string',
						enum: ['rank', 'trend', 'compare']
					},
					entity: {
						type: 'string',
						enum: ['player', 'team']
					},
					subject: {
						type: 'object',
						additionalProperties: false,
						properties: {
							names: {
								type: 'array',
								items: { type: 'string' }
							},
							ids: {
								type: 'array',
								items: { type: 'string' }
							}
						},
						required: ['names', 'ids']
					},
					metrics: {
						type: 'array',
						items: { type: 'string' },
						minItems: 1
					},
					filters: {
						type: 'object',
						additionalProperties: false,
						properties: {
							season: {
								type: ['string', 'null']
							},
							seasonType: {
								type: ['string', 'null']
							},
							window: {
								type: ['object', 'null'],
								additionalProperties: false,
								properties: {
									type: {
										type: 'string',
										enum: ['last_n_games']
									},
									n: {
										type: 'integer',
										minimum: 1
									}
								},
								required: ['type', 'n']
							},
							dateFrom: {
								type: 'null'
							},
							dateTo: {
								type: 'null'
							}
						},
						required: ['season', 'seasonType', 'window', 'dateFrom', 'dateTo']
					},
					orderBy: {
						type: ['object', 'null'],
						additionalProperties: false,
						properties: {
							metric: { type: 'string' },
							direction: {
								type: 'string',
								enum: ['asc', 'desc']
							}
						},
						required: ['metric', 'direction']
					},
					limit: {
						type: ['integer', 'null'],
						minimum: 1
					},
					outputMode: {
						type: ['string', 'null'],
						enum: ['table', 'summary', 'timeseries', 'comparison', null]
					}
				},
				required: ['operation', 'entity', 'subject', 'metrics', 'filters', 'orderBy', 'limit', 'outputMode']
			},
			warning: {
				type: ['object', 'null'],
				additionalProperties: false,
				properties: {
					code: {
						type: 'string',
						enum: [
							'unsupported_query_shape',
							'unsupported_metric',
							'clarification_needed',
							'missing_metric',
							'compare_requires_two_subjects'
						]
					},
					message: { type: 'string' }
				},
				required: ['code', 'message']
			}
		},
		required: ['type', 'query', 'warning']
	}
} as const;

/**
 * Isolates the OpenAI call so planner prompting and model upgrades stay outside route orchestration.
 */
export function createOpenAIPlannerAdapter(): PlannerAdapter {
	const apiKey = readPlannerEnv('OPENAI_API_KEY');
	const model = readPlannerEnv('OPENAI_PLANNER_MODEL');

	if (!apiKey || apiKey.trim().length === 0) {
		throw new Error('OPENAI_API_KEY is required for planner runtime.');
	}

	if (!model || model.trim().length === 0) {
		throw new Error('OPENAI_PLANNER_MODEL is required for planner runtime.');
	}

	const client = new OpenAI({ apiKey });

	return {
		async planQuestion(question: string): Promise<unknown> {
			const completion = await client.chat.completions.create({
				model,
				temperature: 0,
				messages: buildPlannerMessages(question),
				response_format: {
					type: 'json_schema',
					json_schema: PLANNER_OUTPUT_SCHEMA
				}
			});
			const content = completion.choices[0]?.message?.content;
			if (!content) {
				throw new Error('Planner returned an empty response.');
			}

			try {
				return JSON.parse(content);
			} catch (error) {
				throw new Error(`Planner returned invalid JSON: ${String(error)}`);
			}
		}
	};
}

/* Helper functions */

let plannerEnvLoaded = false;

/**
 * Loads local app env files on demand so the planner works in the SvelteKit server and the direct Bun test harness.
 */
function readPlannerEnv(name: 'OPENAI_API_KEY' | 'OPENAI_PLANNER_MODEL'): string | undefined {
	const directValue = process.env[name]?.trim();
	if (directValue) {
		return directValue;
	}

	if (!plannerEnvLoaded && typeof process.loadEnvFile === 'function') {
		for (const candidate of ['.env.local', '.env.development', '.env']) {
			const path = resolve(process.cwd(), candidate);
			if (!existsSync(path)) {
				continue;
			}

			try {
				process.loadEnvFile(path);
			} catch {
				// Ignore malformed or missing optional env files here and rely on the required-variable guard below.
			}
		}
		plannerEnvLoaded = true;
	}

	const loadedValue = process.env[name]?.trim();
	return loadedValue && loadedValue.length > 0 ? loadedValue : undefined;
}

export function _buildPlannerMessagesForTests(question: string): ChatCompletionMessageParam[] {
	return [
		{
			role: 'system',
			content:
				'You plan NBA stats questions into a closed contract. Only support player ranking, player trend, player comparison, and team defensive ranking questions in this slice. Do not resolve player identity into canonical ids. If the question is unsupported, return coverage_gap.'
		},
		{
			role: 'system',
			content:
				"Allowed metric ids in this slice are canonical executor ids such as pts, ast, reb, and drtg. Always include every schema field. Use empty arrays instead of omitting subject.names or subject.ids. Use null for optional scalar/object fields that do not apply. Season normalization is the planner's responsibility. Never emit season phrases like this season or current season in filters.season. Use null for implicit current-season asks. When the question names a season, always normalize it to exact YYYY-YY form before returning it. For example, 2023/24, 2023-2024, and 2023 24 must all become 2023-24. For player rankings, use rank/player, keep both subject arrays empty, and set orderBy to the same metric descending. For team defensive rankings, use rank/team, keep both subject arrays empty, normalize any defensive-rating wording to metric drtg, set orderBy to drtg ascending, and use outputMode table. For player trends, use trend/player, include exactly one raw player name in subject.names, keep subject.ids empty, preserve explicit rolling windows like last 5 as filters.window, and use outputMode timeseries. For player comparisons, use compare/player, preserve the two raw player names in subject.names in the same order they appear in the question, keep subject.ids empty, use outputMode comparison, and leave orderBy and limit null."
		},
		{
			role: 'system',
			content:
				"If a trend question uses scoring language like scored or scoring, infer metric pts. If a trend question names a player and window but does not safely imply a metric, return clarification_needed with warning code missing_metric. If a comparison question omits a metric, default safely to pts. If a comparison question does not clearly include exactly two subjects, return clarification_needed with warning code compare_requires_two_subjects. Treat adjacent unsupported team asks such as offensive team rankings, team comparisons, or team trends as coverage_gap. The executor remains the grounding authority."
		},
		{
			role: 'user',
			content: question
		}
	];
}

function buildPlannerMessages(question: string): ChatCompletionMessageParam[] {
	return _buildPlannerMessagesForTests(question);
}

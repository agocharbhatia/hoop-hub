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
						enum: ['rank', 'trend']
					},
					entity: {
						type: 'string',
						enum: ['player']
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
						required: []
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
						enum: ['unsupported_query_shape', 'unsupported_metric', 'clarification_needed', 'missing_metric']
					},
					message: { type: 'string' }
				},
				required: ['code', 'message']
			}
		},
		required: ['type', 'query', 'warning'],
		allOf: [
			{
				if: {
					properties: {
						type: { const: 'planned' }
					}
				},
				then: {
					properties: {
						warning: { type: 'null' }
					}
				}
			},
			{
				if: {
					properties: {
						type: { enum: ['coverage_gap', 'clarification_needed'] }
					}
				},
				then: {
					properties: {
						query: { type: 'null' }
					}
				}
			}
		]
	}
} as const;

/**
 * Isolates the OpenAI call so planner prompting and model upgrades stay outside route orchestration.
 */
export function createOpenAIPlannerAdapter(): PlannerAdapter {
	const apiKey = process.env.OPENAI_API_KEY;
	const model = process.env.OPENAI_PLANNER_MODEL;

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

function buildPlannerMessages(question: string): ChatCompletionMessageParam[] {
	return [
		{
			role: 'system',
			content:
				'You plan NBA stats questions into a closed contract. Only support player ranking and player trend questions in this slice. Do not resolve player identity into canonical ids. If the question is unsupported, return coverage_gap.'
		},
		{
			role: 'system',
			content:
				"Allowed metric ids in this slice are canonical executor ids such as pts, ast, and reb. For rankings, use rank/player, keep subject empty, and set orderBy to the same metric descending. For player trends, use trend/player, include exactly one raw player name in subject.names, preserve explicit rolling windows like last 5 as filters.window, and use outputMode timeseries."
		},
		{
			role: 'system',
			content:
				"If a trend question uses scoring language like scored or scoring, infer metric pts. If a trend question names a player and window but does not safely imply a metric, return clarification_needed with warning code missing_metric. The executor remains the grounding authority."
		},
		{
			role: 'user',
			content: question
		}
	];
}

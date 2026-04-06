import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { MAX_BATCH_TOOL_REQUESTS } from '$lib/contracts/planner';
import { getPublicSemanticCapabilities } from '$lib/server/semantic/capabilities';
import type { PlannerAdapter } from './service';

const PLANNER_CAPABILITY_CONTRACT_PREFIX = 'Batch stats capability contract: ';

function buildPlannerOutputSchema() {
	const capabilities = getPublicSemanticCapabilities();

	return {
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
				toolRequests: {
					type: ['array', 'null'],
					minItems: 1,
					maxItems: MAX_BATCH_TOOL_REQUESTS,
					items: {
						type: 'object',
						additionalProperties: false,
						properties: {
							toolName: {
								type: 'string',
								enum: ['stats_query']
							},
							query: {
								type: 'object',
								additionalProperties: false,
								properties: {
									operation: {
										type: 'string',
										enum: capabilities.operations
									},
									entity: {
										type: 'string',
										enum: capabilities.entities
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
										items: {
											type: 'string',
											enum: capabilities.metrics.map((metric) => metric.id)
										},
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
												type: ['string', 'null'],
												enum: [...capabilities.seasonTypes.supported, null]
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
												type: ['string', 'null']
											},
											dateTo: {
												type: ['string', 'null']
											},
											conference: {
												type: ['string', 'null'],
												enum: ['East', 'West', null]
											},
											division: {
												type: ['string', 'null'],
												enum: [
													'Atlantic',
													'Central',
													'Southeast',
													'Northwest',
													'Pacific',
													'Southwest',
													null
												]
											},
											gameStatus: {
												type: ['string', 'null'],
												enum: ['upcoming', 'final', 'any', null]
											}
										},
										required: [
											'season',
											'seasonType',
											'window',
											'dateFrom',
											'dateTo',
											'conference',
											'division',
											'gameStatus'
										]
									},
									orderBy: {
										type: ['object', 'null'],
										additionalProperties: false,
										properties: {
											metric: {
												type: 'string',
												enum: capabilities.metrics.map((metric) => metric.id)
											},
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
										enum: [...capabilities.outputModes, null]
									}
								},
								required: ['operation', 'entity', 'subject', 'metrics', 'filters', 'orderBy', 'limit', 'outputMode']
							}
						},
						required: ['toolName', 'query']
					}
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
								'compare_requires_two_subjects',
								'dropped_unsupported_clause'
							]
						},
						message: { type: 'string' }
					},
					required: ['code', 'message']
				},
				warnings: {
					type: ['array', 'null'],
					items: {
						type: 'object',
						additionalProperties: false,
						properties: {
							code: {
								type: 'string',
								enum: [
									'unsupported_query_shape',
									'unsupported_metric',
									'clarification_needed',
									'missing_metric',
									'compare_requires_two_subjects',
									'dropped_unsupported_clause'
								]
							},
							message: { type: 'string' }
						},
						required: ['code', 'message']
					}
				}
			},
			required: ['type', 'toolRequests', 'warning', 'warnings']
		}
	} as const;
}

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
					json_schema: buildPlannerOutputSchema()
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

export function _getPlannerOutputSchemaForTests() {
	return buildPlannerOutputSchema();
}

function buildSingleRequestPlannerCapabilityContract() {
	const capabilities = getPublicSemanticCapabilities();

	return {
		maxToolRequests: MAX_BATCH_TOOL_REQUESTS,
		seasons: capabilities.seasons,
		seasonTypes: capabilities.seasonTypes,
		queryShapes: capabilities.queryShapes
	};
}

function buildShapePlanningGuide() {
	const contract = buildSingleRequestPlannerCapabilityContract();

	return contract.queryShapes
		.map((shape) => {
			const primaryOutputMode = shape.outputModes[0] ?? 'table';
			return `${shape.operation}/${shape.entity}: subject=${shape.subjectRule}; output=${primaryOutputMode}; metrics=${shape.metrics.join(', ')}; orderBy=${shape.planning.orderBy}; limit=${shape.planning.defaultLimit ?? 'null'}; supportsWindow=${shape.planning.supportsWindow}`;
		})
		.join('\n');
}

export function _buildPlannerMessagesForTests(question: string): ChatCompletionMessageParam[] {
	const capabilities = getPublicSemanticCapabilities();
	const capabilityContract = buildSingleRequestPlannerCapabilityContract();
	const shapePlanningGuide = buildShapePlanningGuide();

	return [
		{
			role: 'system',
			content:
				`You plan NBA stats questions into up to ${MAX_BATCH_TOOL_REQUESTS} supported structured tool requests. Only support ${capabilities.queryShapes
					.map((shape) => `${shape.operation}/${shape.entity}`)
					.join(', ')} in this slice. Use the published stats capability contract as your source of truth. Do not resolve player identity into canonical ids. If no bounded supported tool batch fits, return coverage_gap.`
		},
		{
			role: 'system',
			content: `${PLANNER_CAPABILITY_CONTRACT_PREFIX}${JSON.stringify(capabilityContract)}`
		},
		{
			role: 'system',
			content:
				`Interpret the capability contract generically rather than by memorized families. Per-shape planning rules:\n${shapePlanningGuide}`
		},
		{
			role: 'system',
			content:
				`Always include every schema field. Use empty arrays instead of omitting subject.names or subject.ids. Use null for optional scalar or object fields that do not apply. Season normalization is the planner's responsibility. Never emit season phrases like this season or current season in filters.season. Use null for implicit current-season asks. When the question names a season, always normalize it to exact YYYY-YY form before returning it. For example, 2023/24, 2023-2024, and 2023 24 must all become 2023-24. Preserve raw subject name order from the question in subject.names. Keep subject.ids empty in this slice. Use planned warnings for supported batches, and use warning for non-ok decisions only. Do not plan more than ${MAX_BATCH_TOOL_REQUESTS} tool requests.`
		},
		{
			role: 'system',
			content:
				"If a trend question uses scoring language like scored or scoring, infer metric pts. If a trend question names a player and window but does not safely imply a metric, return clarification_needed with warning code missing_metric. If a comparison question omits a metric, default safely to pts. If a comparison question does not clearly include exactly two subjects, return clarification_needed with warning code compare_requires_two_subjects. For mixed standings and game questions, decompose the ask into the minimal supported tool requests instead of one fake combined query. If the question also contains unsupported but non-essential clauses, drop only those clauses and add an explicit planned warning with code dropped_unsupported_clause. Multiple materially different plausible plans should return clarification_needed. Clear but unsupported asks should return coverage_gap. The executor remains the grounding authority."
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

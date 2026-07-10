import type { QueryAnswerAgentToolName, QueryAnswerArtifact, QueryAnswerResponse } from '$lib/contracts/answer-response';
import type { StatsQueryWarning } from '$lib/contracts/semantic-query';
import type { StatsEndpointFetcher } from '$lib/server/data/adapters/stats-endpoint-client';
import type { PlayerDirectoryEntryRecord } from '$lib/server/data/store';
import type { TeamDirectoryEntryRecord } from '$lib/server/teams/team-directory';

export type DynamicAgentToolCall = {
	id: string;
	name: string;
	arguments: string;
};

export type DynamicAgentChatMessage =
	| {
			role: 'system' | 'user';
			content: string;
	  }
	| {
			role: 'assistant';
			content: string | null;
			toolCalls?: DynamicAgentToolCall[];
	  }
	| {
			role: 'tool';
			toolCallId: string;
			name: QueryAnswerAgentToolName;
			content: string;
	  };

export type DynamicAgentToolDefinition = {
	type: 'function';
	function: {
		name: QueryAnswerAgentToolName;
		description: string;
		parameters: Record<string, unknown>;
	};
};

export type DynamicAgentJsonSchema = {
	name: string;
	strict: boolean;
	schema: Record<string, unknown>;
};

export type DynamicAgentCompletionInput = {
	messages: DynamicAgentChatMessage[];
	tools?: DynamicAgentToolDefinition[];
	responseFormat?: DynamicAgentJsonSchema;
};

export type DynamicAgentModelResponse = {
	content: string | null;
	toolCalls: DynamicAgentToolCall[];
};

export type DynamicAgentAdapter = {
	complete(input: DynamicAgentCompletionInput): Promise<DynamicAgentModelResponse>;
};

export type DynamicAgentPlayerDirectory = {
	ensureAvailable(): { ok: true } | { ok: false; message: string };
	findByNameOrAlias(name: string): PlayerDirectoryEntryRecord[];
};

export type DynamicAgentTeamDirectory = {
	findByNameOrAlias(name: string): TeamDirectoryEntryRecord[];
};

export type DynamicAgentClock = {
	nowMs(): number;
};

export type DynamicQueryAgentDependencies = {
	model: DynamicAgentAdapter;
	endpointFetcher: StatsEndpointFetcher;
	playerDirectory: DynamicAgentPlayerDirectory;
	teamDirectory: DynamicAgentTeamDirectory;
	maxToolIterations?: number;
	wallClockMs?: number;
	clock?: DynamicAgentClock;
};

export type DynamicQueryAgent = {
	answerQuestion(question: string): Promise<QueryAnswerResponse>;
};

export type DynamicAgentFinalWarningKind = 'partial_data' | 'capability_limit' | 'artifact_sample' | 'scope_assumption' | 'diagnostic';

export type DynamicAgentFinalWarning = {
	kind: DynamicAgentFinalWarningKind;
	message: string;
};

export type DynamicAgentFinalOutput = {
	answer: string;
	artifacts: QueryAnswerArtifact[];
	warnings: DynamicAgentFinalWarning[];
};

export class DynamicAgentError extends Error {
	constructor(
		readonly code: 'invalid_tool_arguments' | 'invalid_model_output' | 'tool_execution_failed',
		message: string
	) {
		super(message);
		this.name = 'DynamicAgentError';
	}
}

export type DynamicAgentWarning = StatsQueryWarning;

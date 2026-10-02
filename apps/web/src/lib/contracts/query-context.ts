/** Allows follow-ups to refer to server-held research scope without resending tool state. */
export type QueryAnswerRequest = {
	question: string;
	sessionId?: string;
};

export type QueryEffectiveScope = {
	seasons: string[];
	playerIds: string[];
	teamIds: string[];
	opponentTeamIds: string[];
	period?: number;
	shotResult?: 'made' | 'missed' | 'any';
	players?: Array<{ id: string; name: string }>;
	teams?: Array<{ id: string; name: string }>;
	opponents?: Array<{ id: string; name: string }>;
	shotFilters?: string[];
	seasonTypes?: string[];
	dateFrom?: string;
	dateTo?: string;
};

export type QueryIntent =
	| 'league_leaders'
	| 'player_trend'
	| 'player_compare'
	| 'team_ranking'
	| 'unsupported';

export type MetricId = string;

export type MetricSelection = {
	id: MetricId;
	confidence: number;
};

export type QueryPlan = {
	intent: QueryIntent;
	entities: {
		players: string[];
		teams: string[];
		seasons: string[];
	};
	metrics: MetricSelection[];
	filters: {
		season: string | null;
		window: { type: 'last_n_games'; n: number } | null;
	};
	confidence: number;
	reasons: string[];
};

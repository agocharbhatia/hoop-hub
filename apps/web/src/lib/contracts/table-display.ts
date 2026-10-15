/** Preserve presentation intent with saved evidence instead of asking the browser to infer its units. */
export type TableColumnDisplay = {
	label: string;
	unit?: string;
	scale?: number;
	precision?: number;
	preferredDirection?: 'higher' | 'lower';
	role: 'identity' | 'metric' | 'sample' | 'context' | 'detail';
};

export type TableDisplay = {
	title: string;
	primaryColumns: string[];
	metricColumns: string[];
	columns: Record<string, TableColumnDisplay>;
	perMode?: string;
};

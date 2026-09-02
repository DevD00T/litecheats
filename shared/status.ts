export const STATUS_BASE_PATH = "/api/status";

export type StatusLevel = "operational" | "degraded" | "outage";

export interface StatusComponent {
	key: string;
	label: string;
	status: StatusLevel;
	latencyMs: number | null;
	detail: string;
}

export interface StatusSummaryResponse {
	status: StatusLevel;
	region: string;
	checkedAt: string;
	components: StatusComponent[];
}

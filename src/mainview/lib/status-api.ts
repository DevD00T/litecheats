import { AUTH_API_PORT } from "shared/auth";
import { STATUS_BASE_PATH, type StatusSummaryResponse } from "shared/status";

function resolveStatusApiOrigin(): string {
	const configuredOrigin =
		typeof import.meta !== "undefined"
			? (import.meta.env?.VITE_STATUS_API_ORIGIN as string | undefined)
			: undefined;
	if (configuredOrigin?.trim()) {
		return configuredOrigin.trim().replace(/\/+$/, "");
	}

	if (typeof window !== "undefined") {
		const protocol = window.location.protocol;
		if (protocol === "http:" || protocol === "https:") {
			// Vite standalone dev serves HTML fallback for unknown routes.
			// Route the status API directly to the Bun backend in this mode.
			if (window.location.hostname === "localhost" && window.location.port === "5173") {
				return `http://localhost:${AUTH_API_PORT}`;
			}
			return window.location.origin;
		}
	}

	return `http://localhost:${AUTH_API_PORT}`;
}

const STATUS_API_ORIGIN = resolveStatusApiOrigin();
const STATUS_API_URL = STATUS_API_ORIGIN.endsWith(STATUS_BASE_PATH)
	? STATUS_API_ORIGIN
	: `${STATUS_API_ORIGIN}${STATUS_BASE_PATH}`;

export class StatusApiError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

async function parseJson<T>(response: Response): Promise<T | null> {
	try {
		return (await response.json()) as T;
	} catch {
		return null;
	}
}

async function requestStatusSummary(): Promise<StatusSummaryResponse> {
	const response = await fetch(`${STATUS_API_URL}/summary`, {
		method: "GET",
		cache: "no-store",
		headers: {
			Pragma: "no-cache",
			"Cache-Control": "no-cache",
		},
	});

	const payload = await parseJson<StatusSummaryResponse | { error: string }>(response);
	if (!response.ok || !payload) {
		const message =
			payload && "error" in payload
				? payload.error
				: `Status request failed with status ${response.status}`;
		throw new StatusApiError(response.status, message);
	}

	if (!("components" in payload) || !Array.isArray(payload.components)) {
		throw new StatusApiError(500, "Status response is malformed.");
	}

	return payload;
}

export const statusApi = {
	getSummary: requestStatusSummary,
};

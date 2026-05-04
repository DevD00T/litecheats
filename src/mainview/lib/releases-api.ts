import { AUTH_API_PORT } from "shared/auth";
import { DOWNLOADS_BASE_PATH, type ReleaseFeedResponse } from "shared/releases";

function resolveReleasesApiOrigin(): string {
	const configuredOrigin =
		typeof import.meta !== "undefined"
			? (import.meta.env?.VITE_RELEASES_API_ORIGIN as string | undefined)
			: undefined;
	if (configuredOrigin?.trim()) {
		return configuredOrigin.trim().replace(/\/+$/, "");
	}

	if (typeof window !== "undefined") {
		const protocol = window.location.protocol;
		if (protocol === "http:" || protocol === "https:") {
			// Vite standalone dev serves HTML fallback for unknown routes.
			// Route release API directly to Bun backend in this mode.
			if (window.location.hostname === "localhost" && window.location.port === "5173") {
				return `http://localhost:${AUTH_API_PORT}`;
			}
			return window.location.origin;
		}
	}

	return `http://localhost:${AUTH_API_PORT}`;
}

const RELEASES_API_ORIGIN = resolveReleasesApiOrigin();
const RELEASES_API_URL = RELEASES_API_ORIGIN.endsWith(DOWNLOADS_BASE_PATH)
	? RELEASES_API_ORIGIN
	: `${RELEASES_API_ORIGIN}${DOWNLOADS_BASE_PATH}`;

interface ApiErrorResponse {
	error: string;
}

export class ReleasesApiError extends Error {
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

function isReleaseFeedResponse(payload: unknown): payload is ReleaseFeedResponse {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"latest" in payload &&
		"releases" in payload &&
		Array.isArray((payload as ReleaseFeedResponse).releases)
	);
}

function normalizeReleaseFeed(payload: unknown): ReleaseFeedResponse | null {
	if (isReleaseFeedResponse(payload)) {
		return payload;
	}

	if (typeof payload !== "object" || payload === null || !("latest" in payload)) {
		return null;
	}

	// Compatibility path for endpoints returning only {"latest": ...}
	// (for example /downloads/releases/latest or older release API responses).
	const latest = (payload as { latest?: ReleaseFeedResponse["latest"] }).latest ?? null;
	return {
		latest,
		releases: latest ? [latest] : [],
	};
}

async function requestReleaseFeed(): Promise<ReleaseFeedResponse> {
	const response = await fetch(`${RELEASES_API_URL}/releases`, {
		method: "GET",
		cache: "no-store",
		headers: {
			Pragma: "no-cache",
			"Cache-Control": "no-cache",
		},
	});

	const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
	if (!contentType.includes("application/json")) {
		throw new ReleasesApiError(
			502,
			`Downloads API returned unexpected content-type "${contentType || "unknown"}".`,
		);
	}

	const payload = await parseJson<ReleaseFeedResponse | ApiErrorResponse>(response);
	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload
				? payload.error
				: `Releases request failed with status ${response.status}`;
		throw new ReleasesApiError(response.status, message);
	}

	const normalizedFeed = normalizeReleaseFeed(payload);
	if (!normalizedFeed) {
		throw new ReleasesApiError(
			500,
			"Release feed response is malformed. Ensure /downloads/releases returns JSON from the backend.",
		);
	}

	return normalizedFeed;
}

export const releasesApi = {
	getFeed: requestReleaseFeed,
	getDownloadUrl(downloadPath: string) {
		return `${RELEASES_API_ORIGIN}${downloadPath}`;
	},
};

import { AUTH_API_PORT } from "shared/auth";
import { DOWNLOADS_BASE_PATH, type ReleaseFeedResponse } from "shared/releases";

const RELEASES_API_ORIGIN = `http://localhost:${AUTH_API_PORT}`;
const RELEASES_API_URL = `${RELEASES_API_ORIGIN}${DOWNLOADS_BASE_PATH}`;

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

async function requestReleaseFeed(): Promise<ReleaseFeedResponse> {
	const response = await fetch(`${RELEASES_API_URL}/releases`, {
		method: "GET",
		cache: "no-store",
		headers: {
			Pragma: "no-cache",
			"Cache-Control": "no-cache",
		},
	});

	const payload = await parseJson<ReleaseFeedResponse | ApiErrorResponse>(response);
	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload
				? payload.error
				: `Releases request failed with status ${response.status}`;
		throw new ReleasesApiError(response.status, message);
	}

	if (!payload || !("releases" in payload)) {
		throw new ReleasesApiError(500, "Release feed response is malformed.");
	}

	return payload;
}

export const releasesApi = {
	getFeed: requestReleaseFeed,
	getDownloadUrl(downloadPath: string) {
		return `${RELEASES_API_ORIGIN}${downloadPath}`;
	},
};

import {
	AUTH_API_PORT,
	AUTH_BASE_PATH,
	type AdminCreateUserPayload,
	type AdminDeleteUserResponse,
	type AdminUpdateUserPayload,
	type AdminUserListResponse,
	type ApiErrorResponse,
	type AuthSuccessResponse,
	type LoginPayload,
	type LogoutAllSessionsResponse,
	type RevokeSessionPayload,
	type RevokeSessionResponse,
	type SessionListResponse,
	type SessionResponse,
	type SignupPayload,
	type UpdateProfilePayload,
} from "shared/auth";
import type {
	AdminCreateReleasePayload,
	AdminDeleteArtifactResponse,
	AdminDeleteReleaseResponse,
	AdminUpdateArtifactPayload,
	AdminUpdateReleasePayload,
	ReleaseFeedResponse,
	ReleaseFormat,
	ReleasePlatform,
} from "shared/releases";

function resolveAuthApiOrigin(): string {
	if (typeof window !== "undefined") {
		const protocol = window.location.protocol;
		if (protocol === "http:" || protocol === "https:") {
			return window.location.origin;
		}
	}

	return `http://localhost:${AUTH_API_PORT}`;
}

const AUTH_API_ORIGIN = resolveAuthApiOrigin();
const AUTH_API_URL = `${AUTH_API_ORIGIN}${AUTH_BASE_PATH}`;

export class AuthApiError extends Error {
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

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
	const isFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
	const headers = new Headers(init?.headers);
	if (!isFormDataBody && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}
	if (!headers.has("Pragma")) {
		headers.set("Pragma", "no-cache");
	}
	if (!headers.has("Cache-Control")) {
		headers.set("Cache-Control", "no-cache");
	}

	const response = await fetch(`${AUTH_API_URL}${path}`, {
		...init,
		cache: "no-store",
		credentials: "include",
		headers,
	});

	if (response.status === 204) {
		return null as T;
	}

	const payload = await parseJson<T | ApiErrorResponse>(response);
	if (!response.ok) {
		const errorMessage =
			payload && typeof payload === "object" && "error" in payload
				? payload.error
				: `Auth request failed with status ${response.status}`;
		throw new AuthApiError(response.status, errorMessage);
	}

	return payload as T;
}

export const authApi = {
	signup: (payload: SignupPayload) =>
		authRequest<AuthSuccessResponse>("/signup", {
			method: "POST",
			body: JSON.stringify(payload),
		}),
	login: (payload: LoginPayload) =>
		authRequest<AuthSuccessResponse>("", {
			method: "POST",
			body: JSON.stringify(payload),
		}),
	logout: () =>
		authRequest<null>("/logout", {
			method: "POST",
		}),
	logoutAllSessions: () =>
		authRequest<LogoutAllSessionsResponse>("/logout-all", {
			method: "POST",
		}),
	getSession: () => authRequest<SessionResponse>("/session"),
	getSessions: () => authRequest<SessionListResponse>("/sessions"),
	revokeSession: (payload: RevokeSessionPayload) =>
		authRequest<RevokeSessionResponse>("/sessions/revoke", {
			method: "POST",
			body: JSON.stringify(payload),
		}),
	getMe: () => authRequest<AuthSuccessResponse>("/me"),
	updateMe: (payload: UpdateProfilePayload) =>
		authRequest<AuthSuccessResponse>("/me", {
			method: "PATCH",
			body: JSON.stringify(payload),
		}),
	deleteMe: () =>
		authRequest<null>("/me", {
			method: "DELETE",
		}),
	getAdminUsers: () =>
		authRequest<AdminUserListResponse>("/admin/users", {
			method: "GET",
		}),
	createAdminUser: (payload: AdminCreateUserPayload) =>
		authRequest<AuthSuccessResponse>("/admin/users", {
			method: "POST",
			body: JSON.stringify(payload),
		}),
	updateAdminUser: (userId: string, payload: AdminUpdateUserPayload) =>
		authRequest<AuthSuccessResponse>(`/admin/users/${encodeURIComponent(userId)}`, {
			method: "PATCH",
			body: JSON.stringify(payload),
		}),
	deleteAdminUser: (userId: string) =>
		authRequest<AdminDeleteUserResponse>(`/admin/users/${encodeURIComponent(userId)}`, {
			method: "DELETE",
		}),
	getAdminReleases: () =>
		authRequest<ReleaseFeedResponse>("/admin/releases", {
			method: "GET",
		}),
	createAdminRelease: (payload: AdminCreateReleasePayload) =>
		authRequest<ReleaseFeedResponse>("/admin/releases", {
			method: "POST",
			body: JSON.stringify(payload),
		}),
	updateAdminRelease: (releaseId: string, payload: AdminUpdateReleasePayload) =>
		authRequest<ReleaseFeedResponse>(`/admin/releases/${encodeURIComponent(releaseId)}`, {
			method: "PATCH",
			body: JSON.stringify(payload),
		}),
	deleteAdminRelease: (releaseId: string) =>
		authRequest<AdminDeleteReleaseResponse>(`/admin/releases/${encodeURIComponent(releaseId)}`, {
			method: "DELETE",
		}),
	uploadAdminReleaseArtifact: (payload: {
		releaseId: string;
		file: File;
		platform: ReleasePlatform;
		format: ReleaseFormat;
		target?: string;
		filename?: string;
	}) => {
		const formData = new FormData();
		formData.set("file", payload.file);
		formData.set("platform", payload.platform);
		formData.set("format", payload.format);
		if (payload.target?.trim()) {
			formData.set("target", payload.target.trim());
		}
		if (payload.filename?.trim()) {
			formData.set("filename", payload.filename.trim());
		}

		return authRequest<ReleaseFeedResponse>(
			`/admin/releases/${encodeURIComponent(payload.releaseId)}/artifacts`,
			{
				method: "POST",
				body: formData,
			},
		);
	},
	updateAdminArtifact: (artifactId: string, payload: AdminUpdateArtifactPayload) =>
		authRequest<ReleaseFeedResponse>(`/admin/artifacts/${encodeURIComponent(artifactId)}`, {
			method: "PATCH",
			body: JSON.stringify(payload),
		}),
	deleteAdminArtifact: (artifactId: string) =>
		authRequest<AdminDeleteArtifactResponse>(`/admin/artifacts/${encodeURIComponent(artifactId)}`, {
			method: "DELETE",
		}),
};

import {
	AUTH_API_PORT,
	AUTH_BASE_PATH,
	type ApiErrorResponse,
	type AuthSuccessResponse,
	type LoginPayload,
	type SessionResponse,
	type SignupPayload,
	type UpdateProfilePayload,
} from "shared/auth";

const AUTH_API_ORIGIN = `http://localhost:${AUTH_API_PORT}`;
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
	const response = await fetch(`${AUTH_API_URL}${path}`, {
		...init,
		cache: "no-store",
		credentials: "include",
		headers: {
			"Content-Type": "application/json",
			Pragma: "no-cache",
			"Cache-Control": "no-cache",
			...(init?.headers ?? {}),
		},
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
	getSession: () => authRequest<SessionResponse>("/session"),
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
};

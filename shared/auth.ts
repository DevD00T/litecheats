export const AUTH_API_PORT = 8787;
export const AUTH_BASE_PATH = "/login";
export const AUTH_COOKIE_NAME = "litecheats_session";
export const AUTH_COOKIE_MAX_AGE_SECONDS = 86400;

export const USER_ROLES = ["user", "admin", "owner"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const DEFAULT_USER_ROLE: UserRole = "user";

export interface AuthUser {
	id: string;
	email: string;
	fullName: string;
	company: string;
	isAdmin: boolean;
	isOwner: boolean;
	roles: UserRole[];
	createdAt: string;
	updatedAt: string;
}

export interface SignupPayload {
	fullName: string;
	email: string;
	company: string;
	password: string;
}

export interface LoginPayload {
	email: string;
	password: string;
}

export interface UpdateProfilePayload {
	fullName?: string;
	company?: string;
}

export interface SessionResponse {
	authenticated: boolean;
	user: AuthUser | null;
}

export interface AuthSuccessResponse {
	user: AuthUser;
}

export interface ApiErrorResponse {
	error: string;
}

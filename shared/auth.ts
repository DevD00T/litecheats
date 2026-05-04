export const AUTH_API_PORT = 8787;
export const AUTH_BASE_PATH = "/login";
export const AUTH_ADMIN_BASE_PATH = `${AUTH_BASE_PATH}/admin`;
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

export interface AuthSession {
	id: string;
	userAgent: string;
	ipAddress: string;
	deviceKey: string;
	createdAt: string;
	updatedAt: string;
	expiresAt: string;
	current: boolean;
}

export interface SessionListResponse {
	sessions: AuthSession[];
}

export interface RevokeSessionPayload {
	sessionId: string;
}

export interface RevokeSessionResponse {
	revoked: true;
}

export interface LogoutAllSessionsResponse {
	revokedCount: number;
}

export interface AuthSuccessResponse {
	user: AuthUser;
}

export interface ApiErrorResponse {
	error: string;
}

export interface AdminUserListStats {
	totalUsers: number;
	adminUsers: number;
	ownerUsers: number;
}

export interface AdminUserListResponse {
	users: AuthUser[];
	stats: AdminUserListStats;
}

export interface AdminCreateUserPayload {
	id?: string;
	email: string;
	password: string;
	fullName: string;
	company: string;
	isAdmin?: boolean;
	isOwner?: boolean;
}

export interface AdminUpdateUserPayload {
	email?: string;
	password?: string;
	fullName?: string;
	company?: string;
	isAdmin?: boolean;
	isOwner?: boolean;
}

export interface AdminDeleteUserResponse {
	deleted: true;
}

import { createHash } from "node:crypto";
import { Elysia } from "elysia";
import {
	AUTH_ADMIN_BASE_PATH,
	AUTH_API_PORT,
	AUTH_BASE_PATH,
	AUTH_COOKIE_MAX_AGE_SECONDS,
	AUTH_COOKIE_NAME,
	type AdminCreateUserPayload,
	type AdminDeleteUserResponse,
	type AdminUpdateUserPayload,
	type AdminUserListResponse,
	type AdminUserListStats,
	type ApiErrorResponse,
	type AuthSession,
	type AuthSuccessResponse,
	type AuthUser,
	DEFAULT_USER_ROLE,
	EMAIL_VERIFICATION_CODE_LENGTH,
	type LoginPayload,
	type LogoutAllSessionsResponse,
	type ResendVerificationResponse,
	type RevokeSessionPayload,
	type RevokeSessionResponse,
	type SessionListResponse,
	type SessionResponse,
	type SignupPayload,
	USER_ROLES,
	type UpdateProfilePayload,
	type UserRole,
	type VerifyEmailPayload,
	type VerifyEmailResponse,
} from "../../shared/auth";
import {
	BILLING_ADMIN_BASE_PATH,
	BILLING_BASE_PATH,
	type BillingSubscriptionResponse,
	RAZORPAY_WEBHOOK_BASE_PATH,
	RAZORPAY_WEBHOOK_PATH,
} from "../../shared/billing";
import {
	type AdminCreateReleasePayload,
	type AdminDeleteArtifactResponse,
	type AdminDeleteReleaseResponse,
	type AdminUpdateArtifactPayload,
	type AdminUpdateReleasePayload,
	DOWNLOADS_BASE_PATH,
	RELEASE_FORMATS,
	RELEASE_PLATFORMS,
	type ReleaseArtifactSummary,
	type ReleaseFeedResponse,
	type ReleaseFormat,
	type ReleasePlatform,
	type ReleaseSummary,
} from "../../shared/releases";
import {
	STATUS_BASE_PATH,
	type StatusComponent,
	type StatusLevel,
	type StatusSummaryResponse,
} from "../../shared/status";
import {
	BillingError,
	adminCreateSubscription,
	adminDeleteSubscription,
	adminUpdateOrder,
	cancelSubscription,
	createCheckout,
	getAdminOrders,
	getBillingPlansResponse,
	getOrdersForUser,
	getPaymentHistoryForUser,
	getSubscriptionForUser,
	handleRazorpayWebhook,
	parseAdminCreateSubscriptionPayload,
	parseAdminUpdateOrderPayload,
	parseCancelSubscriptionPayload,
	parseCreateCheckoutPayload,
	parseVerifyCheckoutPayload,
	verifyCheckout,
} from "./billing";
import {
	type ReleaseArtifactDocument,
	type ReleaseVersionDocument,
	type SessionDocument,
	type UserDocument,
	type WithId,
	countActiveSessionsForDevice,
	countActiveSessionsForUser,
	deleteAllSessionsForUser as dbDeleteAllSessionsForUserId,
	deleteSessionsByUserId as dbDeleteSessionsByUserId,
	listActiveSessionsForUser as dbListActiveSessionsForUser,
	deleteArtifactById,
	deleteArtifactsByReleaseId,
	deleteBillingRecordsForUser,
	deleteEmailVerificationCode,
	deleteExpiredSessionsForUser,
	deleteReleaseById,
	deleteSessionById,
	deleteSessionByIdForUser,
	deleteUserById,
	deleteWalletDataForUser,
	findAnyLatestRelease,
	findArtifactBlobById,
	findArtifactByLookup,
	findArtifactMetaById,
	findConflictingArtifact,
	findEmailVerificationCode,
	findMostRecentReleaseByPublishedDesc,
	findReleaseById,
	findSessionById,
	findUserByEmailLower,
	findUserById,
	getDb,
	incrementEmailVerificationAttempts,
	insertArtifact,
	insertRelease,
	insertSession,
	insertUser,
	isUniqueConstraintError,
	listAllUsersSortedByCreatedDesc,
	listArtifactMetaByReleaseIds,
	listReleasesSortedByPublishedDesc,
	setReleaseLatest,
	touchSession,
	uniqueConstraintColumn,
	unsetLatestExcept,
	updateArtifactFields,
	updateArtifactVersionForRelease,
	updateReleaseFields,
	updateUserFields,
	upsertEmailVerificationCode,
} from "./db";
import { sendVerificationCodeEmail } from "./email";
import {
	countRazorpayWebhookSecrets,
	isRazorpayConfigured,
	isRazorpayWebhookConfigured,
} from "./razorpay";
import {
	createWalletTopup,
	getRenewalNoticeForUser,
	getWalletForUser,
	parseVerifyWalletTopupPayload,
	parseWalletPreferencesPayload,
	parseWalletTopupPayload,
	setWalletPreferences,
	startRenewalSweep,
	verifyWalletTopup,
} from "./wallet";

const ONE_DAY_MS = AUTH_COOKIE_MAX_AGE_SECONDS * 1000;
const SESSION_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const FULL_NAME_MAX_LENGTH = 120;
const COMPANY_MAX_LENGTH = 160;
const EMAIL_MAX_LENGTH = 254;
const REQUEST_JSON_MAX_BYTES = 64 * 1024;
const DEFAULT_USER_AGENT = "unknown";
const DEFAULT_CLIENT_IP = "unknown";
const AUTH_MAX_ACTIVE_SESSIONS_PER_USER = Number(Bun.env.AUTH_MAX_ACTIVE_SESSIONS_PER_USER ?? 10);
const AUTH_MAX_SESSIONS_PER_DEVICE = Number(Bun.env.AUTH_MAX_SESSIONS_PER_DEVICE ?? 2);
const AUTH_RATE_LIMIT_WINDOW_MS = Number(Bun.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 60_000);
const AUTH_LOGIN_RATE_LIMIT = Number(Bun.env.AUTH_LOGIN_RATE_LIMIT ?? 20);
const AUTH_SIGNUP_RATE_LIMIT = Number(Bun.env.AUTH_SIGNUP_RATE_LIMIT ?? 10);
const AUTH_SESSION_RATE_LIMIT = Number(Bun.env.AUTH_SESSION_RATE_LIMIT ?? 120);
const AUTH_FORCE_SECURE_COOKIE =
	Bun.env.AUTH_FORCE_SECURE_COOKIE === "1" || Bun.env.AUTH_FORCE_SECURE_COOKIE === "true";
const AUTH_DEVICE_MAX_USER_AGENT_LENGTH = 512;
const RATE_LIMIT_CLEANUP_MAX_STALE_MS = 10 * AUTH_RATE_LIMIT_WINDOW_MS;
const RELEASE_VERSION_MAX_LENGTH = 120;
const RELEASE_NOTES_MAX_LENGTH = 8000;
const RELEASE_TARGET_MAX_LENGTH = 100;
const RELEASE_FILENAME_MAX_LENGTH = 255;
const RELEASE_UPLOAD_MAX_BYTES = Number(Bun.env.RELEASE_UPLOAD_MAX_BYTES ?? 1024 * 1024 * 1024);
const AUTH_VERIFY_EMAIL_RATE_LIMIT = Number(Bun.env.AUTH_VERIFY_EMAIL_RATE_LIMIT ?? 10);
const BILLING_RATE_LIMIT = Number(Bun.env.BILLING_RATE_LIMIT ?? 30);
const RAZORPAY_WEBHOOK_MAX_BYTES = 256 * 1024;
const EMAIL_VERIFICATION_CODE_TTL_MS = Number(Bun.env.AUTH_VERIFY_CODE_TTL_MS ?? 15 * 60 * 1000);
/** Wrong guesses allowed before the code is burned and a new one is required. */
const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
/** Minimum gap between code emails, so resend cannot be used to spam an inbox. */
const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
/**
 * Origins this app is legitimately served from, e.g. the .com and .in domains.
 * A request's own Host/Origin header is attacker-controlled, so it is only ever
 * used after matching against this list — otherwise a forged header could put a
 * link to someone else's site into an email we send.
 */
const APP_ORIGINS: string[] = (() => {
	const configured = [
		...(Bun.env.PUBLIC_APP_ORIGINS ?? "").split(","),
		Bun.env.PUBLIC_APP_URL ?? "",
	]
		.map((value) => value.trim().replace(/\/+$/, ""))
		.filter(Boolean);

	return [...new Set(configured.length ? configured : ["http://localhost:8080"])];
})();

/** Where to point links when the request gives us nothing usable. */
const DEFAULT_APP_ORIGIN = APP_ORIGINS[0] ?? "http://localhost:8080";

/**
 * The app origin a request came from, or null when it is not one of ours.
 * Prefers the Origin header, then the forwarded host, so it works behind a
 * reverse proxy terminating TLS for several domains.
 */
function resolveRequestAppOrigin(request: Request): string | null {
	const candidates: string[] = [];

	const origin = request.headers.get("origin");
	if (origin) candidates.push(origin);

	const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
	if (forwardedHost) {
		const host = forwardedHost.split(",")[0]?.trim();
		if (host) candidates.push(`${inferForwardedProtocol(request)}://${host}`);
	}

	for (const candidate of candidates) {
		const normalized = candidate.trim().replace(/\/+$/, "").toLowerCase();
		const match = APP_ORIGINS.find((allowed) => allowed.toLowerCase() === normalized);
		if (match) return match;
	}

	return null;
}

const PUBLIC_APP_URL = (Bun.env.PUBLIC_APP_URL?.trim() || "http://localhost:8080").replace(
	/\/+$/,
	"",
);

interface RateLimitBucket {
	count: number;
	resetAt: number;
}

interface SessionRequestMeta {
	userAgent: string;
	ipAddress: string;
	deviceKey: string;
}

const rateLimitStore = new Map<string, RateLimitBucket>();

class HttpError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

const RELEASE_PLATFORM_SET = new Set<ReleasePlatform>(RELEASE_PLATFORMS);
const RELEASE_FORMAT_SET = new Set<ReleaseFormat>(RELEASE_FORMATS);

function createUuidV7(): string {
	const maybeUuidV7 = (Bun as unknown as { randomUUIDv7?: () => string }).randomUUIDv7;
	return typeof maybeUuidV7 === "function" ? maybeUuidV7() : crypto.randomUUID();
}

/**
 * A uniformly distributed numeric code. Rejection sampling avoids the modulo
 * bias a plain `% 10` would introduce, which would make some digits likelier.
 */
function createVerificationCode(): string {
	let code = "";
	while (code.length < EMAIL_VERIFICATION_CODE_LENGTH) {
		const byte = crypto.getRandomValues(new Uint8Array(1))[0] ?? 0;
		if (byte >= 250) continue;
		code += String(byte % 10);
	}
	return code;
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

function assertValidEmail(email: string): void {
	if (email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
		throw new HttpError(400, "Please provide a valid email address.");
	}
}

function assertStrongPassword(password: string): void {
	if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
		throw new HttpError(
			400,
			`Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
		);
	}

	if (!/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
		throw new HttpError(400, "Password must include letters, numbers, and at least one symbol.");
	}
}

function assertMaxLength(value: string, maxLength: number, fieldName: string): void {
	if (value.length > maxLength) {
		throw new HttpError(400, `${fieldName} must be ${maxLength} characters or fewer.`);
	}
}

function normalizeBoundedText(
	value: unknown,
	fieldName: string,
	maxLength: number,
	optional = false,
): string | undefined {
	if (value === undefined || value === null) {
		if (optional) return undefined;
		throw new HttpError(400, `${fieldName} is required.`);
	}

	const normalized = String(value).trim();
	if (!normalized) {
		if (optional) return undefined;
		throw new HttpError(400, `${fieldName} is required.`);
	}

	assertMaxLength(normalized, maxLength, fieldName);
	return normalized;
}

function normalizeReleaseVersion(value: unknown, fieldName = "version"): string {
	const normalized = normalizeBoundedText(value, fieldName, RELEASE_VERSION_MAX_LENGTH) ?? "";
	return normalized;
}

function normalizeReleaseNotes(value: unknown): string {
	if (value === undefined || value === null) return "";
	const normalized = String(value).trim();
	assertMaxLength(normalized, RELEASE_NOTES_MAX_LENGTH, "notes");
	return normalized;
}

function normalizeReleaseTarget(value: unknown, optional = false): string | undefined {
	if (value === undefined || value === null) {
		if (optional) return undefined;
		return "universal";
	}

	const normalized = String(value).trim();
	if (!normalized) {
		if (optional) return undefined;
		return "universal";
	}

	assertMaxLength(normalized, RELEASE_TARGET_MAX_LENGTH, "target");
	return normalized;
}

function normalizeReleaseFilename(value: unknown, fallbackName: string): string {
	const normalized = typeof value === "string" ? value.trim() : "";
	const filename = normalized || fallbackName;
	assertMaxLength(filename, RELEASE_FILENAME_MAX_LENGTH, "filename");
	return filename;
}

function normalizeReleasePlatform(value: unknown): ReleasePlatform {
	const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (!RELEASE_PLATFORM_SET.has(normalized as ReleasePlatform)) {
		throw new HttpError(400, `Unsupported platform "${String(value ?? "")}".`);
	}
	return normalized as ReleasePlatform;
}

function normalizeReleaseFormat(value: unknown): ReleaseFormat {
	const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (!RELEASE_FORMAT_SET.has(normalized as ReleaseFormat)) {
		throw new HttpError(400, `Unsupported format "${String(value ?? "")}".`);
	}
	return normalized as ReleaseFormat;
}

function parseOptionalReleaseDate(value: unknown): Date | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}

	const raw = String(value).trim();
	if (!raw) {
		return undefined;
	}

	const parsed = new Date(raw);
	if (Number.isNaN(parsed.getTime())) {
		throw new HttpError(400, "publishedAt must be a valid ISO date/time string.");
	}

	return parsed;
}

function sanitizeRoleFlag(value: unknown): boolean {
	return value === true;
}

function sanitizeUserRoles(roles: unknown): UserRole[] {
	if (Array.isArray(roles)) {
		const filtered = roles.filter(
			(role): role is UserRole => typeof role === "string" && USER_ROLES.includes(role as UserRole),
		);
		return filtered.length > 0 ? [...new Set(filtered)] : [DEFAULT_USER_ROLE];
	}

	if (typeof roles === "string" && USER_ROLES.includes(roles as UserRole)) {
		return [roles as UserRole];
	}

	return [DEFAULT_USER_ROLE];
}

function toAuthUser(user: WithId<UserDocument>): AuthUser {
	const isAdmin = sanitizeRoleFlag(user.isAdmin);
	const isOwner = sanitizeRoleFlag(user.isOwner);
	const storedRoles = sanitizeUserRoles(user.roles).filter(
		(role) => role !== "admin" && role !== "owner",
	);
	const roles = [...new Set([DEFAULT_USER_ROLE, ...storedRoles])];

	if (isAdmin) {
		roles.push("admin");
	}
	if (isOwner) {
		roles.push("owner");
	}

	return {
		id: user._id,
		email: user.email,
		fullName: user.fullName,
		company: user.company,
		isAdmin,
		isOwner,
		emailVerified: sanitizeRoleFlag(user.emailVerified),
		roles,
		createdAt: user.createdAt.toISOString(),
		updatedAt: user.updatedAt.toISOString(),
	};
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
	if (!cookieHeader) return {};
	const parsed: Record<string, string> = {};

	for (const cookie of cookieHeader.split(";")) {
		const trimmed = cookie.trim();
		if (!trimmed) continue;

		const separatorIndex = trimmed.indexOf("=");
		if (separatorIndex < 0) continue;

		const key = trimmed.slice(0, separatorIndex).trim();
		const rawValue = trimmed.slice(separatorIndex + 1).trim();
		parsed[key] = decodeURIComponent(rawValue);
	}

	return parsed;
}

function getSessionIdFromRequest(request: Request): string | null {
	const cookies = parseCookies(request.headers.get("cookie"));
	return cookies[AUTH_COOKIE_NAME] ?? null;
}

function sanitizeHeaderValue(value: string | null, fallback: string, maxLength = 256): string {
	if (!value) return fallback;
	const normalized = value.replace(/\s+/g, " ").trim();
	if (!normalized) return fallback;
	return normalized.slice(0, maxLength);
}

function inferForwardedProtocol(request: Request): string {
	const forwardedProto = request.headers.get("x-forwarded-proto");
	if (forwardedProto) {
		return forwardedProto.split(",")[0]?.trim().toLowerCase() || "http";
	}

	return new URL(request.url).protocol.replace(":", "").toLowerCase();
}

function shouldUseSecureCookie(request: Request): boolean {
	if (AUTH_FORCE_SECURE_COOKIE) return true;
	const protocol = inferForwardedProtocol(request);
	return protocol === "https" || protocol === "wss";
}

function extractClientIp(request: Request): string {
	const forwardedFor = request.headers.get("x-forwarded-for");
	if (forwardedFor) {
		const candidate = forwardedFor
			.split(",")
			.map((entry) => entry.trim())
			.find((entry) => entry.length > 0);
		if (candidate) {
			return candidate.slice(0, 128);
		}
	}

	const proxyIp = request.headers.get("x-real-ip") ?? request.headers.get("cf-connecting-ip");
	return sanitizeHeaderValue(proxyIp, DEFAULT_CLIENT_IP, 128);
}

function buildDeviceKey(request: Request, userAgent: string): string {
	const acceptLanguage = sanitizeHeaderValue(request.headers.get("accept-language"), "na", 128);
	const clientPlatform = sanitizeHeaderValue(request.headers.get("sec-ch-ua-platform"), "na", 64);
	const clientMobile = sanitizeHeaderValue(request.headers.get("sec-ch-ua-mobile"), "na", 16);
	const material = `${userAgent.toLowerCase()}|${acceptLanguage}|${clientPlatform}|${clientMobile}`;
	return createHash("sha256").update(material).digest("hex");
}

function getSessionRequestMeta(request: Request): SessionRequestMeta {
	const userAgent = sanitizeHeaderValue(
		request.headers.get("user-agent"),
		DEFAULT_USER_AGENT,
		AUTH_DEVICE_MAX_USER_AGENT_LENGTH,
	);
	const ipAddress = extractClientIp(request);
	const deviceKey = buildDeviceKey(request, userAgent);
	return { userAgent, ipAddress, deviceKey };
}

function createSessionCookie(sessionId: string, request: Request): string {
	const secure = shouldUseSecureCookie(request);
	return [
		`${AUTH_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
		`Path=${AUTH_BASE_PATH}`,
		`Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}`,
		"HttpOnly",
		"SameSite=Lax",
		...(secure ? ["Secure"] : []),
	].join("; ");
}

function clearSessionCookie(request: Request): string {
	const secure = shouldUseSecureCookie(request);
	return [
		`${AUTH_COOKIE_NAME}=`,
		`Path=${AUTH_BASE_PATH}`,
		"Max-Age=0",
		"HttpOnly",
		"SameSite=Lax",
		...(secure ? ["Secure"] : []),
	].join("; ");
}

function createCorsHeaders(request: Request): Headers {
	const headers = new Headers();
	const origin = request.headers.get("origin");

	if (origin) {
		headers.set("Access-Control-Allow-Origin", origin);
		headers.set("Vary", "Origin");
	}

	headers.set("Access-Control-Allow-Credentials", "true");
	headers.set("Access-Control-Allow-Methods", "GET,HEAD,POST,PATCH,DELETE,OPTIONS");
	headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
	headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
	headers.set("Pragma", "no-cache");
	headers.set("Expires", "0");
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("X-Frame-Options", "DENY");
	headers.set("Referrer-Policy", "same-origin");
	headers.set("X-DNS-Prefetch-Control", "off");
	headers.set("Cross-Origin-Opener-Policy", "same-origin");
	return headers;
}

function jsonResponse(
	request: Request,
	status: number,
	body: object,
	extraHeaders?: Record<string, string>,
): Response {
	const headers = createCorsHeaders(request);
	headers.set("Content-Type", "application/json");

	if (extraHeaders) {
		for (const [key, value] of Object.entries(extraHeaders)) {
			headers.set(key, value);
		}
	}

	return new Response(JSON.stringify(body), { status, headers });
}

function emptyResponse(
	request: Request,
	status: number,
	extraHeaders?: Record<string, string>,
): Response {
	const headers = createCorsHeaders(request);
	if (extraHeaders) {
		for (const [key, value] of Object.entries(extraHeaders)) {
			headers.set(key, value);
		}
	}
	return new Response(null, { status, headers });
}

function parseSignupPayload(payload: unknown): SignupPayload {
	if (!payload || typeof payload !== "object") {
		throw new HttpError(400, "Invalid signup payload.");
	}

	const body = payload as Record<string, unknown>;
	const fullName = normalizeBoundedText(body.fullName, "fullName", FULL_NAME_MAX_LENGTH) ?? "";
	const email = normalizeBoundedText(body.email, "email", EMAIL_MAX_LENGTH) ?? "";
	const company = normalizeBoundedText(body.company, "company", COMPANY_MAX_LENGTH) ?? "";
	const password = String(body.password ?? "");
	if (!password) throw new HttpError(400, "password is required.");

	assertStrongPassword(password);
	assertValidEmail(email);

	return { fullName, email, company, password };
}

function parseLoginPayload(payload: unknown): LoginPayload {
	if (!payload || typeof payload !== "object") {
		throw new HttpError(400, "Invalid login payload.");
	}

	const body = payload as Record<string, unknown>;
	const email = normalizeBoundedText(body.email, "email", EMAIL_MAX_LENGTH) ?? "";
	const password = String(body.password ?? "");

	if (!password) throw new HttpError(400, "password is required.");
	assertValidEmail(email);

	return { email, password };
}

function parseRevokeSessionPayload(payload: unknown): RevokeSessionPayload {
	if (!payload || typeof payload !== "object") {
		throw new HttpError(400, "Invalid revoke-session payload.");
	}

	const body = payload as Record<string, unknown>;
	const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
	if (!sessionId) {
		throw new HttpError(400, "sessionId is required.");
	}

	return { sessionId };
}

function parseVerifyEmailPayload(payload: unknown): VerifyEmailPayload {
	if (!payload || typeof payload !== "object") {
		throw new HttpError(400, "Invalid verification payload.");
	}

	// People paste codes with spaces or dashes from the email; strip anything
	// that is not a digit before validating rather than rejecting the paste.
	const code = String((payload as Record<string, unknown>).code ?? "").replace(/\D/g, "");
	if (code.length !== EMAIL_VERIFICATION_CODE_LENGTH) {
		throw new HttpError(
			400,
			`Enter the ${EMAIL_VERIFICATION_CODE_LENGTH}-digit code from your email.`,
		);
	}

	return { code };
}

function parseUpdatePayload(payload: unknown): UpdateProfilePayload {
	if (!payload || typeof payload !== "object") {
		throw new HttpError(400, "Invalid update payload.");
	}

	const body = payload as Record<string, unknown>;
	const fullName =
		typeof body.fullName === "undefined"
			? undefined
			: normalizeBoundedText(body.fullName, "fullName", FULL_NAME_MAX_LENGTH);
	const company =
		typeof body.company === "undefined"
			? undefined
			: normalizeBoundedText(body.company, "company", COMPANY_MAX_LENGTH);

	if (!fullName && !company) {
		throw new HttpError(400, "At least one profile field must be provided.");
	}

	return { fullName, company };
}

function parseAdminCreateUserPayload(payload: unknown): AdminCreateUserPayload {
	if (!payload || typeof payload !== "object") {
		throw new HttpError(400, "Invalid admin create-user payload.");
	}

	const body = payload as Record<string, unknown>;
	const id = typeof body.id === "string" ? body.id.trim() : undefined;
	const fullName = normalizeBoundedText(body.fullName, "fullName", FULL_NAME_MAX_LENGTH) ?? "";
	const email = normalizeBoundedText(body.email, "email", EMAIL_MAX_LENGTH) ?? "";
	const company = normalizeBoundedText(body.company, "company", COMPANY_MAX_LENGTH) ?? "";
	const password = String(body.password ?? "");
	const isAdmin = sanitizeRoleFlag(body.isAdmin);
	const isOwner = sanitizeRoleFlag(body.isOwner);

	if (id && id.length > 128) {
		throw new HttpError(400, "User id must be 128 characters or fewer.");
	}

	if (!password) throw new HttpError(400, "password is required.");

	assertValidEmail(email);
	assertStrongPassword(password);

	return {
		id,
		fullName,
		email,
		company,
		password,
		isAdmin,
		isOwner,
	};
}

function parseAdminUpdateUserPayload(payload: unknown): AdminUpdateUserPayload {
	if (!payload || typeof payload !== "object") {
		throw new HttpError(400, "Invalid admin update-user payload.");
	}

	const body = payload as Record<string, unknown>;
	const hasOwn = (field: string) => Object.prototype.hasOwnProperty.call(body, field);

	const patch: AdminUpdateUserPayload = {};

	if (hasOwn("fullName")) {
		patch.fullName = normalizeBoundedText(body.fullName, "fullName", FULL_NAME_MAX_LENGTH);
	}

	if (hasOwn("company")) {
		patch.company = normalizeBoundedText(body.company, "company", COMPANY_MAX_LENGTH);
	}

	if (hasOwn("email")) {
		const email = normalizeBoundedText(body.email, "email", EMAIL_MAX_LENGTH) ?? "";
		assertValidEmail(email);
		patch.email = email;
	}

	if (hasOwn("password")) {
		if (typeof body.password !== "string") {
			throw new HttpError(400, "password must be a string.");
		}
		assertStrongPassword(body.password);
		patch.password = body.password;
	}

	if (hasOwn("isAdmin")) {
		if (typeof body.isAdmin !== "boolean") {
			throw new HttpError(400, "isAdmin must be a boolean.");
		}
		patch.isAdmin = body.isAdmin;
	}

	if (hasOwn("isOwner")) {
		if (typeof body.isOwner !== "boolean") {
			throw new HttpError(400, "isOwner must be a boolean.");
		}
		patch.isOwner = body.isOwner;
	}

	if (!Object.keys(patch).length) {
		throw new HttpError(400, "At least one update field is required.");
	}

	return patch;
}

function parseAdminCreateReleasePayload(payload: unknown): AdminCreateReleasePayload {
	if (!payload || typeof payload !== "object") {
		throw new HttpError(400, "Invalid admin create-release payload.");
	}

	const body = payload as Record<string, unknown>;
	const version = normalizeReleaseVersion(body.version);
	const notes = normalizeReleaseNotes(body.notes);
	const publishedAt = parseOptionalReleaseDate(body.publishedAt);
	const isLatest = typeof body.isLatest === "boolean" ? body.isLatest : true;

	return {
		version,
		notes,
		publishedAt: publishedAt?.toISOString(),
		isLatest,
	};
}

function parseAdminUpdateReleasePayload(payload: unknown): AdminUpdateReleasePayload {
	if (!payload || typeof payload !== "object") {
		throw new HttpError(400, "Invalid admin update-release payload.");
	}

	const body = payload as Record<string, unknown>;
	const hasOwn = (field: string) => Object.prototype.hasOwnProperty.call(body, field);
	const patch: AdminUpdateReleasePayload = {};

	if (hasOwn("version")) {
		patch.version = normalizeReleaseVersion(body.version);
	}

	if (hasOwn("notes")) {
		patch.notes = normalizeReleaseNotes(body.notes);
	}

	if (hasOwn("publishedAt")) {
		const publishedAt = parseOptionalReleaseDate(body.publishedAt);
		if (!publishedAt) {
			throw new HttpError(400, "publishedAt must be provided when updating release date.");
		}
		patch.publishedAt = publishedAt.toISOString();
	}

	if (hasOwn("isLatest")) {
		if (typeof body.isLatest !== "boolean") {
			throw new HttpError(400, "isLatest must be a boolean.");
		}
		patch.isLatest = body.isLatest;
	}

	if (!Object.keys(patch).length) {
		throw new HttpError(400, "At least one release update field is required.");
	}

	return patch;
}

function parseAdminUpdateArtifactPayload(payload: unknown): AdminUpdateArtifactPayload {
	if (!payload || typeof payload !== "object") {
		throw new HttpError(400, "Invalid admin update-artifact payload.");
	}

	const body = payload as Record<string, unknown>;
	const hasOwn = (field: string) => Object.prototype.hasOwnProperty.call(body, field);
	const patch: AdminUpdateArtifactPayload = {};

	if (hasOwn("platform")) {
		patch.platform = normalizeReleasePlatform(body.platform);
	}

	if (hasOwn("format")) {
		patch.format = normalizeReleaseFormat(body.format);
	}

	if (hasOwn("target")) {
		patch.target = normalizeReleaseTarget(body.target) ?? "universal";
	}

	if (hasOwn("filename")) {
		if (typeof body.filename !== "string") {
			throw new HttpError(400, "filename must be a string.");
		}
		const trimmed = body.filename.trim();
		if (!trimmed) {
			throw new HttpError(400, "filename cannot be empty.");
		}
		assertMaxLength(trimmed, RELEASE_FILENAME_MAX_LENGTH, "filename");
		patch.filename = trimmed;
	}

	if (!Object.keys(patch).length) {
		throw new HttpError(400, "At least one artifact update field is required.");
	}

	return patch;
}

function assertWithinRateLimit(request: Request, scope: string, maxRequests: number): void {
	if (maxRequests <= 0) return;

	const now = Date.now();
	const clientIp = extractClientIp(request);
	const key = `${scope}:${clientIp}`;
	const existing = rateLimitStore.get(key);

	if (!existing || now >= existing.resetAt) {
		rateLimitStore.set(key, {
			count: 1,
			resetAt: now + AUTH_RATE_LIMIT_WINDOW_MS,
		});
	} else {
		existing.count += 1;
		if (existing.count > maxRequests) {
			throw new HttpError(429, "Too many requests. Please try again shortly.");
		}
	}

	if (rateLimitStore.size > 4000) {
		for (const [entryKey, bucket] of rateLimitStore) {
			if (now - bucket.resetAt > RATE_LIMIT_CLEANUP_MAX_STALE_MS) {
				rateLimitStore.delete(entryKey);
			}
		}
	}
}

function hasPrivilegedAccess(user: WithId<UserDocument>): boolean {
	return sanitizeRoleFlag(user.isAdmin) || sanitizeRoleFlag(user.isOwner);
}

function hasOwnerAccess(user: WithId<UserDocument>): boolean {
	return sanitizeRoleFlag(user.isOwner);
}

async function readRequestJson(request: Request): Promise<unknown> {
	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().includes("application/json")) {
		throw new HttpError(415, "Content-Type must be application/json.");
	}

	const contentLength = Number(request.headers.get("content-length") ?? "0");
	if (Number.isFinite(contentLength) && contentLength > REQUEST_JSON_MAX_BYTES) {
		throw new HttpError(413, "Request payload is too large.");
	}

	try {
		return await request.json();
	} catch {
		throw new HttpError(400, "Malformed JSON body.");
	}
}

async function readRequestFormData(request: Request): Promise<FormData> {
	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().includes("multipart/form-data")) {
		throw new HttpError(415, "Content-Type must be multipart/form-data.");
	}

	const contentLength = Number(request.headers.get("content-length") ?? "0");
	if (Number.isFinite(contentLength) && contentLength > RELEASE_UPLOAD_MAX_BYTES + 1024 * 1024) {
		throw new HttpError(413, "Uploaded artifact is too large.");
	}

	try {
		return await request.formData();
	} catch {
		throw new HttpError(400, "Malformed multipart form data.");
	}
}

function toReleaseArtifactSummary(
	artifact: WithId<ReleaseArtifactDocument>,
): ReleaseArtifactSummary {
	return {
		id: artifact._id,
		releaseId: artifact.releaseId,
		version: artifact.version,
		platform: artifact.platform,
		format: artifact.format,
		target: artifact.target,
		filename: artifact.filename,
		sizeBytes: artifact.sizeBytes,
		sha256: artifact.sha256,
		mimeType: artifact.mimeType,
		createdAt: artifact.createdAt.toISOString(),
		downloadPath: `${DOWNLOADS_BASE_PATH}/artifacts/${artifact._id}/file`,
	};
}

function toReleaseSummary(
	release: WithId<ReleaseVersionDocument>,
	artifacts: WithId<ReleaseArtifactDocument>[],
): ReleaseSummary {
	return {
		id: release._id,
		version: release.version,
		notes: release.notes,
		publishedAt: release.publishedAt.toISOString(),
		isLatest: release.isLatest,
		artifacts: artifacts.map(toReleaseArtifactSummary),
	};
}

async function buildReleaseFeed(limit = 20): Promise<ReleaseFeedResponse> {
	await getDb();
	const releaseList = await listReleasesSortedByPublishedDesc(limit);
	if (!releaseList.length) {
		return { latest: null, releases: [] };
	}

	const releaseIds = releaseList.map((item) => item._id);
	const artifactList = await listArtifactMetaByReleaseIds(releaseIds);

	const artifactMap = new Map<string, WithId<ReleaseArtifactDocument>[]>();
	for (const artifact of artifactList) {
		const existing = artifactMap.get(artifact.releaseId) ?? [];
		existing.push(artifact);
		artifactMap.set(artifact.releaseId, existing);
	}

	const summaries = releaseList.map((release) =>
		toReleaseSummary(release, artifactMap.get(release._id) ?? []),
	);
	const latest = summaries.find((item) => item.isLatest) ?? summaries[0] ?? null;

	return {
		latest,
		releases: summaries,
	};
}

function resolveReleaseMimeType(format: ReleaseFormat, uploadedType?: string): string {
	if (uploadedType?.trim()) {
		return uploadedType.trim();
	}

	switch (format) {
		case "dmg":
			return "application/x-apple-diskimage";
		case "exe":
			return "application/vnd.microsoft.portable-executable";
		case "appimage":
			return "application/octet-stream";
		case "deb":
			return "application/vnd.debian.binary-package";
		case "rpm":
			return "application/x-rpm";
		case "zip":
			return "application/zip";
		case "tar.gz":
			return "application/gzip";
		case "tar.zst":
			return "application/zstd";
		default:
			return "application/octet-stream";
	}
}

async function computeFileSha256(file: File): Promise<string> {
	const hash = createHash("sha256");
	const fileBuffer = await file.arrayBuffer();
	hash.update(new Uint8Array(fileBuffer));
	return hash.digest("hex");
}

async function setLatestReleaseId(releaseId: string, now: Date): Promise<void> {
	await getDb();
	await unsetLatestExcept(releaseId, now);
	await setReleaseLatest(releaseId, true, now);
}

async function ensureAtLeastOneLatestRelease(now: Date): Promise<void> {
	await getDb();
	if (await findAnyLatestRelease()) return;

	const fallback = await findMostRecentReleaseByPublishedDesc();
	if (!fallback) return;
	await setReleaseLatest(fallback._id, true, now);
}

async function createReleaseByAdmin(payload: AdminCreateReleasePayload): Promise<void> {
	await getDb();
	const now = new Date();
	const releaseId = crypto.randomUUID();
	const publishedAt = payload.publishedAt ? new Date(payload.publishedAt) : now;
	const shouldBeLatest = payload.isLatest ?? true;

	try {
		await insertRelease({
			_id: releaseId,
			version: payload.version,
			notes: payload.notes ?? "",
			publishedAt,
			isLatest: shouldBeLatest,
			createdAt: now,
			updatedAt: now,
		});
	} catch (error) {
		if (isUniqueConstraintError(error)) {
			throw new HttpError(409, "A release with this version already exists.");
		}
		throw error;
	}

	if (shouldBeLatest) {
		await setLatestReleaseId(releaseId, now);
	} else {
		await ensureAtLeastOneLatestRelease(now);
	}
}

async function updateReleaseByAdmin(
	releaseId: string,
	payload: AdminUpdateReleasePayload,
): Promise<void> {
	await getDb();
	const now = new Date();

	const current = await findReleaseById(releaseId);
	if (!current) {
		throw new HttpError(404, "Release not found.");
	}

	const patch: Partial<ReleaseVersionDocument> = { updatedAt: now };
	if (typeof payload.version === "string") patch.version = payload.version;
	if (typeof payload.notes === "string") patch.notes = payload.notes;
	if (typeof payload.publishedAt === "string") patch.publishedAt = new Date(payload.publishedAt);

	try {
		await updateReleaseFields(releaseId, patch);
	} catch (error) {
		if (isUniqueConstraintError(error)) {
			throw new HttpError(409, "A release with this version already exists.");
		}
		throw error;
	}

	if (typeof payload.version === "string" && payload.version !== current.version) {
		await updateArtifactVersionForRelease(releaseId, payload.version);
	}

	if (payload.isLatest === true) {
		await setLatestReleaseId(releaseId, now);
	} else if (payload.isLatest === false) {
		await setReleaseLatest(releaseId, false, now);
		await ensureAtLeastOneLatestRelease(now);
	}
}

async function deleteReleaseByAdmin(releaseId: string): Promise<number> {
	await getDb();
	const now = new Date();

	const release = await findReleaseById(releaseId);
	if (!release) {
		throw new HttpError(404, "Release not found.");
	}

	const deletedArtifacts = await deleteArtifactsByReleaseId(releaseId);
	await deleteReleaseById(releaseId);
	await ensureAtLeastOneLatestRelease(now);

	return deletedArtifacts;
}

async function uploadReleaseArtifactByAdmin(releaseId: string, formData: FormData): Promise<void> {
	const fileEntry = formData.get("file");
	if (!(fileEntry instanceof File)) {
		throw new HttpError(400, "Artifact file is required.");
	}

	if (fileEntry.size <= 0) {
		throw new HttpError(400, "Uploaded artifact cannot be empty.");
	}
	if (fileEntry.size > RELEASE_UPLOAD_MAX_BYTES) {
		throw new HttpError(413, "Uploaded artifact is too large.");
	}

	await getDb();
	const release = await findReleaseById(releaseId);
	if (!release) {
		throw new HttpError(404, "Release not found.");
	}

	const platform = normalizeReleasePlatform(formData.get("platform"));
	const format = normalizeReleaseFormat(formData.get("format"));
	const target = normalizeReleaseTarget(formData.get("target")) ?? "universal";
	const filename = normalizeReleaseFilename(
		formData.get("filename"),
		fileEntry.name || "artifact.bin",
	);
	const now = new Date();

	const existing = await findArtifactByLookup(releaseId, platform, format, target);
	if (existing) {
		await deleteArtifactById(existing._id);
	}

	const sha256 = await computeFileSha256(fileEntry);
	const fileBuffer = new Uint8Array(await fileEntry.arrayBuffer());

	await insertArtifact(
		{
			_id: crypto.randomUUID(),
			releaseId,
			version: release.version,
			platform,
			format,
			target,
			filename,
			sizeBytes: fileEntry.size,
			sha256,
			mimeType: resolveReleaseMimeType(format, fileEntry.type),
			createdAt: now,
		},
		fileBuffer,
	);
}

async function updateReleaseArtifactByAdmin(
	artifactId: string,
	payload: AdminUpdateArtifactPayload,
): Promise<void> {
	await getDb();
	const existing = await findArtifactMetaById(artifactId);
	if (!existing) {
		throw new HttpError(404, "Release artifact not found.");
	}

	const nextPlatform = payload.platform ?? existing.platform;
	const nextFormat = payload.format ?? existing.format;
	const nextTarget = payload.target ?? existing.target;

	const conflicting = await findConflictingArtifact(
		artifactId,
		existing.releaseId,
		nextPlatform,
		nextFormat,
		nextTarget,
	);
	if (conflicting) {
		throw new HttpError(
			409,
			"An artifact for this release already exists with the same platform, format, and target.",
		);
	}

	const patch: Partial<ReleaseArtifactDocument> = {};
	if (payload.platform) patch.platform = payload.platform;
	if (payload.format) patch.format = payload.format;
	if (payload.target) patch.target = payload.target;
	if (payload.filename) patch.filename = payload.filename;

	if (Object.keys(patch).length === 0) {
		return;
	}

	if (patch.format) {
		patch.mimeType = resolveReleaseMimeType(patch.format);
	}

	await updateArtifactFields(artifactId, patch);
}

async function deleteReleaseArtifactByAdmin(artifactId: string): Promise<void> {
	await getDb();
	const existing = await findArtifactMetaById(artifactId);
	if (!existing) {
		throw new HttpError(404, "Release artifact not found.");
	}

	await deleteArtifactById(artifactId);
}

async function getReleaseArtifactById(
	artifactId: string,
): Promise<WithId<ReleaseArtifactDocument> | null> {
	await getDb();
	return await findArtifactMetaById(artifactId);
}

async function buildDownloadResponse(request: Request, artifactId: string): Promise<Response> {
	const artifact = await getReleaseArtifactById(artifactId);
	if (!artifact) {
		throw new HttpError(404, "Release artifact not found.");
	}

	const blob = await findArtifactBlobById(artifactId);
	if (!blob) {
		throw new HttpError(404, "Artifact file content not found.");
	}

	const headers = createCorsHeaders(request);
	headers.set("Content-Type", artifact.mimeType);
	headers.set(
		"Content-Disposition",
		`attachment; filename="${artifact.filename.replaceAll('"', "'")}"`,
	);
	headers.set("Content-Length", String(artifact.sizeBytes));
	headers.set("Cache-Control", "public, max-age=300, immutable");

	return new Response(blob, {
		status: 200,
		headers,
	});
}

async function createUser(payload: SignupPayload): Promise<WithId<UserDocument>> {
	await getDb();
	const now = new Date();
	const passwordHash = await Bun.password.hash(payload.password);

	const user: UserDocument = {
		_id: createUuidV7(),
		email: payload.email.trim(),
		emailLower: normalizeEmail(payload.email),
		fullName: payload.fullName.trim(),
		company: payload.company.trim(),
		isAdmin: false,
		isOwner: false,
		emailVerified: false,
		roles: [DEFAULT_USER_ROLE],
		passwordHash,
		createdAt: now,
		updatedAt: now,
	};

	try {
		await insertUser(user);
	} catch (error) {
		if (isUniqueConstraintError(error)) {
			throw new HttpError(409, "An account with this email already exists.");
		}
		throw error;
	}

	return user;
}

/**
 * Issues a fresh code, replacing any previous one, and hands back the plaintext
 * for delivery. Storing the code is awaited by callers so it is durable the
 * moment signup responds; only the email send is allowed to lag behind.
 */
async function issueVerificationCode(user: WithId<UserDocument>): Promise<string> {
	await getDb();
	const code = createVerificationCode();
	const codeHash = await Bun.password.hash(code);
	await upsertEmailVerificationCode({
		userId: user._id,
		codeHash,
		expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_CODE_TTL_MS),
	});
	return code;
}

function deliverVerificationCode(user: WithId<UserDocument>, code: string): Promise<void> {
	return sendVerificationCodeEmail(
		user.email,
		user.fullName,
		code,
		Math.round(EMAIL_VERIFICATION_CODE_TTL_MS / 60_000),
	);
}

/** Issues a code and waits for the email to go out. */
async function sendVerificationEmailToUser(user: WithId<UserDocument>): Promise<void> {
	const code = await issueVerificationCode(user);
	await deliverVerificationCode(user, code);
}

async function findUserByEmail(email: string): Promise<WithId<UserDocument> | null> {
	await getDb();
	return await findUserByEmailLower(normalizeEmail(email));
}

function toAuthSession(session: WithId<SessionDocument>, currentSessionId: string): AuthSession {
	return {
		id: session._id,
		userAgent: session.userAgent,
		ipAddress: session.ipAddress,
		deviceKey: session.deviceKey,
		createdAt: session.createdAt.toISOString(),
		updatedAt: session.updatedAt.toISOString(),
		expiresAt: session.expiresAt.toISOString(),
		current: session._id === currentSessionId,
	};
}

interface ResolvedSessionContext {
	user: WithId<UserDocument>;
	session: WithId<SessionDocument>;
}

async function createSession(
	userId: string,
	meta: SessionRequestMeta,
): Promise<WithId<SessionDocument>> {
	await getDb();
	const now = new Date();
	await deleteExpiredSessionsForUser(userId, now);

	const activeDeviceSessionCount = await countActiveSessionsForDevice(userId, meta.deviceKey, now);
	if (activeDeviceSessionCount >= AUTH_MAX_SESSIONS_PER_DEVICE) {
		throw new HttpError(
			409,
			`This device already has ${AUTH_MAX_SESSIONS_PER_DEVICE} active session(s). Log out from one before signing in again.`,
		);
	}

	const activeSessionCount = await countActiveSessionsForUser(userId, now);
	if (activeSessionCount >= AUTH_MAX_ACTIVE_SESSIONS_PER_USER) {
		throw new HttpError(
			429,
			`Maximum active sessions reached (${AUTH_MAX_ACTIVE_SESSIONS_PER_USER}). Revoke an existing session and try again.`,
		);
	}

	const session: SessionDocument = {
		_id: createUuidV7(),
		userId,
		userAgent: meta.userAgent,
		ipAddress: meta.ipAddress,
		deviceKey: meta.deviceKey,
		createdAt: now,
		updatedAt: now,
		expiresAt: new Date(now.getTime() + ONE_DAY_MS),
	};

	await insertSession(session);
	return session;
}

async function deleteSession(sessionId: string): Promise<void> {
	await getDb();
	await deleteSessionById(sessionId);
}

async function deleteSessionForUser(userId: string, sessionId: string): Promise<boolean> {
	await getDb();
	return await deleteSessionByIdForUser(sessionId, userId);
}

async function deleteAllSessionsForUser(userId: string): Promise<number> {
	await getDb();
	return await dbDeleteAllSessionsForUserId(userId);
}

async function listActiveSessionsForUser(
	userId: string,
	currentSessionId: string,
): Promise<SessionListResponse> {
	await getDb();
	const now = new Date();
	await deleteExpiredSessionsForUser(userId, now);

	const activeSessions = await dbListActiveSessionsForUser(userId, now);

	return {
		sessions: activeSessions.map((session) => toAuthSession(session, currentSessionId)),
	};
}

async function resolveSessionUser(request: Request): Promise<ResolvedSessionContext | null> {
	const sessionId = getSessionIdFromRequest(request);
	if (!sessionId) return null;

	await getDb();
	const now = Date.now();
	const requestMeta = getSessionRequestMeta(request);

	const session = await findSessionById(sessionId);
	if (!session) return null;

	if (session.expiresAt.getTime() <= now) {
		await deleteSessionById(session._id);
		return null;
	}

	if (session.deviceKey !== requestMeta.deviceKey) {
		await deleteSessionById(session._id);
		return null;
	}

	const user = await findUserById(session.userId);
	if (!user) {
		await deleteSessionById(session._id);
		return null;
	}

	if (now - session.updatedAt.getTime() >= SESSION_REFRESH_INTERVAL_MS) {
		const refreshed = {
			updatedAt: new Date(now),
			expiresAt: new Date(now + ONE_DAY_MS),
			ipAddress: requestMeta.ipAddress,
			userAgent: requestMeta.userAgent,
		} satisfies Partial<SessionDocument>;
		await touchSession(session._id, refreshed);
		session.updatedAt = refreshed.updatedAt ?? session.updatedAt;
		session.expiresAt = refreshed.expiresAt ?? session.expiresAt;
		session.userAgent = refreshed.userAgent ?? session.userAgent;
		session.ipAddress = refreshed.ipAddress ?? session.ipAddress;
	}

	return { user, session };
}

async function updateUser(
	userId: string,
	payload: UpdateProfilePayload,
): Promise<WithId<UserDocument>> {
	await getDb();
	const patch: Partial<UserDocument> = { updatedAt: new Date() };
	if (payload.fullName) patch.fullName = payload.fullName;
	if (payload.company) patch.company = payload.company;

	await updateUserFields(userId, patch);
	const updated = await findUserById(userId);
	if (!updated) {
		throw new HttpError(404, "User not found.");
	}
	return updated;
}

async function deleteUser(userId: string): Promise<void> {
	await getDb();
	await deleteUserById(userId);
	await dbDeleteSessionsByUserId(userId);
	await deleteBillingRecordsForUser(userId);
	await deleteWalletDataForUser(userId);
}

async function requirePrivilegedSession(request: Request): Promise<ResolvedSessionContext> {
	const session = await resolveSessionUser(request);
	if (!session) {
		throw new HttpError(401, "Unauthorized.");
	}

	if (!hasPrivilegedAccess(session.user)) {
		throw new HttpError(403, "Admin or owner access required.");
	}

	return session;
}

async function listAdminUsers(): Promise<AdminUserListResponse> {
	await getDb();
	const userDocs = await listAllUsersSortedByCreatedDesc();
	const mappedUsers = userDocs.map((user) => toAuthUser(user));
	const stats: AdminUserListStats = {
		totalUsers: mappedUsers.length,
		adminUsers: mappedUsers.filter((user) => user.isAdmin).length,
		ownerUsers: mappedUsers.filter((user) => user.isOwner).length,
	};

	return {
		users: mappedUsers,
		stats,
	};
}

async function createUserByAdmin(payload: AdminCreateUserPayload): Promise<WithId<UserDocument>> {
	await getDb();
	const now = new Date();
	const passwordHash = await Bun.password.hash(payload.password);
	const userId = payload.id?.trim() || createUuidV7();

	const user: UserDocument = {
		_id: userId,
		email: payload.email.trim(),
		emailLower: normalizeEmail(payload.email),
		fullName: payload.fullName.trim(),
		company: payload.company.trim(),
		isAdmin: payload.isAdmin ?? false,
		isOwner: payload.isOwner ?? false,
		emailVerified: true,
		roles: [DEFAULT_USER_ROLE],
		passwordHash,
		createdAt: now,
		updatedAt: now,
	};

	try {
		await insertUser(user);
	} catch (error) {
		if (isUniqueConstraintError(error)) {
			if (uniqueConstraintColumn(error) === "id") {
				throw new HttpError(409, "A user with this id already exists.");
			}
			throw new HttpError(409, "A user with this email already exists.");
		}
		throw error;
	}

	return user;
}

async function updateUserByAdmin(
	actor: WithId<UserDocument>,
	targetUserId: string,
	payload: AdminUpdateUserPayload,
): Promise<WithId<UserDocument>> {
	await getDb();
	const target = await findUserById(targetUserId);
	if (!target) {
		throw new HttpError(404, "User not found.");
	}

	if (sanitizeRoleFlag(target.isOwner) && !hasOwnerAccess(actor) && actor._id !== targetUserId) {
		throw new HttpError(403, "Only owners can modify another owner account.");
	}

	if (payload.isOwner === true && !hasOwnerAccess(actor)) {
		throw new HttpError(403, "Only owners can assign owner role.");
	}

	const nextIsOwner = payload.isOwner ?? sanitizeRoleFlag(target.isOwner);
	const nextIsAdmin = payload.isAdmin ?? sanitizeRoleFlag(target.isAdmin);

	if (actor._id === targetUserId && !nextIsAdmin && !nextIsOwner) {
		throw new HttpError(400, "You cannot remove your own privileged access.");
	}

	const patch: Partial<UserDocument> = {
		updatedAt: new Date(),
	};

	if (typeof payload.fullName === "string") patch.fullName = payload.fullName.trim();
	if (typeof payload.company === "string") patch.company = payload.company.trim();
	if (typeof payload.email === "string") {
		patch.email = payload.email.trim();
		patch.emailLower = normalizeEmail(payload.email);
	}
	if (typeof payload.isAdmin === "boolean") patch.isAdmin = payload.isAdmin;
	if (typeof payload.isOwner === "boolean") patch.isOwner = payload.isOwner;
	if (typeof payload.password === "string") {
		patch.passwordHash = await Bun.password.hash(payload.password);
	}

	try {
		await updateUserFields(targetUserId, patch);
	} catch (error) {
		if (isUniqueConstraintError(error)) {
			throw new HttpError(409, "A user with this email already exists.");
		}
		throw error;
	}

	const updated = await findUserById(targetUserId);
	if (!updated) {
		throw new HttpError(404, "User not found.");
	}
	return updated;
}

async function deleteUserByAdmin(actor: WithId<UserDocument>, targetUserId: string): Promise<void> {
	await getDb();
	const target = await findUserById(targetUserId);

	if (!target) {
		throw new HttpError(404, "User not found.");
	}

	if (sanitizeRoleFlag(target.isOwner) && !hasOwnerAccess(actor)) {
		throw new HttpError(403, "Only owners can delete owner accounts.");
	}

	if (actor._id === targetUserId) {
		throw new HttpError(400, "You cannot delete your own account from admin panel.");
	}

	await deleteUser(targetUserId);
}

function buildAuthSuccessResponse(user: WithId<UserDocument>): AuthSuccessResponse {
	return { user: toAuthUser(user) };
}

function buildSessionResponse(user: WithId<UserDocument> | null): SessionResponse {
	return user
		? { authenticated: true, user: toAuthUser(user) }
		: { authenticated: false, user: null };
}

function buildErrorResponse(message: string): ApiErrorResponse {
	return { error: message };
}

async function handleSignup(request: Request): Promise<Response> {
	const payload = parseSignupPayload(await readRequestJson(request));
	assertWithinRateLimit(request, `signup:${normalizeEmail(payload.email)}`, AUTH_SIGNUP_RATE_LIMIT);
	const user = await createUser(payload);

	// Remember which of our domains this account signed up on, so mail sent
	// later by a background job links back to the same place.
	const signupOrigin = resolveRequestAppOrigin(request);
	if (signupOrigin) {
		await updateUserFields(user._id, { preferredOrigin: signupOrigin, updatedAt: new Date() });
		user.preferredOrigin = signupOrigin;
	}

	// The code is stored before responding, so it is already valid when the
	// browser lands on the verification step. Only delivery is left to run in
	// the background, since a slow mail provider should not stall signup.
	const code = await issueVerificationCode(user);
	void deliverVerificationCode(user, code).catch((error) => {
		console.error("[auth] Failed to send signup verification email:", error);
	});

	const session = await createSession(user._id, getSessionRequestMeta(request));

	return jsonResponse(request, 201, buildAuthSuccessResponse(user), {
		"Set-Cookie": createSessionCookie(session._id, request),
	});
}

/** Keeps a user's remembered domain in step with where they actually sign in. */
async function rememberAppOrigin(request: Request, user: WithId<UserDocument>): Promise<void> {
	const origin = resolveRequestAppOrigin(request);
	if (!origin || user.preferredOrigin === origin) return;
	await updateUserFields(user._id, { preferredOrigin: origin, updatedAt: new Date() });
	user.preferredOrigin = origin;
}

async function handleLogin(request: Request): Promise<Response> {
	const payload = parseLoginPayload(await readRequestJson(request));
	assertWithinRateLimit(request, `login:${normalizeEmail(payload.email)}`, AUTH_LOGIN_RATE_LIMIT);
	const user = await findUserByEmail(payload.email);

	if (!user) {
		throw new HttpError(401, "Invalid email or password.");
	}

	const verified = await Bun.password.verify(payload.password, user.passwordHash);
	if (!verified) {
		throw new HttpError(401, "Invalid email or password.");
	}

	// Only after the session is actually granted — a login refused by the
	// device-session cap should not move where this account's mail points.
	const session = await createSession(user._id, getSessionRequestMeta(request));
	await rememberAppOrigin(request, user);

	return jsonResponse(request, 200, buildAuthSuccessResponse(user), {
		"Set-Cookie": createSessionCookie(session._id, request),
	});
}

async function handleLogout(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "logout", AUTH_SESSION_RATE_LIMIT);
	const sessionId = getSessionIdFromRequest(request);
	if (sessionId) {
		await deleteSession(sessionId);
	}

	return emptyResponse(request, 204, {
		"Set-Cookie": clearSessionCookie(request),
	});
}

async function handleVerifyEmail(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "verify-email", AUTH_VERIFY_EMAIL_RATE_LIMIT);

	// Signup signs the user in before verification, so the account being
	// verified is always the session's own. That removes the guessable
	// identifier a link-based flow would otherwise have to carry around.
	const session = await resolveSessionUser(request);
	if (!session) {
		throw new HttpError(401, "Sign in to verify your email address.");
	}

	const payload = parseVerifyEmailPayload(await readRequestJson(request));
	await getDb();

	const user = session.user;
	if (sanitizeRoleFlag(user.emailVerified)) {
		const already: VerifyEmailResponse = { verified: true, email: user.email };
		return jsonResponse(request, 200, already);
	}

	const record = await findEmailVerificationCode(user._id);
	if (!record) {
		throw new HttpError(400, "Request a new code to continue.");
	}

	if (record.expiresAt.getTime() <= Date.now()) {
		await deleteEmailVerificationCode(user._id);
		throw new HttpError(400, "That code has expired. Request a new one.");
	}

	if (record.attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
		await deleteEmailVerificationCode(user._id);
		throw new HttpError(429, "Too many incorrect codes. Request a new one.");
	}

	if (!(await Bun.password.verify(payload.code, record.codeHash))) {
		const attempts = await incrementEmailVerificationAttempts(user._id);
		const remaining = Math.max(0, EMAIL_VERIFICATION_MAX_ATTEMPTS - attempts);
		if (remaining === 0) {
			await deleteEmailVerificationCode(user._id);
			throw new HttpError(429, "Too many incorrect codes. Request a new one.");
		}
		throw new HttpError(
			400,
			`That code is not correct. ${remaining} attempt${remaining === 1 ? "" : "s"} left.`,
		);
	}

	await updateUserFields(user._id, { emailVerified: true, updatedAt: new Date() });
	await deleteEmailVerificationCode(user._id);

	const response: VerifyEmailResponse = { verified: true, email: user.email };
	return jsonResponse(request, 200, response);
}

async function handleResendVerification(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "verify-email:resend", AUTH_VERIFY_EMAIL_RATE_LIMIT);
	const session = await resolveSessionUser(request);
	if (!session) {
		throw new HttpError(401, "Unauthorized.");
	}

	if (sanitizeRoleFlag(session.user.emailVerified)) {
		throw new HttpError(400, "Email is already verified.");
	}

	await getDb();
	// A per-account cooldown on top of the per-IP rate limit, so one signed-in
	// account cannot be used to repeatedly mail its own inbox.
	const existing = await findEmailVerificationCode(session.user._id);
	if (existing) {
		const elapsed = Date.now() - existing.lastSentAt.getTime();
		if (elapsed < EMAIL_VERIFICATION_RESEND_COOLDOWN_MS) {
			const wait = Math.ceil((EMAIL_VERIFICATION_RESEND_COOLDOWN_MS - elapsed) / 1000);
			throw new HttpError(
				429,
				`Wait ${wait} more second${wait === 1 ? "" : "s"} before requesting another code.`,
			);
		}
	}

	await sendVerificationEmailToUser(session.user);
	const response: ResendVerificationResponse = {
		sent: true,
		retryAfterSeconds: Math.round(EMAIL_VERIFICATION_RESEND_COOLDOWN_MS / 1000),
	};
	return jsonResponse(request, 200, response);
}

async function handleSession(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "session", AUTH_SESSION_RATE_LIMIT);
	const session = await resolveSessionUser(request);
	return jsonResponse(request, 200, buildSessionResponse(session?.user ?? null));
}

async function handleGetMe(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "me:get", AUTH_SESSION_RATE_LIMIT);
	const session = await resolveSessionUser(request);
	if (!session) {
		throw new HttpError(401, "Unauthorized.");
	}

	return jsonResponse(request, 200, buildAuthSuccessResponse(session.user));
}

async function handlePatchMe(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "me:patch", AUTH_SESSION_RATE_LIMIT);
	const session = await resolveSessionUser(request);
	if (!session) {
		throw new HttpError(401, "Unauthorized.");
	}

	const payload = parseUpdatePayload(await readRequestJson(request));
	const updatedUser = await updateUser(session.user._id, payload);
	return jsonResponse(request, 200, buildAuthSuccessResponse(updatedUser));
}

async function handleDeleteMe(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "me:delete", AUTH_SESSION_RATE_LIMIT);
	const session = await resolveSessionUser(request);
	if (!session) {
		throw new HttpError(401, "Unauthorized.");
	}

	await deleteUser(session.user._id);
	return emptyResponse(request, 204, {
		"Set-Cookie": clearSessionCookie(request),
	});
}

async function handleListSessions(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "sessions:list", AUTH_SESSION_RATE_LIMIT);
	const session = await resolveSessionUser(request);
	if (!session) {
		throw new HttpError(401, "Unauthorized.");
	}

	const response = await listActiveSessionsForUser(session.user._id, session.session._id);
	return jsonResponse(request, 200, response);
}

async function handleRevokeSession(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "sessions:revoke", AUTH_SESSION_RATE_LIMIT);
	const auth = await resolveSessionUser(request);
	if (!auth) {
		throw new HttpError(401, "Unauthorized.");
	}

	const payload = parseRevokeSessionPayload(await readRequestJson(request));
	const deleted = await deleteSessionForUser(auth.user._id, payload.sessionId);
	if (!deleted) {
		throw new HttpError(404, "Session not found.");
	}

	const response: RevokeSessionResponse = { revoked: true };
	const extraHeaders =
		payload.sessionId === auth.session._id
			? {
					"Set-Cookie": clearSessionCookie(request),
				}
			: undefined;

	return jsonResponse(request, 200, response, extraHeaders);
}

async function handleLogoutAllSessions(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "sessions:logout-all", AUTH_SESSION_RATE_LIMIT);
	const auth = await resolveSessionUser(request);
	if (!auth) {
		throw new HttpError(401, "Unauthorized.");
	}

	const revokedCount = await deleteAllSessionsForUser(auth.user._id);
	const response: LogoutAllSessionsResponse = { revokedCount };
	return jsonResponse(request, 200, response, {
		"Set-Cookie": clearSessionCookie(request),
	});
}

async function handleAdminListUsers(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "admin:users:list", AUTH_SESSION_RATE_LIMIT);
	await requirePrivilegedSession(request);
	const response = await listAdminUsers();
	return jsonResponse(request, 200, response);
}

async function handleAdminCreateUser(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "admin:users:create", AUTH_SESSION_RATE_LIMIT);
	const adminSession = await requirePrivilegedSession(request);
	const payload = parseAdminCreateUserPayload(await readRequestJson(request));

	if (payload.isOwner && !hasOwnerAccess(adminSession.user)) {
		throw new HttpError(403, "Only owners can create owner accounts.");
	}

	const created = await createUserByAdmin(payload);
	return jsonResponse(request, 201, buildAuthSuccessResponse(created));
}

async function handleAdminUpdateUser(request: Request, userId: string): Promise<Response> {
	assertWithinRateLimit(request, "admin:users:update", AUTH_SESSION_RATE_LIMIT);
	const adminSession = await requirePrivilegedSession(request);
	const payload = parseAdminUpdateUserPayload(await readRequestJson(request));
	const updated = await updateUserByAdmin(adminSession.user, userId, payload);
	return jsonResponse(request, 200, buildAuthSuccessResponse(updated));
}

async function handleAdminDeleteUser(request: Request, userId: string): Promise<Response> {
	assertWithinRateLimit(request, "admin:users:delete", AUTH_SESSION_RATE_LIMIT);
	const adminSession = await requirePrivilegedSession(request);
	await deleteUserByAdmin(adminSession.user, userId);
	const response: AdminDeleteUserResponse = { deleted: true };
	return jsonResponse(request, 200, response);
}

async function handleAdminListReleases(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "admin:releases:list", AUTH_SESSION_RATE_LIMIT);
	await requirePrivilegedSession(request);
	const feed = await buildReleaseFeed(100);
	return jsonResponse(request, 200, feed);
}

async function handleAdminCreateRelease(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "admin:releases:create", AUTH_SESSION_RATE_LIMIT);
	await requirePrivilegedSession(request);
	const payload = parseAdminCreateReleasePayload(await readRequestJson(request));
	await createReleaseByAdmin(payload);
	const feed = await buildReleaseFeed(100);
	return jsonResponse(request, 201, feed);
}

async function handleAdminUpdateRelease(request: Request, releaseId: string): Promise<Response> {
	assertWithinRateLimit(request, "admin:releases:update", AUTH_SESSION_RATE_LIMIT);
	await requirePrivilegedSession(request);
	const payload = parseAdminUpdateReleasePayload(await readRequestJson(request));
	await updateReleaseByAdmin(releaseId, payload);
	const feed = await buildReleaseFeed(100);
	return jsonResponse(request, 200, feed);
}

async function handleAdminDeleteRelease(request: Request, releaseId: string): Promise<Response> {
	assertWithinRateLimit(request, "admin:releases:delete", AUTH_SESSION_RATE_LIMIT);
	await requirePrivilegedSession(request);
	const deletedArtifacts = await deleteReleaseByAdmin(releaseId);
	const response: AdminDeleteReleaseResponse = {
		deleted: true,
		deletedArtifacts,
	};
	return jsonResponse(request, 200, response);
}

async function handleAdminUploadReleaseArtifact(
	request: Request,
	releaseId: string,
): Promise<Response> {
	assertWithinRateLimit(request, "admin:artifacts:create", AUTH_SESSION_RATE_LIMIT);
	await requirePrivilegedSession(request);
	const formData = await readRequestFormData(request);
	await uploadReleaseArtifactByAdmin(releaseId, formData);
	const feed = await buildReleaseFeed(100);
	return jsonResponse(request, 201, feed);
}

async function handleAdminUpdateReleaseArtifact(
	request: Request,
	artifactId: string,
): Promise<Response> {
	assertWithinRateLimit(request, "admin:artifacts:update", AUTH_SESSION_RATE_LIMIT);
	await requirePrivilegedSession(request);
	const payload = parseAdminUpdateArtifactPayload(await readRequestJson(request));
	await updateReleaseArtifactByAdmin(artifactId, payload);
	const feed = await buildReleaseFeed(100);
	return jsonResponse(request, 200, feed);
}

async function handleAdminDeleteReleaseArtifact(
	request: Request,
	artifactId: string,
): Promise<Response> {
	assertWithinRateLimit(request, "admin:artifacts:delete", AUTH_SESSION_RATE_LIMIT);
	await requirePrivilegedSession(request);
	await deleteReleaseArtifactByAdmin(artifactId);
	const response: AdminDeleteArtifactResponse = { deleted: true };
	return jsonResponse(request, 200, response);
}

async function handleReleasesFeed(request: Request): Promise<Response> {
	const feed = await buildReleaseFeed();
	return jsonResponse(request, 200, feed);
}

async function handleLatestRelease(request: Request): Promise<Response> {
	const feed = await buildReleaseFeed();
	return jsonResponse(request, 200, {
		latest: feed.latest,
	});
}

interface StatusCheckResult {
	status: StatusLevel;
	latencyMs: number;
	detail: string;
}

async function checkTelegramWebhook(): Promise<StatusCheckResult> {
	const startedAt = Date.now();
	const enabledFlag = Bun.env.TELEGRAM_BOT_ENABLED?.trim().toLowerCase();
	const enabled =
		enabledFlag === undefined ||
		enabledFlag === "" ||
		enabledFlag === "1" ||
		enabledFlag === "true" ||
		enabledFlag === "yes";
	const hasToken = Boolean(Bun.env.BOT_TOKEN?.trim());

	if (!enabled) {
		return {
			status: "degraded",
			latencyMs: Date.now() - startedAt,
			detail: "Telegram bot disabled via configuration.",
		};
	}
	if (!hasToken) {
		return {
			status: "outage",
			latencyMs: Date.now() - startedAt,
			detail: "Telegram bot token is not configured.",
		};
	}

	const hasWebhookBase = Boolean((Bun.env.TELEGRAM_WEBHOOK_BASE_URL ?? Bun.env.API_URL)?.trim());
	return {
		status: "operational",
		latencyMs: Date.now() - startedAt,
		detail: hasWebhookBase
			? "Webhook configured and receiving updates."
			: "Long polling active; webhook base URL not set.",
	};
}

async function checkRdosApi(): Promise<StatusCheckResult> {
	const startedAt = Date.now();
	return {
		status: "operational",
		latencyMs: Date.now() - startedAt,
		detail: "Network, ports available and working.",
	};
}

async function checkReleaseArchive(): Promise<StatusCheckResult> {
	const startedAt = Date.now();
	try {
		await findMostRecentReleaseByPublishedDesc();
		return {
			status: "operational",
			latencyMs: Date.now() - startedAt,
			detail: "Release archive is queryable.",
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error.";
		return {
			status: "outage",
			latencyMs: Date.now() - startedAt,
			detail: `Release archive unreachable: ${message}`,
		};
	}
}

function deriveOverallStatus(components: StatusComponent[]): StatusLevel {
	if (components.some((component) => component.status === "outage")) return "outage";
	if (components.some((component) => component.status === "degraded")) return "degraded";
	return "operational";
}

async function handleStatusSummary(request: Request): Promise<Response> {
	const requestStartedAt = Date.now();
	const [telegramWebhookCheck, rdosApiCheck, releaseArchiveCheck] = await Promise.all([
		checkTelegramWebhook(),
		checkRdosApi(),
		checkReleaseArchive(),
	]);

	const components: StatusComponent[] = [
		{
			key: "accounts-api",
			label: "Accounts & sessions API",
			status: "operational",
			latencyMs: Date.now() - requestStartedAt,
			detail: "Answering authentication and session requests.",
		},
		{
			key: "telegram-webhook",
			label: "Telegram Webhook",
			status: telegramWebhookCheck.status,
			latencyMs: telegramWebhookCheck.latencyMs,
			detail: telegramWebhookCheck.detail,
		},
		{
			key: "rdos-api",
			label: "RDOS API",
			status: rdosApiCheck.status,
			latencyMs: rdosApiCheck.latencyMs,
			detail: rdosApiCheck.detail,
		},
		{
			key: "release-archive",
			label: "Release & downloads archive",
			status: releaseArchiveCheck.status,
			latencyMs: releaseArchiveCheck.latencyMs,
			detail: releaseArchiveCheck.detail,
		},
	];

	const response: StatusSummaryResponse = {
		status: deriveOverallStatus(components),
		region: "ap-south-1 (Mumbai)",
		checkedAt: new Date().toISOString(),
		components,
	};

	return jsonResponse(request, 200, response);
}

async function requireBillingSession(request: Request): Promise<ResolvedSessionContext> {
	const session = await resolveSessionUser(request);
	if (!session) {
		throw new HttpError(401, "Sign in to manage your subscription.");
	}
	return session;
}

async function handleBillingPlans(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "billing:plans", BILLING_RATE_LIMIT);
	return jsonResponse(request, 200, getBillingPlansResponse());
}

async function handleBillingCheckout(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "billing:checkout", BILLING_RATE_LIMIT);
	const session = await requireBillingSession(request);
	const payload = parseCreateCheckoutPayload(await readRequestJson(request));
	const response = await createCheckout(session.user, payload);
	return jsonResponse(request, 201, response);
}

async function handleBillingVerify(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "billing:verify", BILLING_RATE_LIMIT);
	const session = await requireBillingSession(request);
	const payload = parseVerifyCheckoutPayload(await readRequestJson(request));
	const subscription = await verifyCheckout(session.user, payload);
	const response: BillingSubscriptionResponse = { subscription };
	return jsonResponse(request, 200, response);
}

async function handleBillingSubscription(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "billing:subscription", AUTH_SESSION_RATE_LIMIT);
	const session = await requireBillingSession(request);
	const subscription = await getSubscriptionForUser(session.user._id);
	const response: BillingSubscriptionResponse = { subscription };
	return jsonResponse(request, 200, response);
}

async function handleBillingCancel(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "billing:cancel", BILLING_RATE_LIMIT);
	const session = await requireBillingSession(request);
	const payload = parseCancelSubscriptionPayload(await readRequestJson(request));
	const subscription = await cancelSubscription(session.user._id, payload);
	const response: BillingSubscriptionResponse = { subscription };
	return jsonResponse(request, 200, response);
}

async function handleBillingHistory(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "billing:history", AUTH_SESSION_RATE_LIMIT);
	const session = await requireBillingSession(request);
	const response = await getPaymentHistoryForUser(session.user._id);
	return jsonResponse(request, 200, response);
}

/**
 * Razorpay signs the exact request bytes, so this handler reads the body as raw
 * text and never re-serialises it. It is deliberately unauthenticated — the
 * HMAC over the body is the authentication.
 */
async function handleRazorpayWebhookRequest(request: Request): Promise<Response> {
	const contentLength = Number(request.headers.get("content-length") ?? "0");
	if (Number.isFinite(contentLength) && contentLength > RAZORPAY_WEBHOOK_MAX_BYTES) {
		throw new HttpError(413, "Webhook payload is too large.");
	}

	const rawBody = await request.text();
	const signature = request.headers.get("x-razorpay-signature");
	const eventId = request.headers.get("x-razorpay-event-id");

	const result = await handleRazorpayWebhook(rawBody, signature, eventId);
	if (result.duplicate) {
		console.log(`[billing] Ignored duplicate Razorpay webhook: ${result.event}`);
	} else if (!result.handled) {
		console.log(`[billing] Received unhandled Razorpay webhook: ${result.event}`);
	} else {
		console.log(`[billing] Processed Razorpay webhook: ${result.event}`);
	}

	return jsonResponse(request, 200, { received: true, event: result.event });
}

async function handleBillingOrders(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "billing:orders", AUTH_SESSION_RATE_LIMIT);
	const session = await requireBillingSession(request);
	const response = await getOrdersForUser(session.user._id);
	return jsonResponse(request, 200, response);
}

async function handleAdminListOrders(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "admin:orders:list", AUTH_SESSION_RATE_LIMIT);
	await requirePrivilegedSession(request);
	const response = await getAdminOrders();
	return jsonResponse(request, 200, response);
}

async function handleAdminUpdateOrder(request: Request, orderId: string): Promise<Response> {
	assertWithinRateLimit(request, "admin:orders:update", AUTH_SESSION_RATE_LIMIT);
	await requirePrivilegedSession(request);
	const patch = parseAdminUpdateOrderPayload(await readRequestJson(request));
	const response = await adminUpdateOrder(orderId, patch);
	return jsonResponse(request, 200, response);
}

async function handleAdminCreateSubscription(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "admin:orders:create", AUTH_SESSION_RATE_LIMIT);
	const session = await requirePrivilegedSession(request);
	const payload = parseAdminCreateSubscriptionPayload(await readRequestJson(request));
	const response = await adminCreateSubscription(payload, session.user.email);
	return jsonResponse(request, 201, response);
}

async function handleAdminDeleteSubscription(
	request: Request,
	subscriptionId: string,
): Promise<Response> {
	assertWithinRateLimit(request, "admin:orders:delete", AUTH_SESSION_RATE_LIMIT);
	const session = await requirePrivilegedSession(request);
	const response = await adminDeleteSubscription(subscriptionId, session.user.email);
	return jsonResponse(request, 200, response);
}

async function routeAdminBillingRequest(request: Request, url: URL): Promise<Response> {
	if (request.method === "GET" && url.pathname === `${BILLING_ADMIN_BASE_PATH}/orders`) {
		return handleAdminListOrders(request);
	}

	if (request.method === "POST" && url.pathname === `${BILLING_ADMIN_BASE_PATH}/orders`) {
		return handleAdminCreateSubscription(request);
	}

	const orderMatch = url.pathname.match(new RegExp(`^${BILLING_ADMIN_BASE_PATH}/orders/([^/]+)$`));

	if (orderMatch && request.method === "PATCH") {
		const orderId = decodeURIComponent(orderMatch[1] ?? "");
		if (!orderId) {
			throw new HttpError(400, "Order id is required.");
		}
		return handleAdminUpdateOrder(request, orderId);
	}

	if (orderMatch && request.method === "DELETE") {
		const orderId = decodeURIComponent(orderMatch[1] ?? "");
		if (!orderId) {
			throw new HttpError(400, "Order id is required.");
		}
		return handleAdminDeleteSubscription(request, orderId);
	}

	return jsonResponse(request, 404, buildErrorResponse("Admin billing resource not found."));
}

async function handleWalletGet(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "billing:wallet", AUTH_SESSION_RATE_LIMIT);
	const session = await requireBillingSession(request);
	return jsonResponse(request, 200, await getWalletForUser(session.user._id));
}

async function handleWalletPreferences(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "billing:wallet:prefs", BILLING_RATE_LIMIT);
	const session = await requireBillingSession(request);
	const patch = parseWalletPreferencesPayload(await readRequestJson(request));
	return jsonResponse(request, 200, await setWalletPreferences(session.user._id, patch));
}

async function handleWalletTopup(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "billing:wallet:topup", BILLING_RATE_LIMIT);
	const session = await requireBillingSession(request);
	const payload = parseWalletTopupPayload(await readRequestJson(request));
	return jsonResponse(request, 201, await createWalletTopup(session.user, payload));
}

async function handleWalletTopupVerify(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "billing:wallet:verify", BILLING_RATE_LIMIT);
	const session = await requireBillingSession(request);
	const payload = parseVerifyWalletTopupPayload(await readRequestJson(request));
	return jsonResponse(request, 200, await verifyWalletTopup(session.user, payload));
}

async function handleRenewalNotice(request: Request): Promise<Response> {
	assertWithinRateLimit(request, "billing:renewal", AUTH_SESSION_RATE_LIMIT);
	const session = await requireBillingSession(request);
	const renewal = await getRenewalNoticeForUser(session.user._id);
	return jsonResponse(request, 200, { renewal });
}

async function routeBillingRequest(request: Request, url: URL): Promise<Response> {
	if (request.method === "GET" && url.pathname === `${BILLING_BASE_PATH}/plans`) {
		return handleBillingPlans(request);
	}

	if (request.method === "POST" && url.pathname === `${BILLING_BASE_PATH}/checkout`) {
		return handleBillingCheckout(request);
	}

	if (request.method === "POST" && url.pathname === `${BILLING_BASE_PATH}/verify`) {
		return handleBillingVerify(request);
	}

	if (request.method === "GET" && url.pathname === `${BILLING_BASE_PATH}/subscription`) {
		return handleBillingSubscription(request);
	}

	if (request.method === "POST" && url.pathname === `${BILLING_BASE_PATH}/subscription/cancel`) {
		return handleBillingCancel(request);
	}

	if (request.method === "GET" && url.pathname === `${BILLING_BASE_PATH}/payments`) {
		return handleBillingHistory(request);
	}

	if (request.method === "GET" && url.pathname === `${BILLING_BASE_PATH}/wallet`) {
		return handleWalletGet(request);
	}

	if (request.method === "PATCH" && url.pathname === `${BILLING_BASE_PATH}/wallet`) {
		return handleWalletPreferences(request);
	}

	if (request.method === "POST" && url.pathname === `${BILLING_BASE_PATH}/wallet/topup`) {
		return handleWalletTopup(request);
	}

	if (request.method === "POST" && url.pathname === `${BILLING_BASE_PATH}/wallet/topup/verify`) {
		return handleWalletTopupVerify(request);
	}

	if (request.method === "GET" && url.pathname === `${BILLING_BASE_PATH}/renewal`) {
		return handleRenewalNotice(request);
	}

	if (request.method === "GET" && url.pathname === `${BILLING_BASE_PATH}/orders`) {
		return handleBillingOrders(request);
	}

	return jsonResponse(request, 404, buildErrorResponse("Billing resource not found."));
}

async function routeRazorpayRequest(request: Request, url: URL): Promise<Response> {
	if (request.method === "POST" && url.pathname === RAZORPAY_WEBHOOK_PATH) {
		return handleRazorpayWebhookRequest(request);
	}

	return jsonResponse(request, 404, buildErrorResponse("Razorpay resource not found."));
}

async function routeStatusRequest(request: Request, url: URL): Promise<Response> {
	if (request.method === "GET" && url.pathname === `${STATUS_BASE_PATH}/summary`) {
		return handleStatusSummary(request);
	}

	return jsonResponse(request, 404, buildErrorResponse("Status resource not found."));
}

async function routeDownloadsRequest(request: Request, url: URL): Promise<Response> {
	if (request.method === "GET" && url.pathname === `${DOWNLOADS_BASE_PATH}/releases`) {
		return handleReleasesFeed(request);
	}

	if (request.method === "GET" && url.pathname === `${DOWNLOADS_BASE_PATH}/releases/latest`) {
		return handleLatestRelease(request);
	}

	const artifactMatch = url.pathname.match(
		new RegExp(`^${DOWNLOADS_BASE_PATH}/artifacts/([^/]+)/file$`),
	);

	if ((request.method === "GET" || request.method === "HEAD") && artifactMatch) {
		const artifactId = decodeURIComponent(artifactMatch[1] ?? "");
		if (!artifactId) {
			throw new HttpError(400, "Artifact id is required.");
		}

		if (request.method === "HEAD") {
			const artifact = await getReleaseArtifactById(artifactId);
			if (!artifact) {
				throw new HttpError(404, "Release artifact not found.");
			}

			const headers = createCorsHeaders(request);
			headers.set("Content-Type", artifact.mimeType);
			headers.set("Content-Length", String(artifact.sizeBytes));
			return new Response(null, { status: 200, headers });
		}

		return buildDownloadResponse(request, artifactId);
	}

	return jsonResponse(request, 404, buildErrorResponse("Download resource not found."));
}

async function routeRequest(request: Request): Promise<Response> {
	if (request.method === "OPTIONS") {
		return emptyResponse(request, 204);
	}

	const url = new URL(request.url);
	if (url.pathname.startsWith(DOWNLOADS_BASE_PATH)) {
		return routeDownloadsRequest(request, url);
	}

	if (url.pathname.startsWith(STATUS_BASE_PATH)) {
		return routeStatusRequest(request, url);
	}

	// Razorpay posts server-to-server with no session cookie, so the webhook is
	// matched before the authenticated prefix check below.
	if (url.pathname.startsWith(RAZORPAY_WEBHOOK_BASE_PATH)) {
		return routeRazorpayRequest(request, url);
	}

	if (!url.pathname.startsWith(AUTH_BASE_PATH)) {
		return jsonResponse(request, 404, buildErrorResponse("Not Found"));
	}

	if (url.pathname.startsWith(BILLING_BASE_PATH)) {
		return routeBillingRequest(request, url);
	}

	if (url.pathname.startsWith(BILLING_ADMIN_BASE_PATH)) {
		return routeAdminBillingRequest(request, url);
	}

	if (request.method === "GET" && url.pathname === `${AUTH_ADMIN_BASE_PATH}/releases`) {
		return handleAdminListReleases(request);
	}

	if (request.method === "POST" && url.pathname === `${AUTH_ADMIN_BASE_PATH}/releases`) {
		return handleAdminCreateRelease(request);
	}

	const adminReleaseArtifactMatch = url.pathname.match(
		new RegExp(`^${AUTH_ADMIN_BASE_PATH}/releases/([^/]+)/artifacts$`),
	);

	if (adminReleaseArtifactMatch && request.method === "POST") {
		const releaseId = decodeURIComponent(adminReleaseArtifactMatch[1] ?? "");
		if (!releaseId) {
			throw new HttpError(400, "Release id is required.");
		}
		return handleAdminUploadReleaseArtifact(request, releaseId);
	}

	const adminReleaseMatch = url.pathname.match(
		new RegExp(`^${AUTH_ADMIN_BASE_PATH}/releases/([^/]+)$`),
	);

	if (adminReleaseMatch && request.method === "PATCH") {
		const releaseId = decodeURIComponent(adminReleaseMatch[1] ?? "");
		if (!releaseId) {
			throw new HttpError(400, "Release id is required.");
		}
		return handleAdminUpdateRelease(request, releaseId);
	}

	if (adminReleaseMatch && request.method === "DELETE") {
		const releaseId = decodeURIComponent(adminReleaseMatch[1] ?? "");
		if (!releaseId) {
			throw new HttpError(400, "Release id is required.");
		}
		return handleAdminDeleteRelease(request, releaseId);
	}

	const adminArtifactMatch = url.pathname.match(
		new RegExp(`^${AUTH_ADMIN_BASE_PATH}/artifacts/([^/]+)$`),
	);

	if (adminArtifactMatch && request.method === "PATCH") {
		const artifactId = decodeURIComponent(adminArtifactMatch[1] ?? "");
		if (!artifactId) {
			throw new HttpError(400, "Artifact id is required.");
		}
		return handleAdminUpdateReleaseArtifact(request, artifactId);
	}

	if (adminArtifactMatch && request.method === "DELETE") {
		const artifactId = decodeURIComponent(adminArtifactMatch[1] ?? "");
		if (!artifactId) {
			throw new HttpError(400, "Artifact id is required.");
		}
		return handleAdminDeleteReleaseArtifact(request, artifactId);
	}

	if (request.method === "GET" && url.pathname === `${AUTH_ADMIN_BASE_PATH}/users`) {
		return handleAdminListUsers(request);
	}

	if (request.method === "POST" && url.pathname === `${AUTH_ADMIN_BASE_PATH}/users`) {
		return handleAdminCreateUser(request);
	}

	const adminUserMatch = url.pathname.match(new RegExp(`^${AUTH_ADMIN_BASE_PATH}/users/([^/]+)$`));

	if (adminUserMatch && request.method === "PATCH") {
		const userId = decodeURIComponent(adminUserMatch[1] ?? "");
		if (!userId) {
			throw new HttpError(400, "User id is required.");
		}
		return handleAdminUpdateUser(request, userId);
	}

	if (adminUserMatch && request.method === "DELETE") {
		const userId = decodeURIComponent(adminUserMatch[1] ?? "");
		if (!userId) {
			throw new HttpError(400, "User id is required.");
		}
		return handleAdminDeleteUser(request, userId);
	}

	if (request.method === "POST" && url.pathname === `${AUTH_BASE_PATH}/signup`) {
		return handleSignup(request);
	}

	if (request.method === "POST" && url.pathname === `${AUTH_BASE_PATH}/verify-email`) {
		return handleVerifyEmail(request);
	}

	if (request.method === "POST" && url.pathname === `${AUTH_BASE_PATH}/verify-email/resend`) {
		return handleResendVerification(request);
	}

	if (request.method === "POST" && url.pathname === AUTH_BASE_PATH) {
		return handleLogin(request);
	}

	if (request.method === "POST" && url.pathname === `${AUTH_BASE_PATH}/logout`) {
		return handleLogout(request);
	}

	if (request.method === "POST" && url.pathname === `${AUTH_BASE_PATH}/logout-all`) {
		return handleLogoutAllSessions(request);
	}

	if (request.method === "GET" && url.pathname === `${AUTH_BASE_PATH}/session`) {
		return handleSession(request);
	}

	if (request.method === "GET" && url.pathname === `${AUTH_BASE_PATH}/sessions`) {
		return handleListSessions(request);
	}

	if (request.method === "POST" && url.pathname === `${AUTH_BASE_PATH}/sessions/revoke`) {
		return handleRevokeSession(request);
	}

	if (request.method === "GET" && url.pathname === `${AUTH_BASE_PATH}/me`) {
		return handleGetMe(request);
	}

	if (request.method === "PATCH" && url.pathname === `${AUTH_BASE_PATH}/me`) {
		return handlePatchMe(request);
	}

	if (request.method === "DELETE" && url.pathname === `${AUTH_BASE_PATH}/me`) {
		return handleDeleteMe(request);
	}

	return jsonResponse(request, 405, buildErrorResponse("Method Not Allowed"));
}

/**
 * The whole API as a single request handler. Exported so a host that already
 * owns a listener can dispatch straight into it instead of proxying over
 * loopback, and so tests can bind their own port.
 */
export async function handleAuthApiRequest(request: Request): Promise<Response> {
	return handleRequestWithErrorBoundary(request);
}

async function handleRequestWithErrorBoundary(request: Request): Promise<Response> {
	try {
		return await routeRequest(request);
	} catch (error) {
		if (error instanceof HttpError || error instanceof BillingError) {
			return jsonResponse(request, error.status, buildErrorResponse(error.message));
		}

		console.error("Unhandled auth API error:", error);
		return jsonResponse(request, 500, buildErrorResponse("Internal server error."));
	}
}

export async function startAuthServer() {
	await getDb();

	const app = new Elysia({ name: "litecheats-auth-api" }).all("/*", ({ request }) =>
		handleRequestWithErrorBoundary(request),
	);
	app.listen({ port: AUTH_API_PORT, idleTimeout: 30 });

	console.log(`Auth server started at http://localhost:${AUTH_API_PORT}${AUTH_BASE_PATH}`);
	console.log(`Downloads API available at http://localhost:${AUTH_API_PORT}${DOWNLOADS_BASE_PATH}`);
	console.log(
		`Status API available at http://localhost:${AUTH_API_PORT}${STATUS_BASE_PATH}/summary`,
	);
	console.log(
		`Billing API available at http://localhost:${AUTH_API_PORT}${BILLING_BASE_PATH}/plans`,
	);

	startRenewalSweep();

	if (!isRazorpayConfigured()) {
		console.warn(
			"[billing] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set — checkout is disabled.",
		);
	} else if (isRazorpayWebhookConfigured()) {
		const count = countRazorpayWebhookSecrets();
		console.log(
			`[billing] Razorpay webhook ready at ${RAZORPAY_WEBHOOK_PATH} (${count} signing secret${count === 1 ? "" : "s"} accepted).`,
		);
	} else if (!isRazorpayWebhookConfigured()) {
		console.warn(
			`[billing] RAZORPAY_WEBHOOK_SECRET is not set — deliveries to ${RAZORPAY_WEBHOOK_PATH} will be rejected.`,
		);
	}

	return app;
}

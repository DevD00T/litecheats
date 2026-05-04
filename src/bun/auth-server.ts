import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { Elysia } from "elysia";
import {
	type Db,
	type Document,
	GridFSBucket,
	MongoClient,
	MongoServerError,
	ObjectId,
	type WithId,
} from "mongodb";
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
	type LoginPayload,
	type LogoutAllSessionsResponse,
	type RevokeSessionPayload,
	type RevokeSessionResponse,
	type SessionListResponse,
	type SessionResponse,
	type SignupPayload,
	USER_ROLES,
	type UpdateProfilePayload,
	type UserRole,
} from "../../shared/auth";
import {
	type AdminCreateReleasePayload,
	type AdminDeleteArtifactResponse,
	type AdminDeleteReleaseResponse,
	type AdminUpdateArtifactPayload,
	type AdminUpdateReleasePayload,
	DOWNLOADS_BASE_PATH,
	RELEASE_FILES_BUCKET,
	RELEASE_FORMATS,
	RELEASE_PLATFORMS,
	type ReleaseArtifactSummary,
	type ReleaseFeedResponse,
	type ReleaseFormat,
	type ReleasePlatform,
	type ReleaseSummary,
} from "../../shared/releases";

const DEFAULT_MONGODB_URI = "mongodb://127.0.0.1:27017";
const DEFAULT_MONGODB_DB_NAME = "litecheats";
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

interface RateLimitBucket {
	count: number;
	resetAt: number;
}

interface SessionRequestMeta {
	userAgent: string;
	ipAddress: string;
	deviceKey: string;
}

const mongoClient = new MongoClient(Bun.env.MONGODB_URI ?? DEFAULT_MONGODB_URI);
const mongoDbName = Bun.env.MONGODB_DB_NAME ?? DEFAULT_MONGODB_DB_NAME;
let dbPromise: Promise<Db> | null = null;
const rateLimitStore = new Map<string, RateLimitBucket>();

interface UserDocument extends Document {
	_id: string;
	email: string;
	emailLower: string;
	fullName: string;
	company: string;
	roles?: unknown;
	isAdmin?: unknown;
	isOwner?: unknown;
	passwordHash: string;
	createdAt: Date;
	updatedAt: Date;
}

interface SessionDocument extends Document {
	_id: string;
	userId: string;
	userAgent: string;
	ipAddress: string;
	deviceKey: string;
	createdAt: Date;
	updatedAt: Date;
	expiresAt: Date;
}

interface ReleaseVersionDocument extends Document {
	_id: string;
	version: string;
	notes: string;
	publishedAt: Date;
	isLatest: boolean;
	createdAt: Date;
	updatedAt: Date;
}

interface ReleaseArtifactDocument extends Document {
	_id: string;
	releaseId: string;
	version: string;
	platform: ReleasePlatform;
	format: ReleaseFormat;
	target: string;
	filename: string;
	sizeBytes: number;
	sha256: string;
	mimeType: string;
	gridFsFileId: string;
	createdAt: Date;
}

interface TelegramAdminDocument extends Document {
	_id: string;
	username: string;
	usernameLower: string;
	role: "admin" | "owner";
	addedByTelegramId: number | null;
	addedByUsername: string | null;
	createdAt: Date;
	updatedAt: Date;
}

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

async function ensureCollection(db: Db, collectionName: string, validator: object): Promise<void> {
	const exists = await db.listCollections({ name: collectionName }).hasNext();

	if (!exists) {
		await db.createCollection(collectionName, { validator });
		return;
	}

	try {
		await db.command({
			collMod: collectionName,
			validator,
			validationLevel: "moderate",
		});
	} catch {
		// Some managed MongoDB tiers restrict collMod; skip hard failure here.
	}
}

async function ensureMongoSchema(db: Db): Promise<void> {
	await ensureCollection(db, "users", {
		$jsonSchema: {
			bsonType: "object",
			required: [
				"_id",
				"email",
				"emailLower",
				"fullName",
				"company",
				"isAdmin",
				"isOwner",
				"roles",
				"passwordHash",
				"createdAt",
				"updatedAt",
			],
			properties: {
				_id: { bsonType: "string" },
				email: { bsonType: "string" },
				emailLower: { bsonType: "string" },
				fullName: { bsonType: "string" },
				company: { bsonType: "string" },
				isAdmin: { bsonType: "bool" },
				isOwner: { bsonType: "bool" },
				roles: {
					bsonType: "array",
					minItems: 1,
					uniqueItems: true,
					items: {
						bsonType: "string",
						enum: [...USER_ROLES],
					},
				},
				passwordHash: { bsonType: "string" },
				createdAt: { bsonType: "date" },
				updatedAt: { bsonType: "date" },
			},
		},
	});

	await ensureCollection(db, "sessions", {
		$jsonSchema: {
			bsonType: "object",
			required: [
				"_id",
				"userId",
				"userAgent",
				"ipAddress",
				"deviceKey",
				"createdAt",
				"updatedAt",
				"expiresAt",
			],
			properties: {
				_id: { bsonType: "string" },
				userId: { bsonType: "string" },
				userAgent: { bsonType: "string" },
				ipAddress: { bsonType: "string" },
				deviceKey: { bsonType: "string" },
				createdAt: { bsonType: "date" },
				updatedAt: { bsonType: "date" },
				expiresAt: { bsonType: "date" },
			},
		},
	});

	await ensureCollection(db, "release_versions", {
		$jsonSchema: {
			bsonType: "object",
			required: ["_id", "version", "notes", "publishedAt", "isLatest", "createdAt", "updatedAt"],
			properties: {
				_id: { bsonType: "string" },
				version: { bsonType: "string" },
				notes: { bsonType: "string" },
				publishedAt: { bsonType: "date" },
				isLatest: { bsonType: "bool" },
				createdAt: { bsonType: "date" },
				updatedAt: { bsonType: "date" },
			},
		},
	});

	await ensureCollection(db, "release_artifacts", {
		$jsonSchema: {
			bsonType: "object",
			required: [
				"_id",
				"releaseId",
				"version",
				"platform",
				"format",
				"target",
				"filename",
				"sizeBytes",
				"sha256",
				"mimeType",
				"gridFsFileId",
				"createdAt",
			],
			properties: {
				_id: { bsonType: "string" },
				releaseId: { bsonType: "string" },
				version: { bsonType: "string" },
				platform: { bsonType: "string" },
				format: { bsonType: "string" },
				target: { bsonType: "string" },
				filename: { bsonType: "string" },
				sizeBytes: { bsonType: ["int", "long", "double", "decimal"] },
				sha256: { bsonType: "string" },
				mimeType: { bsonType: "string" },
				gridFsFileId: { bsonType: "string" },
				createdAt: { bsonType: "date" },
			},
		},
	});

	await ensureCollection(db, "telegram_admins", {
		$jsonSchema: {
			bsonType: "object",
			required: [
				"_id",
				"username",
				"usernameLower",
				"role",
				"addedByTelegramId",
				"addedByUsername",
				"createdAt",
				"updatedAt",
			],
			properties: {
				_id: { bsonType: "string" },
				username: { bsonType: "string" },
				usernameLower: { bsonType: "string" },
				role: {
					bsonType: "string",
					enum: ["admin", "owner"],
				},
				addedByTelegramId: { bsonType: ["long", "int", "double", "null"] },
				addedByUsername: { bsonType: ["string", "null"] },
				createdAt: { bsonType: "date" },
				updatedAt: { bsonType: "date" },
			},
		},
	});

	const users = db.collection<UserDocument>("users");
	const sessions = db.collection<SessionDocument>("sessions");
	const releaseVersions = db.collection<ReleaseVersionDocument>("release_versions");
	const releaseArtifacts = db.collection<ReleaseArtifactDocument>("release_artifacts");
	const telegramAdmins = db.collection<TelegramAdminDocument>("telegram_admins");

	const migrationTimestamp = new Date();
	await users.updateMany(
		{ isAdmin: { $exists: false } },
		{ $set: { isAdmin: false, updatedAt: migrationTimestamp } },
	);
	await users.updateMany(
		{ isOwner: { $exists: false } },
		{ $set: { isOwner: false, updatedAt: migrationTimestamp } },
	);
	await users.updateMany(
		{
			$and: [{ isAdmin: { $not: { $type: "bool" } } }, { isAdmin: { $exists: true } }],
		},
		{ $set: { isAdmin: false, updatedAt: migrationTimestamp } },
	);
	await users.updateMany(
		{
			$and: [{ isOwner: { $not: { $type: "bool" } } }, { isOwner: { $exists: true } }],
		},
		{ $set: { isOwner: false, updatedAt: migrationTimestamp } },
	);
	await users.updateMany(
		{ roles: { $exists: false } },
		{ $set: { roles: [DEFAULT_USER_ROLE], updatedAt: migrationTimestamp } },
	);

	await users.updateMany({ roles: { $type: "array" } }, [
		{
			$set: {
				roles: {
					$let: {
						vars: {
							filteredRoles: {
								$filter: {
									input: "$roles",
									as: "role",
									cond: { $in: ["$$role", [...USER_ROLES]] },
								},
							},
						},
						in: {
							$cond: [
								{ $gt: [{ $size: "$$filteredRoles" }, 0] },
								{ $setUnion: ["$$filteredRoles", []] },
								[DEFAULT_USER_ROLE],
							],
						},
					},
				},
			},
		},
	]);

	await users.updateMany(
		{
			$and: [{ roles: { $not: { $type: "array" } } }, { roles: { $exists: true } }],
		},
		{ $set: { roles: [DEFAULT_USER_ROLE], updatedAt: migrationTimestamp } },
	);
	const fallbackDeviceKey = createHash("sha256")
		.update(`${DEFAULT_USER_AGENT}|na|na|na`)
		.digest("hex");
	await sessions.updateMany(
		{ userAgent: { $exists: false } },
		{ $set: { userAgent: DEFAULT_USER_AGENT, updatedAt: migrationTimestamp } },
	);
	await sessions.updateMany(
		{ ipAddress: { $exists: false } },
		{ $set: { ipAddress: DEFAULT_CLIENT_IP, updatedAt: migrationTimestamp } },
	);
	await sessions.updateMany(
		{ deviceKey: { $exists: false } },
		{ $set: { deviceKey: fallbackDeviceKey, updatedAt: migrationTimestamp } },
	);

	await users.createIndex({ emailLower: 1 }, { unique: true, name: "users_email_unique" });
	await users.createIndex({ roles: 1 }, { name: "users_roles_idx" });
	await sessions.createIndex({ userId: 1 }, { name: "sessions_user_id_idx" });
	await sessions.createIndex(
		{ userId: 1, deviceKey: 1, expiresAt: 1 },
		{ name: "sessions_user_device_idx" },
	);
	await sessions.createIndex(
		{ expiresAt: 1 },
		{ expireAfterSeconds: 0, name: "sessions_ttl_expires_at_idx" },
	);
	await releaseVersions.createIndex(
		{ version: 1 },
		{ unique: true, name: "release_versions_unique" },
	);
	await releaseVersions.createIndex({ isLatest: 1 }, { name: "release_versions_latest_idx" });
	await releaseVersions.createIndex(
		{ publishedAt: -1 },
		{ name: "release_versions_published_desc_idx" },
	);
	await releaseArtifacts.createIndex({ releaseId: 1 }, { name: "release_artifacts_release_idx" });
	await releaseArtifacts.createIndex(
		{ version: 1, platform: 1, format: 1, target: 1 },
		{ name: "release_artifacts_lookup_idx" },
	);
	await telegramAdmins.createIndex(
		{ usernameLower: 1 },
		{ unique: true, name: "telegram_admins_username_unique" },
	);
}

async function getDb(): Promise<Db> {
	if (!dbPromise) {
		const connectPromise = (async () => {
			await mongoClient.connect();
			const db = mongoClient.db(mongoDbName);
			await ensureMongoSchema(db);
			return db;
		})();

		dbPromise = connectPromise.catch((error) => {
			dbPromise = null;
			throw error;
		});
	}

	return dbPromise;
}

export async function getAuthDb(): Promise<Db> {
	return getDb();
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
	const db = await getDb();
	const releases = db.collection<ReleaseVersionDocument>("release_versions");
	const artifacts = db.collection<ReleaseArtifactDocument>("release_artifacts");

	const releaseList = await releases.find().sort({ publishedAt: -1 }).limit(limit).toArray();
	if (!releaseList.length) {
		return { latest: null, releases: [] };
	}

	const releaseIds = releaseList.map((item) => item._id);
	const artifactList = await artifacts
		.find({ releaseId: { $in: releaseIds } })
		.sort({ createdAt: -1 })
		.toArray();

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
	const db = await getDb();
	const releases = db.collection<ReleaseVersionDocument>("release_versions");
	await releases.updateMany(
		{ _id: { $ne: releaseId }, isLatest: true },
		{ $set: { isLatest: false, updatedAt: now } },
	);
	await releases.updateOne({ _id: releaseId }, { $set: { isLatest: true, updatedAt: now } });
}

async function ensureAtLeastOneLatestRelease(now: Date): Promise<void> {
	const db = await getDb();
	const releases = db.collection<ReleaseVersionDocument>("release_versions");
	const latest = await releases.findOne({ isLatest: true });
	if (latest) return;

	const fallback = await releases.find().sort({ publishedAt: -1 }).limit(1).next();
	if (!fallback) return;
	await releases.updateOne({ _id: fallback._id }, { $set: { isLatest: true, updatedAt: now } });
}

async function createReleaseByAdmin(payload: AdminCreateReleasePayload): Promise<void> {
	const db = await getDb();
	const releases = db.collection<ReleaseVersionDocument>("release_versions");
	const now = new Date();
	const releaseId = crypto.randomUUID();
	const publishedAt = payload.publishedAt ? new Date(payload.publishedAt) : now;
	const shouldBeLatest = payload.isLatest ?? true;

	try {
		await releases.insertOne({
			_id: releaseId,
			version: payload.version,
			notes: payload.notes ?? "",
			publishedAt,
			isLatest: shouldBeLatest,
			createdAt: now,
			updatedAt: now,
		});
	} catch (error) {
		if (error instanceof MongoServerError && error.code === 11000) {
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
	const db = await getDb();
	const releases = db.collection<ReleaseVersionDocument>("release_versions");
	const artifacts = db.collection<ReleaseArtifactDocument>("release_artifacts");
	const now = new Date();

	const current = await releases.findOne({ _id: releaseId });
	if (!current) {
		throw new HttpError(404, "Release not found.");
	}

	const patch: Partial<ReleaseVersionDocument> = { updatedAt: now };
	if (typeof payload.version === "string") patch.version = payload.version;
	if (typeof payload.notes === "string") patch.notes = payload.notes;
	if (typeof payload.publishedAt === "string") patch.publishedAt = new Date(payload.publishedAt);

	try {
		await releases.updateOne({ _id: releaseId }, { $set: patch });
	} catch (error) {
		if (error instanceof MongoServerError && error.code === 11000) {
			throw new HttpError(409, "A release with this version already exists.");
		}
		throw error;
	}

	if (typeof payload.version === "string" && payload.version !== current.version) {
		await artifacts.updateMany(
			{ releaseId },
			{
				$set: { version: payload.version },
			},
		);
	}

	if (payload.isLatest === true) {
		await setLatestReleaseId(releaseId, now);
	} else if (payload.isLatest === false) {
		await releases.updateOne({ _id: releaseId }, { $set: { isLatest: false, updatedAt: now } });
		await ensureAtLeastOneLatestRelease(now);
	}
}

async function deleteReleaseByAdmin(releaseId: string): Promise<number> {
	const db = await getDb();
	const releases = db.collection<ReleaseVersionDocument>("release_versions");
	const artifacts = db.collection<ReleaseArtifactDocument>("release_artifacts");
	const bucket = new GridFSBucket(db, { bucketName: RELEASE_FILES_BUCKET });
	const now = new Date();

	const release = await releases.findOne({ _id: releaseId });
	if (!release) {
		throw new HttpError(404, "Release not found.");
	}

	const relatedArtifacts = await artifacts.find({ releaseId }).toArray();
	for (const artifact of relatedArtifacts) {
		try {
			await bucket.delete(new ObjectId(artifact.gridFsFileId));
		} catch {
			// Ignore stale GridFS references during cleanup.
		}
	}

	const artifactDelete = await artifacts.deleteMany({ releaseId });
	await releases.deleteOne({ _id: releaseId });
	await ensureAtLeastOneLatestRelease(now);

	return artifactDelete.deletedCount;
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

	const db = await getDb();
	const releases = db.collection<ReleaseVersionDocument>("release_versions");
	const artifacts = db.collection<ReleaseArtifactDocument>("release_artifacts");
	const bucket = new GridFSBucket(db, { bucketName: RELEASE_FILES_BUCKET });
	const release = await releases.findOne({ _id: releaseId });
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

	const existing = await artifacts.findOne({
		releaseId,
		platform,
		format,
		target,
	});

	if (existing) {
		try {
			await bucket.delete(new ObjectId(existing.gridFsFileId));
		} catch {
			// Ignore stale GridFS references during replacement.
		}
		await artifacts.deleteOne({ _id: existing._id });
	}

	const sha256 = await computeFileSha256(fileEntry);
	const upload = bucket.openUploadStream(filename, {
		metadata: {
			releaseId,
			version: release.version,
			platform,
			format,
			target,
			sha256,
		},
	});
	const fileBuffer = Buffer.from(await fileEntry.arrayBuffer());
	await new Promise<void>((resolve, reject) => {
		upload.once("finish", () => resolve());
		upload.once("error", (error) => reject(error));
		upload.end(fileBuffer);
	});

	await artifacts.insertOne({
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
		gridFsFileId: (upload.id as ObjectId).toHexString(),
		createdAt: now,
	});
}

async function updateReleaseArtifactByAdmin(
	artifactId: string,
	payload: AdminUpdateArtifactPayload,
): Promise<void> {
	const db = await getDb();
	const artifacts = db.collection<ReleaseArtifactDocument>("release_artifacts");
	const existing = await artifacts.findOne({ _id: artifactId });
	if (!existing) {
		throw new HttpError(404, "Release artifact not found.");
	}

	const nextPlatform = payload.platform ?? existing.platform;
	const nextFormat = payload.format ?? existing.format;
	const nextTarget = payload.target ?? existing.target;

	const conflicting = await artifacts.findOne({
		_id: { $ne: artifactId },
		releaseId: existing.releaseId,
		platform: nextPlatform,
		format: nextFormat,
		target: nextTarget,
	});
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

	await artifacts.updateOne({ _id: artifactId }, { $set: patch });
}

async function deleteReleaseArtifactByAdmin(artifactId: string): Promise<void> {
	const db = await getDb();
	const artifacts = db.collection<ReleaseArtifactDocument>("release_artifacts");
	const bucket = new GridFSBucket(db, { bucketName: RELEASE_FILES_BUCKET });
	const existing = await artifacts.findOne({ _id: artifactId });
	if (!existing) {
		throw new HttpError(404, "Release artifact not found.");
	}

	try {
		await bucket.delete(new ObjectId(existing.gridFsFileId));
	} catch {
		// Ignore stale GridFS references during cleanup.
	}

	await artifacts.deleteOne({ _id: artifactId });
}

async function getReleaseArtifactById(
	artifactId: string,
): Promise<WithId<ReleaseArtifactDocument> | null> {
	const db = await getDb();
	const artifacts = db.collection<ReleaseArtifactDocument>("release_artifacts");
	return artifacts.findOne({ _id: artifactId });
}

async function buildDownloadResponse(request: Request, artifactId: string): Promise<Response> {
	const artifact = await getReleaseArtifactById(artifactId);
	if (!artifact) {
		throw new HttpError(404, "Release artifact not found.");
	}

	let objectId: ObjectId;
	try {
		objectId = new ObjectId(artifact.gridFsFileId);
	} catch {
		throw new HttpError(500, "Artifact storage reference is invalid.");
	}

	const db = await getDb();
	const bucket = new GridFSBucket(db, { bucketName: RELEASE_FILES_BUCKET });
	const exists = await bucket.find({ _id: objectId }).limit(1).next();
	if (!exists) {
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

	const stream = bucket.openDownloadStream(objectId);
	return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
		status: 200,
		headers,
	});
}

async function createUser(payload: SignupPayload): Promise<WithId<UserDocument>> {
	const db = await getDb();
	const users = db.collection<UserDocument>("users");

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
		roles: [DEFAULT_USER_ROLE],
		passwordHash,
		createdAt: now,
		updatedAt: now,
	};

	try {
		await users.insertOne(user);
	} catch (error) {
		if (error instanceof MongoServerError && error.code === 11000) {
			throw new HttpError(409, "An account with this email already exists.");
		}
		throw error;
	}

	return user;
}

async function findUserByEmail(email: string): Promise<WithId<UserDocument> | null> {
	const db = await getDb();
	const users = db.collection<UserDocument>("users");
	return users.findOne({ emailLower: normalizeEmail(email) });
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
	const db = await getDb();
	const sessions = db.collection<SessionDocument>("sessions");

	const now = new Date();
	await sessions.deleteMany({
		userId,
		expiresAt: { $lte: now },
	});

	const existingDeviceSession = await sessions.findOne({
		userId,
		deviceKey: meta.deviceKey,
		expiresAt: { $gt: now },
	});
	if (existingDeviceSession) {
		throw new HttpError(
			409,
			"This device already has an active session. Log out from that session before signing in again.",
		);
	}

	const activeSessionCount = await sessions.countDocuments({
		userId,
		expiresAt: { $gt: now },
	});
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

	await sessions.insertOne(session);
	return session;
}

async function deleteSession(sessionId: string): Promise<void> {
	const db = await getDb();
	const sessions = db.collection<SessionDocument>("sessions");
	await sessions.deleteOne({ _id: sessionId });
}

async function deleteSessionsByUserId(userId: string): Promise<void> {
	const db = await getDb();
	const sessions = db.collection<SessionDocument>("sessions");
	await sessions.deleteMany({ userId });
}

async function deleteSessionForUser(userId: string, sessionId: string): Promise<boolean> {
	const db = await getDb();
	const sessions = db.collection<SessionDocument>("sessions");
	const result = await sessions.deleteOne({ _id: sessionId, userId });
	return result.deletedCount > 0;
}

async function deleteAllSessionsForUser(userId: string): Promise<number> {
	const db = await getDb();
	const sessions = db.collection<SessionDocument>("sessions");
	const result = await sessions.deleteMany({ userId });
	return result.deletedCount;
}

async function listActiveSessionsForUser(
	userId: string,
	currentSessionId: string,
): Promise<SessionListResponse> {
	const db = await getDb();
	const sessions = db.collection<SessionDocument>("sessions");
	const now = new Date();
	await sessions.deleteMany({ userId, expiresAt: { $lte: now } });

	const activeSessions = await sessions
		.find({
			userId,
			expiresAt: { $gt: now },
		})
		.sort({ updatedAt: -1 })
		.toArray();

	return {
		sessions: activeSessions.map((session) => toAuthSession(session, currentSessionId)),
	};
}

async function resolveSessionUser(request: Request): Promise<ResolvedSessionContext | null> {
	const sessionId = getSessionIdFromRequest(request);
	if (!sessionId) return null;

	const db = await getDb();
	const sessions = db.collection<SessionDocument>("sessions");
	const users = db.collection<UserDocument>("users");
	const now = Date.now();
	const requestMeta = getSessionRequestMeta(request);

	const session = await sessions.findOne({ _id: sessionId });
	if (!session) return null;

	if (session.expiresAt.getTime() <= now) {
		await sessions.deleteOne({ _id: session._id });
		return null;
	}

	if (session.deviceKey !== requestMeta.deviceKey) {
		await sessions.deleteOne({ _id: session._id });
		return null;
	}

	const user = await users.findOne({ _id: session.userId });
	if (!user) {
		await sessions.deleteOne({ _id: session._id });
		return null;
	}

	if (now - session.updatedAt.getTime() >= SESSION_REFRESH_INTERVAL_MS) {
		const refreshed = {
			updatedAt: new Date(now),
			expiresAt: new Date(now + ONE_DAY_MS),
			ipAddress: requestMeta.ipAddress,
			userAgent: requestMeta.userAgent,
		} satisfies Partial<SessionDocument>;
		await sessions.updateOne(
			{ _id: session._id },
			{
				$set: refreshed,
			},
		);
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
	const db = await getDb();
	const users = db.collection<UserDocument>("users");

	const patch: Partial<UserDocument> = { updatedAt: new Date() };
	if (payload.fullName) patch.fullName = payload.fullName;
	if (payload.company) patch.company = payload.company;

	await users.updateOne({ _id: userId }, { $set: patch });
	const updated = await users.findOne({ _id: userId });
	if (!updated) {
		throw new HttpError(404, "User not found.");
	}
	return updated;
}

async function deleteUser(userId: string): Promise<void> {
	const db = await getDb();
	const users = db.collection<UserDocument>("users");
	await users.deleteOne({ _id: userId });
	await deleteSessionsByUserId(userId);
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
	const db = await getDb();
	const users = db.collection<UserDocument>("users");

	const userDocs = await users
		.find(
			{},
			{
				projection: {
					_id: 1,
					email: 1,
					fullName: 1,
					company: 1,
					roles: 1,
					isAdmin: 1,
					isOwner: 1,
					createdAt: 1,
					updatedAt: 1,
				},
			},
		)
		.sort({ createdAt: -1 })
		.toArray();

	const mappedUsers = userDocs.map((user) => toAuthUser(user as WithId<UserDocument>));
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
	const db = await getDb();
	const users = db.collection<UserDocument>("users");

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
		roles: [DEFAULT_USER_ROLE],
		passwordHash,
		createdAt: now,
		updatedAt: now,
	};

	try {
		await users.insertOne(user);
	} catch (error) {
		if (error instanceof MongoServerError && error.code === 11000) {
			const keyPattern = error.keyPattern ? Object.keys(error.keyPattern)[0] : "";
			if (keyPattern === "_id") {
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
	const db = await getDb();
	const users = db.collection<UserDocument>("users");

	const target = await users.findOne({ _id: targetUserId });
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
		await users.updateOne({ _id: targetUserId }, { $set: patch });
	} catch (error) {
		if (error instanceof MongoServerError && error.code === 11000) {
			throw new HttpError(409, "A user with this email already exists.");
		}
		throw error;
	}

	const updated = await users.findOne({ _id: targetUserId });
	if (!updated) {
		throw new HttpError(404, "User not found.");
	}
	return updated;
}

async function deleteUserByAdmin(actor: WithId<UserDocument>, targetUserId: string): Promise<void> {
	const db = await getDb();
	const users = db.collection<UserDocument>("users");
	const target = await users.findOne({ _id: targetUserId });

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
	const session = await createSession(user._id, getSessionRequestMeta(request));

	return jsonResponse(request, 201, buildAuthSuccessResponse(user), {
		"Set-Cookie": createSessionCookie(session._id, request),
	});
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

	const session = await createSession(user._id, getSessionRequestMeta(request));
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

	if (!url.pathname.startsWith(AUTH_BASE_PATH)) {
		return jsonResponse(request, 404, buildErrorResponse("Not Found"));
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

async function handleRequestWithErrorBoundary(request: Request): Promise<Response> {
	try {
		return await routeRequest(request);
	} catch (error) {
		if (error instanceof HttpError) {
			return jsonResponse(request, error.status, buildErrorResponse(error.message));
		}

		console.error("Unhandled auth API error:", error);
		return jsonResponse(request, 500, buildErrorResponse("Internal server error."));
	}
}

export async function startAuthServer() {
	const app = new Elysia({ name: "litecheats-auth-api" }).all("/*", ({ request }) =>
		handleRequestWithErrorBoundary(request),
	);
	app.listen({ port: AUTH_API_PORT, idleTimeout: 30 });

	console.log(`Auth server started at http://localhost:${AUTH_API_PORT}${AUTH_BASE_PATH}`);
	console.log(`Downloads API available at http://localhost:${AUTH_API_PORT}${DOWNLOADS_BASE_PATH}`);
	return app;
}

import { Readable } from "node:stream";
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
	type AuthSuccessResponse,
	type AuthUser,
	DEFAULT_USER_ROLE,
	type LoginPayload,
	type SessionResponse,
	type SignupPayload,
	USER_ROLES,
	type UpdateProfilePayload,
	type UserRole,
} from "../../shared/auth";
import {
	DOWNLOADS_BASE_PATH,
	RELEASE_FILES_BUCKET,
	type ReleaseArtifactSummary,
	type ReleaseFeedResponse,
	type ReleaseFormat,
	type ReleasePlatform,
	type ReleaseSummary,
} from "../../shared/releases";

const DEFAULT_MONGODB_URI = "mongodb://127.0.0.1:27017";
const DEFAULT_MONGODB_DB_NAME = "litecheats";
const ONE_DAY_MS = AUTH_COOKIE_MAX_AGE_SECONDS * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const mongoClient = new MongoClient(Bun.env.MONGODB_URI ?? DEFAULT_MONGODB_URI);
const mongoDbName = Bun.env.MONGODB_DB_NAME ?? DEFAULT_MONGODB_DB_NAME;
let dbPromise: Promise<Db> | null = null;

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

class HttpError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

function createUuidV7(): string {
	const maybeUuidV7 = (Bun as unknown as { randomUUIDv7?: () => string }).randomUUIDv7;
	return typeof maybeUuidV7 === "function" ? maybeUuidV7() : crypto.randomUUID();
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

function assertValidEmail(email: string): void {
	if (!EMAIL_PATTERN.test(email)) {
		throw new HttpError(400, "Please provide a valid email address.");
	}
}

function assertStrongPassword(password: string): void {
	if (password.length < 8) {
		throw new HttpError(400, "Password must be at least 8 characters long.");
	}
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

function createSessionCookie(sessionId: string): string {
	return [
		`${AUTH_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
		`Path=${AUTH_BASE_PATH}`,
		`Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}`,
		"HttpOnly",
		"SameSite=Lax",
	].join("; ");
}

function clearSessionCookie(): string {
	return [
		`${AUTH_COOKIE_NAME}=`,
		`Path=${AUTH_BASE_PATH}`,
		"Max-Age=0",
		"HttpOnly",
		"SameSite=Lax",
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
	const fullName = String(body.fullName ?? "").trim();
	const email = String(body.email ?? "").trim();
	const company = String(body.company ?? "").trim();
	const password = String(body.password ?? "");

	if (!fullName || !email || !company || !password) {
		throw new HttpError(400, "All signup fields are required.");
	}

	assertStrongPassword(password);
	assertValidEmail(email);

	return { fullName, email, company, password };
}

function parseLoginPayload(payload: unknown): LoginPayload {
	if (!payload || typeof payload !== "object") {
		throw new HttpError(400, "Invalid login payload.");
	}

	const body = payload as Record<string, unknown>;
	const email = String(body.email ?? "").trim();
	const password = String(body.password ?? "");

	if (!email || !password) {
		throw new HttpError(400, "Email and password are required.");
	}

	return { email, password };
}

function parseUpdatePayload(payload: unknown): UpdateProfilePayload {
	if (!payload || typeof payload !== "object") {
		throw new HttpError(400, "Invalid update payload.");
	}

	const body = payload as Record<string, unknown>;
	const fullName = typeof body.fullName === "string" ? body.fullName.trim() : undefined;
	const company = typeof body.company === "string" ? body.company.trim() : undefined;

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
	const fullName = String(body.fullName ?? "").trim();
	const email = String(body.email ?? "").trim();
	const company = String(body.company ?? "").trim();
	const password = String(body.password ?? "");
	const isAdmin = sanitizeRoleFlag(body.isAdmin);
	const isOwner = sanitizeRoleFlag(body.isOwner);

	if (id && id.length > 128) {
		throw new HttpError(400, "User id must be 128 characters or fewer.");
	}

	if (!fullName || !email || !company || !password) {
		throw new HttpError(400, "fullName, email, company, and password are required.");
	}

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
		if (typeof body.fullName !== "string" || !body.fullName.trim()) {
			throw new HttpError(400, "fullName must be a non-empty string.");
		}
		patch.fullName = body.fullName.trim();
	}

	if (hasOwn("company")) {
		if (typeof body.company !== "string" || !body.company.trim()) {
			throw new HttpError(400, "company must be a non-empty string.");
		}
		patch.company = body.company.trim();
	}

	if (hasOwn("email")) {
		if (typeof body.email !== "string" || !body.email.trim()) {
			throw new HttpError(400, "email must be a non-empty string.");
		}
		const email = body.email.trim();
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

function hasPrivilegedAccess(user: WithId<UserDocument>): boolean {
	return sanitizeRoleFlag(user.isAdmin) || sanitizeRoleFlag(user.isOwner);
}

function hasOwnerAccess(user: WithId<UserDocument>): boolean {
	return sanitizeRoleFlag(user.isOwner);
}

async function readRequestJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		throw new HttpError(400, "Malformed JSON body.");
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
			required: ["_id", "userId", "createdAt", "updatedAt", "expiresAt"],
			properties: {
				_id: { bsonType: "string" },
				userId: { bsonType: "string" },
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

	const users = db.collection<UserDocument>("users");
	const sessions = db.collection<SessionDocument>("sessions");
	const releaseVersions = db.collection<ReleaseVersionDocument>("release_versions");
	const releaseArtifacts = db.collection<ReleaseArtifactDocument>("release_artifacts");

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

	await users.createIndex({ emailLower: 1 }, { unique: true, name: "users_email_unique" });
	await users.createIndex({ roles: 1 }, { name: "users_roles_idx" });
	await sessions.createIndex({ userId: 1 }, { name: "sessions_user_id_idx" });
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

async function buildReleaseFeed(): Promise<ReleaseFeedResponse> {
	const db = await getDb();
	const releases = db.collection<ReleaseVersionDocument>("release_versions");
	const artifacts = db.collection<ReleaseArtifactDocument>("release_artifacts");

	const releaseList = await releases.find().sort({ publishedAt: -1 }).limit(20).toArray();
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

async function createSession(userId: string): Promise<WithId<SessionDocument>> {
	const db = await getDb();
	const sessions = db.collection<SessionDocument>("sessions");

	const now = new Date();
	const session: SessionDocument = {
		_id: createUuidV7(),
		userId,
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

async function resolveSessionUser(
	request: Request,
): Promise<{ user: WithId<UserDocument>; sessionId: string } | null> {
	const sessionId = getSessionIdFromRequest(request);
	if (!sessionId) return null;

	const db = await getDb();
	const sessions = db.collection<SessionDocument>("sessions");
	const users = db.collection<UserDocument>("users");

	const session = await sessions.findOne({ _id: sessionId });
	if (!session) return null;

	if (session.expiresAt.getTime() <= Date.now()) {
		await sessions.deleteOne({ _id: session._id });
		return null;
	}

	const user = await users.findOne({ _id: session.userId });
	if (!user) {
		await sessions.deleteOne({ _id: session._id });
		return null;
	}

	return { user, sessionId };
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

async function requirePrivilegedSession(
	request: Request,
): Promise<{ user: WithId<UserDocument>; sessionId: string }> {
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
	const user = await createUser(payload);
	const session = await createSession(user._id);

	return jsonResponse(request, 201, buildAuthSuccessResponse(user), {
		"Set-Cookie": createSessionCookie(session._id),
	});
}

async function handleLogin(request: Request): Promise<Response> {
	const payload = parseLoginPayload(await readRequestJson(request));
	const user = await findUserByEmail(payload.email);

	if (!user) {
		throw new HttpError(401, "Invalid email or password.");
	}

	const verified = await Bun.password.verify(payload.password, user.passwordHash);
	if (!verified) {
		throw new HttpError(401, "Invalid email or password.");
	}

	const session = await createSession(user._id);
	return jsonResponse(request, 200, buildAuthSuccessResponse(user), {
		"Set-Cookie": createSessionCookie(session._id),
	});
}

async function handleLogout(request: Request): Promise<Response> {
	const sessionId = getSessionIdFromRequest(request);
	if (sessionId) {
		await deleteSession(sessionId);
	}

	return emptyResponse(request, 204, {
		"Set-Cookie": clearSessionCookie(),
	});
}

async function handleSession(request: Request): Promise<Response> {
	const session = await resolveSessionUser(request);
	return jsonResponse(request, 200, buildSessionResponse(session?.user ?? null));
}

async function handleGetMe(request: Request): Promise<Response> {
	const session = await resolveSessionUser(request);
	if (!session) {
		throw new HttpError(401, "Unauthorized.");
	}

	return jsonResponse(request, 200, buildAuthSuccessResponse(session.user));
}

async function handlePatchMe(request: Request): Promise<Response> {
	const session = await resolveSessionUser(request);
	if (!session) {
		throw new HttpError(401, "Unauthorized.");
	}

	const payload = parseUpdatePayload(await readRequestJson(request));
	const updatedUser = await updateUser(session.user._id, payload);
	return jsonResponse(request, 200, buildAuthSuccessResponse(updatedUser));
}

async function handleDeleteMe(request: Request): Promise<Response> {
	const session = await resolveSessionUser(request);
	if (!session) {
		throw new HttpError(401, "Unauthorized.");
	}

	await deleteUser(session.user._id);
	return emptyResponse(request, 204, {
		"Set-Cookie": clearSessionCookie(),
	});
}

async function handleAdminListUsers(request: Request): Promise<Response> {
	await requirePrivilegedSession(request);
	const response = await listAdminUsers();
	return jsonResponse(request, 200, response);
}

async function handleAdminCreateUser(request: Request): Promise<Response> {
	const adminSession = await requirePrivilegedSession(request);
	const payload = parseAdminCreateUserPayload(await readRequestJson(request));

	if (payload.isOwner && !hasOwnerAccess(adminSession.user)) {
		throw new HttpError(403, "Only owners can create owner accounts.");
	}

	const created = await createUserByAdmin(payload);
	return jsonResponse(request, 201, buildAuthSuccessResponse(created));
}

async function handleAdminUpdateUser(request: Request, userId: string): Promise<Response> {
	const adminSession = await requirePrivilegedSession(request);
	const payload = parseAdminUpdateUserPayload(await readRequestJson(request));
	const updated = await updateUserByAdmin(adminSession.user, userId, payload);
	return jsonResponse(request, 200, buildAuthSuccessResponse(updated));
}

async function handleAdminDeleteUser(request: Request, userId: string): Promise<Response> {
	const adminSession = await requirePrivilegedSession(request);
	await deleteUserByAdmin(adminSession.user, userId);
	const response: AdminDeleteUserResponse = { deleted: true };
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

	if (request.method === "GET" && url.pathname === `${AUTH_BASE_PATH}/session`) {
		return handleSession(request);
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

export async function startAuthServer(): Promise<ReturnType<typeof Bun.serve>> {
	const server = Bun.serve({
		port: AUTH_API_PORT,
		idleTimeout: 30,
		fetch: async (request) => {
			try {
				return await routeRequest(request);
			} catch (error) {
				if (error instanceof HttpError) {
					return jsonResponse(request, error.status, buildErrorResponse(error.message));
				}

				const message = error instanceof Error ? error.message : "Internal server error.";
				return jsonResponse(request, 500, buildErrorResponse(message));
			}
		},
	});

	console.log(`Auth server started at http://localhost:${AUTH_API_PORT}${AUTH_BASE_PATH}`);
	console.log(`Downloads API available at http://localhost:${AUTH_API_PORT}${DOWNLOADS_BASE_PATH}`);
	return server;
}

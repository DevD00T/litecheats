import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEFAULT_USER_ROLE, type UserRole } from "../../shared/auth";
import type { ReleaseFormat, ReleasePlatform } from "../../shared/releases";

const DEFAULT_SQLITE_PATH = "./data/litecheats.sqlite";
const SQLITE_PATH = resolve(Bun.env.SQLITE_PATH ?? Bun.env.DATABASE_PATH ?? DEFAULT_SQLITE_PATH);
const DEFAULT_OWNER_EMAIL = "owner@litecheats.com";
const DEFAULT_OWNER_FULL_NAME = "Owner";
const DEFAULT_OWNER_COMPANY = "Litecheats Technologies";

export interface UserDocument {
	_id: string;
	email: string;
	emailLower: string;
	fullName: string;
	company: string;
	roles?: unknown;
	isAdmin?: unknown;
	isOwner?: unknown;
	emailVerified?: unknown;
	passwordHash: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface EmailVerificationRecord {
	token: string;
	userId: string;
	expiresAt: Date;
	createdAt: Date;
}

export interface SessionDocument {
	_id: string;
	userId: string;
	userAgent: string;
	ipAddress: string;
	deviceKey: string;
	createdAt: Date;
	updatedAt: Date;
	expiresAt: Date;
}

export interface ReleaseVersionDocument {
	_id: string;
	version: string;
	notes: string;
	publishedAt: Date;
	isLatest: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface ReleaseArtifactDocument {
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
	createdAt: Date;
}

export interface TelegramAdminDocument {
	_id: string;
	username: string;
	usernameLower: string;
	role: "admin" | "owner";
	addedByTelegramId: number | null;
	addedByUsername: string | null;
	createdAt: Date;
	updatedAt: Date;
}

// mongodb's WithId<T> = T & { _id: ... }; every document above already declares
// _id itself, so the identity alias keeps every call site that names WithId<X> unchanged.
export type WithId<T> = T;

interface UserRow {
	id: string;
	email: string;
	emailLower: string;
	fullName: string;
	company: string;
	isAdmin: number;
	isOwner: number;
	emailVerified: number;
	roles: string;
	passwordHash: string;
	createdAt: string;
	updatedAt: string;
}

interface EmailVerificationRow {
	token: string;
	userId: string;
	expiresAt: string;
	createdAt: string;
}

interface SessionRow {
	id: string;
	userId: string;
	userAgent: string;
	ipAddress: string;
	deviceKey: string;
	createdAt: string;
	updatedAt: string;
	expiresAt: string;
}

interface ReleaseRow {
	id: string;
	version: string;
	notes: string;
	publishedAt: string;
	isLatest: number;
	createdAt: string;
	updatedAt: string;
}

interface ArtifactMetaRow {
	id: string;
	releaseId: string;
	version: string;
	platform: string;
	format: string;
	target: string;
	filename: string;
	sizeBytes: number;
	sha256: string;
	mimeType: string;
	createdAt: string;
}

interface TelegramAdminRow {
	id: string;
	username: string;
	usernameLower: string;
	role: string;
	addedByTelegramId: number | null;
	addedByUsername: string | null;
	createdAt: string;
	updatedAt: string;
}

const ARTIFACT_META_COLUMNS =
	"id, releaseId, version, platform, format, target, filename, sizeBytes, sha256, mimeType, createdAt";

let db: Database | null = null;
let initPromise: Promise<Database> | null = null;

function createUuidV7(): string {
	const maybeUuidV7 = (Bun as unknown as { randomUUIDv7?: () => string }).randomUUIDv7;
	return typeof maybeUuidV7 === "function" ? maybeUuidV7() : crypto.randomUUID();
}

function generateRandomPassword(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(18));
	return `${Buffer.from(bytes).toString("base64url")}!9`;
}

export function isUniqueConstraintError(error: unknown): boolean {
	return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

export function uniqueConstraintColumn(error: unknown): string | null {
	if (!(error instanceof Error)) return null;
	const match = error.message.match(/UNIQUE constraint failed: [^.]+\.(\w+)/);
	return match?.[1] ?? null;
}

function requireDb(): Database {
	if (!db) {
		throw new Error("Database has not finished initializing. Call getDb() first.");
	}
	return db;
}

function openDatabase(): Database {
	const dir = dirname(SQLITE_PATH);
	if (dir && dir !== ".") {
		mkdirSync(dir, { recursive: true });
	}

	const instance = new Database(SQLITE_PATH, { create: true });
	instance.exec("PRAGMA journal_mode = WAL;");
	instance.exec("PRAGMA foreign_keys = ON;");
	return instance;
}

function runMigrations(instance: Database): void {
	instance.exec(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL,
			emailLower TEXT NOT NULL UNIQUE,
			fullName TEXT NOT NULL,
			company TEXT NOT NULL,
			isAdmin INTEGER NOT NULL DEFAULT 0,
			isOwner INTEGER NOT NULL DEFAULT 0,
			emailVerified INTEGER NOT NULL DEFAULT 0,
			roles TEXT NOT NULL,
			passwordHash TEXT NOT NULL,
			createdAt TEXT NOT NULL,
			updatedAt TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS email_verifications (
			token TEXT PRIMARY KEY,
			userId TEXT NOT NULL,
			expiresAt TEXT NOT NULL,
			createdAt TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS email_verifications_user_idx ON email_verifications(userId);

		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			userId TEXT NOT NULL,
			userAgent TEXT NOT NULL,
			ipAddress TEXT NOT NULL,
			deviceKey TEXT NOT NULL,
			createdAt TEXT NOT NULL,
			updatedAt TEXT NOT NULL,
			expiresAt TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(userId);
		CREATE INDEX IF NOT EXISTS sessions_user_device_idx ON sessions(userId, deviceKey, expiresAt);
		CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expiresAt);

		CREATE TABLE IF NOT EXISTS release_versions (
			id TEXT PRIMARY KEY,
			version TEXT NOT NULL UNIQUE,
			notes TEXT NOT NULL,
			publishedAt TEXT NOT NULL,
			isLatest INTEGER NOT NULL DEFAULT 0,
			createdAt TEXT NOT NULL,
			updatedAt TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS release_versions_latest_idx ON release_versions(isLatest);
		CREATE INDEX IF NOT EXISTS release_versions_published_idx ON release_versions(publishedAt);

		CREATE TABLE IF NOT EXISTS release_artifacts (
			id TEXT PRIMARY KEY,
			releaseId TEXT NOT NULL,
			version TEXT NOT NULL,
			platform TEXT NOT NULL,
			format TEXT NOT NULL,
			target TEXT NOT NULL,
			filename TEXT NOT NULL,
			sizeBytes INTEGER NOT NULL,
			sha256 TEXT NOT NULL,
			mimeType TEXT NOT NULL,
			data BLOB NOT NULL,
			createdAt TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS release_artifacts_release_idx ON release_artifacts(releaseId);
		CREATE INDEX IF NOT EXISTS release_artifacts_lookup_idx
			ON release_artifacts(version, platform, format, target);

		CREATE TABLE IF NOT EXISTS telegram_admins (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL,
			usernameLower TEXT NOT NULL UNIQUE,
			role TEXT NOT NULL,
			addedByTelegramId INTEGER,
			addedByUsername TEXT,
			createdAt TEXT NOT NULL,
			updatedAt TEXT NOT NULL
		);
	`);

	// Column added after initial release; existing databases created before it
	// won't have it yet. ALTER TABLE ADD COLUMN has no IF NOT EXISTS guard in
	// SQLite, so probe for the column instead of relying on a thrown error.
	const userColumns = instance.query("PRAGMA table_info(users)").all() as { name: string }[];
	if (!userColumns.some((column) => column.name === "emailVerified")) {
		instance.exec("ALTER TABLE users ADD COLUMN emailVerified INTEGER NOT NULL DEFAULT 0;");
	}
}

async function seedOwnerAccount(instance: Database): Promise<void> {
	const ownerCount = instance
		.query("SELECT COUNT(*) as count FROM users WHERE isOwner = 1")
		.get() as { count: number };
	if (ownerCount.count > 0) return;

	const emailInput = Bun.env.OWNER_EMAIL?.trim() || DEFAULT_OWNER_EMAIL;
	const emailLower = emailInput.toLowerCase();
	const now = new Date().toISOString();

	const existing = instance.query("SELECT id FROM users WHERE emailLower = ?").get(emailLower) as {
		id: string;
	} | null;

	if (existing) {
		instance
			.query(
				"UPDATE users SET isOwner = 1, isAdmin = 1, emailVerified = 1, updatedAt = ? WHERE id = ?",
			)
			.run(now, existing.id);
		console.log(`[db] Promoted existing account "${emailInput}" to owner.`);
		return;
	}

	const explicitPassword = Bun.env.OWNER_PASSWORD?.trim();
	const password = explicitPassword || generateRandomPassword();
	const passwordHash = await Bun.password.hash(password);
	const id = createUuidV7();

	instance
		.query(
			`INSERT INTO users (id, email, emailLower, fullName, company, isAdmin, isOwner, emailVerified, roles, passwordHash, createdAt, updatedAt)
			 VALUES (?, ?, ?, ?, ?, 1, 1, 1, ?, ?, ?, ?)`,
		)
		.run(
			id,
			emailInput,
			emailLower,
			Bun.env.OWNER_FULL_NAME?.trim() || DEFAULT_OWNER_FULL_NAME,
			Bun.env.OWNER_COMPANY?.trim() || DEFAULT_OWNER_COMPANY,
			JSON.stringify([DEFAULT_USER_ROLE]),
			passwordHash,
			now,
			now,
		);

	console.log("========================================");
	console.log(" Owner account created");
	console.log(` Email:    ${emailInput}`);
	if (!explicitPassword) {
		console.log(` Password: ${password}`);
		console.log(" Save this password now, it will not be shown again.");
		console.log(" Set OWNER_PASSWORD in your environment to control it explicitly next time.");
	} else {
		console.log(" Password: set from OWNER_PASSWORD.");
	}
	console.log("========================================");
}

export async function getDb(): Promise<Database> {
	if (db) return db;
	if (!initPromise) {
		initPromise = (async () => {
			const instance = openDatabase();
			runMigrations(instance);
			await seedOwnerAccount(instance);
			db = instance;
			return instance;
		})().catch((error) => {
			initPromise = null;
			throw error;
		});
	}
	return initPromise;
}

function rowToUser(row: UserRow): WithId<UserDocument> {
	return {
		_id: row.id,
		email: row.email,
		emailLower: row.emailLower,
		fullName: row.fullName,
		company: row.company,
		isAdmin: Boolean(row.isAdmin),
		isOwner: Boolean(row.isOwner),
		emailVerified: Boolean(row.emailVerified),
		roles: JSON.parse(row.roles) as UserRole[],
		passwordHash: row.passwordHash,
		createdAt: new Date(row.createdAt),
		updatedAt: new Date(row.updatedAt),
	};
}

export function insertUser(user: WithId<UserDocument>): void {
	requireDb()
		.query(
			`INSERT INTO users (id, email, emailLower, fullName, company, isAdmin, isOwner, emailVerified, roles, passwordHash, createdAt, updatedAt)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			user._id,
			user.email,
			user.emailLower,
			user.fullName,
			user.company,
			user.isAdmin ? 1 : 0,
			user.isOwner ? 1 : 0,
			user.emailVerified ? 1 : 0,
			JSON.stringify(user.roles ?? [DEFAULT_USER_ROLE]),
			user.passwordHash,
			user.createdAt.toISOString(),
			user.updatedAt.toISOString(),
		);
}

export function findUserByEmailLower(emailLower: string): WithId<UserDocument> | null {
	const row = requireDb()
		.query("SELECT * FROM users WHERE emailLower = ?")
		.get(emailLower) as UserRow | null;
	return row ? rowToUser(row) : null;
}

export function findUserById(id: string): WithId<UserDocument> | null {
	const row = requireDb().query("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null;
	return row ? rowToUser(row) : null;
}

export function listAllUsersSortedByCreatedDesc(): WithId<UserDocument>[] {
	const rows = requireDb().query("SELECT * FROM users ORDER BY createdAt DESC").all() as UserRow[];
	return rows.map(rowToUser);
}

export function updateUserFields(id: string, patch: Partial<UserDocument>): void {
	const columns: Record<string, string | number> = {};
	if (patch.fullName !== undefined) columns.fullName = patch.fullName;
	if (patch.company !== undefined) columns.company = patch.company;
	if (patch.email !== undefined) columns.email = patch.email;
	if (patch.emailLower !== undefined) columns.emailLower = patch.emailLower;
	if (patch.isAdmin !== undefined) columns.isAdmin = patch.isAdmin ? 1 : 0;
	if (patch.isOwner !== undefined) columns.isOwner = patch.isOwner ? 1 : 0;
	if (patch.emailVerified !== undefined) columns.emailVerified = patch.emailVerified ? 1 : 0;
	if (patch.passwordHash !== undefined) columns.passwordHash = patch.passwordHash;
	if (patch.roles !== undefined) columns.roles = JSON.stringify(patch.roles);
	if (patch.updatedAt !== undefined) columns.updatedAt = patch.updatedAt.toISOString();

	const keys = Object.keys(columns);
	if (!keys.length) return;

	const setClause = keys.map((key) => `${key} = ?`).join(", ");
	requireDb()
		.query(`UPDATE users SET ${setClause} WHERE id = ?`)
		.run(...keys.map((key) => columns[key]), id);
}

export function deleteUserById(id: string): void {
	requireDb().query("DELETE FROM users WHERE id = ?").run(id);
}

function rowToSession(row: SessionRow): WithId<SessionDocument> {
	return {
		_id: row.id,
		userId: row.userId,
		userAgent: row.userAgent,
		ipAddress: row.ipAddress,
		deviceKey: row.deviceKey,
		createdAt: new Date(row.createdAt),
		updatedAt: new Date(row.updatedAt),
		expiresAt: new Date(row.expiresAt),
	};
}

export function insertSession(session: WithId<SessionDocument>): void {
	requireDb()
		.query(
			`INSERT INTO sessions (id, userId, userAgent, ipAddress, deviceKey, createdAt, updatedAt, expiresAt)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			session._id,
			session.userId,
			session.userAgent,
			session.ipAddress,
			session.deviceKey,
			session.createdAt.toISOString(),
			session.updatedAt.toISOString(),
			session.expiresAt.toISOString(),
		);
}

export function findSessionById(id: string): WithId<SessionDocument> | null {
	const row = requireDb().query("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | null;
	return row ? rowToSession(row) : null;
}

export function deleteSessionById(id: string): void {
	requireDb().query("DELETE FROM sessions WHERE id = ?").run(id);
}

export function deleteSessionByIdForUser(id: string, userId: string): boolean {
	const result = requireDb()
		.query("DELETE FROM sessions WHERE id = ? AND userId = ?")
		.run(id, userId);
	return result.changes > 0;
}

export function deleteSessionsByUserId(userId: string): void {
	requireDb().query("DELETE FROM sessions WHERE userId = ?").run(userId);
}

export function deleteAllSessionsForUser(userId: string): number {
	const result = requireDb().query("DELETE FROM sessions WHERE userId = ?").run(userId);
	return result.changes;
}

export function deleteExpiredSessionsForUser(userId: string, now: Date): void {
	requireDb()
		.query("DELETE FROM sessions WHERE userId = ? AND expiresAt <= ?")
		.run(userId, now.toISOString());
}

export function countActiveSessionsForDevice(userId: string, deviceKey: string, now: Date): number {
	const row = requireDb()
		.query(
			"SELECT COUNT(*) as count FROM sessions WHERE userId = ? AND deviceKey = ? AND expiresAt > ?",
		)
		.get(userId, deviceKey, now.toISOString()) as { count: number };
	return row.count;
}

export function countActiveSessionsForUser(userId: string, now: Date): number {
	const row = requireDb()
		.query("SELECT COUNT(*) as count FROM sessions WHERE userId = ? AND expiresAt > ?")
		.get(userId, now.toISOString()) as { count: number };
	return row.count;
}

export function listActiveSessionsForUser(userId: string, now: Date): WithId<SessionDocument>[] {
	const rows = requireDb()
		.query("SELECT * FROM sessions WHERE userId = ? AND expiresAt > ? ORDER BY updatedAt DESC")
		.all(userId, now.toISOString()) as SessionRow[];
	return rows.map(rowToSession);
}

export function touchSession(
	id: string,
	patch: { updatedAt: Date; expiresAt: Date; ipAddress: string; userAgent: string },
): void {
	requireDb()
		.query(
			"UPDATE sessions SET updatedAt = ?, expiresAt = ?, ipAddress = ?, userAgent = ? WHERE id = ?",
		)
		.run(
			patch.updatedAt.toISOString(),
			patch.expiresAt.toISOString(),
			patch.ipAddress,
			patch.userAgent,
			id,
		);
}

function rowToRelease(row: ReleaseRow): WithId<ReleaseVersionDocument> {
	return {
		_id: row.id,
		version: row.version,
		notes: row.notes,
		publishedAt: new Date(row.publishedAt),
		isLatest: Boolean(row.isLatest),
		createdAt: new Date(row.createdAt),
		updatedAt: new Date(row.updatedAt),
	};
}

export function insertRelease(release: WithId<ReleaseVersionDocument>): void {
	requireDb()
		.query(
			`INSERT INTO release_versions (id, version, notes, publishedAt, isLatest, createdAt, updatedAt)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			release._id,
			release.version,
			release.notes,
			release.publishedAt.toISOString(),
			release.isLatest ? 1 : 0,
			release.createdAt.toISOString(),
			release.updatedAt.toISOString(),
		);
}

export function findReleaseById(id: string): WithId<ReleaseVersionDocument> | null {
	const row = requireDb()
		.query("SELECT * FROM release_versions WHERE id = ?")
		.get(id) as ReleaseRow | null;
	return row ? rowToRelease(row) : null;
}

export function findReleaseByVersion(version: string): WithId<ReleaseVersionDocument> | null {
	const row = requireDb()
		.query("SELECT * FROM release_versions WHERE version = ?")
		.get(version) as ReleaseRow | null;
	return row ? rowToRelease(row) : null;
}

export function listReleasesSortedByPublishedDesc(limit: number): WithId<ReleaseVersionDocument>[] {
	const rows = requireDb()
		.query("SELECT * FROM release_versions ORDER BY publishedAt DESC LIMIT ?")
		.all(limit) as ReleaseRow[];
	return rows.map(rowToRelease);
}

export function findMostRecentReleaseByPublishedDesc(): WithId<ReleaseVersionDocument> | null {
	const row = requireDb()
		.query("SELECT * FROM release_versions ORDER BY publishedAt DESC LIMIT 1")
		.get() as ReleaseRow | null;
	return row ? rowToRelease(row) : null;
}

export function findAnyLatestRelease(): WithId<ReleaseVersionDocument> | null {
	const row = requireDb()
		.query("SELECT * FROM release_versions WHERE isLatest = 1 LIMIT 1")
		.get() as ReleaseRow | null;
	return row ? rowToRelease(row) : null;
}

export function unsetLatestExcept(id: string, updatedAt: Date): void {
	requireDb()
		.query("UPDATE release_versions SET isLatest = 0, updatedAt = ? WHERE id != ? AND isLatest = 1")
		.run(updatedAt.toISOString(), id);
}

export function setReleaseLatest(id: string, isLatest: boolean, updatedAt: Date): void {
	requireDb()
		.query("UPDATE release_versions SET isLatest = ?, updatedAt = ? WHERE id = ?")
		.run(isLatest ? 1 : 0, updatedAt.toISOString(), id);
}

export function updateReleaseFields(id: string, patch: Partial<ReleaseVersionDocument>): void {
	const columns: Record<string, string | number> = {};
	if (patch.version !== undefined) columns.version = patch.version;
	if (patch.notes !== undefined) columns.notes = patch.notes;
	if (patch.publishedAt !== undefined) columns.publishedAt = patch.publishedAt.toISOString();
	if (patch.isLatest !== undefined) columns.isLatest = patch.isLatest ? 1 : 0;
	if (patch.updatedAt !== undefined) columns.updatedAt = patch.updatedAt.toISOString();

	const keys = Object.keys(columns);
	if (!keys.length) return;

	const setClause = keys.map((key) => `${key} = ?`).join(", ");
	requireDb()
		.query(`UPDATE release_versions SET ${setClause} WHERE id = ?`)
		.run(...keys.map((key) => columns[key]), id);
}

export function deleteReleaseById(id: string): void {
	requireDb().query("DELETE FROM release_versions WHERE id = ?").run(id);
}

export function updateArtifactVersionForRelease(releaseId: string, version: string): void {
	requireDb()
		.query("UPDATE release_artifacts SET version = ? WHERE releaseId = ?")
		.run(version, releaseId);
}

function rowToArtifactMeta(row: ArtifactMetaRow): WithId<ReleaseArtifactDocument> {
	return {
		_id: row.id,
		releaseId: row.releaseId,
		version: row.version,
		platform: row.platform as ReleasePlatform,
		format: row.format as ReleaseFormat,
		target: row.target,
		filename: row.filename,
		sizeBytes: row.sizeBytes,
		sha256: row.sha256,
		mimeType: row.mimeType,
		createdAt: new Date(row.createdAt),
	};
}

export function insertArtifact(artifact: WithId<ReleaseArtifactDocument>, data: Uint8Array): void {
	requireDb()
		.query(
			`INSERT INTO release_artifacts
				(id, releaseId, version, platform, format, target, filename, sizeBytes, sha256, mimeType, data, createdAt)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			artifact._id,
			artifact.releaseId,
			artifact.version,
			artifact.platform,
			artifact.format,
			artifact.target,
			artifact.filename,
			artifact.sizeBytes,
			artifact.sha256,
			artifact.mimeType,
			data,
			artifact.createdAt.toISOString(),
		);
}

export function findArtifactMetaById(id: string): WithId<ReleaseArtifactDocument> | null {
	const row = requireDb()
		.query(`SELECT ${ARTIFACT_META_COLUMNS} FROM release_artifacts WHERE id = ?`)
		.get(id) as ArtifactMetaRow | null;
	return row ? rowToArtifactMeta(row) : null;
}

export function findArtifactBlobById(id: string): Uint8Array | null {
	const row = requireDb().query("SELECT data FROM release_artifacts WHERE id = ?").get(id) as {
		data: Uint8Array;
	} | null;
	return row ? row.data : null;
}

export function findArtifactByLookup(
	releaseId: string,
	platform: string,
	format: string,
	target: string,
): WithId<ReleaseArtifactDocument> | null {
	const row = requireDb()
		.query(
			`SELECT ${ARTIFACT_META_COLUMNS} FROM release_artifacts
			 WHERE releaseId = ? AND platform = ? AND format = ? AND target = ?`,
		)
		.get(releaseId, platform, format, target) as ArtifactMetaRow | null;
	return row ? rowToArtifactMeta(row) : null;
}

export function findConflictingArtifact(
	excludeId: string,
	releaseId: string,
	platform: string,
	format: string,
	target: string,
): WithId<ReleaseArtifactDocument> | null {
	const row = requireDb()
		.query(
			`SELECT ${ARTIFACT_META_COLUMNS} FROM release_artifacts
			 WHERE id != ? AND releaseId = ? AND platform = ? AND format = ? AND target = ?`,
		)
		.get(excludeId, releaseId, platform, format, target) as ArtifactMetaRow | null;
	return row ? rowToArtifactMeta(row) : null;
}

export function listArtifactMetaByReleaseIds(
	releaseIds: string[],
): WithId<ReleaseArtifactDocument>[] {
	if (!releaseIds.length) return [];
	const placeholders = releaseIds.map(() => "?").join(", ");
	const rows = requireDb()
		.query(
			`SELECT ${ARTIFACT_META_COLUMNS} FROM release_artifacts WHERE releaseId IN (${placeholders}) ORDER BY createdAt DESC`,
		)
		.all(...releaseIds) as ArtifactMetaRow[];
	return rows.map(rowToArtifactMeta);
}

export function updateArtifactFields(id: string, patch: Partial<ReleaseArtifactDocument>): void {
	const columns: Record<string, string | number> = {};
	if (patch.platform !== undefined) columns.platform = patch.platform;
	if (patch.format !== undefined) columns.format = patch.format;
	if (patch.target !== undefined) columns.target = patch.target;
	if (patch.filename !== undefined) columns.filename = patch.filename;
	if (patch.mimeType !== undefined) columns.mimeType = patch.mimeType;

	const keys = Object.keys(columns);
	if (!keys.length) return;

	const setClause = keys.map((key) => `${key} = ?`).join(", ");
	requireDb()
		.query(`UPDATE release_artifacts SET ${setClause} WHERE id = ?`)
		.run(...keys.map((key) => columns[key]), id);
}

export function deleteArtifactById(id: string): void {
	requireDb().query("DELETE FROM release_artifacts WHERE id = ?").run(id);
}

export function deleteArtifactsByReleaseId(releaseId: string): number {
	const result = requireDb()
		.query("DELETE FROM release_artifacts WHERE releaseId = ?")
		.run(releaseId);
	return result.changes;
}

function rowToTelegramAdmin(row: TelegramAdminRow): WithId<TelegramAdminDocument> {
	return {
		_id: row.id,
		username: row.username,
		usernameLower: row.usernameLower,
		role: row.role as "admin" | "owner",
		addedByTelegramId: row.addedByTelegramId,
		addedByUsername: row.addedByUsername,
		createdAt: new Date(row.createdAt),
		updatedAt: new Date(row.updatedAt),
	};
}

export function findTelegramAdminByUsernameLower(
	usernameLower: string,
): WithId<TelegramAdminDocument> | null {
	const row = requireDb()
		.query("SELECT * FROM telegram_admins WHERE usernameLower = ?")
		.get(usernameLower) as TelegramAdminRow | null;
	return row ? rowToTelegramAdmin(row) : null;
}

export function listTelegramAdminsSorted(): WithId<TelegramAdminDocument>[] {
	const rows = requireDb()
		.query("SELECT * FROM telegram_admins ORDER BY role DESC, usernameLower ASC")
		.all() as TelegramAdminRow[];
	return rows.map(rowToTelegramAdmin);
}

export function seedTelegramAdminsFromEnv(usernames: string[]): void {
	const instance = requireDb();
	const now = new Date().toISOString();

	for (const username of usernames) {
		const usernameLower = username.toLowerCase();
		const existing = instance
			.query("SELECT id FROM telegram_admins WHERE usernameLower = ?")
			.get(usernameLower) as { id: string } | null;

		if (existing) {
			instance.query("UPDATE telegram_admins SET updatedAt = ? WHERE id = ?").run(now, existing.id);
			continue;
		}

		instance
			.query(
				`INSERT INTO telegram_admins
					(id, username, usernameLower, role, addedByTelegramId, addedByUsername, createdAt, updatedAt)
				 VALUES (?, ?, ?, 'owner', NULL, 'env', ?, ?)`,
			)
			.run(crypto.randomUUID(), username, usernameLower, now, now);
	}
}

export function upsertTelegramAdmin(
	username: string,
	addedByTelegramId: number | null,
	addedByUsername: string | null,
): { admin: WithId<TelegramAdminDocument>; created: boolean } {
	const instance = requireDb();
	const usernameLower = username.toLowerCase();
	const now = new Date().toISOString();

	const existing = findTelegramAdminByUsernameLower(usernameLower);
	if (existing) {
		instance.query("UPDATE telegram_admins SET updatedAt = ? WHERE id = ?").run(now, existing._id);
		return { admin: existing, created: false };
	}

	const id = crypto.randomUUID();
	instance
		.query(
			`INSERT INTO telegram_admins
				(id, username, usernameLower, role, addedByTelegramId, addedByUsername, createdAt, updatedAt)
			 VALUES (?, ?, ?, 'admin', ?, ?, ?, ?)`,
		)
		.run(id, username, usernameLower, addedByTelegramId, addedByUsername, now, now);

	const created = findTelegramAdminByUsernameLower(usernameLower);
	if (!created) {
		throw new Error("Telegram admin was not saved. Please try again.");
	}
	return { admin: created, created: true };
}

function rowToEmailVerificationRecord(row: EmailVerificationRow): EmailVerificationRecord {
	return {
		token: row.token,
		userId: row.userId,
		expiresAt: new Date(row.expiresAt),
		createdAt: new Date(row.createdAt),
	};
}

export function insertEmailVerificationToken(token: string, userId: string, expiresAt: Date): void {
	const now = new Date().toISOString();
	requireDb()
		.query(
			"INSERT INTO email_verifications (token, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)",
		)
		.run(token, userId, expiresAt.toISOString(), now);
}

export function findEmailVerificationToken(token: string): EmailVerificationRecord | null {
	const row = requireDb()
		.query("SELECT * FROM email_verifications WHERE token = ?")
		.get(token) as EmailVerificationRow | null;
	return row ? rowToEmailVerificationRecord(row) : null;
}

export function deleteEmailVerificationToken(token: string): void {
	requireDb().query("DELETE FROM email_verifications WHERE token = ?").run(token);
}

export function deleteEmailVerificationTokensForUser(userId: string): void {
	requireDb().query("DELETE FROM email_verifications WHERE userId = ?").run(userId);
}

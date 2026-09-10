import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEFAULT_USER_ROLE, type UserRole } from "../../shared/auth";
import {
	BILLING_CURRENCY,
	type BillingCycle,
	type BillingMode,
	type BillingPlanId,
	type BillingSubscriptionStatus,
	DEFAULT_WALLET_AUTO_RENEW,
	DEFAULT_WALLET_PAYMENT_MODE,
	type WalletPaymentMode,
	type WalletTransactionType,
} from "../../shared/billing";
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
	/** Private-chat id, or null until this admin has messaged the bot. */
	chatId: number | null;
	addedByTelegramId: number | null;
	addedByUsername: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface BillingSubscriptionDocument {
	_id: string;
	userId: string;
	planId: BillingPlanId;
	planName: string;
	cycle: BillingCycle;
	quantity: number;
	mode: BillingMode;
	status: BillingSubscriptionStatus;
	/** Total charged for the term, in paise, tax included. */
	amount: number;
	currency: string;
	razorpayOrderId: string | null;
	razorpaySubscriptionId: string | null;
	razorpayPaymentId: string | null;
	shortUrl: string | null;
	currentPeriodStart: Date | null;
	currentPeriodEnd: Date | null;
	cancelAtPeriodEnd: boolean;
	/** Short human-quotable id, e.g. LC-SUB-7QK3M2AD. */
	privateId: string;
	notes: string;
	/** Period end the renewal warning was last sent for, so it goes out once. */
	renewalWarningSentFor: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface BillingPaymentDocument {
	_id: string;
	userId: string;
	subscriptionId: string | null;
	razorpayPaymentId: string | null;
	razorpayOrderId: string | null;
	planId: string;
	amount: number;
	currency: string;
	status: string;
	method: string | null;
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
	chatId: number | null;
	addedByTelegramId: number | null;
	addedByUsername: string | null;
	createdAt: string;
	updatedAt: string;
}

const ARTIFACT_META_COLUMNS =
	"id, releaseId, version, platform, format, target, filename, sizeBytes, sha256, mimeType, createdAt";

let db: Database | null = null;
let initPromise: Promise<Database> | null = null;

const PRIVATE_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Short, unambiguous identifier a human can read aloud. The alphabet omits
 * O/0 and I/1 so a support agent and a customer cannot transcribe it wrongly.
 */
export function generateSubscriptionPrivateId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	let suffix = "";
	for (const byte of bytes) {
		suffix += PRIVATE_ID_ALPHABET[byte % PRIVATE_ID_ALPHABET.length];
	}
	return `LC-SUB-${suffix}`;
}

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

		-- Signup verification is a short numeric code the user types in, not a
		-- link they click, so exactly one live code per account is all we need.
		-- The code itself is never stored; only a hash of it.
		CREATE TABLE IF NOT EXISTS email_verification_codes (
			userId TEXT PRIMARY KEY,
			codeHash TEXT NOT NULL,
			expiresAt TEXT NOT NULL,
			attempts INTEGER NOT NULL DEFAULT 0,
			lastSentAt TEXT NOT NULL,
			createdAt TEXT NOT NULL
		);

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

		CREATE TABLE IF NOT EXISTS billing_subscriptions (
			id TEXT PRIMARY KEY,
			userId TEXT NOT NULL,
			planId TEXT NOT NULL,
			planName TEXT NOT NULL,
			cycle TEXT NOT NULL,
			quantity INTEGER NOT NULL,
			mode TEXT NOT NULL,
			status TEXT NOT NULL,
			amount INTEGER NOT NULL,
			currency TEXT NOT NULL,
			razorpayOrderId TEXT,
			razorpaySubscriptionId TEXT,
			razorpayPaymentId TEXT,
			shortUrl TEXT,
			currentPeriodStart TEXT,
			currentPeriodEnd TEXT,
			cancelAtPeriodEnd INTEGER NOT NULL DEFAULT 0,
			createdAt TEXT NOT NULL,
			updatedAt TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS billing_subscriptions_user_idx
			ON billing_subscriptions(userId, createdAt);
		CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_order_idx
			ON billing_subscriptions(razorpayOrderId) WHERE razorpayOrderId IS NOT NULL;
		CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_remote_idx
			ON billing_subscriptions(razorpaySubscriptionId) WHERE razorpaySubscriptionId IS NOT NULL;

		CREATE TABLE IF NOT EXISTS billing_payments (
			id TEXT PRIMARY KEY,
			userId TEXT NOT NULL,
			subscriptionId TEXT,
			razorpayPaymentId TEXT UNIQUE,
			razorpayOrderId TEXT,
			planId TEXT NOT NULL,
			amount INTEGER NOT NULL,
			currency TEXT NOT NULL,
			status TEXT NOT NULL,
			method TEXT,
			createdAt TEXT NOT NULL,
			updatedAt TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS billing_payments_user_idx ON billing_payments(userId, createdAt);
		CREATE INDEX IF NOT EXISTS billing_payments_subscription_idx
			ON billing_payments(subscriptionId);

		-- Razorpay retries a webhook until it gets a 2xx, and may deliver the same
		-- event more than once even after success. Recording the event id makes
		-- every handler idempotent.
		CREATE TABLE IF NOT EXISTS billing_webhook_events (
			id TEXT PRIMARY KEY,
			event TEXT NOT NULL,
			receivedAt TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS billing_webhook_events_received_idx
			ON billing_webhook_events(receivedAt);

		CREATE TABLE IF NOT EXISTS wallet_accounts (
			userId TEXT PRIMARY KEY,
			balance INTEGER NOT NULL DEFAULT 0,
			currency TEXT NOT NULL,
			autoRenew INTEGER NOT NULL DEFAULT 1,
			paymentMode TEXT NOT NULL DEFAULT 'wallet',
			createdAt TEXT NOT NULL,
			updatedAt TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS wallet_transactions (
			id TEXT PRIMARY KEY,
			userId TEXT NOT NULL,
			type TEXT NOT NULL,
			amount INTEGER NOT NULL,
			balanceAfter INTEGER NOT NULL,
			reason TEXT NOT NULL,
			referenceId TEXT,
			createdAt TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS wallet_transactions_user_idx
			ON wallet_transactions(userId, createdAt);

		CREATE TABLE IF NOT EXISTS wallet_topups (
			id TEXT PRIMARY KEY,
			userId TEXT NOT NULL,
			amount INTEGER NOT NULL,
			razorpayOrderId TEXT UNIQUE,
			razorpayPaymentId TEXT,
			status TEXT NOT NULL,
			createdAt TEXT NOT NULL,
			updatedAt TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS wallet_topups_user_idx ON wallet_topups(userId, createdAt);
	`);

	// Added after billing shipped; SQLite has no ALTER TABLE ... IF NOT EXISTS,
	// so probe for the column rather than relying on a thrown error.
	const subscriptionColumns = instance.query("PRAGMA table_info(billing_subscriptions)").all() as {
		name: string;
	}[];
	if (!subscriptionColumns.some((column) => column.name === "renewalWarningSentFor")) {
		instance.exec("ALTER TABLE billing_subscriptions ADD COLUMN renewalWarningSentFor TEXT;");
	}
	if (!subscriptionColumns.some((column) => column.name === "adminNotifiedAt")) {
		instance.exec("ALTER TABLE billing_subscriptions ADD COLUMN adminNotifiedAt TEXT;");
	}
	if (!subscriptionColumns.some((column) => column.name === "notes")) {
		instance.exec("ALTER TABLE billing_subscriptions ADD COLUMN notes TEXT NOT NULL DEFAULT '';");
	}
	if (!subscriptionColumns.some((column) => column.name === "privateId")) {
		instance.exec("ALTER TABLE billing_subscriptions ADD COLUMN privateId TEXT;");
	}

	// Subscriptions created before private ids existed still need one, and the
	// unique index below would reject them all sharing a default. Backfill row
	// by row, then enforce uniqueness.
	const missingPrivateIds = instance
		.query("SELECT id FROM billing_subscriptions WHERE privateId IS NULL OR privateId = ''")
		.all() as { id: string }[];
	if (missingPrivateIds.length) {
		const assign = instance.query("UPDATE billing_subscriptions SET privateId = ? WHERE id = ?");
		instance.transaction(() => {
			for (const row of missingPrivateIds) {
				assign.run(generateSubscriptionPrivateId(), row.id);
			}
		})();
		console.log(
			`[db] Backfilled private subscription ids for ${missingPrivateIds.length} existing subscription(s).`,
		);
	}

	instance.exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_private_idx ON billing_subscriptions(privateId);",
	);

	// The Telegram Bot API cannot DM a user by @username — it needs a numeric
	// chat id, which the bot only learns once that person messages it. The id is
	// recorded the first time an admin talks to the bot in a private chat.
	const telegramAdminColumns = instance.query("PRAGMA table_info(telegram_admins)").all() as {
		name: string;
	}[];
	if (!telegramAdminColumns.some((column) => column.name === "chatId")) {
		instance.exec("ALTER TABLE telegram_admins ADD COLUMN chatId INTEGER;");
	}

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
		chatId: row.chatId,
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

interface BillingSubscriptionRow {
	id: string;
	userId: string;
	planId: string;
	planName: string;
	cycle: string;
	quantity: number;
	mode: string;
	status: string;
	amount: number;
	currency: string;
	razorpayOrderId: string | null;
	razorpaySubscriptionId: string | null;
	razorpayPaymentId: string | null;
	shortUrl: string | null;
	currentPeriodStart: string | null;
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: number;
	privateId: string;
	notes: string;
	renewalWarningSentFor: string | null;
	createdAt: string;
	updatedAt: string;
}

interface BillingPaymentRow {
	id: string;
	userId: string;
	subscriptionId: string | null;
	razorpayPaymentId: string | null;
	razorpayOrderId: string | null;
	planId: string;
	amount: number;
	currency: string;
	status: string;
	method: string | null;
	createdAt: string;
	updatedAt: string;
}

function rowToBillingSubscription(
	row: BillingSubscriptionRow,
): WithId<BillingSubscriptionDocument> {
	return {
		_id: row.id,
		userId: row.userId,
		planId: row.planId as BillingPlanId,
		planName: row.planName,
		cycle: row.cycle as BillingCycle,
		quantity: row.quantity,
		mode: row.mode as BillingMode,
		status: row.status as BillingSubscriptionStatus,
		amount: row.amount,
		currency: row.currency,
		razorpayOrderId: row.razorpayOrderId,
		razorpaySubscriptionId: row.razorpaySubscriptionId,
		razorpayPaymentId: row.razorpayPaymentId,
		shortUrl: row.shortUrl,
		currentPeriodStart: row.currentPeriodStart ? new Date(row.currentPeriodStart) : null,
		currentPeriodEnd: row.currentPeriodEnd ? new Date(row.currentPeriodEnd) : null,
		cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
		privateId: row.privateId,
		notes: row.notes ?? "",
		renewalWarningSentFor: row.renewalWarningSentFor ? new Date(row.renewalWarningSentFor) : null,
		createdAt: new Date(row.createdAt),
		updatedAt: new Date(row.updatedAt),
	};
}

function rowToBillingPayment(row: BillingPaymentRow): WithId<BillingPaymentDocument> {
	return {
		_id: row.id,
		userId: row.userId,
		subscriptionId: row.subscriptionId,
		razorpayPaymentId: row.razorpayPaymentId,
		razorpayOrderId: row.razorpayOrderId,
		planId: row.planId,
		amount: row.amount,
		currency: row.currency,
		status: row.status,
		method: row.method,
		createdAt: new Date(row.createdAt),
		updatedAt: new Date(row.updatedAt),
	};
}

export function insertBillingSubscription(subscription: WithId<BillingSubscriptionDocument>): void {
	requireDb()
		.query(
			`INSERT INTO billing_subscriptions
				(id, userId, planId, planName, cycle, quantity, mode, status, amount, currency,
				 razorpayOrderId, razorpaySubscriptionId, razorpayPaymentId, shortUrl,
				 currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, privateId, notes,
				 createdAt, updatedAt)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			subscription._id,
			subscription.userId,
			subscription.planId,
			subscription.planName,
			subscription.cycle,
			subscription.quantity,
			subscription.mode,
			subscription.status,
			subscription.amount,
			subscription.currency,
			subscription.razorpayOrderId,
			subscription.razorpaySubscriptionId,
			subscription.razorpayPaymentId,
			subscription.shortUrl,
			subscription.currentPeriodStart?.toISOString() ?? null,
			subscription.currentPeriodEnd?.toISOString() ?? null,
			subscription.cancelAtPeriodEnd ? 1 : 0,
			subscription.privateId,
			subscription.notes,
			subscription.createdAt.toISOString(),
			subscription.updatedAt.toISOString(),
		);
}

export function findBillingSubscriptionById(
	id: string,
): WithId<BillingSubscriptionDocument> | null {
	const row = requireDb()
		.query("SELECT * FROM billing_subscriptions WHERE id = ?")
		.get(id) as BillingSubscriptionRow | null;
	return row ? rowToBillingSubscription(row) : null;
}

export function findBillingSubscriptionByOrderId(
	orderId: string,
): WithId<BillingSubscriptionDocument> | null {
	const row = requireDb()
		.query("SELECT * FROM billing_subscriptions WHERE razorpayOrderId = ?")
		.get(orderId) as BillingSubscriptionRow | null;
	return row ? rowToBillingSubscription(row) : null;
}

export function findBillingSubscriptionByRazorpayId(
	razorpaySubscriptionId: string,
): WithId<BillingSubscriptionDocument> | null {
	const row = requireDb()
		.query("SELECT * FROM billing_subscriptions WHERE razorpaySubscriptionId = ?")
		.get(razorpaySubscriptionId) as BillingSubscriptionRow | null;
	return row ? rowToBillingSubscription(row) : null;
}

/**
 * The subscription a user is entitled to right now: an active term that has not
 * lapsed, most recently created first. Null when the user has never paid or
 * every term has expired.
 */
export function findActiveBillingSubscriptionForUser(
	userId: string,
	now: Date,
): WithId<BillingSubscriptionDocument> | null {
	const row = requireDb()
		.query(
			`SELECT * FROM billing_subscriptions
			 WHERE userId = ?
			   AND status IN ('active', 'halted')
			   AND (currentPeriodEnd IS NULL OR currentPeriodEnd > ?)
			 ORDER BY createdAt DESC
			 LIMIT 1`,
		)
		.get(userId, now.toISOString()) as BillingSubscriptionRow | null;
	return row ? rowToBillingSubscription(row) : null;
}

export function findLatestBillingSubscriptionForUser(
	userId: string,
): WithId<BillingSubscriptionDocument> | null {
	const row = requireDb()
		.query("SELECT * FROM billing_subscriptions WHERE userId = ? ORDER BY createdAt DESC LIMIT 1")
		.get(userId) as BillingSubscriptionRow | null;
	return row ? rowToBillingSubscription(row) : null;
}

export function updateBillingSubscriptionFields(
	id: string,
	patch: Partial<BillingSubscriptionDocument>,
): void {
	const columns: Record<string, string | number | null> = {};
	if (patch.status !== undefined) columns.status = patch.status;
	if (patch.quantity !== undefined) columns.quantity = patch.quantity;
	if (patch.amount !== undefined) columns.amount = patch.amount;
	if (patch.razorpayOrderId !== undefined) columns.razorpayOrderId = patch.razorpayOrderId;
	if (patch.razorpaySubscriptionId !== undefined) {
		columns.razorpaySubscriptionId = patch.razorpaySubscriptionId;
	}
	if (patch.razorpayPaymentId !== undefined) columns.razorpayPaymentId = patch.razorpayPaymentId;
	if (patch.shortUrl !== undefined) columns.shortUrl = patch.shortUrl;
	if (patch.currentPeriodStart !== undefined) {
		columns.currentPeriodStart = patch.currentPeriodStart?.toISOString() ?? null;
	}
	if (patch.currentPeriodEnd !== undefined) {
		columns.currentPeriodEnd = patch.currentPeriodEnd?.toISOString() ?? null;
	}
	if (patch.cancelAtPeriodEnd !== undefined) {
		columns.cancelAtPeriodEnd = patch.cancelAtPeriodEnd ? 1 : 0;
	}
	if (patch.notes !== undefined) columns.notes = patch.notes;
	columns.updatedAt = (patch.updatedAt ?? new Date()).toISOString();

	const keys = Object.keys(columns);
	const setClause = keys.map((key) => `${key} = ?`).join(", ");
	requireDb()
		.query(`UPDATE billing_subscriptions SET ${setClause} WHERE id = ?`)
		.run(...keys.map((key) => columns[key]), id);
}

export function deleteBillingRecordsForUser(userId: string): void {
	const instance = requireDb();
	instance.query("DELETE FROM billing_payments WHERE userId = ?").run(userId);
	instance.query("DELETE FROM billing_subscriptions WHERE userId = ?").run(userId);
}

export function insertBillingPayment(payment: WithId<BillingPaymentDocument>): void {
	requireDb()
		.query(
			`INSERT INTO billing_payments
				(id, userId, subscriptionId, razorpayPaymentId, razorpayOrderId, planId,
				 amount, currency, status, method, createdAt, updatedAt)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(razorpayPaymentId) DO UPDATE SET
				status = excluded.status,
				method = excluded.method,
				subscriptionId = COALESCE(excluded.subscriptionId, billing_payments.subscriptionId),
				updatedAt = excluded.updatedAt`,
		)
		.run(
			payment._id,
			payment.userId,
			payment.subscriptionId,
			payment.razorpayPaymentId,
			payment.razorpayOrderId,
			payment.planId,
			payment.amount,
			payment.currency,
			payment.status,
			payment.method,
			payment.createdAt.toISOString(),
			payment.updatedAt.toISOString(),
		);
}

export function listBillingPaymentsForUser(
	userId: string,
	limit: number,
): WithId<BillingPaymentDocument>[] {
	const rows = requireDb()
		.query("SELECT * FROM billing_payments WHERE userId = ? ORDER BY createdAt DESC LIMIT ?")
		.all(userId, limit) as BillingPaymentRow[];
	return rows.map(rowToBillingPayment);
}

/**
 * Claims a webhook event id. Returns false when the event was already
 * processed, which is the signal for the caller to ack and do nothing —
 * Razorpay retries until it gets a 2xx and can redeliver even after success.
 */
export function claimBillingWebhookEvent(eventId: string, event: string): boolean {
	const result = requireDb()
		.query("INSERT OR IGNORE INTO billing_webhook_events (id, event, receivedAt) VALUES (?, ?, ?)")
		.run(eventId, event, new Date().toISOString());
	return result.changes > 0;
}

export function deleteBillingWebhookEventsOlderThan(cutoff: Date): number {
	const result = requireDb()
		.query("DELETE FROM billing_webhook_events WHERE receivedAt <= ?")
		.run(cutoff.toISOString());
	return result.changes;
}

export function listBillingSubscriptionsForUser(
	userId: string,
	limit: number,
): WithId<BillingSubscriptionDocument>[] {
	const rows = requireDb()
		.query("SELECT * FROM billing_subscriptions WHERE userId = ? ORDER BY createdAt DESC LIMIT ?")
		.all(userId, limit) as BillingSubscriptionRow[];
	return rows.map(rowToBillingSubscription);
}

export interface BillingSubscriptionWithOwner {
	subscription: WithId<BillingSubscriptionDocument>;
	userEmail: string;
	userFullName: string;
	paymentCount: number;
}

/**
 * Every order across all accounts, for the admin console. The owning user is
 * joined in so the console does not have to fetch the user list separately, and
 * a LEFT JOIN keeps orders visible even if the account was deleted.
 */
export function listAllBillingSubscriptionsWithOwner(
	limit: number,
): BillingSubscriptionWithOwner[] {
	const rows = requireDb()
		.query(
			`SELECT s.*,
			        COALESCE(u.email, '') AS ownerEmail,
			        COALESCE(u.fullName, '') AS ownerFullName,
			        (SELECT COUNT(*) FROM billing_payments p WHERE p.subscriptionId = s.id) AS paymentCount
			 FROM billing_subscriptions s
			 LEFT JOIN users u ON u.id = s.userId
			 ORDER BY s.createdAt DESC
			 LIMIT ?`,
		)
		.all(limit) as (BillingSubscriptionRow & {
		ownerEmail: string;
		ownerFullName: string;
		paymentCount: number;
	})[];

	return rows.map((row) => ({
		subscription: rowToBillingSubscription(row),
		userEmail: row.ownerEmail,
		userFullName: row.ownerFullName,
		paymentCount: row.paymentCount,
	}));
}

export interface BillingTotals {
	totalOrders: number;
	activeOrders: number;
	capturedRevenue: number;
}

export function getBillingTotals(now: Date): BillingTotals {
	const instance = requireDb();

	const totals = instance
		.query(
			`SELECT COUNT(*) AS totalOrders,
			        COALESCE(SUM(
			          CASE WHEN status = 'active' AND (currentPeriodEnd IS NULL OR currentPeriodEnd > ?)
			               THEN 1 ELSE 0 END
			        ), 0) AS activeOrders
			 FROM billing_subscriptions`,
		)
		.get(now.toISOString()) as { totalOrders: number; activeOrders: number };

	// Revenue counts captured payments only — authorised, failed and refunded
	// rows are recorded for the audit trail but are not money in the bank.
	const revenue = instance
		.query(
			"SELECT COALESCE(SUM(amount), 0) AS capturedRevenue FROM billing_payments WHERE status = 'captured'",
		)
		.get() as { capturedRevenue: number };

	return {
		totalOrders: totals.totalOrders,
		activeOrders: totals.activeOrders,
		capturedRevenue: revenue.capturedRevenue,
	};
}

export function countBillingPaymentsForSubscription(subscriptionId: string): number {
	const row = requireDb()
		.query("SELECT COUNT(*) AS count FROM billing_payments WHERE subscriptionId = ?")
		.get(subscriptionId) as { count: number };
	return row.count;
}

interface WalletRow {
	userId: string;
	balance: number;
	currency: string;
	autoRenew: number;
	paymentMode: string;
	createdAt: string;
	updatedAt: string;
}

interface WalletTransactionRow {
	id: string;
	userId: string;
	type: string;
	amount: number;
	balanceAfter: number;
	reason: string;
	referenceId: string | null;
	createdAt: string;
}

interface WalletTopupRow {
	id: string;
	userId: string;
	amount: number;
	razorpayOrderId: string | null;
	razorpayPaymentId: string | null;
	status: string;
	createdAt: string;
	updatedAt: string;
}

export interface WalletDocument {
	userId: string;
	balance: number;
	currency: string;
	autoRenew: boolean;
	paymentMode: WalletPaymentMode;
	createdAt: Date;
	updatedAt: Date;
}

export interface WalletTransactionDocument {
	_id: string;
	userId: string;
	type: WalletTransactionType;
	amount: number;
	balanceAfter: number;
	reason: string;
	referenceId: string | null;
	createdAt: Date;
}

export interface WalletTopupDocument {
	_id: string;
	userId: string;
	amount: number;
	razorpayOrderId: string | null;
	razorpayPaymentId: string | null;
	status: "created" | "paid" | "failed";
	createdAt: Date;
	updatedAt: Date;
}

function rowToWallet(row: WalletRow): WalletDocument {
	return {
		userId: row.userId,
		balance: row.balance,
		currency: row.currency,
		autoRenew: Boolean(row.autoRenew),
		paymentMode: row.paymentMode as WalletPaymentMode,
		createdAt: new Date(row.createdAt),
		updatedAt: new Date(row.updatedAt),
	};
}

function rowToWalletTransaction(row: WalletTransactionRow): WalletTransactionDocument {
	return {
		_id: row.id,
		userId: row.userId,
		type: row.type as WalletTransactionType,
		amount: row.amount,
		balanceAfter: row.balanceAfter,
		reason: row.reason,
		referenceId: row.referenceId,
		createdAt: new Date(row.createdAt),
	};
}

function rowToWalletTopup(row: WalletTopupRow): WalletTopupDocument {
	return {
		_id: row.id,
		userId: row.userId,
		amount: row.amount,
		razorpayOrderId: row.razorpayOrderId,
		razorpayPaymentId: row.razorpayPaymentId,
		status: row.status as WalletTopupDocument["status"],
		createdAt: new Date(row.createdAt),
		updatedAt: new Date(row.updatedAt),
	};
}

/**
 * Returns the user's wallet, creating it on first touch. Every account has a
 * wallet, defaulting to auto-renew from balance — that is the product default,
 * and a user changes it from their own billing page.
 */
export function ensureWallet(userId: string): WalletDocument {
	const instance = requireDb();
	const existing = instance
		.query("SELECT * FROM wallet_accounts WHERE userId = ?")
		.get(userId) as WalletRow | null;
	if (existing) return rowToWallet(existing);

	const now = new Date().toISOString();
	instance
		.query(
			`INSERT INTO wallet_accounts (userId, balance, currency, autoRenew, paymentMode, createdAt, updatedAt)
			 VALUES (?, 0, ?, ?, ?, ?, ?)
			 ON CONFLICT(userId) DO NOTHING`,
		)
		.run(
			userId,
			BILLING_CURRENCY,
			DEFAULT_WALLET_AUTO_RENEW ? 1 : 0,
			DEFAULT_WALLET_PAYMENT_MODE,
			now,
			now,
		);

	const created = instance
		.query("SELECT * FROM wallet_accounts WHERE userId = ?")
		.get(userId) as WalletRow | null;
	if (!created) throw new Error("Wallet could not be created.");
	return rowToWallet(created);
}

export function updateWalletPreferences(
	userId: string,
	patch: { autoRenew?: boolean; paymentMode?: WalletPaymentMode },
): void {
	const columns: Record<string, string | number> = {};
	if (patch.autoRenew !== undefined) columns.autoRenew = patch.autoRenew ? 1 : 0;
	if (patch.paymentMode !== undefined) columns.paymentMode = patch.paymentMode;
	columns.updatedAt = new Date().toISOString();

	const keys = Object.keys(columns);
	const setClause = keys.map((key) => `${key} = ?`).join(", ");
	requireDb()
		.query(`UPDATE wallet_accounts SET ${setClause} WHERE userId = ?`)
		.run(...keys.map((key) => columns[key]), userId);
}

/**
 * Moves money in or out of a wallet and writes the ledger entry in one
 * transaction, so a balance can never drift from its transaction history.
 * Returns null when a debit would overdraw the wallet.
 */
export function applyWalletTransaction(params: {
	userId: string;
	type: WalletTransactionType;
	amount: number;
	reason: string;
	referenceId: string | null;
	transactionId: string;
}): WalletTransactionDocument | null {
	const instance = requireDb();
	const run = instance.transaction(() => {
		const wallet = ensureWallet(params.userId);
		const delta = params.type === "credit" ? params.amount : -params.amount;
		const balanceAfter = wallet.balance + delta;
		if (balanceAfter < 0) return null;

		const now = new Date().toISOString();
		instance
			.query("UPDATE wallet_accounts SET balance = ?, updatedAt = ? WHERE userId = ?")
			.run(balanceAfter, now, params.userId);
		instance
			.query(
				`INSERT INTO wallet_transactions (id, userId, type, amount, balanceAfter, reason, referenceId, createdAt)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				params.transactionId,
				params.userId,
				params.type,
				params.amount,
				balanceAfter,
				params.reason,
				params.referenceId,
				now,
			);

		return {
			_id: params.transactionId,
			userId: params.userId,
			type: params.type,
			amount: params.amount,
			balanceAfter,
			reason: params.reason,
			referenceId: params.referenceId,
			createdAt: new Date(now),
		} satisfies WalletTransactionDocument;
	});

	return run();
}

export function listWalletTransactions(userId: string, limit: number): WalletTransactionDocument[] {
	const rows = requireDb()
		.query("SELECT * FROM wallet_transactions WHERE userId = ? ORDER BY createdAt DESC LIMIT ?")
		.all(userId, limit) as WalletTransactionRow[];
	return rows.map(rowToWalletTransaction);
}

export function insertWalletTopup(topup: WalletTopupDocument): void {
	requireDb()
		.query(
			`INSERT INTO wallet_topups (id, userId, amount, razorpayOrderId, razorpayPaymentId, status, createdAt, updatedAt)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			topup._id,
			topup.userId,
			topup.amount,
			topup.razorpayOrderId,
			topup.razorpayPaymentId,
			topup.status,
			topup.createdAt.toISOString(),
			topup.updatedAt.toISOString(),
		);
}

export function findWalletTopupById(id: string): WalletTopupDocument | null {
	const row = requireDb()
		.query("SELECT * FROM wallet_topups WHERE id = ?")
		.get(id) as WalletTopupRow | null;
	return row ? rowToWalletTopup(row) : null;
}

export function findWalletTopupByOrderId(orderId: string): WalletTopupDocument | null {
	const row = requireDb()
		.query("SELECT * FROM wallet_topups WHERE razorpayOrderId = ?")
		.get(orderId) as WalletTopupRow | null;
	return row ? rowToWalletTopup(row) : null;
}

/**
 * Flips a top-up to paid, but only from the `created` state. The affected-row
 * count is the caller's guard against crediting the same top-up twice when the
 * browser callback and the webhook both arrive.
 */
export function markWalletTopupPaid(id: string, razorpayPaymentId: string): boolean {
	const result = requireDb()
		.query(
			"UPDATE wallet_topups SET status = 'paid', razorpayPaymentId = ?, updatedAt = ? WHERE id = ? AND status = 'created'",
		)
		.run(razorpayPaymentId, new Date().toISOString(), id);
	return result.changes > 0;
}

export function markWalletTopupFailed(id: string): void {
	requireDb()
		.query(
			"UPDATE wallet_topups SET status = 'failed', updatedAt = ? WHERE id = ? AND status = 'created'",
		)
		.run(new Date().toISOString(), id);
}

export function deleteWalletDataForUser(userId: string): void {
	const instance = requireDb();
	instance.query("DELETE FROM wallet_transactions WHERE userId = ?").run(userId);
	instance.query("DELETE FROM wallet_topups WHERE userId = ?").run(userId);
	instance.query("DELETE FROM wallet_accounts WHERE userId = ?").run(userId);
}

/** Subscriptions whose paid term has run out and that are due a renewal attempt. */
export function listSubscriptionsDueForRenewal(now: Date): WithId<BillingSubscriptionDocument>[] {
	const rows = requireDb()
		.query(
			`SELECT * FROM billing_subscriptions
			 WHERE status = 'active'
			   AND cancelAtPeriodEnd = 0
			   AND currentPeriodEnd IS NOT NULL
			   AND currentPeriodEnd <= ?
			 ORDER BY currentPeriodEnd ASC`,
		)
		.all(now.toISOString()) as BillingSubscriptionRow[];
	return rows.map(rowToBillingSubscription);
}

/**
 * Active subscriptions renewing inside the warning window that have not been
 * warned for this particular period end yet.
 */
export function listSubscriptionsNeedingRenewalWarning(
	now: Date,
	windowEnd: Date,
): WithId<BillingSubscriptionDocument>[] {
	const rows = requireDb()
		.query(
			`SELECT * FROM billing_subscriptions
			 WHERE status = 'active'
			   AND cancelAtPeriodEnd = 0
			   AND currentPeriodEnd IS NOT NULL
			   AND currentPeriodEnd > ?
			   AND currentPeriodEnd <= ?
			   AND (renewalWarningSentFor IS NULL OR renewalWarningSentFor != currentPeriodEnd)
			 ORDER BY currentPeriodEnd ASC`,
		)
		.all(now.toISOString(), windowEnd.toISOString()) as BillingSubscriptionRow[];
	return rows.map(rowToBillingSubscription);
}

/** Records that the warning for this exact period end has gone out. */
export function markRenewalWarningSent(subscriptionId: string, periodEnd: Date): void {
	requireDb()
		.query("UPDATE billing_subscriptions SET renewalWarningSentFor = ? WHERE id = ?")
		.run(periodEnd.toISOString(), subscriptionId);
}

/**
 * Records the private-chat id for an admin so the bot can DM them. Telegram
 * only reveals this when the person messages the bot, so it stays null until
 * an admin has actually opened a chat.
 */
export function linkTelegramAdminChat(usernameLower: string, chatId: number): boolean {
	const result = requireDb()
		.query("UPDATE telegram_admins SET chatId = ?, updatedAt = ? WHERE usernameLower = ?")
		.run(chatId, new Date().toISOString(), usernameLower);
	return result.changes > 0;
}

/** Admins the bot can actually message, i.e. those with a known chat id. */
export function listTelegramAdminChatIds(): { username: string; chatId: number }[] {
	const rows = requireDb()
		.query(
			"SELECT username, chatId FROM telegram_admins WHERE chatId IS NOT NULL ORDER BY createdAt",
		)
		.all() as { username: string; chatId: number }[];
	return rows;
}

/**
 * Claims the "announced to admins" flag for an order. Returns false when the
 * announcement already went out, so the browser verify call and the webhook
 * cannot both notify for the same order.
 */
export function claimOrderAdminNotification(subscriptionId: string): boolean {
	const result = requireDb()
		.query(
			"UPDATE billing_subscriptions SET adminNotifiedAt = ? WHERE id = ? AND adminNotifiedAt IS NULL",
		)
		.run(new Date().toISOString(), subscriptionId);
	return result.changes > 0;
}

/**
 * Deletes a subscription and the payment rows that reference it. Payments are
 * detached rather than removed: they are the record of money that actually
 * moved, so they stay in the ledger even when the subscription is gone.
 */
export function deleteBillingSubscriptionById(id: string): boolean {
	const instance = requireDb();
	const run = instance.transaction(() => {
		instance
			.query("UPDATE billing_payments SET subscriptionId = NULL WHERE subscriptionId = ?")
			.run(id);
		return instance.query("DELETE FROM billing_subscriptions WHERE id = ?").run(id).changes > 0;
	});
	return run();
}

export function findBillingSubscriptionByPrivateId(
	privateId: string,
): WithId<BillingSubscriptionDocument> | null {
	const row = requireDb()
		.query("SELECT * FROM billing_subscriptions WHERE privateId = ?")
		.get(privateId) as BillingSubscriptionRow | null;
	return row ? rowToBillingSubscription(row) : null;
}

export interface EmailVerificationCodeRecord {
	userId: string;
	codeHash: string;
	expiresAt: Date;
	attempts: number;
	lastSentAt: Date;
	createdAt: Date;
}

interface EmailVerificationCodeRow {
	userId: string;
	codeHash: string;
	expiresAt: string;
	attempts: number;
	lastSentAt: string;
	createdAt: string;
}

/** Replaces any live code for this account, so only the newest one works. */
export function upsertEmailVerificationCode(params: {
	userId: string;
	codeHash: string;
	expiresAt: Date;
}): void {
	const now = new Date().toISOString();
	requireDb()
		.query(
			`INSERT INTO email_verification_codes (userId, codeHash, expiresAt, attempts, lastSentAt, createdAt)
			 VALUES (?, ?, ?, 0, ?, ?)
			 ON CONFLICT(userId) DO UPDATE SET
				codeHash = excluded.codeHash,
				expiresAt = excluded.expiresAt,
				attempts = 0,
				lastSentAt = excluded.lastSentAt`,
		)
		.run(params.userId, params.codeHash, params.expiresAt.toISOString(), now, now);
}

export function findEmailVerificationCode(userId: string): EmailVerificationCodeRecord | null {
	const row = requireDb()
		.query("SELECT * FROM email_verification_codes WHERE userId = ?")
		.get(userId) as EmailVerificationCodeRow | null;
	if (!row) return null;

	return {
		userId: row.userId,
		codeHash: row.codeHash,
		expiresAt: new Date(row.expiresAt),
		attempts: row.attempts,
		lastSentAt: new Date(row.lastSentAt),
		createdAt: new Date(row.createdAt),
	};
}

/** Returns the attempt count after incrementing, for lock-out decisions. */
export function incrementEmailVerificationAttempts(userId: string): number {
	const instance = requireDb();
	instance
		.query("UPDATE email_verification_codes SET attempts = attempts + 1 WHERE userId = ?")
		.run(userId);
	const row = instance
		.query("SELECT attempts FROM email_verification_codes WHERE userId = ?")
		.get(userId) as { attempts: number } | null;
	return row?.attempts ?? 0;
}

export function deleteEmailVerificationCode(userId: string): void {
	requireDb().query("DELETE FROM email_verification_codes WHERE userId = ?").run(userId);
}

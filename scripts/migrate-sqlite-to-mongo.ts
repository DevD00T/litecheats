#!/usr/bin/env bun

/**
 * One-off import of the old SQLite database into MongoDB.
 *
 *   bun scripts/migrate-sqlite-to-mongo.ts [--sqlite=./data/litecheats.sqlite] [--dry-run]
 *
 * Safe to run more than once: every document is inserted only if its `_id` is not
 * already in MongoDB, so a second run adds nothing and never overwrites data the
 * app has written since. The SQLite file is opened read-only.
 *
 * This deliberately does NOT boot the app's data layer, because that seeds a
 * default owner account. Importing first means the real owner comes across from
 * SQLite and the app finds an owner already present on its first start.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	type AnyBulkWriteOperation,
	type Document,
	GridFSBucket,
	MongoBulkWriteError,
	MongoClient,
} from "mongodb";
import { DEFAULT_USER_ROLE, USER_ROLES } from "../shared/auth";
import { RELEASE_FILES_BUCKET } from "../shared/releases";
import { generateSubscriptionPrivateId } from "../src/bun/db/billing";
import { readMongoConfig } from "../src/bun/db/client";
import { COLLECTIONS, type CollectionName, ensureSchema } from "../src/bun/db/schema";

type Row = Record<string, unknown>;

const BATCH_SIZE = 500;
const now = new Date();

function readArg(name: string): string | undefined {
	const prefix = `--${name}=`;
	return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const dryRun = process.argv.includes("--dry-run");
const sqlitePath = resolve(
	readArg("sqlite") ?? Bun.env.SQLITE_PATH ?? Bun.env.DATABASE_PATH ?? "./data/litecheats.sqlite",
);

// ---------------------------------------------------------------------------
// SQLite value conversion
// ---------------------------------------------------------------------------

const text = (value: unknown): string => (value == null ? "" : String(value));
const nullableText = (value: unknown): string | null =>
	value == null || value === "" ? null : String(value);
const nullableNumber = (value: unknown): number | null =>
	value == null || value === "" ? null : Number(value);
const flag = (value: unknown): boolean => value === 1 || value === true || value === "1";

function date(value: unknown): Date {
	const parsed = new Date(text(value));
	if (Number.isNaN(parsed.getTime())) throw new Error(`invalid date "${text(value)}"`);
	return parsed;
}

const nullableDate = (value: unknown): Date | null =>
	value == null || value === "" ? null : date(value);

function parseRoles(value: unknown): string[] {
	try {
		const parsed: unknown = JSON.parse(text(value));
		if (Array.isArray(parsed)) {
			const valid = parsed.filter((role): role is string =>
				(USER_ROLES as readonly string[]).includes(role as string),
			);
			if (valid.length) return valid;
		}
	} catch {
		// Fall through to the default.
	}
	return [DEFAULT_USER_ROLE];
}

// ---------------------------------------------------------------------------
// Table mappings: SQLite row -> MongoDB document (or null to skip the row)
// ---------------------------------------------------------------------------

interface TableMapping {
	table: string;
	collection: CollectionName;
	map: (row: Row) => Document | null;
}

const MAPPINGS: TableMapping[] = [
	{
		table: "users",
		collection: COLLECTIONS.users,
		map: (r) => ({
			_id: text(r.id),
			email: text(r.email),
			emailLower: text(r.emailLower),
			fullName: text(r.fullName),
			company: text(r.company),
			roles: parseRoles(r.roles),
			isAdmin: flag(r.isAdmin),
			isOwner: flag(r.isOwner),
			emailVerified: flag(r.emailVerified),
			preferredOrigin: nullableText(r.preferredOrigin),
			passwordHash: text(r.passwordHash),
			createdAt: date(r.createdAt),
			updatedAt: date(r.updatedAt),
		}),
	},
	{
		// Expired sessions are dead weight and MongoDB's TTL would remove them anyway.
		table: "sessions",
		collection: COLLECTIONS.sessions,
		map: (r) =>
			date(r.expiresAt) <= now
				? null
				: {
						_id: text(r.id),
						userId: text(r.userId),
						userAgent: text(r.userAgent),
						ipAddress: text(r.ipAddress),
						deviceKey: text(r.deviceKey),
						createdAt: date(r.createdAt),
						updatedAt: date(r.updatedAt),
						expiresAt: date(r.expiresAt),
					},
	},
	{
		table: "email_verifications",
		collection: COLLECTIONS.emailVerifications,
		map: (r) =>
			date(r.expiresAt) <= now
				? null
				: {
						_id: text(r.token),
						userId: text(r.userId),
						expiresAt: date(r.expiresAt),
						createdAt: date(r.createdAt),
					},
	},
	{
		table: "email_verification_codes",
		collection: COLLECTIONS.emailVerificationCodes,
		map: (r) =>
			date(r.expiresAt) <= now
				? null
				: {
						_id: text(r.userId),
						codeHash: text(r.codeHash),
						expiresAt: date(r.expiresAt),
						attempts: Number(r.attempts ?? 0),
						lastSentAt: date(r.lastSentAt),
						createdAt: date(r.createdAt),
					},
	},
	{
		table: "release_versions",
		collection: COLLECTIONS.releaseVersions,
		map: (r) => ({
			_id: text(r.id),
			version: text(r.version),
			notes: text(r.notes),
			publishedAt: date(r.publishedAt),
			isLatest: flag(r.isLatest),
			createdAt: date(r.createdAt),
			updatedAt: date(r.updatedAt),
		}),
	},
	{
		// Metadata only: the binary is copied into GridFS separately below.
		table: "release_artifacts",
		collection: COLLECTIONS.releaseArtifacts,
		map: (r) => ({
			_id: text(r.id),
			releaseId: text(r.releaseId),
			version: text(r.version),
			platform: text(r.platform),
			format: text(r.format),
			target: text(r.target),
			filename: text(r.filename),
			sizeBytes: Number(r.sizeBytes),
			sha256: text(r.sha256),
			mimeType: text(r.mimeType),
			createdAt: date(r.createdAt),
		}),
	},
	{
		table: "telegram_admins",
		collection: COLLECTIONS.telegramAdmins,
		map: (r) => ({
			_id: text(r.id),
			username: text(r.username),
			usernameLower: text(r.usernameLower),
			role: text(r.role),
			chatId: nullableNumber(r.chatId),
			addedByTelegramId: nullableNumber(r.addedByTelegramId),
			addedByUsername: nullableText(r.addedByUsername),
			createdAt: date(r.createdAt),
			updatedAt: date(r.updatedAt),
		}),
	},
	{
		table: "billing_subscriptions",
		collection: COLLECTIONS.billingSubscriptions,
		map: (r) => ({
			_id: text(r.id),
			userId: text(r.userId),
			planId: text(r.planId),
			planName: text(r.planName),
			cycle: text(r.cycle),
			quantity: Number(r.quantity),
			mode: text(r.mode),
			status: text(r.status),
			amount: Number(r.amount),
			currency: text(r.currency),
			razorpayOrderId: nullableText(r.razorpayOrderId),
			razorpaySubscriptionId: nullableText(r.razorpaySubscriptionId),
			razorpayPaymentId: nullableText(r.razorpayPaymentId),
			shortUrl: nullableText(r.shortUrl),
			currentPeriodStart: nullableDate(r.currentPeriodStart),
			currentPeriodEnd: nullableDate(r.currentPeriodEnd),
			cancelAtPeriodEnd: flag(r.cancelAtPeriodEnd),
			// Very old rows predate private ids.
			privateId: nullableText(r.privateId) ?? generateSubscriptionPrivateId(),
			notes: text(r.notes),
			renewalWarningSentFor: nullableDate(r.renewalWarningSentFor),
			adminNotifiedAt: nullableDate(r.adminNotifiedAt),
			createdAt: date(r.createdAt),
			updatedAt: date(r.updatedAt),
		}),
	},
	{
		table: "billing_payments",
		collection: COLLECTIONS.billingPayments,
		map: (r) => ({
			_id: text(r.id),
			userId: text(r.userId),
			subscriptionId: nullableText(r.subscriptionId),
			razorpayPaymentId: nullableText(r.razorpayPaymentId),
			razorpayOrderId: nullableText(r.razorpayOrderId),
			planId: text(r.planId),
			amount: Number(r.amount),
			currency: text(r.currency),
			status: text(r.status),
			method: nullableText(r.method),
			createdAt: date(r.createdAt),
			updatedAt: date(r.updatedAt),
		}),
	},
	{
		table: "billing_webhook_events",
		collection: COLLECTIONS.billingWebhookEvents,
		map: (r) => ({ _id: text(r.id), event: text(r.event), receivedAt: date(r.receivedAt) }),
	},
	{
		table: "wallet_accounts",
		collection: COLLECTIONS.walletAccounts,
		map: (r) => ({
			_id: text(r.userId),
			balance: Number(r.balance),
			currency: text(r.currency),
			autoRenew: flag(r.autoRenew),
			paymentMode: text(r.paymentMode),
			createdAt: date(r.createdAt),
			updatedAt: date(r.updatedAt),
		}),
	},
	{
		table: "wallet_transactions",
		collection: COLLECTIONS.walletTransactions,
		map: (r) => ({
			_id: text(r.id),
			userId: text(r.userId),
			type: text(r.type),
			amount: Number(r.amount),
			balanceAfter: Number(r.balanceAfter),
			reason: text(r.reason),
			referenceId: nullableText(r.referenceId),
			createdAt: date(r.createdAt),
		}),
	},
	{
		table: "wallet_topups",
		collection: COLLECTIONS.walletTopups,
		map: (r) => ({
			_id: text(r.id),
			userId: text(r.userId),
			amount: Number(r.amount),
			razorpayOrderId: nullableText(r.razorpayOrderId),
			razorpayPaymentId: nullableText(r.razorpayPaymentId),
			status: text(r.status),
			createdAt: date(r.createdAt),
			updatedAt: date(r.updatedAt),
		}),
	},
];

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

interface TableReport {
	table: string;
	read: number;
	skipped: number;
	inserted: number;
	alreadyThere: number;
	failed: number;
	problems: string[];
}

function tableExists(sqlite: Database, table: string): boolean {
	const found = sqlite
		.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
		.get(table);
	return found != null;
}

async function importTable(
	sqlite: Database,
	mongo: MongoClient | null,
	dbName: string,
	mapping: TableMapping,
): Promise<TableReport | null> {
	if (!tableExists(sqlite, mapping.table)) return null;

	const report: TableReport = {
		table: mapping.table,
		read: 0,
		skipped: 0,
		inserted: 0,
		alreadyThere: 0,
		failed: 0,
		problems: [],
	};

	// Artifact rows carry the binary; select it out so it is never held in bulk.
	const columns =
		mapping.table === "release_artifacts"
			? "id, releaseId, version, platform, format, target, filename, sizeBytes, sha256, mimeType, createdAt"
			: "*";
	const rows = sqlite.query(`SELECT ${columns} FROM ${mapping.table}`).all() as Row[];

	const operations: AnyBulkWriteOperation<Document>[] = [];
	for (const row of rows) {
		report.read += 1;
		let doc: Document | null;
		try {
			doc = mapping.map(row);
		} catch (error) {
			report.failed += 1;
			report.problems.push(`${text(row.id ?? row.userId ?? row.token)}: ${(error as Error).message}`);
			continue;
		}
		if (!doc) {
			report.skipped += 1;
			continue;
		}
		const { _id, ...rest } = doc;
		operations.push({
			updateOne: { filter: { _id }, update: { $setOnInsert: rest }, upsert: true },
		});
	}

	if (dryRun || !mongo) {
		report.inserted = operations.length;
		return report;
	}

	const target = mongo.db(dbName).collection(mapping.collection);
	for (let start = 0; start < operations.length; start += BATCH_SIZE) {
		const batch = operations.slice(start, start + BATCH_SIZE);
		try {
			const result = await target.bulkWrite(batch, { ordered: false });
			report.inserted += result.upsertedCount;
			report.alreadyThere += result.matchedCount;
		} catch (error) {
			if (!(error instanceof MongoBulkWriteError)) throw error;
			report.inserted += error.result.upsertedCount;
			report.alreadyThere += error.result.matchedCount;
			const writeErrors = Array.isArray(error.writeErrors) ? error.writeErrors : [error.writeErrors];
			report.failed += writeErrors.length;
			for (const writeError of writeErrors.slice(0, 3)) {
				report.problems.push(String(writeError.errmsg ?? writeError.err?.errmsg ?? "write failed"));
			}
		}
	}
	return report;
}

/** Copies each release binary into GridFS under the artifact's own id. */
async function importArtifactBinaries(
	sqlite: Database,
	mongo: MongoClient,
	dbName: string,
): Promise<{ copied: number; alreadyThere: number; failed: string[] }> {
	const result = { copied: 0, alreadyThere: 0, failed: [] as string[] };
	if (!tableExists(sqlite, "release_artifacts")) return result;

	const database = mongo.db(dbName);
	const files = database.collection<{ _id: string }>(`${RELEASE_FILES_BUCKET}.files`);
	const bucket = new GridFSBucket(database, {
		bucketName: RELEASE_FILES_BUCKET,
		chunkSizeBytes: 1024 * 1024,
	});

	const ids = (sqlite.query("SELECT id, filename FROM release_artifacts").all() as Row[]).map((row) => ({
		id: text(row.id),
		filename: text(row.filename),
	}));

	for (const { id, filename } of ids) {
		if (await files.findOne({ _id: id }, { projection: { _id: 1 } })) {
			result.alreadyThere += 1;
			continue;
		}
		const row = sqlite.query("SELECT data FROM release_artifacts WHERE id = ?").get(id) as {
			data: Uint8Array | null;
		} | null;
		if (!row?.data) {
			result.failed.push(`${id}: no binary stored`);
			continue;
		}
		try {
			const upload = bucket.openUploadStreamWithId(id as never, filename);
			await new Promise<void>((done, fail) => {
				upload.once("finish", () => done());
				upload.once("error", fail);
				upload.end(Buffer.from(row.data!.buffer, row.data!.byteOffset, row.data!.byteLength));
			});
			result.copied += 1;
		} catch (error) {
			result.failed.push(`${id}: ${(error as Error).message}`);
		}
	}
	return result;
}

// ---------------------------------------------------------------------------

if (!existsSync(sqlitePath)) {
	console.error(`SQLite file not found: ${sqlitePath}`);
	console.error("Pass its location with --sqlite=<path> or set SQLITE_PATH.");
	process.exit(1);
}

const sqlite = new Database(sqlitePath, { readonly: true });
console.log(`Source:      ${sqlitePath}`);

let mongo: MongoClient | null = null;
let dbName = "";
if (!dryRun) {
	const config = readMongoConfig();
	dbName = config.dbName;
	mongo = new MongoClient(config.uri, { appName: "litecheats-migration", ignoreUndefined: true });
	await mongo.connect();
	await ensureSchema(mongo.db(dbName));
}
console.log(`Destination: ${dryRun ? "(dry run, nothing is written)" : `MongoDB database "${dbName}"`}\n`);

const reports: TableReport[] = [];
for (const mapping of MAPPINGS) {
	const report = await importTable(sqlite, mongo, dbName, mapping);
	if (report) reports.push(report);
}

let binaries = { copied: 0, alreadyThere: 0, failed: [] as string[] };
if (mongo) binaries = await importArtifactBinaries(sqlite, mongo, dbName);

const pad = (value: string | number, width: number) => String(value).padStart(width);
console.log(`${"table".padEnd(28)}${pad("read", 7)}${pad("new", 7)}${pad("had", 7)}${pad("skip", 7)}${pad("fail", 7)}`);
for (const r of reports) {
	console.log(
		`${r.table.padEnd(28)}${pad(r.read, 7)}${pad(r.inserted, 7)}${pad(r.alreadyThere, 7)}${pad(r.skipped, 7)}${pad(r.failed, 7)}`,
	);
}
if (mongo) {
	console.log(
		`\nrelease binaries: ${binaries.copied} copied to GridFS, ${binaries.alreadyThere} already there, ${binaries.failed.length} failed`,
	);
}

const problems = [...reports.flatMap((r) => r.problems.map((p) => `${r.table}: ${p}`)), ...binaries.failed];
if (problems.length) {
	console.log("\nProblems (first few per table):");
	for (const problem of problems) console.log(`  - ${problem}`);
}
console.log(
	"\n'new' = inserted, 'had' = already in MongoDB (left untouched), 'skip' = expired rows not worth carrying over.",
);

sqlite.close();
await mongo?.close();
process.exit(problems.length ? 1 : 0);

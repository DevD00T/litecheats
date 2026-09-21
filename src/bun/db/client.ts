import dns from "node:dns";
import {
	type ClientSession,
	type Collection,
	type Db,
	GridFSBucket,
	MongoClient,
	type Document as MongoDocument,
	MongoServerError,
	ServerApiVersion,
} from "mongodb";
import { RELEASE_FILES_BUCKET } from "../../../shared/releases";
import { type CollectionName, ensureSchema } from "./schema";
import { seedOwnerAccount } from "./seed";

const DEFAULT_DB_NAME = "litecheats_pwa";
const DUPLICATE_KEY_CODE = 11000;
/** GridFS chunk size. Larger than the 255 KiB default: release binaries are big. */
const RELEASE_FILE_CHUNK_BYTES = 1024 * 1024;

let client: MongoClient | null = null;
let database: Db | null = null;
let initPromise: Promise<Db> | null = null;

export function readMongoConfig(): { uri: string; dbName: string } {
	const uri = Bun.env.MONGODB_URI?.trim();
	if (!uri) {
		throw new Error(
			"MONGODB_URI is not set. Add your MongoDB connection string to .env (see .env.example).",
		);
	}
	// Deliberately no fallback env name: a stray MONGODB_DB from another project
	// must never silently point this app at somebody else's database.
	const dbName = Bun.env.MONGODB_DB_NAME?.trim() || DEFAULT_DB_NAME;
	return { uri, dbName };
}

/**
 * Used only after an SRV lookup has already failed with the system's own resolver.
 * The desktop app runs on the Bun that Electrobun embeds (1.3.9), whose resolver
 * can fail to read the operating system's DNS servers on Windows and fall back to
 * 127.0.0.1, where nothing listens. `mongodb+srv://` needs that lookup, so without
 * this the database would be unreachable from the desktop app.
 */
const FALLBACK_DNS_SERVERS = ["1.1.1.1", "8.8.8.8"];

function isSrvLookupFailure(error: unknown): boolean {
	const failure = error as { syscall?: string; message?: string } | null;
	return failure?.syscall === "querySrv" || /querySrv/.test(failure?.message ?? "");
}

function newMongoClient(uri: string): MongoClient {
	return new MongoClient(uri, {
		appName: "litecheats",
		serverApi: { version: ServerApiVersion.v1 },
		serverSelectionTimeoutMS: 10_000,
		maxPoolSize: 20,
		// Optional fields left undefined are omitted rather than stored as null.
		ignoreUndefined: true,
	});
}

async function connectClient(uri: string): Promise<MongoClient> {
	const attempt = async (): Promise<MongoClient> => {
		const mongo = newMongoClient(uri);
		try {
			await mongo.connect();
			return mongo;
		} catch (error) {
			await mongo.close().catch(() => {});
			throw error;
		}
	};

	// An explicit list always wins and is never second-guessed.
	const explicitServers = Bun.env.MONGODB_DNS_SERVERS?.split(",")
		.map((server) => server.trim())
		.filter(Boolean);
	if (explicitServers?.length) dns.setServers(explicitServers);

	try {
		return await attempt();
	} catch (error) {
		if (explicitServers?.length || !isSrvLookupFailure(error)) throw error;
		console.warn(
			`[db] SRV lookup failed with the system DNS servers (${dns.getServers().join(", ") || "none"}). Retrying with ${FALLBACK_DNS_SERVERS.join(", ")}. Set MONGODB_DNS_SERVERS to choose your own.`,
		);
		dns.setServers(FALLBACK_DNS_SERVERS);
		return attempt();
	}
}

async function initialize(): Promise<Db> {
	const { uri, dbName } = readMongoConfig();
	const mongo = await connectClient(uri);

	try {
		const db = mongo.db(dbName);
		await ensureSchema(db);
		await seedOwnerAccount(db);
		client = mongo;
		database = db;
		console.log(`[db] Connected to MongoDB database "${dbName}".`);
		return db;
	} catch (error) {
		await mongo.close().catch(() => {});
		throw error;
	}
}

/**
 * Connects on first use, applies the schema and seeds the owner. Every
 * repository function awaits this, so there is no "call getDb() first" trap.
 * Concurrent callers share one connection attempt.
 */
export function getDb(): Promise<Db> {
	if (database) return Promise.resolve(database);
	if (!initPromise) {
		initPromise = initialize().catch((error) => {
			initPromise = null;
			throw error;
		});
	}
	return initPromise;
}

export async function collection<T extends MongoDocument>(
	name: CollectionName,
): Promise<Collection<T>> {
	return (await getDb()).collection<T>(name);
}

export async function getReleaseFilesBucket(): Promise<GridFSBucket> {
	const db = await getDb();
	return new GridFSBucket(db, {
		bucketName: RELEASE_FILES_BUCKET,
		chunkSizeBytes: RELEASE_FILE_CHUNK_BYTES,
	});
}

/**
 * Runs `work` in a multi-document transaction, retrying transient failures.
 * Requires a replica set, which every Atlas cluster is.
 */
export async function withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
	await getDb();
	if (!client) throw new Error("Database client is not connected.");

	const session = client.startSession();
	try {
		// `withTransaction` returns the callback's value, and may run it more than
		// once, so the callback must not have side effects outside the session.
		return await session.withTransaction(() => work(session));
	} finally {
		await session.endSession();
	}
}

/** Round-trip to the server, for health checks. Returns latency in milliseconds. */
export async function pingDatabase(): Promise<number> {
	const db = await getDb();
	const startedAt = performance.now();
	await db.command({ ping: 1 });
	return Math.round(performance.now() - startedAt);
}

export async function closeDb(): Promise<void> {
	const current = client;
	client = null;
	database = null;
	initPromise = null;
	await current?.close();
}

export function isUniqueConstraintError(error: unknown): boolean {
	return error instanceof MongoServerError && error.code === DUPLICATE_KEY_CODE;
}

/**
 * The field a duplicate-key error was raised on, e.g. "emailLower". The primary
 * key is reported as "id", which is what callers have always compared against.
 */
export function uniqueConstraintColumn(error: unknown): string | null {
	if (!isUniqueConstraintError(error)) return null;
	const keyPattern = (error as MongoServerError).keyPattern;
	const key = keyPattern ? Object.keys(keyPattern)[0] : undefined;
	if (!key) return null;
	return key === "_id" ? "id" : key;
}

/**
 * Upserts keyed on a unique index can lose a race and surface a duplicate-key
 * error even though the document now exists. The retry then takes the update path.
 */
export async function retryOnDuplicateKey<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (!isUniqueConstraintError(error)) throw error;
		return operation();
	}
}

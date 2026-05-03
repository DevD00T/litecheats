#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import {
	type Db,
	type Document,
	GridFSBucket,
	MongoClient,
	ObjectId,
	type WithId,
} from "mongodb";
import { DOWNLOADS_BASE_PATH, RELEASE_FILES_BUCKET, type ReleaseFormat, type ReleasePlatform } from "../shared/releases";

const DEFAULT_MONGODB_URI = "mongodb://127.0.0.1:27017";
const DEFAULT_MONGODB_DB_NAME = "litecheats";
const RELEASE_COLLECTION = "release_versions";
const ARTIFACT_COLLECTION = "release_artifacts";

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

interface ArtifactCandidate {
	absolutePath: string;
	filename: string;
	platform: ReleasePlatform;
	format: ReleaseFormat;
	target: string;
	sizeBytes: number;
	sha256: string;
	mimeType: string;
}

interface CliOptions {
	version?: string;
	notes?: string;
	files: string[];
	dirs: string[];
}

function createUuidV7(): string {
	const maybeUuidV7 = (Bun as unknown as { randomUUIDv7?: () => string }).randomUUIDv7;
	return typeof maybeUuidV7 === "function" ? maybeUuidV7() : crypto.randomUUID();
}

function parseCliOptions(args: string[]): CliOptions {
	const options: CliOptions = {
		files: [],
		dirs: [],
	};

	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		const next = args[index + 1];

		if ((value === "--version" || value === "-v") && next) {
			options.version = next.trim();
			index += 1;
			continue;
		}
		if ((value === "--notes" || value === "-n") && next) {
			options.notes = next;
			index += 1;
			continue;
		}
		if ((value === "--file" || value === "-f") && next) {
			options.files.push(next);
			index += 1;
			continue;
		}
		if ((value === "--artifact-dir" || value === "-d") && next) {
			options.dirs.push(next);
			index += 1;
			continue;
		}
	}

	return options;
}

function parseFormatFromFilename(filename: string): ReleaseFormat | null {
	const lower = filename.toLowerCase();
	if (lower.endsWith(".tar.zst")) return "tar.zst";
	if (lower.endsWith(".tar.gz")) return "tar.gz";
	if (lower.endsWith(".appimage")) return "appimage";
	if (lower.endsWith(".dmg")) return "dmg";
	if (lower.endsWith(".exe")) return "exe";
	if (lower.endsWith(".deb")) return "deb";
	if (lower.endsWith(".rpm")) return "rpm";
	if (lower.endsWith(".zip")) return "zip";
	return null;
}

function inferPlatform(filename: string, format: ReleaseFormat): ReleasePlatform | null {
	const lower = filename.toLowerCase();
	if (lower.includes("macos") || format === "dmg") return "macos";
	if (lower.includes("win") || format === "exe") return "windows";
	if (lower.includes("linux") || ["appimage", "deb", "rpm"].includes(format)) return "linux";

	if (format === "tar.gz" || format === "tar.zst") {
		if (lower.includes("setup") && lower.includes("linux")) return "linux";
		if (lower.includes("app") && lower.includes("macos")) return "macos";
		if (lower.includes("win")) return "windows";
	}

	if (format === "zip") {
		if (lower.includes("setup") && lower.includes("win")) return "windows";
	}

	return null;
}

function inferTarget(filename: string, platform: ReleasePlatform): string {
	const lower = filename.toLowerCase();
	const match = lower.match(/(macos-(?:arm64|x64)|win(?:32)?-x64|linux-(?:arm64|x64))/);
	if (match?.[1]) {
		return match[1].replace("win32-x64", "win-x64");
	}

	if (lower.includes("arm64")) {
		if (platform === "windows") return "win-arm64";
		return `${platform}-arm64`;
	}
	if (lower.includes("x64") || lower.includes("amd64")) {
		if (platform === "windows") return "win-x64";
		return `${platform}-x64`;
	}

	if (platform === "windows") return "win-x64";
	return `${platform}-x64`;
}

function inferMimeType(format: ReleaseFormat): string {
	switch (format) {
		case "dmg":
			return "application/x-apple-diskimage";
		case "exe":
			return "application/vnd.microsoft.portable-executable";
		case "appimage":
			return "application/vnd.appimage";
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

async function hashFile(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	const stream = createReadStream(filePath);
	for await (const chunk of stream) {
		hash.update(chunk as Buffer);
	}
	return hash.digest("hex");
}

async function walkDirectory(directoryPath: string): Promise<string[]> {
	const entries = await readdir(directoryPath, { withFileTypes: true });
	const collected: string[] = [];

	for (const entry of entries) {
		const absolutePath = path.join(directoryPath, entry.name);
		if (entry.isDirectory()) {
			const nested = await walkDirectory(absolutePath);
			collected.push(...nested);
			continue;
		}
		if (entry.isFile()) {
			collected.push(absolutePath);
		}
	}

	return collected;
}

async function discoverArtifactFiles(options: CliOptions): Promise<string[]> {
	if (options.files.length) {
		return options.files.map((filePath) => path.resolve(filePath));
	}

	const configuredDirectories = options.dirs.length
		? options.dirs
		: (Bun.env.RELEASE_ARTIFACT_DIRS ?? "artifacts")
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean);

	const discovered: string[] = [];
	for (const directory of configuredDirectories) {
		const absoluteDirectory = path.resolve(directory);
		try {
			const directoryStat = await stat(absoluteDirectory);
			if (!directoryStat.isDirectory()) continue;
		} catch {
			continue;
		}

		const files = await walkDirectory(absoluteDirectory);
		discovered.push(...files);
	}

	return discovered;
}

async function buildArtifactCandidates(artifactFiles: string[]): Promise<ArtifactCandidate[]> {
	const uniqueFiles = [...new Set(artifactFiles.map((file) => path.resolve(file)))];
	const candidates: ArtifactCandidate[] = [];

	for (const absolutePath of uniqueFiles) {
		const filename = path.basename(absolutePath);
		const fileStat = await stat(absolutePath);
		if (!fileStat.isFile()) continue;

		const format = parseFormatFromFilename(filename);
		if (!format) continue;

		const platform = inferPlatform(filename, format);
		if (!platform) continue;

		const sizeBytes = fileStat.size;
		const sha256 = await hashFile(absolutePath);
		const target = inferTarget(filename, platform);
		const mimeType = inferMimeType(format);

		candidates.push({
			absolutePath,
			filename,
			platform,
			format,
			target,
			sizeBytes,
			sha256,
			mimeType,
		});

		if (platform === "windows" && format === "zip" && filename.toLowerCase().includes("setup")) {
			const extractedExePath = await extractWindowsSetupFromZip(absolutePath);
			if (extractedExePath) {
				const extractedFilename = path.basename(extractedExePath);
				const extractedStat = await stat(extractedExePath);
				candidates.push({
					absolutePath: extractedExePath,
					filename: extractedFilename,
					platform: "windows",
					format: "exe",
					target: inferTarget(extractedFilename, "windows"),
					sizeBytes: extractedStat.size,
					sha256: await hashFile(extractedExePath),
					mimeType: inferMimeType("exe"),
				});
			}
		}
	}

	return candidates;
}

async function extractWindowsSetupFromZip(zipPath: string): Promise<string | null> {
	const tempDirectory = await mkdtemp(path.join(tmpdir(), "litecheats-win-setup-"));
	const process = Bun.spawn({
		cmd: ["unzip", "-j", "-o", zipPath, "*.exe", "-d", tempDirectory],
		stdout: "ignore",
		stderr: "ignore",
	});

	const exitCode = await process.exited;
	if (exitCode !== 0) {
		return null;
	}

	const extractedFiles = await walkDirectory(tempDirectory);
	const installer = extractedFiles.find((filePath) => filePath.toLowerCase().endsWith(".exe"));
	return installer ?? null;
}

async function ensureReleaseIndexes(db: Db): Promise<void> {
	const releases = db.collection<ReleaseVersionDocument>(RELEASE_COLLECTION);
	const artifacts = db.collection<ReleaseArtifactDocument>(ARTIFACT_COLLECTION);

	await releases.createIndex({ version: 1 }, { unique: true, name: "release_versions_unique" });
	await releases.createIndex({ isLatest: 1 }, { name: "release_versions_latest_idx" });
	await releases.createIndex({ publishedAt: -1 }, { name: "release_versions_published_desc_idx" });
	await artifacts.createIndex({ releaseId: 1 }, { name: "release_artifacts_release_idx" });
	await artifacts.createIndex(
		{ version: 1, platform: 1, format: 1, target: 1 },
		{ name: "release_artifacts_lookup_idx" },
	);
}

async function uploadArtifactFile(
	bucket: GridFSBucket,
	candidate: ArtifactCandidate,
	releaseVersion: string,
): Promise<string> {
	const uploadStream = bucket.openUploadStream(candidate.filename, {
		contentType: candidate.mimeType,
		metadata: {
			version: releaseVersion,
			platform: candidate.platform,
			target: candidate.target,
			format: candidate.format,
			sha256: candidate.sha256,
		},
	});

	await pipeline(createReadStream(candidate.absolutePath), uploadStream);
	const uploadId = uploadStream.id;
	return uploadId instanceof ObjectId ? uploadId.toHexString() : String(uploadId);
}

async function deleteGridFileIfPresent(bucket: GridFSBucket, gridFsFileId: string): Promise<void> {
	try {
		const objectId = new ObjectId(gridFsFileId);
		await bucket.delete(objectId);
	} catch {
		// Ignore invalid ids or missing files; metadata replacement should still continue.
	}
}

async function ensureRelease(
	db: Db,
	version: string,
	notes: string,
): Promise<WithId<ReleaseVersionDocument>> {
	const releases = db.collection<ReleaseVersionDocument>(RELEASE_COLLECTION);
	const now = new Date();
	const existing = await releases.findOne({ version });

	if (existing) {
		if (!existing.isLatest) {
			await releases.updateMany(
				{ _id: { $ne: existing._id } },
				{ $set: { isLatest: false, updatedAt: now } },
			);
			await releases.updateOne(
				{ _id: existing._id },
				{ $set: { isLatest: true, notes, updatedAt: now } },
			);
			existing.isLatest = true;
		}

		if (existing.notes !== notes) {
			await releases.updateOne({ _id: existing._id }, { $set: { notes, updatedAt: now } });
			existing.notes = notes;
		}

		return existing;
	}

	await releases.updateMany({}, { $set: { isLatest: false, updatedAt: now } });
	const created: ReleaseVersionDocument = {
		_id: createUuidV7(),
		version,
		notes,
		publishedAt: now,
		isLatest: true,
		createdAt: now,
		updatedAt: now,
	};

	await releases.insertOne(created);
	return created;
}

async function publishArtifacts(
	db: Db,
	release: WithId<ReleaseVersionDocument>,
	candidates: ArtifactCandidate[],
): Promise<void> {
	const artifacts = db.collection<ReleaseArtifactDocument>(ARTIFACT_COLLECTION);
	const bucket = new GridFSBucket(db, { bucketName: RELEASE_FILES_BUCKET });

	for (const candidate of candidates) {
		const existing = await artifacts.findOne({
			releaseId: release._id,
			platform: candidate.platform,
			format: candidate.format,
			target: candidate.target,
		});

		const gridFsFileId = await uploadArtifactFile(bucket, candidate, release.version);
		const now = new Date();

		if (existing) {
			await deleteGridFileIfPresent(bucket, existing.gridFsFileId);
			await artifacts.updateOne(
				{ _id: existing._id },
				{
					$set: {
						version: release.version,
						filename: candidate.filename,
						sizeBytes: candidate.sizeBytes,
						sha256: candidate.sha256,
						mimeType: candidate.mimeType,
						gridFsFileId,
						createdAt: now,
					},
				},
			);
			console.log(
				`updated ${candidate.platform} ${candidate.format} (${candidate.target}) -> ${candidate.filename}`,
			);
			continue;
		}

		const artifact: ReleaseArtifactDocument = {
			_id: createUuidV7(),
			releaseId: release._id,
			version: release.version,
			platform: candidate.platform,
			format: candidate.format,
			target: candidate.target,
			filename: candidate.filename,
			sizeBytes: candidate.sizeBytes,
			sha256: candidate.sha256,
			mimeType: candidate.mimeType,
			gridFsFileId,
			createdAt: now,
		};

		await artifacts.insertOne(artifact);
		console.log(
			`published ${candidate.platform} ${candidate.format} (${candidate.target}) -> ${candidate.filename}`,
		);
	}
}

async function main(): Promise<void> {
	const cli = parseCliOptions(process.argv.slice(2));
	const packageJsonPath = path.resolve(import.meta.dir, "..", "package.json");
	const packageJson = (await Bun.file(packageJsonPath).json()) as { version?: string };
	const version = cli.version ?? Bun.env.RELEASE_VERSION ?? packageJson.version ?? "0.0.0";
	const notes = cli.notes ?? Bun.env.RELEASE_NOTES ?? "Automated release publish";
	const artifactFiles = await discoverArtifactFiles(cli);
	const candidates = await buildArtifactCandidates(artifactFiles);

	if (!candidates.length) {
		throw new Error(
			"No installer artifacts found. Provide --file paths or set RELEASE_ARTIFACT_DIRS (default: artifacts).",
		);
	}

	const mongoUri = Bun.env.MONGODB_URI ?? DEFAULT_MONGODB_URI;
	const mongoDbName = Bun.env.MONGODB_DB_NAME ?? DEFAULT_MONGODB_DB_NAME;
	const mongoClient = new MongoClient(mongoUri);

	await mongoClient.connect();
	try {
		const db = mongoClient.db(mongoDbName);
		await ensureReleaseIndexes(db);
		const release = await ensureRelease(db, version, notes);
		await publishArtifacts(db, release, candidates);

		console.log("");
		console.log(`Release ${release.version} published.`);
		console.log(`Download feed: ${DOWNLOADS_BASE_PATH}/releases/latest`);
		for (const candidate of candidates) {
			console.log(
				`- ${candidate.platform} ${candidate.target} ${candidate.format} (${(
					candidate.sizeBytes /
					(1024 * 1024)
				).toFixed(1)} MB)`,
			);
		}
	} finally {
		await mongoClient.close();
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`release publish failed: ${message}`);
	process.exit(1);
});

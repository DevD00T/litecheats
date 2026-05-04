#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import {
	type Collection,
	type Db,
	type Document,
	GridFSBucket,
	MongoClient,
	ObjectId,
} from "mongodb";
import { RELEASE_FILES_BUCKET, type ReleaseFormat, type ReleasePlatform } from "../shared/releases";

const DEFAULT_MONGODB_URI = "mongodb://127.0.0.1:27017";
const DEFAULT_MONGODB_DB_NAME = "litecheats";

const SUPPORTED_PLATFORMS: ReleasePlatform[] = ["macos", "windows", "linux"];
const SUPPORTED_FORMATS: ReleaseFormat[] = [
	"dmg",
	"exe",
	"appimage",
	"deb",
	"rpm",
	"zip",
	"tar.gz",
	"tar.zst",
];

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

interface PublishOptions {
	version: string;
	artifactPath: string;
	platform: ReleasePlatform;
	format: ReleaseFormat;
	target: string;
	notes: string;
	latest: boolean;
}

function printUsage(): void {
	console.log(`Usage:
bun scripts/publish-release.ts --version <version> --artifact <path-to-file> [options]

Required:
  --version <value>         Release version (e.g. v0.1.0 or 0.1.0)
  --artifact <path>         Artifact file path (e.g. ./build/dmg/Litecheats.dmg)

Optional:
  --platform <value>        macos | windows | linux (default: macos)
  --format <value>          dmg | exe | appimage | deb | rpm | zip | tar.gz | tar.zst (default: inferred from file ext)
  --target <value>          Build target label (default: universal)
  --notes <value>           Release notes (default: "")
  --latest <true|false>     Mark as latest release (default: true)

Example:
  bun scripts/publish-release.ts --version v0.1.0 --artifact ./build/dmg/Litecheats.dmg --platform macos --format dmg --target universal --notes "Initial macOS release"
`);
}

function getArgValue(args: string[], key: string): string | undefined {
	const index = args.indexOf(key);
	if (index < 0) return undefined;
	return args[index + 1];
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
	if (!value) return fallback;
	const normalized = value.trim().toLowerCase();
	if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
	if (normalized === "0" || normalized === "false" || normalized === "no") return false;
	return fallback;
}

function inferFormatFromExtension(artifactPath: string): ReleaseFormat {
	const normalized = artifactPath.toLowerCase();
	if (normalized.endsWith(".tar.gz")) return "tar.gz";
	if (normalized.endsWith(".tar.zst")) return "tar.zst";

	const extension = extname(normalized);
	switch (extension) {
		case ".dmg":
			return "dmg";
		case ".exe":
			return "exe";
		case ".appimage":
			return "appimage";
		case ".deb":
			return "deb";
		case ".rpm":
			return "rpm";
		case ".zip":
			return "zip";
		default:
			throw new Error(
				`Unable to infer format from file extension: ${artifactPath}. Pass --format explicitly.`,
			);
	}
}

function normalizePlatform(value: string | undefined): ReleasePlatform {
	const normalized = (value ?? "macos").trim().toLowerCase() as ReleasePlatform;
	if (!SUPPORTED_PLATFORMS.includes(normalized)) {
		throw new Error(`Unsupported platform "${value}". Supported: ${SUPPORTED_PLATFORMS.join(", ")}`);
	}
	return normalized;
}

function normalizeFormat(value: string | undefined, artifactPath: string): ReleaseFormat {
	const normalized = (value?.trim().toLowerCase() ?? inferFormatFromExtension(artifactPath)) as ReleaseFormat;
	if (!SUPPORTED_FORMATS.includes(normalized)) {
		throw new Error(`Unsupported format "${value}". Supported: ${SUPPORTED_FORMATS.join(", ")}`);
	}
	return normalized;
}

function normalizeVersion(value: string | undefined): string {
	const normalized = value?.trim();
	if (!normalized) {
		throw new Error("Missing --version");
	}
	return normalized;
}

function resolveMimeType(format: ReleaseFormat): string {
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

async function computeSha256(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	const file = Bun.file(filePath);
	for await (const chunk of file.stream()) {
		hash.update(chunk as Uint8Array);
	}
	return hash.digest("hex");
}

async function uploadArtifactToGridFs(
	db: Db,
	filePath: string,
	filename: string,
	metadata: Record<string, unknown>,
): Promise<ObjectId> {
	const bucket = new GridFSBucket(db, { bucketName: RELEASE_FILES_BUCKET });
	const source = createReadStream(filePath);
	const upload = bucket.openUploadStream(filename, {
		metadata,
	});

	await pipeline(source, upload);
	return upload.id as ObjectId;
}

async function removeExistingArtifact(
	db: Db,
	releaseArtifacts: Collection<ReleaseArtifactDocument>,
	version: string,
	platform: ReleasePlatform,
	format: ReleaseFormat,
	target: string,
): Promise<void> {
	const existing = await releaseArtifacts.findOne({
		version,
		platform,
		format,
		target,
	});

	if (!existing) return;

	const bucket = new GridFSBucket(db, { bucketName: RELEASE_FILES_BUCKET });
	try {
		await bucket.delete(new ObjectId(existing.gridFsFileId));
	} catch {
		// Ignore stale GridFS reference cleanup failures.
	}

	await releaseArtifacts.deleteOne({ _id: existing._id });
}

function parseOptions(argv: string[]): PublishOptions {
	if (argv.includes("--help") || argv.includes("-h")) {
		printUsage();
		process.exit(0);
	}

	const version = normalizeVersion(getArgValue(argv, "--version"));
	const artifactRawPath = getArgValue(argv, "--artifact");
	if (!artifactRawPath) {
		throw new Error("Missing --artifact");
	}

	const artifactPath = resolve(artifactRawPath.trim());
	const platform = normalizePlatform(getArgValue(argv, "--platform"));
	const format = normalizeFormat(getArgValue(argv, "--format"), artifactPath);
	const target = getArgValue(argv, "--target")?.trim() || "universal";
	const notes = getArgValue(argv, "--notes")?.trim() || "";
	const latest = parseBoolean(getArgValue(argv, "--latest"), true);

	return {
		version,
		artifactPath,
		platform,
		format,
		target,
		notes,
		latest,
	};
}

async function publishRelease(options: PublishOptions): Promise<void> {
	const artifactStats = await stat(options.artifactPath);
	if (!artifactStats.isFile()) {
		throw new Error(`Artifact path is not a file: ${options.artifactPath}`);
	}

	const sha256 = await computeSha256(options.artifactPath);
	const filename = basename(options.artifactPath);
	const now = new Date();
	const mimeType = resolveMimeType(options.format);

	const mongoClient = new MongoClient(Bun.env.MONGODB_URI ?? DEFAULT_MONGODB_URI);
	try {
		await mongoClient.connect();
		const db = mongoClient.db(Bun.env.MONGODB_DB_NAME ?? DEFAULT_MONGODB_DB_NAME);
		const releaseVersions = db.collection<ReleaseVersionDocument>("release_versions");
		const releaseArtifacts = db.collection<ReleaseArtifactDocument>("release_artifacts");

		const existingRelease = await releaseVersions.findOne({ version: options.version });
		const releaseId = existingRelease?._id ?? crypto.randomUUID();

		if (options.latest) {
			await releaseVersions.updateMany(
				{ _id: { $ne: releaseId }, isLatest: true },
				{ $set: { isLatest: false, updatedAt: now } },
			);
		}

		if (existingRelease) {
			await releaseVersions.updateOne(
				{ _id: existingRelease._id },
				{
					$set: {
						notes: options.notes,
						publishedAt: now,
						isLatest: options.latest,
						updatedAt: now,
					},
				},
			);
		} else {
			await releaseVersions.insertOne({
				_id: releaseId,
				version: options.version,
				notes: options.notes,
				publishedAt: now,
				isLatest: options.latest,
				createdAt: now,
				updatedAt: now,
			});
		}

		await removeExistingArtifact(
			db,
			releaseArtifacts,
			options.version,
			options.platform,
			options.format,
			options.target,
		);

		const gridFsFileId = await uploadArtifactToGridFs(db, options.artifactPath, filename, {
			version: options.version,
			platform: options.platform,
			format: options.format,
			target: options.target,
			sha256,
		});

		const artifactId = crypto.randomUUID();
		await releaseArtifacts.insertOne({
			_id: artifactId,
			releaseId,
			version: options.version,
			platform: options.platform,
			format: options.format,
			target: options.target,
			filename,
			sizeBytes: artifactStats.size,
			sha256,
			mimeType,
			gridFsFileId: gridFsFileId.toHexString(),
			createdAt: now,
		});

		console.log(`Published release ${options.version}`);
		console.log(`Artifact: ${filename}`);
		console.log(`Platform: ${options.platform}`);
		console.log(`Format: ${options.format}`);
		console.log(`Target: ${options.target}`);
		console.log(`SHA256: ${sha256}`);
		console.log(`Download API: /downloads/artifacts/${artifactId}/file`);
	} finally {
		await mongoClient.close();
	}
}

try {
	const options = parseOptions(process.argv.slice(2));
	await publishRelease(options);
} catch (error) {
	const message = error instanceof Error ? error.message : "Failed to publish release.";
	console.error(message);
	printUsage();
	process.exit(1);
}

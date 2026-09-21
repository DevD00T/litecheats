import type { ObjectId } from "mongodb";
import { RELEASE_FILES_BUCKET } from "../../../shared/releases";
import { collection, getDb, getReleaseFilesBucket } from "./client";
import { COLLECTIONS } from "./schema";
import type { ReleaseArtifactDocument, ReleaseVersionDocument, WithId } from "./types";

const releases = () => collection<ReleaseVersionDocument>(COLLECTIONS.releaseVersions);
const artifacts = () => collection<ReleaseArtifactDocument>(COLLECTIONS.releaseArtifacts);

/**
 * GridFS types its file ids as ObjectId, but the server accepts any BSON value.
 * Release binaries are keyed by the artifact's own string id, so a file and its
 * metadata document always share one `_id` and an orphan is trivial to spot.
 */
function asFileId(id: string): ObjectId {
	return id as unknown as ObjectId;
}

function isFileNotFound(error: unknown): boolean {
	return error instanceof Error && /FileNotFound|was not found/i.test(error.message);
}

// ---------------------------------------------------------------------------
// Release versions
// ---------------------------------------------------------------------------

export async function insertRelease(release: WithId<ReleaseVersionDocument>): Promise<void> {
	await (await releases()).insertOne(release);
}

export async function findReleaseById(id: string): Promise<WithId<ReleaseVersionDocument> | null> {
	return (await releases()).findOne({ _id: id });
}

export async function findReleaseByVersion(
	version: string,
): Promise<WithId<ReleaseVersionDocument> | null> {
	return (await releases()).findOne({ version });
}

export async function listReleasesSortedByPublishedDesc(
	limit: number,
): Promise<WithId<ReleaseVersionDocument>[]> {
	return (await releases()).find().sort({ publishedAt: -1 }).limit(limit).toArray();
}

export async function findMostRecentReleaseByPublishedDesc(): Promise<WithId<ReleaseVersionDocument> | null> {
	return (await releases()).findOne({}, { sort: { publishedAt: -1 } });
}

export async function findAnyLatestRelease(): Promise<WithId<ReleaseVersionDocument> | null> {
	return (await releases()).findOne({ isLatest: true });
}

export async function unsetLatestExcept(id: string, updatedAt: Date): Promise<void> {
	await (await releases()).updateMany(
		{ _id: { $ne: id }, isLatest: true },
		{ $set: { isLatest: false, updatedAt } },
	);
}

export async function setReleaseLatest(
	id: string,
	isLatest: boolean,
	updatedAt: Date,
): Promise<void> {
	await (await releases()).updateOne({ _id: id }, { $set: { isLatest, updatedAt } });
}

export async function updateReleaseFields(
	id: string,
	patch: Partial<ReleaseVersionDocument>,
): Promise<void> {
	const set: Partial<ReleaseVersionDocument> = {};
	if (patch.version !== undefined) set.version = patch.version;
	if (patch.notes !== undefined) set.notes = patch.notes;
	if (patch.publishedAt !== undefined) set.publishedAt = patch.publishedAt;
	if (patch.isLatest !== undefined) set.isLatest = patch.isLatest;
	if (patch.updatedAt !== undefined) set.updatedAt = patch.updatedAt;

	if (!Object.keys(set).length) return;
	await (await releases()).updateOne({ _id: id }, { $set: set });
}

export async function deleteReleaseById(id: string): Promise<void> {
	await (await releases()).deleteOne({ _id: id });
}

// ---------------------------------------------------------------------------
// Release artifacts: metadata in a collection, the binary in GridFS
// ---------------------------------------------------------------------------

export async function updateArtifactVersionForRelease(
	releaseId: string,
	version: string,
): Promise<void> {
	await (await artifacts()).updateMany({ releaseId }, { $set: { version } });
}

/**
 * Stores the binary, then its metadata. If the metadata insert fails the binary
 * is removed again, so a failed upload never leaves an unreachable file behind.
 */
export async function insertArtifact(
	artifact: WithId<ReleaseArtifactDocument>,
	data: Uint8Array,
): Promise<void> {
	const bucket = await getReleaseFilesBucket();
	const upload = bucket.openUploadStreamWithId(asFileId(artifact._id), artifact.filename, {
		metadata: {
			releaseId: artifact.releaseId,
			sha256: artifact.sha256,
			mimeType: artifact.mimeType,
		},
	});

	await new Promise<void>((resolve, reject) => {
		upload.once("finish", () => resolve());
		upload.once("error", reject);
		upload.end(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
	});

	try {
		await (await artifacts()).insertOne(artifact);
	} catch (error) {
		await deleteReleaseFile(artifact._id);
		throw error;
	}
}

export async function findArtifactMetaById(
	id: string,
): Promise<WithId<ReleaseArtifactDocument> | null> {
	return (await artifacts()).findOne({ _id: id });
}

/**
 * Reads the whole binary into memory. It is served as a Buffer rather than a
 * stream on purpose: Bun drops an explicit Content-Length from a streamed body
 * and falls back to chunked encoding, which would cost every installer download
 * its progress bar and size. Null when the file is missing, e.g. metadata
 * written by an interrupted upload.
 */
export async function findArtifactBlobById(id: string): Promise<Buffer<ArrayBuffer> | null> {
	const db = await getDb();
	const stored = await db
		.collection<{ _id: string }>(`${RELEASE_FILES_BUCKET}.files`)
		.findOne({ _id: id }, { projection: { _id: 1 } });
	if (!stored) return null;

	const bucket = await getReleaseFilesBucket();
	const chunks: Buffer<ArrayBuffer>[] = [];
	for await (const chunk of bucket.openDownloadStream(asFileId(id))) {
		chunks.push(chunk as Buffer<ArrayBuffer>);
	}
	return Buffer.concat(chunks);
}

export async function findArtifactByLookup(
	releaseId: string,
	platform: string,
	format: string,
	target: string,
): Promise<WithId<ReleaseArtifactDocument> | null> {
	return (await artifacts()).findOne({
		releaseId,
		platform: platform as ReleaseArtifactDocument["platform"],
		format: format as ReleaseArtifactDocument["format"],
		target,
	});
}

export async function findConflictingArtifact(
	excludeId: string,
	releaseId: string,
	platform: string,
	format: string,
	target: string,
): Promise<WithId<ReleaseArtifactDocument> | null> {
	return (await artifacts()).findOne({
		_id: { $ne: excludeId },
		releaseId,
		platform: platform as ReleaseArtifactDocument["platform"],
		format: format as ReleaseArtifactDocument["format"],
		target,
	});
}

export async function listArtifactMetaByReleaseIds(
	releaseIds: string[],
): Promise<WithId<ReleaseArtifactDocument>[]> {
	if (!releaseIds.length) return [];
	return (await artifacts())
		.find({ releaseId: { $in: releaseIds } })
		.sort({ createdAt: -1 })
		.toArray();
}

export async function updateArtifactFields(
	id: string,
	patch: Partial<ReleaseArtifactDocument>,
): Promise<void> {
	const set: Partial<ReleaseArtifactDocument> = {};
	if (patch.platform !== undefined) set.platform = patch.platform;
	if (patch.format !== undefined) set.format = patch.format;
	if (patch.target !== undefined) set.target = patch.target;
	if (patch.filename !== undefined) set.filename = patch.filename;
	if (patch.mimeType !== undefined) set.mimeType = patch.mimeType;

	if (!Object.keys(set).length) return;
	await (await artifacts()).updateOne({ _id: id }, { $set: set });
}

async function deleteReleaseFile(id: string): Promise<void> {
	const bucket = await getReleaseFilesBucket();
	try {
		await bucket.delete(asFileId(id));
	} catch (error) {
		if (!isFileNotFound(error)) throw error;
	}
}

export async function deleteArtifactById(id: string): Promise<void> {
	await deleteReleaseFile(id);
	await (await artifacts()).deleteOne({ _id: id });
}

export async function deleteArtifactsByReleaseId(releaseId: string): Promise<number> {
	const collectionHandle = await artifacts();
	const ids = (
		await collectionHandle.find({ releaseId }, { projection: { _id: 1 } }).toArray()
	).map((artifact) => artifact._id);
	await Promise.all(ids.map(deleteReleaseFile));
	const result = await collectionHandle.deleteMany({ releaseId });
	return result.deletedCount;
}

import type { ObjectId } from "mongodb";
import { ANDROID_APK_MIME_TYPE } from "../../../shared/android";
import { collection, getReleaseFilesBucket } from "./client";
import { COLLECTIONS } from "./schema";
import type { AndroidReleaseDocument, WithId } from "./types";

const androidReleases = () => collection<AndroidReleaseDocument>(COLLECTIONS.androidReleases);

/** GridFS types file ids as ObjectId; APKs are keyed by the release's own string id. */
function asFileId(id: string): ObjectId {
	return id as unknown as ObjectId;
}

/**
 * Stores the APK in GridFS, then its metadata. If the metadata insert fails (for
 * example a duplicate versionCode) the file is removed again.
 */
export async function insertAndroidRelease(
	release: WithId<AndroidReleaseDocument>,
	apk: Uint8Array,
): Promise<void> {
	const bucket = await getReleaseFilesBucket();
	const upload = bucket.openUploadStreamWithId(asFileId(release._id), release.filename, {
		metadata: {
			channel: "android",
			packageName: release.packageName,
			versionCode: release.versionCode,
			sha256: release.sha256,
			mimeType: ANDROID_APK_MIME_TYPE,
		},
	});
	await new Promise<void>((resolve, reject) => {
		upload.once("finish", () => resolve());
		upload.once("error", reject);
		upload.end(Buffer.from(apk.buffer, apk.byteOffset, apk.byteLength));
	});

	try {
		await (await androidReleases()).insertOne(release);
	} catch (error) {
		await deleteAndroidFile(release._id);
		throw error;
	}
}

export async function findLatestAndroidRelease(): Promise<WithId<AndroidReleaseDocument> | null> {
	return (await androidReleases()).findOne({}, { sort: { versionCode: -1 } });
}

export async function findAndroidReleaseById(
	id: string,
): Promise<WithId<AndroidReleaseDocument> | null> {
	return (await androidReleases()).findOne({ _id: id });
}

export async function listAndroidReleases(limit = 50): Promise<WithId<AndroidReleaseDocument>[]> {
	return (await androidReleases()).find().sort({ versionCode: -1 }).limit(limit).toArray();
}

export async function updateAndroidReleaseFields(
	id: string,
	patch: Pick<Partial<AndroidReleaseDocument>, "notes" | "mandatory" | "updatedAt">,
): Promise<void> {
	const set: Partial<AndroidReleaseDocument> = {};
	if (patch.notes !== undefined) set.notes = patch.notes;
	if (patch.mandatory !== undefined) set.mandatory = patch.mandatory;
	if (patch.updatedAt !== undefined) set.updatedAt = patch.updatedAt;
	if (!Object.keys(set).length) return;
	await (await androidReleases()).updateOne({ _id: id }, { $set: set });
}

async function deleteAndroidFile(id: string): Promise<void> {
	const bucket = await getReleaseFilesBucket();
	try {
		await bucket.delete(asFileId(id));
	} catch (error) {
		if (!(error instanceof Error && /FileNotFound|was not found/i.test(error.message))) throw error;
	}
}

export async function deleteAndroidRelease(id: string): Promise<void> {
	await deleteAndroidFile(id);
	await (await androidReleases()).deleteOne({ _id: id });
}

/**
 * Deletes every release except the newest `keep`, APK and metadata both, and
 * returns what was removed. This is what keeps GridFS from filling up with
 * versions no phone should install any more.
 */
export async function pruneAndroidReleases(
	keep: number,
): Promise<WithId<AndroidReleaseDocument>[]> {
	const all = await (await androidReleases()).find().sort({ versionCode: -1 }).toArray();
	const stale = all.slice(Math.max(1, keep));
	for (const release of stale) {
		await deleteAndroidRelease(release._id);
	}
	return stale;
}

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
	ANDROID_ADMIN_PATH,
	ANDROID_DOWNLOADS_PATH,
	type AndroidReleaseSummary,
} from "../../shared/android";
import { ApkParseError, readApkManifest } from "./apk-manifest";
import {
	type AndroidReleaseDocument,
	type WithId,
	findLatestAndroidRelease,
	getDb,
	insertAndroidRelease,
	isUniqueConstraintError,
	pruneAndroidReleases,
} from "./db";

/** The only package the update channel accepts. Must match appId in the Android project. */
export const ANDROID_APP_ID = (Bun.env.ANDROID_APP_ID ?? "com.litecheats.app").trim();

/**
 * How many Android versions are kept. The default, 0, keeps every version: the
 * newest is live for everyone, older ones stay as an archive that admins and
 * owners can see and download. A positive number deletes all but that many
 * newest versions on each publish.
 */
export const ANDROID_KEEP_RELEASES = Math.max(
	0,
	Math.floor(Number(Bun.env.ANDROID_KEEP_RELEASES ?? 0) || 0),
);

/** 200 MB is far above any real APK and keeps an accidental upload of something else out. */
const ANDROID_APK_MAX_BYTES = Number(Bun.env.ANDROID_APK_MAX_BYTES ?? 200 * 1024 * 1024);

/**
 * Lets the Android build script publish without an admin browser session:
 * `Authorization: Bearer <ANDROID_PUBLISH_TOKEN>`. Disabled unless the env var
 * is set to at least 32 characters. Compared in constant time.
 */
export function isAndroidPublishTokenValid(authorization: string | null): boolean {
	const expected = (Bun.env.ANDROID_PUBLISH_TOKEN ?? "").trim();
	if (expected.length < 32 || !authorization) return false;
	const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
	if (!match?.[1]) return false;
	const a = createHash("sha256").update(match[1].trim()).digest();
	const b = createHash("sha256").update(expected).digest();
	return timingSafeEqual(a, b);
}

export class AndroidReleaseError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/** `liveId` is the id of the highest versionCode, the one everyone is offered. */
export function toAndroidReleaseSummary(
	release: WithId<AndroidReleaseDocument>,
	liveId: string | null,
): AndroidReleaseSummary {
	return {
		id: release._id,
		versionCode: release.versionCode,
		versionName: release.versionName,
		packageName: release.packageName,
		minSdkVersion: release.minSdkVersion,
		sha256: release.sha256,
		sizeBytes: release.sizeBytes,
		filename: release.filename,
		notes: release.notes,
		mandatory: release.mandatory,
		publishedAt: release.publishedAt.toISOString(),
		downloadPath: `${ANDROID_DOWNLOADS_PATH}/${release._id}/file`,
		adminDownloadPath: `${ANDROID_ADMIN_PATH}/${release._id}/file`,
		live: release._id === liveId,
	};
}

export interface PublishAndroidApkInput {
	apk: Uint8Array;
	notes?: string;
	mandatory?: boolean;
	/**
	 * Adds an older build to the archive instead of making it live. Its
	 * versionCode must be lower than the live one's and not published yet.
	 */
	archive?: boolean;
}

export interface PublishAndroidApkResult {
	release: AndroidReleaseSummary;
	/** Versions deleted from GridFS because a newer one now exists. */
	removed: { versionCode: number; versionName: string }[];
}

/**
 * Publishes an APK to the update channel:
 * 1. reads package, versionCode and versionName from the APK's own manifest,
 * 2. refuses another app's package, or a versionCode that isn't higher than the current one
 *    (Android would refuse to install a downgrade anyway),
 * 3. stores it in GridFS with its SHA-256,
 * 4. deletes the versions that fall outside ANDROID_KEEP_RELEASES (none by default).
 *
 * With `archive` it instead files an older build under the live one, for the
 * version history; phones are never offered it.
 */
export async function publishAndroidApk(
	input: PublishAndroidApkInput,
): Promise<PublishAndroidApkResult> {
	const { apk } = input;
	if (apk.byteLength === 0) throw new AndroidReleaseError(400, "The uploaded APK is empty.");
	if (apk.byteLength > ANDROID_APK_MAX_BYTES)
		throw new AndroidReleaseError(413, "The uploaded APK is too large.");

	let manifest: ReturnType<typeof readApkManifest>;
	try {
		manifest = readApkManifest(apk);
	} catch (error) {
		if (error instanceof ApkParseError) throw new AndroidReleaseError(400, error.message);
		throw new AndroidReleaseError(400, "That file is not a readable Android APK.");
	}

	if (manifest.packageName !== ANDROID_APP_ID) {
		throw new AndroidReleaseError(
			400,
			`This APK is ${manifest.packageName}, but the update channel only accepts ${ANDROID_APP_ID}.`,
		);
	}

	await getDb();
	const current = await findLatestAndroidRelease();
	if (input.archive) {
		if (!current || manifest.versionCode >= current.versionCode) {
			throw new AndroidReleaseError(
				409,
				`Only builds older than the live version can be added to the archive; ${manifest.versionName} (${manifest.versionCode}) would become the live version. Publish it normally instead.`,
			);
		}
	} else if (current && manifest.versionCode <= current.versionCode) {
		throw new AndroidReleaseError(
			409,
			`versionCode ${manifest.versionCode} is not newer than the live ${current.versionCode} (${current.versionName}). Bump versionCode in version.properties and rebuild, or tick "Add to version history" to file an older build.`,
		);
	}

	const sha256 = createHash("sha256").update(apk).digest("hex");
	const now = new Date();
	const release: WithId<AndroidReleaseDocument> = {
		_id: randomUUID(),
		packageName: manifest.packageName,
		versionCode: manifest.versionCode,
		versionName: manifest.versionName,
		minSdkVersion: manifest.minSdkVersion,
		sha256,
		sizeBytes: apk.byteLength,
		filename: `Litecheats-${manifest.versionName}-${manifest.versionCode}.apk`,
		notes: (input.notes ?? "").trim().slice(0, 4000),
		// An archived build is never offered, so it can't block anyone either.
		mandatory: input.archive ? false : Boolean(input.mandatory),
		publishedAt: now,
		createdAt: now,
		updatedAt: now,
	};

	try {
		await insertAndroidRelease(release, apk);
	} catch (error) {
		if (isUniqueConstraintError(error)) {
			throw new AndroidReleaseError(
				409,
				`versionCode ${manifest.versionCode} is already published.`,
			);
		}
		throw error;
	}

	const removed =
		ANDROID_KEEP_RELEASES > 0 ? await pruneAndroidReleases(ANDROID_KEEP_RELEASES) : [];
	const live = await findLatestAndroidRelease();
	return {
		release: toAndroidReleaseSummary(release, live?._id ?? null),
		removed: removed.map((item) => ({
			versionCode: item.versionCode,
			versionName: item.versionName,
		})),
	};
}

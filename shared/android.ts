import { AUTH_ADMIN_BASE_PATH } from "./auth";
import { DOWNLOADS_BASE_PATH } from "./releases";

/**
 * The Android app's update channel. Separate from the desktop release feed on
 * purpose: Android updates are ordered by an integer versionCode, and the two
 * products' version numbers must never collide in one table.
 */
export const ANDROID_DOWNLOADS_PATH = `${DOWNLOADS_BASE_PATH}/android`;
export const ANDROID_LATEST_PATH = `${ANDROID_DOWNLOADS_PATH}/latest`;
export const ANDROID_ADMIN_PATH = `${AUTH_ADMIN_BASE_PATH}/android/releases`;
export const ANDROID_APK_MIME_TYPE = "application/vnd.android.package-archive";

export interface AndroidReleaseSummary {
	id: string;
	/** Integer build number from the APK's own manifest. Updates go strictly upward. */
	versionCode: number;
	/** Human version from the manifest, e.g. "1.2.0". */
	versionName: string;
	packageName: string;
	minSdkVersion: number | null;
	/** Lowercase hex SHA-256 of the APK. The app refuses to install a download that doesn't match. */
	sha256: string;
	sizeBytes: number;
	filename: string;
	notes: string;
	/** When true the app blocks use until the update is installed. */
	mandatory: boolean;
	publishedAt: string;
	/** Public download. Works for the live version only. */
	downloadPath: string;
	/** Download of any version for admins and owners (under /login, so the session cookie is sent). */
	adminDownloadPath: string;
	/**
	 * The version offered to everyone: the highest versionCode. Older versions are
	 * kept as an archive that only admins and owners can see and download.
	 */
	live: boolean;
}

export interface AndroidLatestResponse {
	latest: AndroidReleaseSummary | null;
}

export interface AdminAndroidReleasesResponse {
	releases: AndroidReleaseSummary[];
	/** The package every upload must carry (ANDROID_APP_ID, default com.litecheats.app). */
	packageName: string;
	/** How many versions are kept; 0 keeps every version (the default). */
	keepCount: number;
}

export interface AdminUpdateAndroidReleasePayload {
	notes?: string;
	mandatory?: boolean;
}

export interface AdminDeleteAndroidReleaseResponse {
	deleted: true;
}

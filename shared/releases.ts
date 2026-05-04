export const DOWNLOADS_BASE_PATH = "/downloads";
export const RELEASE_FILES_BUCKET = "release_artifacts";

export type ReleasePlatform = "macos" | "windows" | "linux";
export const RELEASE_PLATFORMS: ReleasePlatform[] = ["macos", "windows", "linux"];

export type ReleaseFormat =
	| "dmg"
	| "exe"
	| "appimage"
	| "deb"
	| "rpm"
	| "zip"
	| "tar.gz"
	| "tar.zst";
export const RELEASE_FORMATS: ReleaseFormat[] = [
	"dmg",
	"exe",
	"appimage",
	"deb",
	"rpm",
	"zip",
	"tar.gz",
	"tar.zst",
];

export interface ReleaseArtifactSummary {
	id: string;
	releaseId: string;
	version: string;
	platform: ReleasePlatform;
	format: ReleaseFormat;
	target: string;
	filename: string;
	sizeBytes: number;
	sha256: string;
	mimeType: string;
	createdAt: string;
	downloadPath: string;
}

export interface ReleaseSummary {
	id: string;
	version: string;
	notes: string;
	publishedAt: string;
	isLatest: boolean;
	artifacts: ReleaseArtifactSummary[];
}

export interface ReleaseFeedResponse {
	latest: ReleaseSummary | null;
	releases: ReleaseSummary[];
}

export interface AdminCreateReleasePayload {
	version: string;
	notes?: string;
	publishedAt?: string;
	isLatest?: boolean;
}

export interface AdminUpdateReleasePayload {
	version?: string;
	notes?: string;
	publishedAt?: string;
	isLatest?: boolean;
}

export interface AdminDeleteReleaseResponse {
	deleted: true;
	deletedArtifacts: number;
}

export interface AdminUpdateArtifactPayload {
	platform?: ReleasePlatform;
	format?: ReleaseFormat;
	target?: string;
	filename?: string;
}

export interface AdminDeleteArtifactResponse {
	deleted: true;
}

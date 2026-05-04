import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authApi } from "@/lib/auth-api";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { AdminCreateUserPayload, AdminUserListStats, AuthUser } from "shared/auth";
import {
	RELEASE_FORMATS,
	RELEASE_PLATFORMS,
	type ReleaseArtifactSummary,
	type ReleaseFeedResponse,
	type ReleaseFormat,
	type ReleasePlatform,
	type ReleaseSummary,
} from "shared/releases";
import { toast } from "sonner";

type UserDraft = {
	fullName: string;
	company: string;
	email: string;
	password: string;
	isAdmin: boolean;
	isOwner: boolean;
};

type ReleaseDraft = {
	version: string;
	notes: string;
	publishedAtLocal: string;
	isLatest: boolean;
};

type ArtifactDraft = {
	platform: ReleasePlatform;
	format: ReleaseFormat;
	target: string;
	filename: string;
};

type UploadDraft = {
	platform: ReleasePlatform;
	format: ReleaseFormat;
	target: string;
	filename: string;
	file: File | null;
};

const EMPTY_STATS: AdminUserListStats = {
	totalUsers: 0,
	adminUsers: 0,
	ownerUsers: 0,
};

function formatDate(value: string): string {
	try {
		return new Date(value).toLocaleString("en-IN", {
			dateStyle: "medium",
			timeStyle: "short",
			timeZone: "Asia/Kolkata",
		});
	} catch {
		return value;
	}
}

function toDraft(user: AuthUser): UserDraft {
	return {
		fullName: user.fullName,
		company: user.company,
		email: user.email,
		password: "",
		isAdmin: user.isAdmin,
		isOwner: user.isOwner,
	};
}

function toLocalDatetimeInputValue(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return localDate.toISOString().slice(0, 16);
}

function toReleaseDraft(release: ReleaseSummary): ReleaseDraft {
	return {
		version: release.version,
		notes: release.notes,
		publishedAtLocal: toLocalDatetimeInputValue(release.publishedAt),
		isLatest: release.isLatest,
	};
}

function toArtifactDraft(artifact: ReleaseArtifactSummary): ArtifactDraft {
	return {
		platform: artifact.platform,
		format: artifact.format,
		target: artifact.target,
		filename: artifact.filename,
	};
}

function createUploadDraft(release: ReleaseSummary): UploadDraft {
	const firstArtifact = release.artifacts[0];
	return {
		platform: firstArtifact?.platform ?? "macos",
		format: firstArtifact?.format ?? "dmg",
		target: firstArtifact?.target ?? "universal",
		filename: "",
		file: null,
	};
}

function parseLocalDatetimeToIso(value: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error("Published date/time is required.");
	}

	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error("Published date/time is invalid.");
	}
	return parsed.toISOString();
}

function ReleaseManagementSection() {
	const [feed, setFeed] = useState<ReleaseFeedResponse>({ latest: null, releases: [] });
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [releaseDrafts, setReleaseDrafts] = useState<Record<string, ReleaseDraft>>({});
	const [artifactDrafts, setArtifactDrafts] = useState<Record<string, ArtifactDraft>>({});
	const [uploadDrafts, setUploadDrafts] = useState<Record<string, UploadDraft>>({});
	const [uploadInputKeys, setUploadInputKeys] = useState<Record<string, number>>({});
	const [creatingRelease, setCreatingRelease] = useState(false);
	const [savingReleaseId, setSavingReleaseId] = useState<string | null>(null);
	const [deletingReleaseId, setDeletingReleaseId] = useState<string | null>(null);
	const [savingArtifactId, setSavingArtifactId] = useState<string | null>(null);
	const [deletingArtifactId, setDeletingArtifactId] = useState<string | null>(null);
	const [uploadingReleaseId, setUploadingReleaseId] = useState<string | null>(null);
	const [createForm, setCreateForm] = useState({
		version: "",
		notes: "",
		publishedAtLocal: toLocalDatetimeInputValue(new Date().toISOString()),
		isLatest: true,
	});

	const applyReleaseFeed = useCallback((nextFeed: ReleaseFeedResponse) => {
		setFeed(nextFeed);
		setReleaseDrafts(
			Object.fromEntries(nextFeed.releases.map((release) => [release.id, toReleaseDraft(release)])),
		);
		setArtifactDrafts(
			Object.fromEntries(
				nextFeed.releases.flatMap((release) =>
					release.artifacts.map((artifact) => [artifact.id, toArtifactDraft(artifact)]),
				),
			),
		);
		setUploadDrafts(
			Object.fromEntries(
				nextFeed.releases.map((release) => [release.id, createUploadDraft(release)]),
			),
		);
	}, []);

	const loadReleaseFeed = useCallback(
		async (options?: { withLoading?: boolean; showToast?: boolean }) => {
			const withLoading = options?.withLoading ?? false;
			if (withLoading) {
				setLoading(true);
			} else {
				setRefreshing(true);
			}

			try {
				const response = await authApi.getAdminReleases();
				applyReleaseFeed(response);
				if (options?.showToast) {
					toast.success("Release dashboard refreshed.");
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : "Failed to load releases.";
				toast.error(message);
			} finally {
				setLoading(false);
				setRefreshing(false);
			}
		},
		[applyReleaseFeed],
	);

	useEffect(() => {
		void loadReleaseFeed({ withLoading: true });
	}, [loadReleaseFeed]);

	const updateReleaseDraft = (releaseId: string, patch: Partial<ReleaseDraft>) => {
		setReleaseDrafts((previous) => ({
			...previous,
			[releaseId]: {
				...(previous[releaseId] ?? {
					version: "",
					notes: "",
					publishedAtLocal: "",
					isLatest: false,
				}),
				...patch,
			},
		}));
	};

	const updateArtifactDraft = (artifactId: string, patch: Partial<ArtifactDraft>) => {
		setArtifactDrafts((previous) => ({
			...previous,
			[artifactId]: {
				...(previous[artifactId] ?? {
					platform: "macos",
					format: "dmg",
					target: "universal",
					filename: "",
				}),
				...patch,
			},
		}));
	};

	const updateUploadDraft = (releaseId: string, patch: Partial<UploadDraft>) => {
		setUploadDrafts((previous) => ({
			...previous,
			[releaseId]: {
				...(previous[releaseId] ?? {
					platform: "macos",
					format: "dmg",
					target: "universal",
					filename: "",
					file: null,
				}),
				...patch,
			},
		}));
	};

	const handleCreateRelease = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!createForm.version.trim()) {
			toast.error("Release version is required.");
			return;
		}

		setCreatingRelease(true);
		try {
			const response = await authApi.createAdminRelease({
				version: createForm.version.trim(),
				notes: createForm.notes.trim(),
				publishedAt: parseLocalDatetimeToIso(createForm.publishedAtLocal),
				isLatest: createForm.isLatest,
			});
			applyReleaseFeed(response);
			setCreateForm({
				version: "",
				notes: "",
				publishedAtLocal: toLocalDatetimeInputValue(new Date().toISOString()),
				isLatest: true,
			});
			toast.success("Release created.");
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to create release.";
			toast.error(message);
		} finally {
			setCreatingRelease(false);
		}
	};

	const handleSaveRelease = async (release: ReleaseSummary) => {
		const draft = releaseDrafts[release.id];
		if (!draft) return;

		setSavingReleaseId(release.id);
		try {
			const response = await authApi.updateAdminRelease(release.id, {
				version: draft.version.trim(),
				notes: draft.notes.trim(),
				publishedAt: parseLocalDatetimeToIso(draft.publishedAtLocal),
				isLatest: draft.isLatest,
			});
			applyReleaseFeed(response);
			toast.success("Release updated.");
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to update release.";
			toast.error(message);
		} finally {
			setSavingReleaseId(null);
		}
	};

	const handleDeleteRelease = async (release: ReleaseSummary) => {
		const accepted = window.confirm(
			`Delete release ${release.version}? This removes all linked artifacts.`,
		);
		if (!accepted) return;

		setDeletingReleaseId(release.id);
		try {
			const response = await authApi.deleteAdminRelease(release.id);
			toast.success(`Release deleted. Removed ${response.deletedArtifacts} artifact(s).`);
			await loadReleaseFeed();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to delete release.";
			toast.error(message);
		} finally {
			setDeletingReleaseId(null);
		}
	};

	const handleUploadArtifact = async (releaseId: string) => {
		const draft = uploadDrafts[releaseId];
		if (!draft?.file) {
			toast.error("Select an artifact file to upload.");
			return;
		}

		setUploadingReleaseId(releaseId);
		try {
			const response = await authApi.uploadAdminReleaseArtifact({
				releaseId,
				file: draft.file,
				platform: draft.platform,
				format: draft.format,
				target: draft.target.trim() || "universal",
				filename: draft.filename.trim() || undefined,
			});
			applyReleaseFeed(response);
			setUploadInputKeys((previous) => ({
				...previous,
				[releaseId]: (previous[releaseId] ?? 0) + 1,
			}));
			toast.success("Artifact uploaded.");
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to upload artifact.";
			toast.error(message);
		} finally {
			setUploadingReleaseId(null);
		}
	};

	const handleSaveArtifact = async (artifact: ReleaseArtifactSummary) => {
		const draft = artifactDrafts[artifact.id];
		if (!draft) return;

		setSavingArtifactId(artifact.id);
		try {
			const response = await authApi.updateAdminArtifact(artifact.id, {
				platform: draft.platform,
				format: draft.format,
				target: draft.target.trim() || "universal",
				filename: draft.filename.trim(),
			});
			applyReleaseFeed(response);
			toast.success("Artifact metadata updated.");
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to update artifact.";
			toast.error(message);
		} finally {
			setSavingArtifactId(null);
		}
	};

	const handleDeleteArtifact = async (artifact: ReleaseArtifactSummary) => {
		const accepted = window.confirm(`Delete artifact ${artifact.filename}?`);
		if (!accepted) return;

		setDeletingArtifactId(artifact.id);
		try {
			await authApi.deleteAdminArtifact(artifact.id);
			toast.success("Artifact deleted.");
			await loadReleaseFeed();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to delete artifact.";
			toast.error(message);
		} finally {
			setDeletingArtifactId(null);
		}
	};

	return (
		<Card className="bg-background/90">
			<CardHeader>
				<CardTitle className="font-heading text-xl">Release Management</CardTitle>
				<CardDescription>
					Upload and manage macOS, Windows, and Linux artifacts here. Control versions and release
					history directly from this panel.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<form
					className="grid gap-3 rounded-lg border border-border/65 bg-muted/20 p-4"
					onSubmit={handleCreateRelease}
				>
					<p className="text-sm font-semibold text-foreground">Create Release</p>
					<div className="grid gap-3 md:grid-cols-2">
						<div className="grid gap-2">
							<label
								htmlFor="release-version"
								className="text-xs font-medium text-muted-foreground"
							>
								Version
							</label>
							<Input
								id="release-version"
								value={createForm.version}
								onChange={(event) =>
									setCreateForm((previous) => ({ ...previous, version: event.target.value }))
								}
								placeholder="v1.2.0"
								required
							/>
						</div>
						<div className="grid gap-2">
							<label
								htmlFor="release-published-at"
								className="text-xs font-medium text-muted-foreground"
							>
								Published At
							</label>
							<Input
								id="release-published-at"
								type="datetime-local"
								value={createForm.publishedAtLocal}
								onChange={(event) =>
									setCreateForm((previous) => ({
										...previous,
										publishedAtLocal: event.target.value,
									}))
								}
								required
							/>
						</div>
					</div>
					<div className="grid gap-2">
						<label htmlFor="release-notes" className="text-xs font-medium text-muted-foreground">
							Release Notes
						</label>
						<Textarea
							id="release-notes"
							value={createForm.notes}
							onChange={(event) =>
								setCreateForm((previous) => ({ ...previous, notes: event.target.value }))
							}
							className="min-h-20"
						/>
					</div>
					<div className="flex flex-wrap items-center gap-4">
						<label className="inline-flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={createForm.isLatest}
								onChange={(event) =>
									setCreateForm((previous) => ({ ...previous, isLatest: event.target.checked }))
								}
							/>
							Set as latest
						</label>
						<Button type="submit" disabled={creatingRelease}>
							{creatingRelease ? "Creating..." : "Create Release"}
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => void loadReleaseFeed({ showToast: true })}
						>
							{refreshing ? "Refreshing..." : "Refresh Releases"}
						</Button>
					</div>
				</form>

				{loading ? <p className="text-sm text-muted-foreground">Loading releases...</p> : null}

				{!loading && feed.releases.length === 0 ? (
					<p className="text-sm text-muted-foreground">No releases found.</p>
				) : null}

				{!loading
					? feed.releases.map((release) => {
							const releaseDraft = releaseDrafts[release.id] ?? toReleaseDraft(release);
							const uploadDraft = uploadDrafts[release.id] ?? createUploadDraft(release);
							const artifactFileInputId = `artifact-file-${release.id}`;
							const releaseVersionInputId = `release-version-${release.id}`;
							const releasePublishedAtInputId = `release-published-${release.id}`;
							const releaseNotesInputId = `release-notes-${release.id}`;
							return (
								<div
									key={release.id}
									className="rounded-xl border border-border/65 bg-muted/20 p-4"
								>
									<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
										<div className="flex flex-wrap items-center gap-2">
											<p className="text-sm font-semibold text-foreground">{release.version}</p>
											{release.isLatest ? <Badge>latest</Badge> : null}
										</div>
										<p className="text-xs text-muted-foreground">
											Published {formatDate(release.publishedAt)}
										</p>
									</div>

									<div className="grid gap-3 md:grid-cols-2">
										<div className="grid gap-2">
											<label
												htmlFor={releaseVersionInputId}
												className="text-xs font-medium text-muted-foreground"
											>
												Version
											</label>
											<Input
												id={releaseVersionInputId}
												value={releaseDraft.version}
												onChange={(event) =>
													updateReleaseDraft(release.id, { version: event.target.value })
												}
											/>
										</div>
										<div className="grid gap-2">
											<label
												htmlFor={releasePublishedAtInputId}
												className="text-xs font-medium text-muted-foreground"
											>
												Published At
											</label>
											<Input
												id={releasePublishedAtInputId}
												type="datetime-local"
												value={releaseDraft.publishedAtLocal}
												onChange={(event) =>
													updateReleaseDraft(release.id, { publishedAtLocal: event.target.value })
												}
											/>
										</div>
									</div>
									<div className="mt-3 grid gap-2">
										<label
											htmlFor={releaseNotesInputId}
											className="text-xs font-medium text-muted-foreground"
										>
											Notes
										</label>
										<Textarea
											id={releaseNotesInputId}
											value={releaseDraft.notes}
											onChange={(event) =>
												updateReleaseDraft(release.id, { notes: event.target.value })
											}
											className="min-h-20"
										/>
									</div>
									<div className="mt-3 flex flex-wrap items-center gap-4">
										<label className="inline-flex items-center gap-2 text-sm">
											<input
												type="checkbox"
												checked={releaseDraft.isLatest}
												onChange={(event) =>
													updateReleaseDraft(release.id, { isLatest: event.target.checked })
												}
											/>
											Set as latest
										</label>
										<Button
											type="button"
											disabled={savingReleaseId === release.id}
											onClick={() => void handleSaveRelease(release)}
										>
											{savingReleaseId === release.id ? "Saving..." : "Save Release"}
										</Button>
										<Button
											type="button"
											variant="destructive"
											disabled={deletingReleaseId === release.id}
											onClick={() => void handleDeleteRelease(release)}
										>
											{deletingReleaseId === release.id ? "Deleting..." : "Delete Release"}
										</Button>
									</div>

									<div className="mt-4 space-y-3 rounded-lg border border-border/65 bg-background/70 p-3">
										<p className="text-sm font-semibold text-foreground">Artifacts</p>
										{release.artifacts.length === 0 ? (
											<p className="text-xs text-muted-foreground">
												No artifacts uploaded for this release.
											</p>
										) : (
											release.artifacts.map((artifact) => {
												const artifactDraft =
													artifactDrafts[artifact.id] ?? toArtifactDraft(artifact);
												return (
													<div
														key={artifact.id}
														className="rounded-md border border-border/60 bg-muted/25 p-3"
													>
														<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
															<p className="text-xs font-medium text-foreground">
																{artifact.filename}
															</p>
															<a
																href={artifact.downloadPath}
																target="_blank"
																rel="noreferrer"
																className="text-xs text-primary underline-offset-2 hover:underline"
															>
																Download
															</a>
														</div>
														<div className="grid gap-2 md:grid-cols-4">
															<select
																className="h-9 rounded-md border border-input bg-background px-2 text-sm"
																value={artifactDraft.platform}
																onChange={(event) =>
																	updateArtifactDraft(artifact.id, {
																		platform: event.target.value as ReleasePlatform,
																	})
																}
															>
																{RELEASE_PLATFORMS.map((platform) => (
																	<option key={`${artifact.id}-${platform}`} value={platform}>
																		{platform}
																	</option>
																))}
															</select>
															<select
																className="h-9 rounded-md border border-input bg-background px-2 text-sm"
																value={artifactDraft.format}
																onChange={(event) =>
																	updateArtifactDraft(artifact.id, {
																		format: event.target.value as ReleaseFormat,
																	})
																}
															>
																{RELEASE_FORMATS.map((format) => (
																	<option key={`${artifact.id}-${format}`} value={format}>
																		{format}
																	</option>
																))}
															</select>
															<Input
																value={artifactDraft.target}
																onChange={(event) =>
																	updateArtifactDraft(artifact.id, { target: event.target.value })
																}
																placeholder="target"
															/>
															<Input
																value={artifactDraft.filename}
																onChange={(event) =>
																	updateArtifactDraft(artifact.id, { filename: event.target.value })
																}
																placeholder="filename"
															/>
														</div>
														<div className="mt-2 flex flex-wrap gap-2">
															<Button
																type="button"
																size="sm"
																disabled={savingArtifactId === artifact.id}
																onClick={() => void handleSaveArtifact(artifact)}
															>
																{savingArtifactId === artifact.id ? "Saving..." : "Save Artifact"}
															</Button>
															<Button
																type="button"
																size="sm"
																variant="destructive"
																disabled={deletingArtifactId === artifact.id}
																onClick={() => void handleDeleteArtifact(artifact)}
															>
																{deletingArtifactId === artifact.id
																	? "Deleting..."
																	: "Delete Artifact"}
															</Button>
														</div>
													</div>
												);
											})
										)}

										<div className="rounded-md border border-border/60 bg-card/70 p-3">
											<p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
												Upload New Artifact
											</p>
											<div className="grid gap-2 md:grid-cols-4">
												<select
													className="h-9 rounded-md border border-input bg-background px-2 text-sm"
													value={uploadDraft.platform}
													onChange={(event) =>
														updateUploadDraft(release.id, {
															platform: event.target.value as ReleasePlatform,
														})
													}
												>
													{RELEASE_PLATFORMS.map((platform) => (
														<option key={`${release.id}-upload-${platform}`} value={platform}>
															{platform}
														</option>
													))}
												</select>
												<select
													className="h-9 rounded-md border border-input bg-background px-2 text-sm"
													value={uploadDraft.format}
													onChange={(event) =>
														updateUploadDraft(release.id, {
															format: event.target.value as ReleaseFormat,
														})
													}
												>
													{RELEASE_FORMATS.map((format) => (
														<option key={`${release.id}-upload-${format}`} value={format}>
															{format}
														</option>
													))}
												</select>
												<Input
													value={uploadDraft.target}
													onChange={(event) =>
														updateUploadDraft(release.id, { target: event.target.value })
													}
													placeholder="target (e.g. universal)"
												/>
												<Input
													value={uploadDraft.filename}
													onChange={(event) =>
														updateUploadDraft(release.id, { filename: event.target.value })
													}
													placeholder="override filename (optional)"
												/>
											</div>
											<div className="mt-2 flex flex-wrap items-center gap-3">
												<label
													htmlFor={artifactFileInputId}
													className="text-xs font-medium text-muted-foreground"
												>
													File
												</label>
												<input
													key={uploadInputKeys[release.id] ?? 0}
													id={artifactFileInputId}
													type="file"
													onChange={(event) =>
														updateUploadDraft(release.id, {
															file: event.target.files?.[0] ?? null,
														})
													}
												/>
												<Button
													type="button"
													size="sm"
													disabled={uploadingReleaseId === release.id}
													onClick={() => void handleUploadArtifact(release.id)}
												>
													{uploadingReleaseId === release.id ? "Uploading..." : "Upload Artifact"}
												</Button>
											</div>
										</div>
									</div>
								</div>
							);
						})
					: null}
			</CardContent>
		</Card>
	);
}

export function AdminPage() {
	const [users, setUsers] = useState<AuthUser[]>([]);
	const [stats, setStats] = useState<AdminUserListStats>(EMPTY_STATS);
	const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [savingId, setSavingId] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [createForm, setCreateForm] = useState<AdminCreateUserPayload>({
		id: "",
		fullName: "",
		company: "",
		email: "",
		password: "",
		isAdmin: false,
		isOwner: false,
	});

	const refreshAdminData = useCallback(
		async (options?: { showToast?: boolean; withLoading?: boolean }) => {
			const withLoading = options?.withLoading ?? false;
			if (withLoading) {
				setLoading(true);
			} else {
				setRefreshing(true);
			}

			try {
				const response = await authApi.getAdminUsers();
				setUsers(response.users);
				setStats(response.stats);
				setDrafts(
					Object.fromEntries(response.users.map((user) => [user.id, toDraft(user)])) as Record<
						string,
						UserDraft
					>,
				);
				if (options?.showToast) {
					toast.success("Admin dashboard refreshed.");
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : "Failed to load admin dashboard.";
				toast.error(message);
			} finally {
				setLoading(false);
				setRefreshing(false);
			}
		},
		[],
	);

	useEffect(() => {
		void refreshAdminData({ withLoading: true });
	}, [refreshAdminData]);

	const roleBreakdown = useMemo(
		() => [
			{ label: "Total Users", value: stats.totalUsers },
			{ label: "Admins", value: stats.adminUsers },
			{ label: "Owners", value: stats.ownerUsers },
		],
		[stats],
	);

	const updateDraft = (userId: string, patch: Partial<UserDraft>) => {
		setDrafts((previous) => ({
			...previous,
			[userId]: {
				...(previous[userId] ?? {
					fullName: "",
					company: "",
					email: "",
					password: "",
					isAdmin: false,
					isOwner: false,
				}),
				...patch,
			},
		}));
	};

	const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const payload: AdminCreateUserPayload = {
			id: createForm.id?.trim() || undefined,
			fullName: createForm.fullName.trim(),
			company: createForm.company.trim(),
			email: createForm.email.trim(),
			password: createForm.password,
			isAdmin: createForm.isAdmin,
			isOwner: createForm.isOwner,
		};

		if (!payload.fullName || !payload.company || !payload.email || !payload.password) {
			toast.error("fullName, company, email, and password are required.");
			return;
		}

		setCreating(true);
		try {
			await authApi.createAdminUser(payload);
			toast.success("User created.");
			setCreateForm({
				id: "",
				fullName: "",
				company: "",
				email: "",
				password: "",
				isAdmin: false,
				isOwner: false,
			});
			await refreshAdminData();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to create user.";
			toast.error(message);
		} finally {
			setCreating(false);
		}
	};

	const handleSaveUser = async (user: AuthUser) => {
		const draft = drafts[user.id];
		if (!draft) return;

		const payload: Record<string, unknown> = {};
		if (draft.fullName.trim() !== user.fullName) payload.fullName = draft.fullName.trim();
		if (draft.company.trim() !== user.company) payload.company = draft.company.trim();
		if (draft.email.trim() !== user.email) payload.email = draft.email.trim();
		if (draft.isAdmin !== user.isAdmin) payload.isAdmin = draft.isAdmin;
		if (draft.isOwner !== user.isOwner) payload.isOwner = draft.isOwner;
		if (draft.password.trim()) payload.password = draft.password;

		if (!Object.keys(payload).length) {
			toast.message("No changes to save.");
			return;
		}

		setSavingId(user.id);
		try {
			await authApi.updateAdminUser(user.id, payload);
			toast.success("User updated.");
			await refreshAdminData();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to update user.";
			toast.error(message);
		} finally {
			setSavingId(null);
		}
	};

	const handleDeleteUser = async (user: AuthUser) => {
		const accepted = window.confirm(
			`Delete ${user.email}? This removes user sessions permanently.`,
		);
		if (!accepted) return;

		setDeletingId(user.id);
		try {
			await authApi.deleteAdminUser(user.id);
			toast.success("User deleted.");
			await refreshAdminData();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to delete user.";
			toast.error(message);
		} finally {
			setDeletingId(null);
		}
	};

	if (loading) {
		return (
			<AnimatedPage>
				<div className="rounded-xl border border-border/65 bg-card/70 p-6 text-sm text-muted-foreground">
					Loading admin dashboard...
				</div>
			</AnimatedPage>
		);
	}

	return (
		<AnimatedPage>
			<section className="space-y-5">
				<Card className="bg-background/90">
					<CardHeader className="space-y-3">
						<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
							Admin Panel
						</Badge>
						<CardTitle className="font-heading text-3xl">User Access Dashboard</CardTitle>
						<CardDescription>
							Manage users, privileged roles, and account lifecycle controls.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-3 md:grid-cols-3">
							{roleBreakdown.map((item) => (
								<div
									key={item.label}
									className="rounded-lg border border-border/65 bg-muted/25 p-4 text-sm"
								>
									<p className="text-muted-foreground">{item.label}</p>
									<p className="mt-1 text-2xl font-semibold text-foreground">{item.value}</p>
								</div>
							))}
						</div>
						<div className="flex items-center gap-3">
							<Button
								type="button"
								variant="outline"
								onClick={() => void refreshAdminData({ showToast: true })}
							>
								{refreshing ? "Refreshing..." : "Refresh"}
							</Button>
						</div>
					</CardContent>
				</Card>

				<Card className="bg-background/90">
					<CardHeader>
						<CardTitle className="font-heading text-xl">Create User</CardTitle>
						<CardDescription>Create a new user with id, email, and password.</CardDescription>
					</CardHeader>
					<CardContent>
						<form className="grid gap-4" onSubmit={handleCreateUser}>
							<div className="grid gap-2 md:grid-cols-2">
								<div className="grid gap-2">
									<label htmlFor="new-id" className="text-sm font-medium">
										User ID
									</label>
									<Input
										id="new-id"
										value={createForm.id ?? ""}
										onChange={(event) =>
											setCreateForm((previous) => ({ ...previous, id: event.target.value }))
										}
										placeholder="Optional custom id"
									/>
								</div>
								<div className="grid gap-2">
									<label htmlFor="new-email" className="text-sm font-medium">
										Email
									</label>
									<Input
										id="new-email"
										type="email"
										value={createForm.email}
										onChange={(event) =>
											setCreateForm((previous) => ({ ...previous, email: event.target.value }))
										}
										required
									/>
								</div>
							</div>
							<div className="grid gap-2 md:grid-cols-2">
								<div className="grid gap-2">
									<label htmlFor="new-fullName" className="text-sm font-medium">
										Full Name
									</label>
									<Input
										id="new-fullName"
										value={createForm.fullName}
										onChange={(event) =>
											setCreateForm((previous) => ({ ...previous, fullName: event.target.value }))
										}
										required
									/>
								</div>
								<div className="grid gap-2">
									<label htmlFor="new-company" className="text-sm font-medium">
										Company
									</label>
									<Input
										id="new-company"
										value={createForm.company}
										onChange={(event) =>
											setCreateForm((previous) => ({ ...previous, company: event.target.value }))
										}
										required
									/>
								</div>
							</div>
							<div className="grid gap-2">
								<label htmlFor="new-password" className="text-sm font-medium">
									Password
								</label>
								<Input
									id="new-password"
									type="password"
									value={createForm.password}
									onChange={(event) =>
										setCreateForm((previous) => ({ ...previous, password: event.target.value }))
									}
									required
								/>
							</div>
							<div className="flex flex-wrap gap-4">
								<label className="inline-flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										checked={Boolean(createForm.isAdmin)}
										onChange={(event) =>
											setCreateForm((previous) => ({ ...previous, isAdmin: event.target.checked }))
										}
									/>
									Grant Admin
								</label>
								<label className="inline-flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										checked={Boolean(createForm.isOwner)}
										onChange={(event) =>
											setCreateForm((previous) => ({ ...previous, isOwner: event.target.checked }))
										}
									/>
									Grant Owner
								</label>
							</div>
							<Button type="submit" disabled={creating}>
								{creating ? "Creating..." : "Create User"}
							</Button>
						</form>
					</CardContent>
				</Card>

				<Card className="bg-background/90">
					<CardHeader>
						<CardTitle className="font-heading text-xl">Users</CardTitle>
						<CardDescription>
							Edit role flags, profile data, password, or delete accounts.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{users.length === 0 ? (
							<p className="text-sm text-muted-foreground">No users found.</p>
						) : (
							users.map((user) => {
								const draft = drafts[user.id] ?? toDraft(user);
								const fullNameInputId = `user-${user.id}-fullName`;
								const companyInputId = `user-${user.id}-company`;
								const emailInputId = `user-${user.id}-email`;
								const passwordInputId = `user-${user.id}-password`;
								return (
									<div key={user.id} className="rounded-xl border border-border/65 bg-muted/20 p-4">
										<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
											<div>
												<p className="text-sm font-semibold text-foreground">{user.email}</p>
												<p className="text-xs text-muted-foreground">
													ID: {user.id} • Created: {formatDate(user.createdAt)}
												</p>
											</div>
											<div className="flex flex-wrap gap-2">
												{user.roles.map((role) => (
													<Badge key={`${user.id}-${role}`} variant="secondary">
														{role}
													</Badge>
												))}
											</div>
										</div>
										<div className="grid gap-3 md:grid-cols-2">
											<div className="grid gap-2">
												<label
													htmlFor={fullNameInputId}
													className="text-xs font-medium text-muted-foreground"
												>
													Full Name
												</label>
												<Input
													id={fullNameInputId}
													value={draft.fullName}
													onChange={(event) =>
														updateDraft(user.id, { fullName: event.target.value })
													}
												/>
											</div>
											<div className="grid gap-2">
												<label
													htmlFor={companyInputId}
													className="text-xs font-medium text-muted-foreground"
												>
													Company
												</label>
												<Input
													id={companyInputId}
													value={draft.company}
													onChange={(event) =>
														updateDraft(user.id, { company: event.target.value })
													}
												/>
											</div>
											<div className="grid gap-2">
												<label
													htmlFor={emailInputId}
													className="text-xs font-medium text-muted-foreground"
												>
													Email
												</label>
												<Input
													id={emailInputId}
													type="email"
													value={draft.email}
													onChange={(event) => updateDraft(user.id, { email: event.target.value })}
												/>
											</div>
											<div className="grid gap-2">
												<label
													htmlFor={passwordInputId}
													className="text-xs font-medium text-muted-foreground"
												>
													New Password
												</label>
												<Input
													id={passwordInputId}
													type="password"
													placeholder="Leave blank to keep current"
													value={draft.password}
													onChange={(event) =>
														updateDraft(user.id, { password: event.target.value })
													}
												/>
											</div>
										</div>
										<div className="mt-3 flex flex-wrap items-center gap-4">
											<label className="inline-flex items-center gap-2 text-sm">
												<input
													type="checkbox"
													checked={draft.isAdmin}
													onChange={(event) =>
														updateDraft(user.id, { isAdmin: event.target.checked })
													}
												/>
												Admin
											</label>
											<label className="inline-flex items-center gap-2 text-sm">
												<input
													type="checkbox"
													checked={draft.isOwner}
													onChange={(event) =>
														updateDraft(user.id, { isOwner: event.target.checked })
													}
												/>
												Owner
											</label>
										</div>
										<div className="mt-4 flex flex-wrap gap-3">
											<Button
												type="button"
												disabled={savingId === user.id}
												onClick={() => void handleSaveUser(user)}
											>
												{savingId === user.id ? "Saving..." : "Save Changes"}
											</Button>
											<Button
												type="button"
												variant="destructive"
												disabled={deletingId === user.id}
												onClick={() => void handleDeleteUser(user)}
											>
												{deletingId === user.id ? "Deleting..." : "Delete User"}
											</Button>
										</div>
									</div>
								);
							})
						)}
					</CardContent>
				</Card>
				<ReleaseManagementSection />
			</section>
		</AnimatedPage>
	);
}

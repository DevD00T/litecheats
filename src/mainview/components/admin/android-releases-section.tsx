import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { authApi } from "@/lib/auth-api";
import { useCallback, useEffect, useState } from "react";
import type { AdminAndroidReleasesResponse, AndroidReleaseSummary } from "shared/android";
import { toast } from "sonner";

function formatSize(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string): string {
	return new Date(value).toLocaleString("en-IN", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "Asia/Kolkata",
	});
}

/**
 * The Android in-app update channel. Upload a signed release APK and every
 * installed copy of the app offers it on its next check; the server reads the
 * versionCode from the APK, stores it in GridFS and deletes older versions.
 */
export function AndroidReleasesSection() {
	const [data, setData] = useState<AdminAndroidReleasesResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [file, setFile] = useState<File | null>(null);
	const [fileInputKey, setFileInputKey] = useState(0);
	const [notes, setNotes] = useState("");
	const [mandatory, setMandatory] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

	const apply = useCallback((response: AdminAndroidReleasesResponse) => {
		setData(response);
		setNoteDrafts(
			Object.fromEntries(response.releases.map((release) => [release.id, release.notes])),
		);
	}, []);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			apply(await authApi.getAdminAndroidReleases());
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not load Android releases.");
		} finally {
			setLoading(false);
		}
	}, [apply]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const publish = async () => {
		if (!file) {
			toast.error("Choose the signed release APK to publish.");
			return;
		}
		setPublishing(true);
		try {
			const response = await authApi.publishAdminAndroidRelease({ file, notes, mandatory });
			apply(response);
			const latest = response.releases[0];
			toast.success(
				latest
					? `Published ${latest.versionName} (versionCode ${latest.versionCode}). Phones will update on their next check.`
					: "Published.",
			);
			setFile(null);
			setFileInputKey((key) => key + 1);
			setNotes("");
			setMandatory(false);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Publishing failed.");
		} finally {
			setPublishing(false);
		}
	};

	const update = async (
		release: AndroidReleaseSummary,
		patch: { notes?: string; mandatory?: boolean },
	) => {
		setBusyId(release.id);
		try {
			apply(await authApi.updateAdminAndroidRelease(release.id, patch));
			toast.success(`${release.versionName} updated.`);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Update failed.");
		} finally {
			setBusyId(null);
		}
	};

	const remove = async (release: AndroidReleaseSummary) => {
		if (
			!window.confirm(
				`Delete ${release.versionName} (${release.versionCode})? Phones will stop being offered it.`,
			)
		) {
			return;
		}
		setBusyId(release.id);
		try {
			await authApi.deleteAdminAndroidRelease(release.id);
			toast.success(`${release.versionName} deleted.`);
			await refresh();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Delete failed.");
		} finally {
			setBusyId(null);
		}
	};

	return (
		<div className="grid gap-5">
			<Card className="bg-background/90">
				<CardHeader className="space-y-2">
					<CardTitle className="font-heading text-xl">Android app updates</CardTitle>
					<CardDescription>
						Publish a signed release APK. The server reads its versionCode and versionName from the
						APK, stores it in GridFS with its SHA-256, and deletes older versions (keeping the
						newest {data?.keepCount ?? 1}). Installed apps download it, verify the hash and install
						it.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					<p className="text-xs text-muted-foreground">
						Accepted package:{" "}
						<code className="font-code text-secondary">{data?.packageName ?? "…"}</code>. Each
						upload needs a higher versionCode than the published one (bump it in{" "}
						<code className="font-code">version.properties</code>).
					</p>
					<div className="grid gap-2">
						<label htmlFor="android-apk" className="text-sm font-medium">
							Release APK
						</label>
						<input
							key={fileInputKey}
							id="android-apk"
							type="file"
							accept=".apk,application/vnd.android.package-archive"
							onChange={(event) => setFile(event.target.files?.[0] ?? null)}
						/>
					</div>
					<div className="grid gap-2">
						<label htmlFor="android-notes" className="text-sm font-medium">
							What's new
						</label>
						<Textarea
							id="android-notes"
							rows={3}
							placeholder="Shown to users in the update prompt."
							value={notes}
							onChange={(event) => setNotes(event.target.value)}
						/>
					</div>
					<label className="inline-flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={mandatory}
							onChange={(event) => setMandatory(event.target.checked)}
						/>
						Mandatory — users must install it before they can keep using the app
					</label>
					<Button type="button" disabled={publishing} onClick={() => void publish()}>
						{publishing ? "Uploading..." : "Publish update"}
					</Button>
				</CardContent>
			</Card>

			<Card className="bg-background/90">
				<CardHeader>
					<CardTitle className="font-heading text-lg">Published versions</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-3">
					{loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
					{!loading && !data?.releases.length ? (
						<p className="text-sm text-muted-foreground">No Android version published yet.</p>
					) : null}
					{data?.releases.map((release, index) => (
						<div
							key={release.id}
							className="grid gap-3 rounded-lg border border-border/65 bg-muted/25 p-4"
						>
							<div className="flex flex-wrap items-center gap-2">
								<span className="font-heading text-base font-bold">{release.versionName}</span>
								<Badge variant="secondary" className="font-code">
									versionCode {release.versionCode}
								</Badge>
								{index === 0 ? (
									<Badge variant="secondary" className="bg-success/12 text-success">
										live
									</Badge>
								) : null}
								{release.mandatory ? (
									<Badge variant="secondary" className="bg-warning/12 text-warning">
										mandatory
									</Badge>
								) : null}
							</div>
							<div className="grid gap-1 text-xs text-muted-foreground">
								<span>
									{formatSize(release.sizeBytes)} · published {formatDateTime(release.publishedAt)}{" "}
									IST · minSdk {release.minSdkVersion ?? "?"}
								</span>
								<span className="break-all font-code">sha256 {release.sha256}</span>
								<a className="text-primary hover:underline" href={release.downloadPath}>
									{release.filename}
								</a>
							</div>
							<Textarea
								rows={2}
								value={noteDrafts[release.id] ?? ""}
								onChange={(event) =>
									setNoteDrafts((previous) => ({ ...previous, [release.id]: event.target.value }))
								}
							/>
							<div className="flex flex-wrap gap-2">
								<Button
									type="button"
									size="sm"
									disabled={busyId === release.id}
									onClick={() => void update(release, { notes: noteDrafts[release.id] ?? "" })}
								>
									Save notes
								</Button>
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={busyId === release.id}
									onClick={() => void update(release, { mandatory: !release.mandatory })}
								>
									{release.mandatory ? "Make optional" : "Make mandatory"}
								</Button>
								<Button
									type="button"
									size="sm"
									variant="destructive"
									disabled={busyId === release.id}
									onClick={() => void remove(release)}
								>
									Delete
								</Button>
							</div>
						</div>
					))}
				</CardContent>
			</Card>
		</div>
	);
}

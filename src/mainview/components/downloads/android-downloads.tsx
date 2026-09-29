import { useAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authApi } from "@/lib/auth-api";
import { releasesApi } from "@/lib/releases-api";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AndroidReleaseSummary } from "shared/android";
import type { UserDeviceSummary } from "shared/devices";
import { toast } from "sonner";

const ANDROID_VERSION_BY_API: Record<number, string> = {
	26: "8.0",
	27: "8.1",
	28: "9",
	29: "10",
	30: "11",
	31: "12",
	32: "12L",
	33: "13",
	34: "14",
	35: "15",
	36: "16",
};

function androidVersionFor(minSdk: number | null): string {
	if (!minSdk) return "Android 9";
	return `Android ${ANDROID_VERSION_BY_API[minSdk] ?? `API ${minSdk}`}`;
}

export function formatApkSize(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPublished(value: string): string {
	try {
		return new Intl.DateTimeFormat("en-IN", {
			dateStyle: "medium",
			timeStyle: "short",
			timeZone: "Asia/Kolkata",
		}).format(new Date(value));
	} catch {
		return value;
	}
}

/**
 * The signed-in user's phones that run an older app version than the one
 * published, from the per-device records the app saves (user_devices).
 */
export function useOutdatedDevices(latest: AndroidReleaseSummary | null) {
	const { isAuthenticated } = useAuth();
	const [devices, setDevices] = useState<UserDeviceSummary[] | null>(null);

	useEffect(() => {
		if (!isAuthenticated) {
			setDevices(null);
			return;
		}
		let cancelled = false;
		authApi
			.getMyDevices()
			.then((response) => {
				if (!cancelled) setDevices(response.devices);
			})
			.catch(() => {
				if (!cancelled) setDevices(null);
			});
		return () => {
			cancelled = true;
		};
	}, [isAuthenticated]);

	const outdated =
		latest && devices ? devices.filter((device) => device.appVersionCode < latest.versionCode) : [];
	return { devices, outdated };
}

/**
 * Every published version, for admins and owners only. Everyone else sees just
 * the live version above; the server refuses older downloads to them too.
 */
function AndroidVersionHistory() {
	const { user } = useAuth();
	const privileged = Boolean(user?.isAdmin || user?.isOwner);
	const [releases, setReleases] = useState<AndroidReleaseSummary[] | null>(null);

	useEffect(() => {
		if (!privileged) {
			setReleases(null);
			return;
		}
		let cancelled = false;
		authApi
			.getAdminAndroidReleases()
			.then((response) => {
				if (!cancelled) setReleases(response.releases);
			})
			.catch(() => {
				if (!cancelled) setReleases(null);
			});
		return () => {
			cancelled = true;
		};
	}, [privileged]);

	if (!privileged || !releases) return null;

	return (
		<Card className="downloads-card bg-background/90">
			<CardHeader className="space-y-2">
				<div className="flex flex-wrap items-center gap-2">
					<CardTitle className="font-heading text-xl">Version history</CardTitle>
					<Badge variant="secondary" className="text-muted-foreground">
						admins &amp; owners only
					</Badge>
				</div>
				<CardDescription>
					Every published version. Users only see and download the live one; manage versions in
					Admin → Android.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-2">
				{releases.map((item) => (
					<div
						key={item.id}
						className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5"
					>
						<span className="font-heading text-sm font-bold">{item.versionName}</span>
						<Badge variant="secondary" className="font-code">
							{item.versionCode}
						</Badge>
						{item.live ? (
							<Badge variant="secondary" className="bg-success/12 text-success">
								live
							</Badge>
						) : null}
						<span className="text-xs text-muted-foreground">
							{formatApkSize(item.sizeBytes)} · {formatPublished(item.publishedAt)} IST
						</span>
						<span className="hidden font-code text-[11px] text-muted-foreground/80 md:inline">
							{item.sha256.slice(0, 16)}…
						</span>
						<a
							href={releasesApi.getDownloadUrl(item.adminDownloadPath)}
							className={cn(buttonVariants({ size: "sm", variant: "outline" }), "ml-auto")}
						>
							Download
						</a>
					</div>
				))}
			</CardContent>
		</Card>
	);
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
	return (
		<div className="rounded-[14px] border border-border bg-card/55 p-4">
			<div className="font-code text-[11px] text-primary">{n}</div>
			<div className="mt-1.5 font-heading text-[15px] font-bold tracking-tight">{title}</div>
			<div className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{children}</div>
		</div>
	);
}

/** Everything about the Android app on the downloads page: download, update prompt, how updates work. */
export function AndroidDownloads({
	release,
	loading,
}: {
	release: AndroidReleaseSummary | null;
	loading: boolean;
}) {
	const { isAuthenticated } = useAuth();
	const { devices, outdated } = useOutdatedDevices(release);

	if (loading) {
		return (
			<Card className="downloads-card">
				<CardContent className="py-8 text-sm text-muted-foreground">
					Loading the Android app...
				</CardContent>
			</Card>
		);
	}

	if (!release) {
		return (
			<Card className="downloads-card">
				<CardHeader>
					<CardTitle className="font-heading text-2xl">
						The Android app isn't published yet
					</CardTitle>
					<CardDescription>
						An admin publishes it from Admin → Android. It appears here for everyone as soon as it
						is.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const downloadUrl = releasesApi.getDownloadUrl(release.downloadPath);
	const copyHash = () => {
		void navigator.clipboard
			?.writeText(release.sha256)
			.then(() => toast.success("SHA-256 copied."))
			.catch(() => toast.error("Couldn't copy."));
	};

	return (
		<div className="grid gap-5">
			{outdated.length ? (
				<Card className="downloads-card border-warning/45 bg-warning/[0.07]">
					<CardContent className="grid gap-3 pt-6">
						<p className="text-sm font-semibold text-warning">
							Update available for{" "}
							{outdated.length === 1 ? "your phone" : `${outdated.length} of your phones`}
						</p>
						<ul className="grid gap-1 text-xs text-warning/90">
							{outdated.map((device) => (
								<li key={device.deviceId}>
									{device.deviceModel || "Android device"}: {device.appVersionName} →{" "}
									{release.versionName}
									{device.preferences.autoUpdate && device.permissions.installUpdates
										? " (installs by itself on the next check)"
										: " (auto-update is off or not allowed; update manually)"}
								</li>
							))}
						</ul>
						<div className="flex flex-wrap gap-2">
							<a href={downloadUrl} className={cn(buttonVariants({ size: "sm" }), "w-fit")}>
								Download {release.versionName}
							</a>
							<span className="self-center text-xs text-muted-foreground">
								Or open the app: More → App updates → Download & install.
							</span>
						</div>
					</CardContent>
				</Card>
			) : null}

			<Card className="downloads-card glow-ring border-primary/35 bg-background/90">
				<CardHeader className="space-y-3">
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant="secondary" className="bg-primary/12 text-primary">
							Android
						</Badge>
						<Badge variant="secondary" className="font-code">
							versionCode {release.versionCode}
						</Badge>
						{release.mandatory ? (
							<Badge variant="secondary" className="bg-warning/12 text-warning">
								Required update
							</Badge>
						) : null}
					</div>
					<CardTitle className="font-heading text-3xl">
						Litecheats for Android {release.versionName}
					</CardTitle>
					<CardDescription>
						{formatApkSize(release.sizeBytes)} · published {formatPublished(release.publishedAt)}{" "}
						IST ·{androidVersionFor(release.minSdkVersion)} or newer · free
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					{release.notes ? (
						<div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
							<p className="text-xs tracking-[0.12em] text-muted-foreground uppercase">
								What's new
							</p>
							<p className="mt-1 whitespace-pre-line text-sm text-foreground/90">{release.notes}</p>
						</div>
					) : null}
					<div className="flex flex-wrap items-center gap-3">
						<a href={downloadUrl} className={cn(buttonVariants({ size: "lg" }), "glow-ring")}>
							Download APK
						</a>
						{!isAuthenticated ? (
							<Link to="/signup" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
								Create a free account
							</Link>
						) : null}
					</div>
					<div className="grid gap-1.5 rounded-lg border border-border/60 bg-background/60 p-3">
						<div className="flex items-center justify-between gap-2">
							<span className="text-xs tracking-[0.12em] text-muted-foreground uppercase">
								SHA-256
							</span>
							<Button type="button" size="sm" variant="ghost" onClick={copyHash}>
								Copy
							</Button>
						</div>
						<code className="break-all font-code text-xs text-foreground/85">{release.sha256}</code>
						<p className="text-[11px] text-muted-foreground">
							Check it on a computer with{" "}
							<code className="font-code">certutil -hashfile {release.filename} SHA256</code>{" "}
							(Windows) or <code className="font-code">sha256sum {release.filename}</code>{" "}
							(macOS/Linux). The app checks it for you on every update.
						</p>
					</div>
					{isAuthenticated && devices && !outdated.length && devices.length ? (
						<p className="text-sm text-success">All your phones are on the latest version.</p>
					) : null}
				</CardContent>
			</Card>

			<AndroidVersionHistory />

			<div>
				<h2 className="font-heading text-xl font-bold tracking-tight">
					Install once, then it updates itself
				</h2>
				<div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<Step n="01" title="Download">
						Tap <strong>Download APK</strong> on your phone. Chrome may warn that the file could be
						harmful; it's the Litecheats app from this site, so choose{" "}
						<strong>Download anyway</strong>.
					</Step>
					<Step n="02" title="Install">
						Open the file. Android asks to allow installs from your browser the first time; allow
						it, then tap <strong>Install</strong>. Installing over an older version keeps your
						sign-in.
					</Step>
					<Step n="03" title="Allow updates">
						On first launch, allow <strong>Install app updates</strong> and notifications. Your
						choices are saved to your account.
					</Step>
					<Step n="04" title="Automatic updates">
						The app checks this server when you open it and every 6 hours, verifies each new
						version's SHA-256 and signature, installs it and deletes the old file.
					</Step>
				</div>
			</div>
		</div>
	);
}

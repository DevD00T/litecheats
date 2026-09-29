import { useOutdatedDevices } from "@/components/downloads/android-downloads";
import { buttonVariants } from "@/components/ui/button";
import { isBundledElectrobunRuntime } from "@/lib/electrobun";
import { releasesApi } from "@/lib/releases-api";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { AndroidReleaseSummary } from "shared/android";

const DISMISS_KEY = "litecheats-android-prompt-dismissed";

function readDismissed(): number {
	try {
		return Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
	} catch {
		return 0;
	}
}

/**
 * A slim prompt for Android visitors: "Get the app" when a version is published,
 * or "Update your app" when the signed-in user's synced phone runs an older one.
 * Dismissing hides it until the next version is published.
 */
export function AndroidAppPrompt() {
	const { pathname } = useLocation();
	const [release, setRelease] = useState<AndroidReleaseSummary | null>(null);
	const [dismissed, setDismissed] = useState(0);
	const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
	const enabled = isAndroid && !isBundledElectrobunRuntime();
	const { outdated } = useOutdatedDevices(enabled ? release : null);

	useEffect(() => {
		if (!enabled) return;
		setDismissed(readDismissed());
		releasesApi
			.getAndroidLatest()
			.then((response) => setRelease(response.latest))
			.catch(() => setRelease(null));
	}, [enabled]);

	if (!enabled || !release || pathname.startsWith("/downloads")) return null;
	const needsUpdate = outdated.length > 0;
	if (!needsUpdate && dismissed >= release.versionCode) return null;
	if (needsUpdate && release.mandatory === false && dismissed >= release.versionCode) return null;

	const dismiss = () => {
		try {
			window.localStorage.setItem(DISMISS_KEY, String(release.versionCode));
		} catch {
			// Storage blocked: hide for this page view only.
		}
		setDismissed(release.versionCode);
	};

	return (
		<div className="relative z-20 border-b border-border/70 bg-primary/[0.08] backdrop-blur-xl">
			<div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-6 py-2.5 md:px-10">
				<p className="min-w-0 flex-1 text-[12.5px] text-foreground/90">
					{needsUpdate ? (
						<>
							<strong>Update available:</strong> Litecheats for Android {release.versionName} (your
							phone has {outdated[0]?.appVersionName}).
						</>
					) : (
						<>
							<strong>Litecheats for Android {release.versionName}</strong> — install once, it keeps
							itself up to date.
						</>
					)}
				</p>
				<a
					href={releasesApi.getDownloadUrl(release.downloadPath)}
					className={cn(buttonVariants({ size: "sm" }))}
				>
					{needsUpdate ? "Download update" : "Get the app"}
				</a>
				<Link
					to="/downloads?tab=android"
					className="text-[12.5px] font-medium text-primary underline-offset-4 hover:underline"
				>
					Details
				</Link>
				{release.mandatory && needsUpdate ? null : (
					<button
						type="button"
						onClick={dismiss}
						aria-label="Dismiss"
						className="rounded-md px-2 text-lg leading-none text-muted-foreground hover:text-foreground"
					>
						×
					</button>
				)}
			</div>
		</div>
	);
}

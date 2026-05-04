import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { releasesApi } from "@/lib/releases-api";
import { cn } from "@/lib/utils";
import { gsap } from "gsap";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReleaseArtifactSummary, ReleaseFeedResponse, ReleasePlatform } from "shared/releases";
import { toast } from "sonner";

const platformOrder: ReleasePlatform[] = ["macos", "windows", "linux"];

const platformLabels: Record<ReleasePlatform, string> = {
	macos: "macOS",
	windows: "Windows",
	linux: "Linux",
};

function formatFileSize(sizeBytes: number): string {
	const mb = sizeBytes / (1024 * 1024);
	if (mb >= 1024) {
		return `${(mb / 1024).toFixed(2)} GB`;
	}
	return `${mb.toFixed(1)} MB`;
}

function formatPublishedDate(value: string): string {
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

function sortArtifacts(artifacts: ReleaseArtifactSummary[]): ReleaseArtifactSummary[] {
	return [...artifacts].sort((left, right) => {
		if (left.platform !== right.platform) {
			return platformOrder.indexOf(left.platform) - platformOrder.indexOf(right.platform);
		}
		if (left.target !== right.target) {
			return left.target.localeCompare(right.target);
		}
		return left.filename.localeCompare(right.filename);
	});
}

export function DownloadsPage() {
	const scopeRef = useRef<HTMLElement | null>(null);
	const [feed, setFeed] = useState<ReleaseFeedResponse | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	useLayoutEffect(() => {
		if (!scopeRef.current) return;
		const ctx = gsap.context(() => {
			gsap.from(".downloads-intro", {
				y: 26,
				opacity: 0,
				duration: 0.65,
				ease: "power3.out",
			});
			gsap.from(".downloads-card", {
				y: 22,
				opacity: 0,
				duration: 0.5,
				stagger: 0.08,
				ease: "power2.out",
				delay: 0.1,
			});
		}, scopeRef);

		return () => ctx.revert();
	}, []);

	useEffect(() => {
		let cancelled = false;
		setIsLoading(true);
		setErrorMessage(null);

		void releasesApi
			.getFeed()
			.then((payload) => {
				if (cancelled) return;
				setFeed(payload);
			})
			.catch((error) => {
				if (cancelled) return;
				const message = error instanceof Error ? error.message : "Failed to load downloads.";
				setErrorMessage(message);
				toast.error(message);
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const latestArtifacts = useMemo(
		() => sortArtifacts(feed?.latest?.artifacts ?? []),
		[feed?.latest?.artifacts],
	);

	const artifactsByPlatform = useMemo(() => {
		const groups = new Map<ReleasePlatform, ReleaseArtifactSummary[]>();
		for (const platform of platformOrder) {
			groups.set(platform, []);
		}
		for (const artifact of latestArtifacts) {
			const group = groups.get(artifact.platform) ?? [];
			group.push(artifact);
			groups.set(artifact.platform, group);
		}
		return groups;
	}, [latestArtifacts]);

	return (
		<AnimatedPage>
			<section ref={scopeRef} className="space-y-6">
				<div className="downloads-intro rounded-2xl border border-border/65 bg-card/75 p-6 md:p-8">
					<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
						Desktop Downloads
					</Badge>
					<h1 className="mt-4 font-heading text-3xl font-semibold tracking-tight md:text-5xl">
						Download Litecheats for macOS, Windows, and Linux.
					</h1>
					<p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground md:text-base">
						Production-ready desktop builds are available here. Choose the latest package for your
						platform to install or upgrade.
					</p>
				</div>

				{isLoading ? (
					<Card className="downloads-card">
						<CardContent className="py-8 text-sm text-muted-foreground">
							Loading release artifacts...
						</CardContent>
					</Card>
				) : null}

				{!isLoading && errorMessage ? (
					<Card className="downloads-card border-destructive/40 bg-destructive/5">
						<CardContent className="py-8 text-sm text-destructive">{errorMessage}</CardContent>
					</Card>
				) : null}

				{!isLoading && !errorMessage && !feed?.latest ? (
					<Card className="downloads-card">
						<CardHeader>
							<CardTitle className="font-heading text-2xl">No Published Release Yet</CardTitle>
							<CardDescription>
								Run a stable build and publish artifacts to make downloads available.
							</CardDescription>
						</CardHeader>
					</Card>
				) : null}

				{!isLoading && !errorMessage && feed?.latest ? (
					<>
						<Card className="downloads-card bg-background/85">
							<CardHeader>
								<CardTitle className="font-heading text-2xl">
									Latest Release: {feed.latest.version}
								</CardTitle>
								<CardDescription>
									Published {formatPublishedDate(feed.latest.publishedAt)} IST
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								{feed.latest.notes ? (
									<p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
										{feed.latest.notes}
									</p>
								) : null}
								<div className="grid gap-4 md:grid-cols-3">
									{platformOrder.map((platform) => {
										const artifacts = artifactsByPlatform.get(platform) ?? [];
										return (
											<Card key={platform} className="border-border/60 bg-card/65">
												<CardHeader>
													<CardTitle className="text-lg">{platformLabels[platform]}</CardTitle>
													<CardDescription>
														{artifacts.length
															? `${artifacts.length} package${artifacts.length > 1 ? "s" : ""}`
															: "No package for this platform yet"}
													</CardDescription>
												</CardHeader>
												<CardContent className="space-y-3">
													{artifacts.map((artifact) => (
														<div
															key={artifact.id}
															className="rounded-md border border-border/60 bg-background/85 p-3"
														>
															<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
																{artifact.target} · {artifact.format}
															</p>
															<p className="mt-1 break-all text-sm font-medium text-foreground">
																{artifact.filename}
															</p>
															<p className="mt-1 text-xs text-muted-foreground">
																{formatFileSize(artifact.sizeBytes)}
															</p>
															<a
																href={releasesApi.getDownloadUrl(artifact.downloadPath)}
																className={cn(buttonVariants({ size: "sm" }), "mt-3 inline-flex")}
															>
																Download
															</a>
														</div>
													))}
												</CardContent>
											</Card>
										);
									})}
								</div>
							</CardContent>
						</Card>

						<Card className="downloads-card bg-background/85">
							<CardHeader>
								<CardTitle className="font-heading text-xl">Release History</CardTitle>
								<CardDescription>Latest 20 published releases.</CardDescription>
							</CardHeader>
							<CardContent className="space-y-3">
								{feed.releases.map((release) => (
									<div
										key={release.id}
										className="rounded-md border border-border/55 bg-card/65 p-3 text-sm"
									>
										<div className="flex flex-wrap items-center justify-between gap-2">
											<p className="font-semibold text-foreground">{release.version}</p>
											<p className="text-xs text-muted-foreground">
												{formatPublishedDate(release.publishedAt)} IST
											</p>
										</div>
										<p className="mt-1 text-xs text-muted-foreground">
											{release.artifacts.length} artifact
											{release.artifacts.length === 1 ? "" : "s"}
										</p>
									</div>
								))}
							</CardContent>
						</Card>
					</>
				) : null}
			</section>
		</AnimatedPage>
	);
}

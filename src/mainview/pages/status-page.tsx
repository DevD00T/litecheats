import { AnimatedPage } from "@/components/layout/animated-page";
import { statusApi } from "@/lib/status-api";
import { cn } from "@/lib/utils";
import { gsap } from "gsap";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { StatusLevel, StatusSummaryResponse } from "shared/status";
import { toast } from "sonner";

const levelCopy: Record<
	StatusLevel,
	{ label: string; dot: string; text: string; border: string; bg: string }
> = {
	operational: {
		label: "Operational",
		dot: "bg-success",
		text: "text-success",
		border: "border-success/35",
		bg: "bg-success/10",
	},
	degraded: {
		label: "Degraded",
		dot: "bg-warning",
		text: "text-warning",
		border: "border-warning/35",
		bg: "bg-warning/10",
	},
	outage: {
		label: "Outage",
		dot: "bg-destructive",
		text: "text-destructive",
		border: "border-destructive/35",
		bg: "bg-destructive/10",
	},
};

function formatCheckedAt(value: string): string {
	try {
		return new Intl.DateTimeFormat("en-IN", {
			dateStyle: "medium",
			timeStyle: "medium",
			timeZone: "Asia/Kolkata",
		}).format(new Date(value));
	} catch {
		return value;
	}
}

export function StatusPage() {
	const scopeRef = useRef<HTMLElement | null>(null);
	const [summary, setSummary] = useState<StatusSummaryResponse | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	useLayoutEffect(() => {
		if (!scopeRef.current) return;
		const ctx = gsap.context(() => {
			gsap.from(".status-intro", { y: 24, opacity: 0, duration: 0.6, ease: "power3.out" });
			gsap.from(".status-row", {
				y: 18,
				opacity: 0,
				duration: 0.45,
				stagger: 0.07,
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

		void statusApi
			.getSummary()
			.then((payload) => {
				if (cancelled) return;
				setSummary(payload);
			})
			.catch((error) => {
				if (cancelled) return;
				const message = error instanceof Error ? error.message : "Failed to load platform status.";
				setErrorMessage(message);
				toast.error(message);
			})
			.finally(() => {
				if (!cancelled) setIsLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const overall = useMemo(() => (summary ? levelCopy[summary.status] : null), [summary]);

	return (
		<AnimatedPage>
			<section ref={scopeRef} className="space-y-6">
				<div className="status-intro rounded-2xl border border-border bg-card/70 p-6 md:p-8">
					<div className="text-[11px] tracking-[0.16em] text-primary uppercase">Status</div>
					<h1 className="mt-3 font-heading text-3xl font-bold tracking-tight md:text-5xl">
						Live platform status
					</h1>
					<p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
						Real-time checks against the accounts API, the Telegram webhook, the RDOS API, and
						the release archive that back the RDOS console and MAVLink cloud.
					</p>
				</div>

				{isLoading ? (
					<div className="status-row rounded-2xl border border-border bg-card/55 p-6 text-sm text-muted-foreground">
						Checking platform status...
					</div>
				) : null}

				{!isLoading && errorMessage ? (
					<div className="status-row rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
						{errorMessage} — the status API may not be running in this environment.
					</div>
				) : null}

				{!isLoading && !errorMessage && summary && overall ? (
					<>
						<div
							className={cn(
								"status-row flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-5",
								overall.border,
								overall.bg,
							)}
						>
							<div className="flex items-center gap-3">
								<span className={cn("h-2.5 w-2.5 rounded-full", overall.dot)} />
								<span className={cn("font-heading text-lg font-bold tracking-tight", overall.text)}>
									All systems {overall.label.toLowerCase()}
								</span>
							</div>
							<div className="font-code text-xs text-muted-foreground">
								{summary.region} · checked {formatCheckedAt(summary.checkedAt)} IST
							</div>
						</div>

						<div className="flex flex-col gap-3">
							{summary.components.map((component) => {
								const tone = levelCopy[component.status];
								return (
									<div
										key={component.key}
										className="status-row flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/55 p-4"
									>
										<div className="flex items-center gap-3">
											<span className={cn("h-2 w-2 flex-none rounded-full", tone.dot)} />
											<div>
												<div className="text-sm font-semibold text-foreground">
													{component.label}
												</div>
												<p className="mt-0.5 text-xs text-muted-foreground">{component.detail}</p>
											</div>
										</div>
										<div className="flex items-center gap-3">
											{component.latencyMs !== null ? (
												<span className="font-code text-xs text-muted-foreground">
													{component.latencyMs} ms
												</span>
											) : null}
											<span
												className={cn(
													"rounded-md border px-2 py-0.5 text-[10.5px] font-bold tracking-[0.06em] uppercase",
													tone.border,
													tone.bg,
													tone.text,
												)}
											>
												{tone.label}
											</span>
										</div>
									</div>
								);
							})}
						</div>
					</>
				) : null}
			</section>
		</AnimatedPage>
	);
}

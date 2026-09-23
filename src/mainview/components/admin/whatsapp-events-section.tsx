import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authApi } from "@/lib/auth-api";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import {
	type AdminWhatsAppEventsResponse,
	WHATSAPP_WEBHOOK_EVENTS,
	type WhatsAppWebhookEventSummary,
} from "shared/whatsapp";
import { toast } from "sonner";

const PAGE_SIZE = 50;
const HEALTHY_STATES = new Set(["CONNECTED"]);

const eventLabels: Record<string, string> = Object.fromEntries(
	WHATSAPP_WEBHOOK_EVENTS.map((entry) => [entry.event, entry.label]),
);

function formatDateTime(value: string): string {
	return new Date(value).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

export function WhatsAppEventsSection() {
	const [filter, setFilter] = useState<string | null>(null);
	const [overview, setOverview] = useState<AdminWhatsAppEventsResponse | null>(null);
	const [events, setEvents] = useState<WhatsAppWebhookEventSummary[]>([]);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);

	const load = useCallback(async (event: string | null) => {
		setLoading(true);
		try {
			const response = await authApi.getAdminWhatsAppEvents({
				event: event ?? undefined,
				limit: PAGE_SIZE,
			});
			setOverview(response);
			setEvents(response.events);
			setHasMore(response.events.length === PAGE_SIZE);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not load WhatsApp events.");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load(filter);
	}, [filter, load]);

	const loadOlder = async () => {
		const oldest = events.at(-1);
		if (!oldest) return;
		setLoadingMore(true);
		try {
			const response = await authApi.getAdminWhatsAppEvents({
				event: filter ?? undefined,
				before: oldest.receivedAt,
				limit: PAGE_SIZE,
			});
			setEvents((current) => [...current, ...response.events]);
			setHasMore(response.events.length === PAGE_SIZE);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not load older events.");
		} finally {
			setLoadingMore(false);
		}
	};

	const connection = overview?.connection ?? null;
	const webhookUrl = overview
		? `${typeof window === "undefined" ? "" : window.location.origin}${overview.webhookPath}`
		: "";
	const totalStored = Object.values(overview?.counts ?? {}).reduce((sum, count) => sum + count, 0);

	return (
		<div className="grid gap-5">
			<Card className="bg-background/90">
				<CardHeader className="space-y-2">
					<CardTitle className="font-heading text-xl">WhatsApp</CardTitle>
					<CardDescription>
						Events delivered by the WhatsApp gateway. Kept for {overview?.retentionDays ?? 30} days.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4 text-sm">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-muted-foreground">Session</span>
						{connection ? (
							<>
								<Badge
									variant="secondary"
									className={
										HEALTHY_STATES.has(connection.status)
											? "bg-success/12 text-success"
											: "bg-warning/12 text-warning"
									}
								>
									{connection.status}
								</Badge>
								<span className="text-xs text-muted-foreground">
									since {formatDateTime(connection.at)}
								</span>
							</>
						) : (
							<span className="text-xs text-muted-foreground">
								No connection update received yet.
							</span>
						)}
					</div>
					<div className="grid gap-1">
						<span className="text-muted-foreground">Webhook URL</span>
						<code className="break-all rounded-md border border-border/65 bg-muted/25 px-2 py-1 font-code text-xs">
							{webhookUrl || "…"}
						</code>
						{overview && !overview.webhookConfigured ? (
							<p className="text-xs text-warning">
								WHATSAPP_WEBHOOK_SECRET is not set on the server, so every delivery is refused. Set
								it to the secret configured on the gateway's webhook.
							</p>
						) : null}
					</div>
				</CardContent>
			</Card>

			<Card className="bg-background/90">
				<CardContent className="grid gap-4 pt-6">
					<div className="flex flex-wrap items-center gap-1.5">
						<FilterChip
							label="All"
							count={totalStored}
							active={filter === null}
							onClick={() => setFilter(null)}
						/>
						{WHATSAPP_WEBHOOK_EVENTS.map((entry) => (
							<FilterChip
								key={entry.event}
								label={entry.label}
								title={entry.description}
								count={overview?.counts[entry.event] ?? 0}
								active={filter === entry.event}
								onClick={() => setFilter(entry.event)}
							/>
						))}
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="ml-auto"
							disabled={loading}
							onClick={() => void load(filter)}
						>
							{loading ? "Loading..." : "Refresh"}
						</Button>
					</div>

					{!loading && events.length === 0 ? (
						<p className="py-6 text-center text-sm text-muted-foreground">No events yet.</p>
					) : null}

					<ul className="grid gap-2">
						{events.map((item) => (
							<li
								key={item.id}
								className="rounded-lg border border-border/65 bg-muted/20 px-3 py-2 text-sm"
							>
								<details>
									<summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
										<Badge variant="secondary" className="bg-primary/12 text-primary">
											{eventLabels[item.event] ?? item.event}
										</Badge>
										<span className="min-w-0 flex-1 break-words text-foreground">
											{item.summary}
										</span>
										<span className="text-xs text-muted-foreground">
											{formatDateTime(item.occurredAt ?? item.receivedAt)}
										</span>
									</summary>
									<pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted/40 p-2 font-code text-xs">
										{JSON.stringify(
											{ event: item.event, sessionId: item.sessionId, data: item.data },
											null,
											2,
										)}
									</pre>
								</details>
							</li>
						))}
					</ul>

					{hasMore ? (
						<Button
							type="button"
							variant="outline"
							disabled={loadingMore}
							onClick={() => void loadOlder()}
						>
							{loadingMore ? "Loading..." : "Load older events"}
						</Button>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}

function FilterChip({
	label,
	title,
	count,
	active,
	onClick,
}: {
	label: string;
	title?: string;
	count: number;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			title={title}
			aria-pressed={active}
			onClick={onClick}
			className={cn(
				"rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
				active
					? "border-primary/40 bg-primary/15 text-primary"
					: "border-border/65 text-muted-foreground hover:text-foreground",
			)}
		>
			{label} <span className="opacity-70">{count}</span>
		</button>
	);
}

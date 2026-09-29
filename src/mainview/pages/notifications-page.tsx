import { AnimatedPage } from "@/components/layout/animated-page";
import { useNotifications } from "@/components/notifications/use-notifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { NOTIFICATION_CATEGORY_LABELS, type UserNotification } from "shared/notifications";

const categoryTone: Record<string, string> = {
	offer: "bg-success/12 text-success",
	order: "bg-primary/12 text-primary",
	update: "bg-secondary/14 text-secondary",
	announcement: "bg-warning/12 text-warning",
	custom: "bg-muted text-muted-foreground",
};

function formatWhen(value: string): string {
	return new Date(value).toLocaleString("en-IN", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "Asia/Kolkata",
	});
}

export function NotificationsPage() {
	const navigate = useNavigate();
	const { notifications, unread, loaded, markRead, markAllRead, refresh } = useNotifications();

	const open = (item: UserNotification) => {
		void markRead(item.id);
		if (!item.link) return;
		if (item.link.startsWith("/")) navigate(item.link);
		else window.open(item.link, "_blank", "noopener");
	};

	return (
		<AnimatedPage>
			<section className="mx-auto grid w-full max-w-3xl gap-5">
				<Card className="bg-background/90">
					<CardHeader className="space-y-3">
						<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
							Inbox
						</Badge>
						<CardTitle className="font-heading text-3xl">Notifications</CardTitle>
						<CardDescription>
							Offers, order updates and announcements from Litecheats. The Android app shows these
							as phone notifications too.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-wrap gap-2">
						<Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
							Refresh
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={!unread}
							onClick={() => void markAllRead()}
						>
							Mark all as read
						</Button>
					</CardContent>
				</Card>

				{loaded && !notifications.length ? (
					<p className="text-center text-sm text-muted-foreground">No notifications yet.</p>
				) : null}

				<div className="grid gap-3">
					{notifications.map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() => open(item)}
							className={cn(
								"rounded-xl border p-4 text-left transition-colors hover:border-primary/40",
								item.readAt ? "border-border/60 bg-card/55" : "border-primary/40 bg-primary/[0.07]",
							)}
						>
							<div className="flex flex-wrap items-center gap-2">
								{item.readAt ? null : <span className="h-2 w-2 rounded-full bg-primary" />}
								<Badge variant="secondary" className={categoryTone[item.category]}>
									{NOTIFICATION_CATEGORY_LABELS[item.category]}
								</Badge>
								<span className="ml-auto text-xs text-muted-foreground">
									{formatWhen(item.createdAt)}
								</span>
							</div>
							<p className="mt-2 font-heading text-base font-bold">{item.title}</p>
							<p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{item.body}</p>
							{item.link ? <p className="mt-2 text-xs font-medium text-primary">Open →</p> : null}
						</button>
					))}
				</div>
			</section>
		</AnimatedPage>
	);
}

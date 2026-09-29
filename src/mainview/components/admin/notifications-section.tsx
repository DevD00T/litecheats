import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { notificationsApi } from "@/lib/notifications-api";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthUser } from "shared/auth";
import {
	NOTIFICATION_AUDIENCES,
	NOTIFICATION_AUDIENCE_LABELS,
	NOTIFICATION_CATEGORIES,
	NOTIFICATION_CATEGORY_LABELS,
	NOTIFICATION_PLACEHOLDERS,
	type NotificationAudienceType,
	type NotificationCampaign,
	type NotificationCategory,
	type NotificationTemplate,
} from "shared/notifications";
import { toast } from "sonner";

const selectClass = "h-9 rounded-md border border-border bg-background px-2 text-sm";

interface Draft {
	templateId: string;
	category: NotificationCategory;
	title: string;
	body: string;
	link: string;
}

const emptyDraft: Draft = {
	templateId: "",
	category: "announcement",
	title: "",
	body: "",
	link: "",
};

function formatWhen(value: string): string {
	return new Date(value).toLocaleString("en-IN", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "Asia/Kolkata",
	});
}

/**
 * Admins send templates to groups of users; owners also write custom
 * notifications, pick individual users, and manage the templates.
 */
export function NotificationsSection({
	users,
	viewerIsOwner,
}: { users: AuthUser[]; viewerIsOwner: boolean }) {
	const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
	const [campaigns, setCampaigns] = useState<NotificationCampaign[]>([]);
	const [draft, setDraft] = useState<Draft>(emptyDraft);
	const [audience, setAudience] = useState<NotificationAudienceType>("all");
	const [selected, setSelected] = useState<string[]>([]);
	const [userFilter, setUserFilter] = useState("");
	const [preview, setPreview] = useState<{ count: number; sample: string[] } | null>(null);
	const [sending, setSending] = useState(false);
	const [editing, setEditing] = useState<
		(Omit<Draft, "templateId"> & { id: string | null; name: string }) | null
	>(null);

	const refresh = useCallback(async () => {
		try {
			const [t, c] = await Promise.all([
				notificationsApi.templates(),
				notificationsApi.campaigns(),
			]);
			setTemplates(t.templates);
			setCampaigns(c.campaigns);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not load notifications.");
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const audiencePayload = useMemo(
		() => (audience === "users" ? { type: audience, userIds: selected } : { type: audience }),
		[audience, selected],
	);

	// Live count of who would receive it.
	useEffect(() => {
		if (audience === "users" && !selected.length) {
			setPreview({ count: 0, sample: [] });
			return;
		}
		let cancelled = false;
		notificationsApi
			.previewAudience(audiencePayload)
			.then((result) => {
				if (!cancelled) setPreview(result);
			})
			.catch(() => {
				if (!cancelled) setPreview(null);
			});
		return () => {
			cancelled = true;
		};
	}, [audience, selected, audiencePayload]);

	const pickTemplate = (id: string) => {
		const template = templates.find((item) => item.id === id);
		if (!template) {
			setDraft({ ...emptyDraft, templateId: "" });
			return;
		}
		setDraft({
			templateId: template.id,
			category: template.category,
			title: template.title,
			body: template.body,
			link: template.link ?? "",
		});
	};

	const send = async () => {
		if (!viewerIsOwner && !draft.templateId) {
			toast.error("Pick a template to send.");
			return;
		}
		if (!draft.title.trim() || !draft.body.trim()) {
			toast.error("Title and message are required.");
			return;
		}
		const count = preview?.count ?? 0;
		if (!window.confirm(`Send "${draft.title}" to ${count} user${count === 1 ? "" : "s"}?`)) return;
		setSending(true);
		try {
			const { campaign } = await notificationsApi.send({
				category: draft.category,
				title: draft.title,
				body: draft.body,
				link: draft.link.trim() || null,
				audience: audiencePayload,
				templateId: draft.templateId || null,
			});
			toast.success(`Sent to ${campaign.recipientCount} user(s).`);
			await refresh();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Sending failed.");
		} finally {
			setSending(false);
		}
	};

	const saveTemplate = async () => {
		if (!editing) return;
		try {
			const payload = {
				name: editing.name,
				category: editing.category,
				title: editing.title,
				body: editing.body,
				link: editing.link.trim() || null,
			};
			const response = editing.id
				? await notificationsApi.updateTemplate(editing.id, payload)
				: await notificationsApi.createTemplate(payload);
			setTemplates(response.templates);
			setEditing(null);
			toast.success("Template saved.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save the template.");
		}
	};

	const deleteTemplate = async (template: NotificationTemplate) => {
		if (!window.confirm(`Delete the template "${template.name}"?`)) return;
		try {
			setTemplates((await notificationsApi.deleteTemplate(template.id)).templates);
			toast.success("Template deleted.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not delete the template.");
		}
	};

	const filteredUsers = users.filter((user) =>
		`${user.email} ${user.fullName} ${user.company}`
			.toLowerCase()
			.includes(userFilter.trim().toLowerCase()),
	);
	const fieldsLocked = !viewerIsOwner;

	return (
		<div className="grid gap-5">
			<Card className="bg-background/90">
				<CardHeader className="space-y-2">
					<CardTitle className="font-heading text-xl">Send a notification</CardTitle>
					<CardDescription>
						Reaches the Android app as a phone notification (within a minute while it's open, about
						15 minutes otherwise) and the website inbox.{" "}
						{viewerIsOwner
							? "As an owner you can write custom messages and pick users."
							: "Admins send templates; owners write custom messages and pick individual users."}
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					<div className="grid gap-1.5">
						<label htmlFor="notify-template" className="text-xs font-medium">
							Template
						</label>
						<select
							id="notify-template"
							className={selectClass}
							value={draft.templateId}
							onChange={(event) => pickTemplate(event.target.value)}
						>
							<option value="">
								{viewerIsOwner ? "Custom (no template)" : "Pick a template..."}
							</option>
							{templates.map((template) => (
								<option key={template.id} value={template.id}>
									{template.name} · {NOTIFICATION_CATEGORY_LABELS[template.category]}
								</option>
							))}
						</select>
					</div>
					<div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
						<div className="grid gap-1.5">
							<label htmlFor="notify-category" className="text-xs font-medium">
								Type
							</label>
							<select
								id="notify-category"
								className={selectClass}
								disabled={fieldsLocked}
								value={draft.category}
								onChange={(event) =>
									setDraft({ ...draft, category: event.target.value as NotificationCategory })
								}
							>
								{NOTIFICATION_CATEGORIES.map((category) => (
									<option key={category} value={category}>
										{NOTIFICATION_CATEGORY_LABELS[category]}
									</option>
								))}
							</select>
						</div>
						<div className="grid gap-1.5">
							<label htmlFor="notify-title" className="text-xs font-medium">
								Title
							</label>
							<Input
								id="notify-title"
								disabled={fieldsLocked}
								value={draft.title}
								onChange={(event) => setDraft({ ...draft, title: event.target.value })}
							/>
						</div>
					</div>
					<div className="grid gap-1.5">
						<label htmlFor="notify-body" className="text-xs font-medium">
							Message
						</label>
						<Textarea
							id="notify-body"
							rows={3}
							disabled={fieldsLocked}
							value={draft.body}
							onChange={(event) => setDraft({ ...draft, body: event.target.value })}
						/>
						<p className="text-[11px] text-muted-foreground">
							Placeholders:{" "}
							{NOTIFICATION_PLACEHOLDERS.map((item) => (
								<code key={item.key} title={item.description} className="mr-1.5 font-code">
									{`{{${item.key}}}`}
								</code>
							))}
						</p>
					</div>
					<div className="grid gap-1.5">
						<label htmlFor="notify-link" className="text-xs font-medium">
							Opens (optional)
						</label>
						<Input
							id="notify-link"
							disabled={fieldsLocked}
							placeholder="/pricing, /billing, /downloads?tab=android or https://..."
							value={draft.link}
							onChange={(event) => setDraft({ ...draft, link: event.target.value })}
						/>
					</div>

					<div className="grid gap-1.5">
						<label htmlFor="notify-audience" className="text-xs font-medium">
							Send to
						</label>
						<select
							id="notify-audience"
							className={selectClass}
							value={audience}
							onChange={(event) => setAudience(event.target.value as NotificationAudienceType)}
						>
							{NOTIFICATION_AUDIENCES.filter((type) => type !== "users" || viewerIsOwner).map(
								(type) => (
									<option key={type} value={type}>
										{NOTIFICATION_AUDIENCE_LABELS[type]}
									</option>
								),
							)}
						</select>
					</div>

					{audience === "users" ? (
						<div className="grid gap-2 rounded-lg border border-border/65 bg-muted/20 p-3">
							<div className="flex flex-wrap items-center gap-2">
								<Input
									placeholder="Filter users..."
									value={userFilter}
									onChange={(event) => setUserFilter(event.target.value)}
									className="max-w-xs"
								/>
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={() =>
										setSelected([
											...new Set([...selected, ...filteredUsers.map((user) => user.id)]),
										])
									}
								>
									Select shown
								</Button>
								<Button type="button" size="sm" variant="ghost" onClick={() => setSelected([])}>
									Clear
								</Button>
								<span className="text-xs text-muted-foreground">{selected.length} selected</span>
							</div>
							<div className="grid max-h-64 gap-1 overflow-y-auto">
								{filteredUsers.map((user) => (
									<label key={user.id} className="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											checked={selected.includes(user.id)}
											onChange={(event) =>
												setSelected(
													event.target.checked
														? [...selected, user.id]
														: selected.filter((id) => id !== user.id),
												)
											}
										/>
										<span className="truncate">
											{user.email} <span className="text-muted-foreground">· {user.fullName}</span>
										</span>
									</label>
								))}
							</div>
						</div>
					) : null}

					<p className="text-sm">
						{preview ? (
							<>
								<strong>{preview.count}</strong> user{preview.count === 1 ? "" : "s"} will receive
								it
								{preview.sample.length ? (
									<span className="text-muted-foreground"> (e.g. {preview.sample.join(", ")})</span>
								) : null}
							</>
						) : (
							<span className="text-muted-foreground">Counting recipients...</span>
						)}
					</p>
					<Button type="button" disabled={sending || !preview?.count} onClick={() => void send()}>
						{sending ? "Sending..." : "Send notification"}
					</Button>
				</CardContent>
			</Card>

			<Card className="bg-background/90">
				<CardHeader>
					<CardTitle className="font-heading text-lg">Templates</CardTitle>
					<CardDescription>
						{viewerIsOwner
							? "Reusable offers, order updates and announcements."
							: "Only owners can edit templates."}
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3">
					{viewerIsOwner && !editing ? (
						<Button
							type="button"
							variant="outline"
							className="w-fit"
							onClick={() =>
								setEditing({ id: null, name: "", category: "offer", title: "", body: "", link: "" })
							}
						>
							New template
						</Button>
					) : null}
					{editing ? (
						<div className="grid gap-2 rounded-lg border border-primary/40 bg-primary/[0.05] p-3">
							<Input
								placeholder="Template name"
								value={editing.name}
								onChange={(event) => setEditing({ ...editing, name: event.target.value })}
							/>
							<select
								className={selectClass}
								value={editing.category}
								onChange={(event) =>
									setEditing({ ...editing, category: event.target.value as NotificationCategory })
								}
							>
								{NOTIFICATION_CATEGORIES.map((category) => (
									<option key={category} value={category}>
										{NOTIFICATION_CATEGORY_LABELS[category]}
									</option>
								))}
							</select>
							<Input
								placeholder="Title"
								value={editing.title}
								onChange={(event) => setEditing({ ...editing, title: event.target.value })}
							/>
							<Textarea
								rows={3}
								placeholder="Message"
								value={editing.body}
								onChange={(event) => setEditing({ ...editing, body: event.target.value })}
							/>
							<Input
								placeholder="Opens (optional)"
								value={editing.link}
								onChange={(event) => setEditing({ ...editing, link: event.target.value })}
							/>
							<div className="flex gap-2">
								<Button type="button" size="sm" onClick={() => void saveTemplate()}>
									Save template
								</Button>
								<Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
									Cancel
								</Button>
							</div>
						</div>
					) : null}
					{templates.map((template) => (
						<div
							key={template.id}
							className="grid gap-1 rounded-lg border border-border/65 bg-muted/20 p-3 text-sm"
						>
							<div className="flex flex-wrap items-center gap-2">
								<span className="font-medium">{template.name}</span>
								<Badge variant="secondary">{NOTIFICATION_CATEGORY_LABELS[template.category]}</Badge>
								{viewerIsOwner ? (
									<span className="ml-auto flex gap-2">
										<Button
											type="button"
											size="sm"
											variant="outline"
											onClick={() =>
												setEditing({
													id: template.id,
													name: template.name,
													category: template.category,
													title: template.title,
													body: template.body,
													link: template.link ?? "",
												})
											}
										>
											Edit
										</Button>
										<Button
											type="button"
											size="sm"
											variant="ghost"
											onClick={() => void deleteTemplate(template)}
										>
											Delete
										</Button>
									</span>
								) : null}
							</div>
							<span className="font-medium text-foreground/90">{template.title}</span>
							<span className="text-muted-foreground">{template.body}</span>
						</div>
					))}
				</CardContent>
			</Card>

			<Card className="bg-background/90">
				<CardHeader>
					<CardTitle className="font-heading text-lg">Sent</CardTitle>
					<CardDescription>Delivered = reached the app or website; read = opened.</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-2">
					{!campaigns.length ? (
						<p className="text-sm text-muted-foreground">Nothing sent yet.</p>
					) : null}
					{campaigns.map((campaign) => (
						<div
							key={campaign.id}
							className="grid gap-1 rounded-lg border border-border/65 bg-muted/20 p-3 text-sm"
						>
							<div className="flex flex-wrap items-center gap-2">
								<span className="font-medium">{campaign.title}</span>
								<Badge variant="secondary">{NOTIFICATION_CATEGORY_LABELS[campaign.category]}</Badge>
								{campaign.source === "order-status" ? (
									<Badge variant="secondary">automatic</Badge>
								) : null}
								<span className="ml-auto text-xs text-muted-foreground">
									{formatWhen(campaign.createdAt)}
								</span>
							</div>
							<span className="text-xs text-muted-foreground">
								{NOTIFICATION_AUDIENCE_LABELS[campaign.audience.type]} · by {campaign.sentBy}
							</span>
							<div className="flex flex-wrap gap-3 font-code text-xs">
								<span>sent {campaign.recipientCount}</span>
								<span
									className={cn(campaign.deliveredCount ? "text-success" : "text-muted-foreground")}
								>
									delivered {campaign.deliveredCount}
								</span>
								<span className={cn(campaign.readCount ? "text-primary" : "text-muted-foreground")}>
									read {campaign.readCount}
								</span>
							</div>
						</div>
					))}
				</CardContent>
			</Card>
		</div>
	);
}

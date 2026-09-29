import { AUTH_API_PORT } from "shared/auth";
import type {
	AudiencePreviewResponse,
	MyNotificationsResponse,
	NotificationAudience,
	NotificationCampaignsResponse,
	NotificationTemplatesResponse,
	SendNotificationPayload,
	SendNotificationResponse,
	UpsertNotificationTemplatePayload,
} from "shared/notifications";

function origin(): string {
	if (typeof window !== "undefined" && window.location.protocol.startsWith("http")) {
		return window.location.origin;
	}
	return `http://localhost:${AUTH_API_PORT}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${origin()}/login${path}`, {
		...init,
		cache: "no-store",
		credentials: "include",
		headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", ...init?.headers },
	});
	if (response.status === 204) return null as T;
	let payload: unknown = null;
	try {
		payload = await response.json();
	} catch {
		payload = null;
	}
	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload
				? String((payload as { error: unknown }).error)
				: `Request failed with status ${response.status}`;
		throw new Error(message);
	}
	return payload as T;
}

export const notificationsApi = {
	mine: (limit = 50) => request<MyNotificationsResponse>(`/me/notifications?limit=${limit}`),
	markRead: (id: string) =>
		request<null>(`/me/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
	markAllRead: () => request<{ updated: number }>("/me/notifications/read-all", { method: "POST" }),

	templates: () => request<NotificationTemplatesResponse>("/admin/notifications/templates"),
	createTemplate: (payload: UpsertNotificationTemplatePayload) =>
		request<NotificationTemplatesResponse>("/admin/notifications/templates", {
			method: "POST",
			body: JSON.stringify(payload),
		}),
	updateTemplate: (id: string, payload: UpsertNotificationTemplatePayload) =>
		request<NotificationTemplatesResponse>(
			`/admin/notifications/templates/${encodeURIComponent(id)}`,
			{
				method: "PATCH",
				body: JSON.stringify(payload),
			},
		),
	deleteTemplate: (id: string) =>
		request<NotificationTemplatesResponse>(
			`/admin/notifications/templates/${encodeURIComponent(id)}`,
			{
				method: "DELETE",
			},
		),
	previewAudience: (audience: NotificationAudience) =>
		request<AudiencePreviewResponse>("/admin/notifications/audience-preview", {
			method: "POST",
			body: JSON.stringify({ audience }),
		}),
	send: (payload: SendNotificationPayload) =>
		request<SendNotificationResponse>("/admin/notifications/send", {
			method: "POST",
			body: JSON.stringify(payload),
		}),
	campaigns: () => request<NotificationCampaignsResponse>("/admin/notifications/campaigns"),
};

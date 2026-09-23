/** The WhatsApp gateway posts events here, e.g. https://litecheats.com/whatsapp/webhook. */
export const WHATSAPP_WEBHOOK_BASE_PATH = "/whatsapp";
export const WHATSAPP_WEBHOOK_PATH = `${WHATSAPP_WEBHOOK_BASE_PATH}/webhook`;

/** Every event the gateway can deliver, with what it means, in the order its UI lists them. */
export const WHATSAPP_WEBHOOK_EVENTS = [
	{ event: "message.received", label: "Message Received", description: "A new message arrived." },
	{ event: "message.sent", label: "Message Sent", description: "A message was sent." },
	{
		event: "message.status",
		label: "Message Status",
		description: "A message was delivered or read.",
	},
	{
		event: "connection.update",
		label: "Connection Update",
		description: "The session connected or disconnected.",
	},
	{ event: "group.update", label: "Group Update", description: "Group info changed." },
	{
		event: "group.participant",
		label: "Group Member",
		description: "Participants joined, left, or changed roles.",
	},
	{ event: "contact.update", label: "Contact Update", description: "Contact info changed." },
	{
		event: "status.update",
		label: "Status/Story",
		description: "A status was posted or viewed.",
	},
	{ event: "message.edited", label: "Message Edited", description: "A message was edited." },
	{
		event: "message.deleted",
		label: "Message Deleted",
		description: "A message was revoked or deleted.",
	},
] as const;

export type WhatsAppWebhookEventName = (typeof WHATSAPP_WEBHOOK_EVENTS)[number]["event"];

/** Session states reported by `connection.update`. */
export const WHATSAPP_CONNECTION_STATES = [
	"SCAN_QR",
	"CONNECTED",
	"DISCONNECTED",
	"LOGGED_OUT",
	"STOPPED",
] as const;

export interface WhatsAppWebhookEventSummary {
	id: string;
	/** As delivered. Usually one of WHATSAPP_WEBHOOK_EVENTS, but unknown names are kept too. */
	event: string;
	sessionId: string | null;
	/** When the gateway says it happened, if it said. */
	occurredAt: string | null;
	receivedAt: string;
	/** One human line, e.g. "Budi (919876543210): Halo". */
	summary: string;
	data: unknown;
}

export interface WhatsAppConnectionState {
	status: string;
	at: string;
}

export interface AdminWhatsAppEventsResponse {
	events: WhatsAppWebhookEventSummary[];
	/** Stored events per event name, across the retention window. */
	counts: Record<string, number>;
	/** Latest `connection.update`, or null if none has arrived yet. */
	connection: WhatsAppConnectionState | null;
	/** Whether a signing secret is set; without one every delivery is refused. */
	webhookConfigured: boolean;
	webhookPath: string;
	retentionDays: number;
}

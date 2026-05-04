import { createConnection } from "node:net";
import { ApplicationMenu, BrowserView, BrowserWindow } from "electrobun/bun";
import { Resend } from "resend";
import { AUTH_API_PORT } from "../../shared/auth";
import type { ContactInquiryPayload, MainRPC } from "../../shared/rpc";
import { startAuthServer } from "./auth-server";

const CONTACT_TO_EMAIL = Bun.env.RESEND_TO_EMAIL ?? "support@litecheats.com";
const CONTACT_FROM_EMAIL =
	Bun.env.RESEND_FROM_EMAIL ?? "Litecheats Enquiry <onboarding@resend.dev>";
const resend = Bun.env.RESEND_API_KEY ? new Resend(Bun.env.RESEND_API_KEY) : null;
const RPC_MAX_REQUEST_TIME_MS = 20000;
const BUNDLED_MAIN_VIEW_URL = "views://mainview/index.html";
const WEBVIEW_DEV_SERVER_URL = Bun.env.WEBVIEW_DEV_SERVER_URL ?? "http://localhost:5173";
const USE_WEBVIEW_DEV_SERVER =
	Bun.env.USE_WEBVIEW_DEV_SERVER === "1" || Bun.env.USE_WEBVIEW_DEV_SERVER === "true";
const DEV_SERVER_WAIT_TIMEOUT_MS = 20000;
const DEV_SERVER_WAIT_INTERVAL_MS = 250;
const WEBVIEW_READY_TIMEOUT_MS = 12000;

async function canReachWebViewServer(url: string): Promise<boolean> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 1000);
	try {
		const response = await fetch(url, { signal: controller.signal });
		return response.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timeout);
	}
}

async function waitForWebViewServer(url: string, timeoutMs: number): Promise<boolean> {
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		if (await canReachWebViewServer(url)) {
			return true;
		}
		await Bun.sleep(DEV_SERVER_WAIT_INTERVAL_MS);
	}

	return false;
}

// Use Vite dev server when explicitly requested, otherwise use bundled views.
async function getMainViewUrl(): Promise<string> {
	if (USE_WEBVIEW_DEV_SERVER) {
		const isReady = await waitForWebViewServer(WEBVIEW_DEV_SERVER_URL, DEV_SERVER_WAIT_TIMEOUT_MS);
		if (isReady) {
			return WEBVIEW_DEV_SERVER_URL;
		}
		console.warn(
			`Webview dev server not reachable at ${WEBVIEW_DEV_SERVER_URL} within ${DEV_SERVER_WAIT_TIMEOUT_MS}ms. Falling back to bundled views.`,
		);
	}

	return BUNDLED_MAIN_VIEW_URL;
}

async function isPortInUse(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ port, host: "127.0.0.1" });
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => {
			resolve(false);
		});
	});
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function normalizeInquiryPayload(payload: ContactInquiryPayload): ContactInquiryPayload {
	const fullName = payload.fullName.trim();
	const email = payload.email.trim();
	const company = payload.company.trim();
	const projectScope = payload.projectScope.trim();

	if (!fullName || !email || !company || !projectScope) {
		throw new Error("All enquiry fields are required.");
	}

	return {
		fullName,
		email,
		company,
		projectScope,
	};
}

function buildInquiryEmailHtml(payload: ContactInquiryPayload): string {
	const receivedAtIst = new Intl.DateTimeFormat("en-IN", {
		dateStyle: "full",
		timeStyle: "medium",
		timeZone: "Asia/Kolkata",
	}).format(new Date());

	return `
<div style="font-family:Arial,sans-serif;background:#f5f7fb;color:#111827;padding:24px;">
  <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
    <div style="background:#111827;color:#ffffff;padding:20px 24px;">
      <h1 style="margin:0;font-size:20px;line-height:1.3;">New Enquiry • Litecheats Technologies</h1>
      <p style="margin:8px 0 0 0;font-size:12px;opacity:0.86;">Received at ${escapeHtml(receivedAtIst)} (IST)</p>
    </div>
    <div style="padding:24px;">
      <table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px;">
        <tr>
          <td style="padding:8px 0;color:#6b7280;width:140px;">Full Name</td>
          <td style="padding:8px 0;color:#111827;"><strong>${escapeHtml(payload.fullName)}</strong></td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;">Work Email</td>
          <td style="padding:8px 0;color:#111827;"><a href="mailto:${escapeHtml(payload.email)}">${escapeHtml(payload.email)}</a></td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#6b7280;">Company</td>
          <td style="padding:8px 0;color:#111827;">${escapeHtml(payload.company)}</td>
        </tr>
      </table>
      <div style="margin-top:18px;">
        <p style="margin:0 0 8px 0;color:#6b7280;font-size:14px;">Project Scope</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;white-space:pre-wrap;line-height:1.55;">
${escapeHtml(payload.projectScope)}
        </div>
      </div>
      <p style="margin:20px 0 0 0;color:#6b7280;font-size:12px;">
        This enquiry was submitted from the Litecheats contact form.
      </p>
    </div>
  </div>
</div>
`.trim();
}

function buildInquiryEmailText(payload: ContactInquiryPayload): string {
	const receivedAtIst = new Intl.DateTimeFormat("en-IN", {
		dateStyle: "full",
		timeStyle: "medium",
		timeZone: "Asia/Kolkata",
	}).format(new Date());

	return [
		"New Enquiry - Litecheats Technologies",
		`Received at: ${receivedAtIst} (IST)`,
		`Full Name: ${payload.fullName}`,
		`Work Email: ${payload.email}`,
		`Company: ${payload.company}`,
		"",
		"Project Scope:",
		payload.projectScope,
	].join("\n");
}

async function sendContactInquiryEmail(payload: ContactInquiryPayload): Promise<string> {
	if (!resend) {
		throw new Error("Email service not configured. Set RESEND_API_KEY in Bun environment.");
	}

	const result = await resend.emails.send({
		from: CONTACT_FROM_EMAIL,
		to: CONTACT_TO_EMAIL,
		subject: `New Litecheats enquiry from ${payload.fullName} (${payload.company})`,
		replyTo: payload.email,
		html: buildInquiryEmailHtml(payload),
		text: buildInquiryEmailText(payload),
	});

	if (result.error || !result.data?.id) {
		throw new Error(result.error?.message ?? "Failed to send enquiry email.");
	}

	return result.data.id;
}

// Application menu
ApplicationMenu.setApplicationMenu([
	{
		submenu: [
			{ label: "About Litecheats", role: "about" },
			{ type: "separator" },
			{ label: "Quit", role: "quit", accelerator: "q" },
		],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "selectAll" },
		],
	},
]);

// Define RPC handlers for webview communication
const mainRPC = BrowserView.defineRPC<MainRPC>({
	maxRequestTime: RPC_MAX_REQUEST_TIME_MS,
	handlers: {
		requests: {
			ping: () => "pong",
			getGreeting: () => "Greetings from the Bun side!",
			sendContactInquiry: async (payload) => {
				const safePayload = normalizeInquiryPayload(payload);
				const emailId = await sendContactInquiryEmail(safePayload);
				return { id: emailId };
			},
		},
		messages: {
			log: ({ msg }) => {
				console.log("[Webview]:", msg);
			},
		},
	},
});

let authServer: Awaited<ReturnType<typeof startAuthServer>> | null = null;
if (await isPortInUse(AUTH_API_PORT)) {
	console.warn(
		`Auth server port ${AUTH_API_PORT} is already in use. Reusing existing listener and continuing startup.`,
	);
} else {
	try {
		authServer = await startAuthServer();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("EADDRINUSE")) {
			console.warn(
				`Auth server port ${AUTH_API_PORT} is already in use. Continuing without starting a second instance.`,
			);
		} else {
			throw error;
		}
	}
}

const mainViewUrl = await getMainViewUrl();
console.log(`Main webview URL: ${mainViewUrl}`);

// Create main window
const mainWindow = new BrowserWindow({
	title: "Litecheats",
	url: mainViewUrl,
	frame: {
		width: 1200,
		height: 800,
		x: 100,
		y: 100,
	},
	rpc: mainRPC,
});

let webviewDomReady = false;
let webviewLoadWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
const retryLoadUrls =
	mainViewUrl === BUNDLED_MAIN_VIEW_URL
		? [mainViewUrl, mainViewUrl]
		: [mainViewUrl, mainViewUrl, BUNDLED_MAIN_VIEW_URL];
let webviewRetryIndex = 0;

function clearWebviewWatchdog(): void {
	if (webviewLoadWatchdogTimer !== null) {
		clearTimeout(webviewLoadWatchdogTimer);
		webviewLoadWatchdogTimer = null;
	}
}

function armWebviewWatchdog(): void {
	clearWebviewWatchdog();
	webviewLoadWatchdogTimer = setTimeout(() => {
		if (webviewDomReady) {
			return;
		}

		const nextUrl = retryLoadUrls[webviewRetryIndex];
		if (!nextUrl) {
			console.error(
				`Webview failed to reach dom-ready after ${retryLoadUrls.length} retry attempts.`,
			);
			return;
		}

		webviewRetryIndex += 1;
		console.warn(
			`Webview load timeout. Retrying ${webviewRetryIndex}/${retryLoadUrls.length} with ${nextUrl}`,
		);
		mainWindow.webview.loadURL(nextUrl);
		armWebviewWatchdog();
	}, WEBVIEW_READY_TIMEOUT_MS);
}

armWebviewWatchdog();

// Handle window events
mainWindow.on("close", () => {
	console.log("Main window closed");
	authServer?.stop(true);
	process.exit(0);
});

mainWindow.webview.on("dom-ready", () => {
	webviewDomReady = true;
	clearWebviewWatchdog();
	console.log("Webview DOM ready");
});

console.log("Litecheats app started");

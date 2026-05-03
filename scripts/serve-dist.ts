#!/usr/bin/env bun

import { createConnection } from "node:net";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import { AUTH_API_PORT, AUTH_BASE_PATH } from "../shared/auth";
import { type ContactInquiryPayload, type ContactInquiryResult } from "../shared/rpc";
import { DOWNLOADS_BASE_PATH } from "../shared/releases";
import { startAuthServer } from "../src/bun/auth-server";

const distDir = path.resolve(import.meta.dir, "..", "dist");
const indexHtmlPath = path.join(distDir, "index.html");
const port = Number(Bun.env.PORT ?? Bun.env.HTTP_PORT ?? 8080);
const host = "0.0.0.0";
const AUTH_SERVER_ORIGIN = `http://127.0.0.1:${AUTH_API_PORT}`;
const CONTACT_API_PATH = "/contact/inquiry";
const CONTACT_TO_EMAIL = Bun.env.RESEND_TO_EMAIL ?? "support@litecheats.com";
const CONTACT_FROM_EMAIL =
	Bun.env.RESEND_FROM_EMAIL ?? "Litecheats Enquiry <onboarding@resend.dev>";
const resend = Bun.env.RESEND_API_KEY ? new Resend(Bun.env.RESEND_API_KEY) : null;

function createApiHeaders(request: Request): Headers {
	const headers = new Headers();
	const origin = request.headers.get("origin");
	if (origin) {
		headers.set("Access-Control-Allow-Origin", origin);
		headers.set("Vary", "Origin");
	}
	headers.set("Access-Control-Allow-Credentials", "true");
	headers.set("Access-Control-Allow-Methods", "GET,HEAD,POST,PATCH,DELETE,OPTIONS");
	headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
	headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
	headers.set("Pragma", "no-cache");
	headers.set("Expires", "0");
	return headers;
}

function jsonResponse(
	request: Request,
	status: number,
	body: object,
	extraHeaders?: Record<string, string>,
): Response {
	const headers = createApiHeaders(request);
	headers.set("Content-Type", "application/json");
	if (extraHeaders) {
		for (const [key, value] of Object.entries(extraHeaders)) {
			headers.set(key, value);
		}
	}
	return new Response(JSON.stringify(body), { status, headers });
}

async function isPortInUse(checkPort: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ port: checkPort, host: "127.0.0.1" });
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => {
			resolve(false);
		});
	});
}

async function ensureAuthServerRunning(): Promise<void> {
	if (await isPortInUse(AUTH_API_PORT)) {
		console.log(`Auth API is already running on :${AUTH_API_PORT}`);
		return;
	}

	await startAuthServer();
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

	return { fullName, email, company, projectScope };
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

async function handleContactInquiry(request: Request): Promise<Response> {
	if (request.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: createApiHeaders(request) });
	}

	if (request.method !== "POST") {
		return jsonResponse(request, 405, { error: "Method Not Allowed" });
	}

	try {
		const body = (await request.json()) as ContactInquiryPayload;
		const safePayload = normalizeInquiryPayload(body);
		const id = await sendContactInquiryEmail(safePayload);
		const responseBody: ContactInquiryResult = { id };
		return jsonResponse(request, 200, responseBody);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to send enquiry.";
		return jsonResponse(request, 400, { error: message });
	}
}

async function proxyAuthApi(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const proxyUrl = new URL(url.pathname + url.search, AUTH_SERVER_ORIGIN);
	const proxiedRequest = new Request(proxyUrl, request);
	return fetch(proxiedRequest);
}

function resolvePublicPath(urlPathname: string): string | null {
	const decoded = decodeURIComponent(urlPathname);
	const sanitized = decoded.replace(/^\/+/, "");
	const resolved = path.resolve(distDir, sanitized);
	if (!resolved.startsWith(distDir)) {
		return null;
	}
	return resolved;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		const fileStat = await stat(filePath);
		return fileStat.isFile();
	} catch {
		return false;
	}
}

await ensureAuthServerRunning();

const server = Bun.serve({
	hostname: host,
	port,
	async fetch(request) {
		const requestUrl = new URL(request.url);
		const pathname = requestUrl.pathname;

		if (pathname === "/healthz") {
			return new Response("ok", { status: 200 });
		}

		if (pathname === CONTACT_API_PATH) {
			return handleContactInquiry(request);
		}

		if (pathname.startsWith(AUTH_BASE_PATH) || pathname.startsWith(DOWNLOADS_BASE_PATH)) {
			return proxyAuthApi(request);
		}

		const resolvedPath = resolvePublicPath(pathname);
		if (resolvedPath && (await fileExists(resolvedPath))) {
			return new Response(Bun.file(resolvedPath));
		}

		return new Response(Bun.file(indexHtmlPath), {
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-cache",
			},
		});
	},
});

console.log(`Static server listening on http://${host}:${server.port}`);

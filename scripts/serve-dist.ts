#!/usr/bin/env bun

import { stat } from "node:fs/promises";
import path from "node:path";

const distDir = path.resolve(import.meta.dir, "..", "dist");
const indexHtmlPath = path.join(distDir, "index.html");
const port = Number(Bun.env.PORT ?? Bun.env.HTTP_PORT ?? 8080);
const host = "0.0.0.0";

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

const server = Bun.serve({
	hostname: host,
	port,
	async fetch(request) {
		const requestUrl = new URL(request.url);
		const pathname = requestUrl.pathname;

		if (pathname === "/healthz") {
			return new Response("ok", { status: 200 });
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

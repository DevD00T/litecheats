/*
 * Litecheats service worker.
 *
 * - Page loads: network first, so users always get the current app; when offline,
 *   the last app shell is served (the SPA then routes client-side), or offline.html.
 * - /assets/*: Vite's content-hashed bundles never change, so cache first.
 * - Google Fonts: cache first.
 * - Everything else — the API (/login/*, /downloads/*, /api/*, webhooks), downloads,
 *   Razorpay and any other origin — is never touched, so sessions, payments and
 *   downloads always go straight to the network.
 *
 * Bump VERSION when this file's caching rules change; old caches are then deleted.
 */
const VERSION = "v1";
const SHELL_CACHE = `litecheats-shell-${VERSION}`;
const ASSET_CACHE = `litecheats-assets-${VERSION}`;
const FONT_CACHE = `litecheats-fonts-${VERSION}`;
const KNOWN_CACHES = [SHELL_CACHE, ASSET_CACHE, FONT_CACHE];
const ASSET_CACHE_LIMIT = 120;

const SHELL_URL = "/";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [
	SHELL_URL,
	OFFLINE_URL,
	"/site.webmanifest",
	"/favicon.ico",
	"/android-chrome-192x192.png",
	"/android-chrome-512x512.png",
	"/maskable-192x192.png",
	"/maskable-512x512.png",
	"/apple-touch-icon.png",
];

/** Same-origin paths that belong to the server, not the app. Never intercepted. */
const NETWORK_ONLY_PREFIXES = [
	"/login/",
	"/downloads/",
	"/api/",
	"/contact/",
	"/whatsapp/",
	"/telegram-webhook",
	"/healthz",
];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(SHELL_CACHE)
			// Precache individually so one missing icon can't block installation.
			.then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined)))),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const names = await caches.keys();
			await Promise.all(
				names
					.filter((name) => name.startsWith("litecheats-") && !KNOWN_CACHES.includes(name))
					.map((name) => caches.delete(name)),
			);
			await self.clients.claim();
		})(),
	);
});

// The page asks a waiting worker to take over after the user accepts "Reload".
self.addEventListener("message", (event) => {
	if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;

	const url = new URL(request.url);

	if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") {
		event.respondWith(cacheFirst(request, FONT_CACHE));
		return;
	}
	if (url.origin !== self.location.origin) return;
	if (NETWORK_ONLY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;

	if (request.mode === "navigate") {
		event.respondWith(navigate(request));
		return;
	}

	if (url.pathname.startsWith("/assets/")) {
		event.respondWith(cacheFirst(request, ASSET_CACHE, ASSET_CACHE_LIMIT));
		return;
	}

	if (PRECACHE.includes(url.pathname)) {
		event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
	}
});

async function navigate(request) {
	const cache = await caches.open(SHELL_CACHE);
	try {
		const response = await fetch(request);
		// Every page route serves the same SPA shell; keep the freshest copy for offline use.
		if (response.ok && (response.headers.get("content-type") || "").includes("text/html")) {
			await cache.put(SHELL_URL, response.clone());
		}
		return response;
	} catch {
		return (
			(await cache.match(SHELL_URL)) ||
			(await cache.match(OFFLINE_URL)) ||
			new Response("You're offline.", { status: 503, headers: { "Content-Type": "text/plain" } })
		);
	}
}

async function cacheFirst(request, cacheName, limit) {
	const cache = await caches.open(cacheName);
	const cached = await cache.match(request);
	if (cached) return cached;
	const response = await fetch(request);
	if (response.ok || response.type === "opaque") {
		await cache.put(request, response.clone());
		if (limit) await trim(cache, limit);
	}
	return response;
}

async function staleWhileRevalidate(request, cacheName) {
	const cache = await caches.open(cacheName);
	const cached = await cache.match(request);
	const refresh = fetch(request)
		.then((response) => {
			if (response.ok) cache.put(request, response.clone());
			return response;
		})
		.catch(() => cached);
	return cached || refresh;
}

/** Drops the oldest entries so superseded asset bundles don't pile up. */
async function trim(cache, limit) {
	const keys = await cache.keys();
	for (let index = 0; index < keys.length - limit; index++) {
		await cache.delete(keys[index]);
	}
}

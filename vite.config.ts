import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_TARGET = "http://localhost:8787";

/**
 * "/login" and "/downloads" are API prefixes *and* client-side page routes.
 * Only sub-paths — plus POST /login, which is the sign-in call — are API
 * requests; a bare GET is a page load and has to fall through to the SPA, or
 * the browser is handed raw API JSON instead of the app.
 *
 * `scripts/serve-dist.ts` already makes this split for production. Without the
 * same split here, /login and /downloads are broken in dev only, both directly
 * on the Vite port and through the dev gateway that forwards to it.
 */
function apiProxy(basePath: string, apiMethodsOnBasePath: string[] = []) {
	return {
		target: API_TARGET,
		changeOrigin: true,
		bypass(req: { url?: string; method?: string }): string | undefined {
			const pathname = (req.url ?? "").split("?")[0];
			// Anything nested under the prefix is unambiguously an API call.
			if (pathname.startsWith(`${basePath}/`)) return undefined;
			if (pathname === basePath && apiMethodsOnBasePath.includes(req.method ?? "")) {
				return undefined;
			}
			// Serve the app shell; React Router takes it from there.
			return "/index.html";
		},
	};
}

export default defineConfig({
	plugins: [react()],
	root: "src/mainview",
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src/mainview"),
			shared: path.resolve(__dirname, "shared"),
		},
	},
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			"/login": apiProxy("/login", ["POST"]),
			"/downloads": apiProxy("/downloads"),
			// These are API-only prefixes, so they never collide with a page.
			"/api/status": { target: API_TARGET, changeOrigin: true },
			"/api/razorpay": { target: API_TARGET, changeOrigin: true },
			"/whatsapp": { target: API_TARGET, changeOrigin: true },
		},
	},
});

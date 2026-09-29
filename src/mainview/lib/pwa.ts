import { isBundledElectrobunRuntime } from "@/lib/electrobun";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";

/**
 * Progressive Web App support: registers /sw.js (production web only), offers a
 * reload when a new version is ready, and exposes the browser's install prompt.
 */

interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let installEvent: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

function isStandalone(): boolean {
	return (
		window.matchMedia?.("(display-mode: standalone)").matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	);
}

function promptReload(worker: ServiceWorker) {
	toast("A new version of Litecheats is ready.", {
		duration: Number.POSITIVE_INFINITY,
		action: {
			label: "Reload",
			onClick: () => worker.postMessage({ type: "SKIP_WAITING" }),
		},
	});
}

export function registerServiceWorker(): void {
	if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
	// The desktop shell loads bundled files over its own protocol; the dev server has HMR.
	if (!import.meta.env.PROD || isBundledElectrobunRuntime()) return;

	window.addEventListener("beforeinstallprompt", (event) => {
		event.preventDefault();
		installEvent = event as BeforeInstallPromptEvent;
		emit();
	});
	window.addEventListener("appinstalled", () => {
		installEvent = null;
		emit();
		toast.success("Litecheats is installed.");
	});

	window.addEventListener("load", () => {
		void navigator.serviceWorker
			.register("/sw.js", { scope: "/" })
			.then((registration) => {
				if (registration.waiting && navigator.serviceWorker.controller) {
					promptReload(registration.waiting);
				}
				registration.addEventListener("updatefound", () => {
					const worker = registration.installing;
					worker?.addEventListener("statechange", () => {
						// "installed" with an existing controller means an update, not a first install.
						if (worker.state === "installed" && navigator.serviceWorker.controller) {
							promptReload(worker);
						}
					});
				});
				// Look for a new version whenever the app comes back to the foreground.
				document.addEventListener("visibilitychange", () => {
					if (document.visibilityState === "visible") void registration.update();
				});
			})
			.catch((error) => console.warn("[pwa] service worker registration failed", error));

		let reloading = false;
		navigator.serviceWorker.addEventListener("controllerchange", () => {
			if (reloading) return;
			reloading = true;
			window.location.reload();
		});
	});
}

/** Whether the browser currently offers to install the app, and a function to show that prompt. */
export function useInstallPrompt(): { canInstall: boolean; install: () => Promise<void> } {
	const available = useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => installEvent !== null && !isStandalone(),
		() => false,
	);

	return {
		canInstall: available,
		install: async () => {
			const event = installEvent;
			if (!event) return;
			await event.prompt();
			await event.userChoice.catch(() => undefined);
			installEvent = null;
			emit();
		},
	};
}

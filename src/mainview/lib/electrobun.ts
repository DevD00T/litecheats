import { Electroview } from "electrobun/view";
import type { MainRPC } from "shared/rpc";

const rpc = Electroview.defineRPC<MainRPC>({
	maxRequestTime: 20000,
	handlers: {
		requests: {},
		messages: {},
	},
});

type ElectrobunBridge = {
	rpc?: typeof rpc;
};

function hasElectrobunRuntimeBridge(): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	const hostWindow = window as Window & { __electrobun?: unknown };
	return Boolean(hostWindow.__electrobun);
}

export function isBundledElectrobunRuntime(): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	const protocol = window.location.protocol.toLowerCase();
	const isWebProtocol = protocol === "http:" || protocol === "https:";
	const hostWindow = window as Window & { __electrobun?: unknown };
	const userAgent = navigator.userAgent.toLowerCase();
	const isDesktopShellAgent =
		userAgent.includes("electrobun") ||
		userAgent.includes("electron") ||
		userAgent.includes("appbun");

	return !isWebProtocol || Boolean(hostWindow.__electrobun) || isDesktopShellAgent;
}

export const electrobun: ElectrobunBridge = hasElectrobunRuntimeBridge()
	? new Electroview({ rpc })
	: { rpc: undefined };

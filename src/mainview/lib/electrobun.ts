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

export const electrobun: ElectrobunBridge = hasElectrobunRuntimeBridge()
	? new Electroview({ rpc })
	: { rpc: undefined };

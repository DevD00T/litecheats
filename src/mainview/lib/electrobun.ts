import { Electroview } from "electrobun/view";
import type { MainRPC } from "shared/rpc";

const rpc = Electroview.defineRPC<MainRPC>({
	maxRequestTime: 20000,
	handlers: {
		requests: {},
		messages: {},
	},
});

export const electrobun = new Electroview({ rpc });

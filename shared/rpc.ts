// RPC type definitions for main process <-> webview communication
// This file defines the contract for typed RPC between Electrobun main and webview

import type { RPCSchema } from "electrobun";

export interface ContactInquiryPayload {
	fullName: string;
	email: string;
	company: string;
	projectScope: string;
}

export interface ContactInquiryResult {
	id: string;
}

export type MainRPC = {
	bun: RPCSchema<{
		requests: {
			ping: {
				params: Record<string, never>;
				response: string;
			};
			getGreeting: {
				params: Record<string, never>;
				response: string;
			};
			sendContactInquiry: {
				params: ContactInquiryPayload;
				response: ContactInquiryResult;
			};
		};
		messages: {
			log: { msg: string };
		};
	}>;
	webview: RPCSchema<{
		requests: Record<string, never>;
		messages: Record<string, never>;
	}>;
};

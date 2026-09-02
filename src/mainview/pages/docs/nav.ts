export interface DocNavItem {
	label: string;
	to: string;
}

export interface DocNavGroup {
	group: string;
	items: DocNavItem[];
}

export const docNavGroups: DocNavGroup[] = [
	{
		group: "Getting started",
		items: [
			{ label: "Quickstart", to: "quickstart" },
			{ label: "Authentication", to: "authentication" },
			{ label: "Scopes & tokens", to: "scopes" },
			{ label: "Errors", to: "errors" },
		],
	},
	{
		group: "Telemetry",
		items: [
			{ label: "Stream telemetry", to: "telemetry/stream" },
			{ label: "Snapshot", to: "telemetry/snapshot" },
			{ label: "Message reference", to: "telemetry/messages" },
		],
	},
	{
		group: "Control",
		items: [
			{ label: "Send command", to: "control/command" },
			{ label: "Set mode", to: "control/mode" },
			{ label: "Upload mission", to: "control/mission" },
		],
	},
	{
		group: "Archive",
		items: [
			{ label: "List logs", to: "archive/logs" },
			{ label: "Download artifact", to: "archive/artifacts" },
			{ label: "Analysis jobs", to: "archive/jobs" },
		],
	},
	{
		group: "SDKs",
		items: [
			{ label: "Python", to: "sdks/python" },
			{ label: "TypeScript", to: "sdks/typescript" },
			{ label: "ROS 2 bridge", to: "sdks/ros2" },
		],
	},
];

export const docNavFlat: DocNavItem[] = docNavGroups.flatMap((group) => group.items);

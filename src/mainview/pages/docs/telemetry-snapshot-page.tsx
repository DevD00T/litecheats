import {
	Callout,
	CodeGrid,
	CodeWindow,
	DocHeader,
	DocPager,
	DocSection,
	EndpointKicker,
	ParamsTable,
} from "./doc-ui";

export function TelemetrySnapshotPage() {
	return (
		<>
			<DocHeader
				kicker={<EndpointKicker method="GET" path="/v1/vehicles/{sysid}/telemetry/snapshot" />}
				title="Read a telemetry snapshot"
				description="A single-shot poll: the latest decoded value RDOS holds for each subscribed message, with no persistent connection. Built for dashboards that refresh on an interval rather than staying open, and for health checks."
			/>

			<CodeGrid>
				<CodeWindow label="Request">
					<div>
						curl{" "}
						<span className="text-secondary">
							https://api.rdos.litecheats.in/v1/vehicles/114/telemetry/snapshot
						</span>{" "}
						\
					</div>
					<div>
						{"  "}-H <span className="text-warning">"Authorization: Bearer $RDOS_TOKEN"</span>
					</div>
				</CodeWindow>
				<CodeWindow label="200 · application/json" tone="success" meta="cached ≤1s">
					<div>{"{"}</div>
					<div>
						{"  "}
						<span className="text-primary">"sysid"</span>: 114,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"as_of"</span>:{" "}
						<span className="text-warning">"2026-08-31T09:42:18.114Z"</span>,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"link"</span>: <span className="text-warning">"up"</span>
						,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"messages"</span>: {"{"}
					</div>
					<div>
						{"    "}
						<span className="text-warning">"GLOBAL_POSITION_INT"</span>: {"{ "}
						<span className="text-primary">"relative_alt"</span>: 118400 {"}"},
					</div>
					<div>
						{"    "}
						<span className="text-warning">"BATTERY_STATUS"</span>: {"{ "}
						<span className="text-primary">"remaining"</span>: 68 {"}"},
					</div>
					<div>
						{"    "}
						<span className="text-warning">"SYS_STATUS"</span>: {"{ "}
						<span className="text-primary">"ekf_ok"</span>: true {"}"}
					</div>
					<div>{"  }"}</div>
					<div>{"}"}</div>
				</CodeWindow>
			</CodeGrid>

			<DocSection title="Query parameters">
				<ParamsTable
					rows={[
						{
							n: "msgs",
							t: "string[]",
							d: "Comma-separated message names to include. Omit to get every message currently cached.",
						},
						{
							n: "max_age",
							t: "integer",
							d: "Reject (410 gone) if the cached value is older than this many seconds. Defaults to unlimited.",
						},
					]}
				/>
			</DocSection>

			<Callout tone="primary" title="Snapshot vs. stream">
				A snapshot never opens a connection to the vehicle — it reads whatever the router already
				has cached from the live link. Use it for a page that polls every few seconds; use{" "}
				<code className="font-code text-primary">GET /telemetry</code> (Stream telemetry) for
				anything that needs frame-by-frame updates.
			</Callout>

			<DocPager />
		</>
	);
}

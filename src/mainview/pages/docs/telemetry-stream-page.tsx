import {
	Callout,
	CodeGrid,
	CodeWindow,
	DocHeader,
	DocPager,
	DocSection,
	EndpointKicker,
	EndpointList,
	ParamsTable,
} from "./doc-ui";

export function TelemetryStreamPage() {
	return (
		<>
			<DocHeader
				kicker={<EndpointKicker method="GET" path="/v1/vehicles/{sysid}/telemetry" />}
				title="Stream live telemetry"
				description="Opens a server-sent event stream of decoded MAVLink messages for one vehicle. Every frame carries the original message id, the cloud receive timestamp and the autopilot boot time, so you can re-align against a downloaded log later."
			/>

			<CodeGrid>
				<CodeWindow label="Request">
					<div>
						curl -N <span className="text-secondary">https://api.rdos.litecheats.in</span> \
					</div>
					<div>
						{"  "}
						<span className="text-secondary">/v1/vehicles/114/telemetry</span> \
					</div>
					<div>
						{"  "}-H <span className="text-warning">"Authorization: Bearer $RDOS_TOKEN"</span> \
					</div>
					<div>
						{"  "}-H <span className="text-warning">"Accept: text/event-stream"</span> \
					</div>
					<div>
						{"  "}--data-urlencode{" "}
						<span className="text-warning">"msgs=ATTITUDE,GLOBAL_POSITION_INT"</span> \
					</div>
					<div>
						{"  "}--data-urlencode <span className="text-warning">"rate=10"</span>
					</div>
				</CodeWindow>
				<CodeWindow label="200 · text/event-stream" tone="success" meta="first byte 21 ms">
					<div>
						<span className="text-muted-foreground/60">event:</span> mavlink
					</div>
					<div>
						<span className="text-muted-foreground/60">data:</span> {"{"}
					</div>
					<div>
						{"  "}
						<span className="text-primary">"msgid"</span>: 33,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"name"</span>:{" "}
						<span className="text-warning">"GLOBAL_POSITION_INT"</span>,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"t_boot_ms"</span>: 2814402,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"t_cloud"</span>:{" "}
						<span className="text-warning">"2026-08-31T09:42:18.114Z"</span>,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"lat"</span>: 129041100,{" "}
						<span className="text-primary">"lon"</span>: 776134400,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"relative_alt"</span>: 118400
					</div>
					<div>{"}"}</div>
				</CodeWindow>
			</CodeGrid>

			<DocSection title="Query parameters">
				<ParamsTable
					rows={[
						{
							n: "msgs",
							t: "string[]",
							d: "Comma-separated MAVLink message names to subscribe to. Omit for the default set of 9 messages.",
						},
						{
							n: "rate",
							t: "integer",
							d: "Requested delivery rate in Hz, 1–50. The router downsamples; it never asks the vehicle to change its stream rates.",
						},
						{
							n: "since",
							t: "RFC 3339",
							d: "Replay buffered frames from this instant before switching to live. Buffer holds 5 minutes.",
						},
						{
							n: "format",
							t: "enum",
							d: "sse (default) or ndjson. Both carry identical payloads.",
						},
						{
							n: "raw",
							t: "boolean",
							d: "Include the original base64 MAVLink frame alongside the decoded fields. Doubles bandwidth.",
						},
					]}
				/>
			</DocSection>

			<DocSection title="Other endpoints">
				<EndpointList
					items={[
						{ m: "GET", path: "/v1/vehicles", desc: "List fleet", tone: "success" },
						{ m: "GET", path: "/v1/vehicles/{sysid}", desc: "Vehicle detail", tone: "success" },
						{ m: "POST", path: "/v1/vehicles/{sysid}/command", desc: "MAV_CMD", tone: "primary" },
						{
							m: "POST",
							path: "/v1/vehicles/{sysid}/mode",
							desc: "Set flight mode",
							tone: "primary",
						},
						{
							m: "PUT",
							path: "/v1/vehicles/{sysid}/mission",
							desc: "Upload plan",
							tone: "warning",
						},
						{ m: "GET", path: "/v1/logs", desc: "Search archive", tone: "success" },
						{ m: "GET", path: "/v1/logs/{id}/artifacts/{fmt}", desc: "Download", tone: "success" },
						{ m: "POST", path: "/v1/jobs/decode", desc: "Queue analysis", tone: "primary" },
					]}
				/>
			</DocSection>

			<Callout tone="warning" title="Rate limits & command safety">
				Read endpoints allow 600 req/min per token. Any endpoint that writes to a vehicle —{" "}
				<code className="font-code text-warning">/command</code>,{" "}
				<code className="font-code text-warning">/mission</code>,{" "}
				<code className="font-code text-warning">/mode</code> — requires a token with the{" "}
				<code className="font-code text-warning">vehicle:control</code> scope and is recorded in the
				organisation audit log with the caller identity.
			</Callout>

			<DocPager />
		</>
	);
}

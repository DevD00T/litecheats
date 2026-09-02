import {
	CodeGrid,
	CodeWindow,
	DocHeader,
	DocPager,
	DocSection,
	EndpointKicker,
	ParamsTable,
} from "./doc-ui";

export function ArchiveLogsPage() {
	return (
		<>
			<DocHeader
				kicker={<EndpointKicker method="GET" path="/v1/logs" />}
				title="Search the log archive"
				description="Every raw MAVLink/MSP frame RDOS routes is archived — not just the decoded fields you see in the stream. Retention is 24 months by default, and every log is searchable by vehicle, date range and flight outcome."
			/>

			<CodeGrid>
				<CodeWindow label="Request">
					<div>
						curl{" "}
						<span className="text-secondary">
							"https://api.rdos.litecheats.in/v1/logs?vehicle=114&from=2026-08-01"
						</span>{" "}
						\
					</div>
					<div>
						{"  "}-H <span className="text-warning">"Authorization: Bearer $RDOS_TOKEN"</span>
					</div>
				</CodeWindow>
				<CodeWindow label="200 · application/json" tone="success">
					<div>{"{"}</div>
					<div>
						{"  "}
						<span className="text-primary">"logs"</span>: [
					</div>
					<div>{"    {"}</div>
					<div>
						{"      "}
						<span className="text-primary">"id"</span>:{" "}
						<span className="text-warning">"log_9c31f"</span>,
					</div>
					<div>
						{"      "}
						<span className="text-primary">"vehicle"</span>: 114,
					</div>
					<div>
						{"      "}
						<span className="text-primary">"duration_s"</span>: 1842,
					</div>
					<div>
						{"      "}
						<span className="text-primary">"outcome"</span>:{" "}
						<span className="text-warning">"landed"</span>
					</div>
					<div>{"    }"}</div>
					<div>{"  ]"}</div>
					<div>{"}"}</div>
				</CodeWindow>
			</CodeGrid>

			<DocSection title="Query parameters">
				<ParamsTable
					rows={[
						{
							n: "vehicle",
							t: "integer",
							d: "Filter to a single sysid. Omit to search the whole org.",
						},
						{
							n: "from",
							t: "RFC 3339",
							d: "Only logs whose flight started on or after this instant.",
						},
						{
							n: "to",
							t: "RFC 3339",
							d: "Only logs whose flight started on or before this instant.",
						},
						{
							n: "outcome",
							t: "enum",
							d: "landed, aborted, crashed, in_progress. Useful for pulling every crash for review.",
						},
						{ n: "limit", t: "integer", d: "Page size, 1–100. Defaults to 25." },
						{ n: "cursor", t: "string", d: "Opaque pagination cursor from the previous response." },
					]}
				/>
			</DocSection>

			<DocPager />
		</>
	);
}

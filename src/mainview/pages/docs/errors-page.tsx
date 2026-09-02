import {
	Callout,
	CodeWindow,
	DocHeader,
	DocPager,
	DocSection,
	DocTable,
	GuideKicker,
} from "./doc-ui";

export function ErrorsPage() {
	return (
		<>
			<DocHeader
				kicker={<GuideKicker label="Guide" />}
				title="Errors"
				description="Every error uses the same envelope and a stable machine-readable code, whatever the HTTP status happens to be. Log the request_id — support can trace a single call across the router, the archive and the agent from it."
			/>

			<DocSection title="Error envelope">
				<CodeWindow label="Any 4xx / 5xx" tone="destructive">
					<div>{"{"}</div>
					<div>
						{"  "}
						<span className="text-primary">"error"</span>: {"{"}
					</div>
					<div>
						{"    "}
						<span className="text-primary">"code"</span>:{" "}
						<span className="text-warning">"vehicle_offline"</span>,
					</div>
					<div>
						{"    "}
						<span className="text-primary">"message"</span>:{" "}
						<span className="text-warning">"Vehicle 114 has no active link."</span>,
					</div>
					<div>
						{"    "}
						<span className="text-primary">"request_id"</span>:{" "}
						<span className="text-warning">"req_3f9a1c"</span>
					</div>
					<div>{"  }"}</div>
					<div>{"}"}</div>
				</CodeWindow>
			</DocSection>

			<DocSection title="Common codes">
				<DocTable
					head={["HTTP", "code", "Meaning"]}
					rows={[
						[
							"400",
							<code key="1" className="font-code text-secondary">
								mission_invalid
							</code>,
							"Uploaded plan failed geofence or waypoint-order validation",
						],
						[
							"401",
							<code key="2" className="font-code text-secondary">
								invalid_token
							</code>,
							"Missing, malformed, expired or revoked bearer token",
						],
						[
							"403",
							<code key="3" className="font-code text-secondary">
								invalid_scope
							</code>,
							"Token is valid but lacks the scope this endpoint requires",
						],
						[
							"403",
							<code key="4" className="font-code text-secondary">
								signing_required
							</code>,
							"Vehicle has require-signing on and the caller isn't enrolled",
						],
						[
							"404",
							<code key="5" className="font-code text-secondary">
								vehicle_not_found
							</code>,
							"sysid doesn't exist, or isn't visible to this org",
						],
						[
							"409",
							<code key="6" className="font-code text-secondary">
								vehicle_offline
							</code>,
							"No active MAVLink link for a command or mission endpoint",
						],
						[
							"422",
							<code key="7" className="font-code text-secondary">
								unsupported_command
							</code>,
							"MAV_CMD isn't implemented by the connected autopilot",
						],
						[
							"429",
							<code key="8" className="font-code text-secondary">
								rate_limited
							</code>,
							"Over the per-token request budget — see Retry-After",
						],
						[
							"500",
							<code key="9" className="font-code text-secondary">
								router_error
							</code>,
							"Unexpected failure inside RDOS itself; safe to retry",
						],
					]}
				/>
			</DocSection>

			<DocSection title="Retries and idempotency">
				<p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
					<code className="font-code text-secondary">GET</code> requests are always safe to retry.
					For <code className="font-code text-secondary">POST /command</code>, pass an{" "}
					<code className="font-code text-secondary">idempotency_key</code> — if the same key is
					replayed within 5 minutes, RDOS returns the original{" "}
					<code className="font-code text-secondary">COMMAND_ACK</code> instead of sending the
					command twice. This matters most on a flaky LTE link where the response, not the command,
					is what got lost.
				</p>
			</DocSection>

			<Callout tone="warning" title="429 rate_limited">
				Read endpoints allow 600 req/min per token; back off using the{" "}
				<code className="font-code text-warning">Retry-After</code> header rather than a fixed
				delay. Write endpoints (<code className="font-code text-warning">/command</code>,{" "}
				<code className="font-code text-warning">/mission</code>,{" "}
				<code className="font-code text-warning">/mode</code>) have their own, tighter budget per
				vehicle to keep a busy script from saturating the link to the aircraft.
			</Callout>

			<DocPager />
		</>
	);
}

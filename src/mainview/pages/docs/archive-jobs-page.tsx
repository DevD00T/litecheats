import {
	Callout,
	CodeGrid,
	CodeWindow,
	DocHeader,
	DocPager,
	DocSection,
	DocTable,
	EndpointKicker,
	ParamsTable,
} from "./doc-ui";

export function ArchiveJobsPage() {
	return (
		<>
			<DocHeader
				kicker={<EndpointKicker method="POST" path="/v1/jobs/decode" />}
				title="Queue an analysis job"
				description="Runs FFT-driven noise and motor-health analysis against a stored flight and, for PID tuning jobs, suggests filter and gain values you can review before writing them to the vehicle. AI-assisted analyses require an org-level Groq key; the mechanical analyses run without one."
			/>

			<CodeGrid>
				<CodeWindow label="Request">
					<div>curl -X POST \</div>
					<div>
						{"  "}
						<span className="text-secondary">https://api.rdos.litecheats.in/v1/jobs/decode</span> \
					</div>
					<div>
						{"  "}-H <span className="text-warning">"Authorization: Bearer $RDOS_TOKEN"</span> \
					</div>
					<div>
						{"  "}-H <span className="text-warning">"Content-Type: application/json"</span> \
					</div>
					<div>
						{"  "}-d{" "}
						<span className="text-warning">
							{'\'{"log_id":"log_9c31f","analysis":"pid_tuning"}\''}
						</span>
					</div>
				</CodeWindow>
				<CodeWindow label="202 · application/json" tone="success">
					<div>{"{"}</div>
					<div>
						{"  "}
						<span className="text-primary">"job_id"</span>:{" "}
						<span className="text-warning">"job_4b71"</span>,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"status"</span>:{" "}
						<span className="text-warning">"queued"</span>,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"eta_s"</span>: 40
					</div>
					<div>{"}"}</div>
				</CodeWindow>
			</CodeGrid>

			<DocSection title="Body parameters">
				<ParamsTable
					rows={[
						{
							n: "log_id",
							t: "string",
							d: "Archive log id from GET /v1/logs to run the analysis against.",
						},
						{
							n: "analysis",
							t: "enum",
							d: "pid_tuning, vibration, or motor_health. Each returns a different result shape.",
						},
					]}
				/>
			</DocSection>

			<DocSection title="Polling for the result">
				<CodeWindow label="GET /v1/jobs/{id}" meta="poll every 3-5s">
					<div>
						curl{" "}
						<span className="text-secondary">https://api.rdos.litecheats.in/v1/jobs/job_4b71</span>{" "}
						\
					</div>
					<div>
						{"  "}-H <span className="text-warning">"Authorization: Bearer $RDOS_TOKEN"</span>
					</div>
				</CodeWindow>
			</DocSection>

			<DocSection title="What each analysis returns">
				<DocTable
					head={["analysis", "Returns"]}
					rows={[
						[
							"pid_tuning",
							"Suggested rate and stabilize PID gains, plus the filter cutoffs the suggestion assumes",
						],
						[
							"vibration",
							"Per-axis FFT peaks, a clip-count, and whether values exceed the airframe's safe band",
						],
						[
							"motor_health",
							"Per-motor RPM variance and imbalance score, flagging any motor trending toward failure",
						],
					]}
				/>
			</DocSection>

			<Callout tone="warning" title="Suggestions, not writes">
				A completed job never touches the vehicle's parameters on its own. Review the suggested
				values in the console's PID panel and write them explicitly — treat this endpoint as a
				second opinion, not an autotune.
			</Callout>

			<DocPager />
		</>
	);
}

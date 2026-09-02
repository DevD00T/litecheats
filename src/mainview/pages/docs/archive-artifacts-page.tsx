import {
	Callout,
	CodeGrid,
	CodeWindow,
	DocHeader,
	DocPager,
	DocSection,
	DocTable,
	EndpointKicker,
} from "./doc-ui";

export function ArchiveArtifactsPage() {
	return (
		<>
			<DocHeader
				kicker={<EndpointKicker method="GET" path="/v1/logs/{id}/artifacts/{fmt}" />}
				title="Download an artifact"
				description="Every stored flight can be exported in the format your existing tools already read — the raw router capture, or a format built for a specific ground station or analysis tool."
			/>

			<CodeGrid>
				<CodeWindow label="Request">
					<div>
						curl -L{" "}
						<span className="text-secondary">
							https://api.rdos.litecheats.in/v1/logs/log_9c31f/artifacts/tlog
						</span>{" "}
						\
					</div>
					<div>
						{"  "}-H <span className="text-warning">"Authorization: Bearer $RDOS_TOKEN"</span> \
					</div>
					<div>{"  "}-o flight-114.tlog</div>
				</CodeWindow>
				<CodeWindow label="302 · redirect" tone="success" meta="signed URL, 10 min TTL">
					<div>
						<span className="text-muted-foreground/60">location:</span>{" "}
						https://archive.rdos.litecheats.in/…/flight-114.tlog?sig=…
					</div>
				</CodeWindow>
			</CodeGrid>

			<DocSection title="Supported formats">
				<DocTable
					head={["fmt", "Contains", "Opens in"]}
					rows={[
						[
							<code key="1" className="font-code text-secondary">
								tlog
							</code>,
							"Raw MAVLink frames, RDOS's native capture",
							"QGroundControl, Mission Planner",
						],
						[
							<code key="2" className="font-code text-secondary">
								bin
							</code>,
							"ArduPilot dataflash-style log, re-encoded from the capture",
							"Mission Planner, MAVExplorer",
						],
						[
							<code key="3" className="font-code text-secondary">
								ulog
							</code>,
							"PX4 ulog format",
							"PX4 Flight Review, plotjuggler",
						],
						[
							<code key="4" className="font-code text-secondary">
								csv
							</code>,
							"Flattened, one row per decoded message",
							"Spreadsheets, pandas",
						],
					]}
				/>
			</DocSection>

			<Callout tone="primary" title="Signed URLs, not proxied bytes">
				The API responds with a redirect to a short-lived signed URL on the archive host rather than
				streaming the file itself — large captures download directly from storage, and the link
				expires whether or not it was used.
			</Callout>

			<DocPager />
		</>
	);
}

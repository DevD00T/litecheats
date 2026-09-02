import { Callout, CodeWindow, DocHeader, DocPager, DocSection, GuideKicker } from "./doc-ui";

export function SdkPythonPage() {
	return (
		<>
			<DocHeader
				kicker={<GuideKicker label="SDK" />}
				title="Python"
				description="A thin wrapper over the REST and SSE endpoints — no MAVLink parsing of your own to write. Good fit for ground-side scripts, Jupyter analysis of a downloaded log, or a bridge into an existing pymavlink pipeline."
			/>

			<DocSection title="Install">
				<CodeWindow label="shell">
					<div>pip install rdos</div>
				</CodeWindow>
			</DocSection>

			<DocSection title="Stream telemetry and react to it">
				<CodeWindow label="python" tone="warning">
					<div>
						<span className="text-secondary">from</span> rdos{" "}
						<span className="text-secondary">import</span> Client
					</div>
					<div />
					<div>
						client = Client(token=<span className="text-warning">"$RDOS_TOKEN"</span>)
					</div>
					<div>vehicle = client.vehicle(114)</div>
					<div />
					<div>
						<span className="text-secondary">for</span> frame{" "}
						<span className="text-secondary">in</span> vehicle.stream(msgs=[
						<span className="text-warning">"GLOBAL_POSITION_INT"</span>,{" "}
						<span className="text-warning">"BATTERY_STATUS"</span>]):
					</div>
					<div>
						{"    "}
						<span className="text-secondary">if</span> frame.name ==
						<span className="text-warning"> "BATTERY_STATUS"</span> and frame.remaining &lt; 20:
					</div>
					<div>
						{"        "}vehicle.command(
						<span className="text-warning">"MAV_CMD_NAV_RETURN_TO_LAUNCH"</span>)
					</div>
					<div>
						{"        "}
						<span className="text-secondary">break</span>
					</div>
				</CodeWindow>
			</DocSection>

			<DocSection title="Analyze a downloaded log">
				<CodeWindow label="python" tone="warning">
					<div>
						<span className="text-secondary">from</span> rdos{" "}
						<span className="text-secondary">import</span> Client
					</div>
					<div />
					<div>
						client = Client(token=<span className="text-warning">"$RDOS_TOKEN"</span>)
					</div>
					<div>
						log = client.logs.search(vehicle=114, outcome=
						<span className="text-warning">"landed"</span>)[
						<span className="text-primary">0</span>]
					</div>
					<div>
						path = client.logs.download(log.id, fmt=<span className="text-warning">"bin"</span>)
					</div>
				</CodeWindow>
			</DocSection>

			<Callout tone="primary" title="Sync client, async under the hood">
				The public API is synchronous for scripting convenience;{" "}
				<code className="font-code text-primary">Client.stream()</code> is a generator backed by an
				async SSE reader, so it won't block your process from handling OS signals while a long-lived
				stream is open.
			</Callout>

			<DocPager />
		</>
	);
}

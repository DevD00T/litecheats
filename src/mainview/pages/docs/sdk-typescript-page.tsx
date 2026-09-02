import { Callout, CodeWindow, DocHeader, DocPager, DocSection, GuideKicker } from "./doc-ui";

export function SdkTypescriptPage() {
	return (
		<>
			<DocHeader
				kicker={<GuideKicker label="SDK" />}
				title="TypeScript"
				description="A typed client for both Node and the browser. It wraps EventSource for streaming in the browser and falls back to a Node-friendly SSE reader server-side, so the same code runs in a dashboard and a backend job."
			/>

			<DocSection title="Install">
				<CodeWindow label="shell">
					<div>npm install @rdos/sdk</div>
				</CodeWindow>
			</DocSection>

			<DocSection title="Stream telemetry into a store">
				<CodeWindow label="typescript" tone="warning">
					<div>
						<span className="text-secondary">import</span> {"{ RdosClient }"}{" "}
						<span className="text-secondary">from</span>{" "}
						<span className="text-warning">"@rdos/sdk"</span>
						{";"}
					</div>
					<div />
					<div>
						<span className="text-secondary">const</span> client ={" "}
						<span className="text-secondary">new</span> RdosClient({"{ "}token:
						process.env.RDOS_TOKEN{" }"}
						);
					</div>
					<div>
						<span className="text-secondary">const</span> vehicle = client.vehicle(
						<span className="text-primary">114</span>);
					</div>
					<div />
					<div>
						vehicle.stream({"{ "}msgs: [<span className="text-warning">"ATTITUDE"</span>,{" "}
						<span className="text-warning">"GLOBAL_POSITION_INT"</span>], rate:{" "}
						<span className="text-primary">10</span>
						{" }"}).on(<span className="text-warning">"frame"</span>, (frame) =&gt; {"{"}
					</div>
					<div>{"  "}telemetryStore.setState(frame.name, frame);</div>
					<div>{"});"}</div>
				</CodeWindow>
			</DocSection>

			<DocSection title="Send a signed command">
				<CodeWindow label="typescript" tone="warning">
					<div>
						<span className="text-secondary">await</span> vehicle.command({"{"}
					</div>
					<div>
						{"  "}command: <span className="text-warning">"MAV_CMD_COMPONENT_ARM_DISARM"</span>,
					</div>
					<div>{"  params: [1, 0],"}</div>
					<div>
						{"  "}idempotencyKey: <span className="text-warning">crypto.randomUUID()</span>,
					</div>
					<div>{"});"}</div>
				</CodeWindow>
			</DocSection>

			<Callout tone="primary" title="Same client, browser or server">
				In the browser, <code className="font-code text-primary">RdosClient</code> can also hold the
				non-extractable Web Crypto signing key for MAVLink command signing — pass{" "}
				<code className="font-code text-primary">{"{ signing: true }"}</code> and the SDK handles
				key generation and <code className="font-code text-primary">SETUP_SIGNING</code> enrollment
				for you.
			</Callout>

			<DocPager />
		</>
	);
}

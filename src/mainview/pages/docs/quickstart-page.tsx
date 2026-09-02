import { Link } from "react-router-dom";
import {
	Callout,
	CodeGrid,
	CodeWindow,
	DocHeader,
	DocPager,
	DocSection,
	DocTable,
	GuideKicker,
	StepGrid,
} from "./doc-ui";

export function QuickstartPage() {
	return (
		<>
			<DocHeader
				kicker={<GuideKicker label="Guide" />}
				title="Quickstart"
				description={
					<>
						RDOS is a managed MAVLink router with a REST + streaming API in front of it. This page
						gets a token issued, a vehicle connected and a telemetry frame on your screen in about
						five minutes — no firmware changes and no VPN.
					</>
				}
			/>

			<DocSection title="Four steps, one vehicle">
				<StepGrid
					steps={[
						{
							n: "01",
							title: "Create a token",
							body: (
								<>
									Sign up, then open{" "}
									<code className="font-code text-secondary">Account → API tokens</code> and
									generate a personal access token. Pick scopes — start with{" "}
									<code className="font-code text-secondary">vehicle:read</code>.
								</>
							),
							meta: "dashboard · one click",
						},
						{
							n: "02",
							title: "Connect a vehicle",
							body: "Point an autopilot, a bench SITL instance, or an RDOS-compatible agent at the router. Three transports, pick whichever matches your hardware.",
							meta: "MAVLink v2",
						},
						{
							n: "03",
							title: "Call the API",
							body: "The vehicle shows up in your fleet the moment its first HEARTBEAT lands. List it, then inspect it.",
							meta: "REST · JSON",
						},
						{
							n: "04",
							title: "Go live",
							body: "Open a streaming connection and watch decoded MAVLink frames arrive as they're received, with a five-minute replay buffer behind you.",
							meta: "SSE · WebSocket",
						},
					]}
				/>
			</DocSection>

			<DocSection title="Connect a vehicle">
				<p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
					RDOS speaks plain MAVLink v2 (and MSP for Betaflight/iNav) — there is no proprietary
					firmware fork to flash. Choose the transport that matches where the vehicle actually is:
				</p>
				<div className="mt-3.5">
					<DocTable
						head={["Transport", "Best for", "Setup"]}
						rows={[
							[
								<code key="ws" className="font-code text-secondary">
									MAVLink WebSocket
								</code>,
								"SITL, bench testing, a companion computer already on the same network",
								"Point tools/sitl's bridge, or your own ws:// endpoint, at the router URL",
							],
							[
								<code key="agent" className="font-code text-secondary">
									RDOS agent
								</code>,
								"Field deployments — LTE modem or RF relay carries frames off the vehicle",
								"Install the agent on the companion computer, enroll it with a device token",
							],
							[
								<code key="serial" className="font-code text-secondary">
									WebSerial (console only)
								</code>,
								"A quick USB check from the browser, no cloud round trip",
								"Chrome/Edge 89+, click Connect in the RDOS console, pick the port",
							],
						]}
					/>
				</div>
			</DocSection>

			<DocSection title="List your fleet">
				<CodeGrid>
					<CodeWindow label="Request">
						<div>
							curl{" "}
							<span className="text-secondary">https://api.rdos.litecheats.in/v1/vehicles</span> \
						</div>
						<div>
							{"  "}-H <span className="text-warning">"Authorization: Bearer $RDOS_TOKEN"</span>
						</div>
					</CodeWindow>
					<CodeWindow label="200 · application/json" tone="success">
						<div>{"{"}</div>
						<div>
							{"  "}
							<span className="text-primary">"vehicles"</span>: [
						</div>
						<div>{"    {"}</div>
						<div>
							{"      "}
							<span className="text-primary">"sysid"</span>: 114,
						</div>
						<div>
							{"      "}
							<span className="text-primary">"name"</span>:{" "}
							<span className="text-warning">"RCX-114"</span>,
						</div>
						<div>
							{"      "}
							<span className="text-primary">"autopilot"</span>:{" "}
							<span className="text-warning">"ardupilot"</span>,
						</div>
						<div>
							{"      "}
							<span className="text-primary">"status"</span>:{" "}
							<span className="text-warning">"armed"</span>
						</div>
						<div>{"    }"}</div>
						<div>{"  ]"}</div>
						<div>{"}"}</div>
					</CodeWindow>
				</CodeGrid>
			</DocSection>

			<DocSection title="Base URLs">
				<DocTable
					head={["Environment", "URL", "Notes"]}
					rows={[
						[
							"Production",
							<code key="prod" className="font-code text-secondary">
								https://api.rdos.litecheats.in
							</code>,
							"ap-south-1 (Mumbai), single region",
						],
						[
							"Local dev",
							<code key="local" className="font-code text-secondary">
								http://localhost:4000
							</code>,
							"Run tools/sitl for a simulated vehicle, no token required",
						],
					]}
				/>
			</DocSection>

			<Callout tone="primary" title="Next: authentication and scopes">
				Every non-trivial call needs a bearer token, and write endpoints need the right scope. See{" "}
				<Link to="/docs/authentication" className="font-semibold underline underline-offset-2">
					Authentication
				</Link>{" "}
				and{" "}
				<Link to="/docs/scopes" className="font-semibold underline underline-offset-2">
					Scopes &amp; tokens
				</Link>
				.
			</Callout>

			<DocPager />
		</>
	);
}

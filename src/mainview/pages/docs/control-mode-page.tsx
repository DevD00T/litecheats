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

export function ControlModePage() {
	return (
		<>
			<DocHeader
				kicker={<EndpointKicker method="POST" path="/v1/vehicles/{sysid}/mode" />}
				title="Set flight mode"
				description="Requests a flight-mode change using the mode name for whichever firmware the vehicle runs. RDOS translates the name into the right MAVLink base_mode/custom_mode pair, or the equivalent MSP_SET_MODE flags for Betaflight/iNav."
			/>

			<CodeGrid>
				<CodeWindow label="Request">
					<div>curl -X POST \</div>
					<div>
						{"  "}
						<span className="text-secondary">
							https://api.rdos.litecheats.in/v1/vehicles/114/mode
						</span>{" "}
						\
					</div>
					<div>
						{"  "}-H <span className="text-warning">"Authorization: Bearer $RDOS_TOKEN"</span> \
					</div>
					<div>
						{"  "}-H <span className="text-warning">"Content-Type: application/json"</span> \
					</div>
					<div>
						{"  "}-d <span className="text-warning">{'\'{"mode":"GUIDED"}\''}</span>
					</div>
				</CodeWindow>
				<CodeWindow label="200 · application/json" tone="success">
					<div>{"{"}</div>
					<div>
						{"  "}
						<span className="text-primary">"mode"</span>:{" "}
						<span className="text-warning">"GUIDED"</span>,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"custom_mode"</span>: 4,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"result"</span>:{" "}
						<span className="text-warning">"MAV_RESULT_ACCEPTED"</span>
					</div>
					<div>{"}"}</div>
				</CodeWindow>
			</CodeGrid>

			<DocSection title="Mode names by firmware">
				<p className="mb-3 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
					Send the mode name a pilot would recognise from that firmware's own ground station — RDOS
					handles the mapping to the numeric flag the autopilot actually expects.
				</p>
				<DocTable
					head={["Autopilot", "Protocol", "Example modes"]}
					rows={[
						["ArduPilot", "MAVLink v2", "STABILIZE, LOITER, GUIDED, AUTO, RTL, LAND"],
						["PX4", "MAVLink v2", "MANUAL, POSCTL, OFFBOARD, AUTO.MISSION, AUTO.RTL"],
						["Betaflight", "MSP v1/v2", "ANGLE, HORIZON, ACRO, AIR_MODE (as flag toggles)"],
						["iNav", "MSP v1/v2", "ANGLE, HORIZON, NAV_POSHOLD, NAV_RTH, NAV_WP"],
					]}
				/>
			</DocSection>

			<Callout tone="warning" title="Guided flight needs a live link">
				A mode change is a single command, not a standing connection — if you're driving{" "}
				<code className="font-code text-warning">GUIDED</code> setpoints continuously (gamepad or
				HOTAS flight), keep sending them at your control loop rate. RDOS does not hold a vehicle in
				guided mode on your behalf if you stop sending commands.
			</Callout>

			<DocPager />
		</>
	);
}

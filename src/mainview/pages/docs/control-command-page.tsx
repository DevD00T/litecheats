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

export function ControlCommandPage() {
	return (
		<>
			<DocHeader
				kicker={<EndpointKicker method="POST" path="/v1/vehicles/{sysid}/command" />}
				title="Send a command"
				description="Issues a MAV_CMD to the vehicle and waits for the resulting COMMAND_ACK (or MSP equivalent). Requires the vehicle:control scope. If the vehicle has command signing set to require, the frame is rejected unless it was countersigned client-side first."
			/>

			<CodeGrid>
				<CodeWindow label="Request">
					<div>curl -X POST \</div>
					<div>
						{"  "}
						<span className="text-secondary">
							https://api.rdos.litecheats.in/v1/vehicles/114/command
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
						{"  "}-d{" "}
						<span className="text-warning">
							{
								'\'{"command":"MAV_CMD_COMPONENT_ARM_DISARM","params":[1,0],"idempotency_key":"arm-3f9a"}\''
							}
						</span>
					</div>
				</CodeWindow>
				<CodeWindow label="200 · application/json" tone="success">
					<div>{"{"}</div>
					<div>
						{"  "}
						<span className="text-primary">"command"</span>:{" "}
						<span className="text-warning">"MAV_CMD_COMPONENT_ARM_DISARM"</span>,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"result"</span>:{" "}
						<span className="text-warning">"MAV_RESULT_ACCEPTED"</span>,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"signed"</span>: true,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"latency_ms"</span>: 96
					</div>
					<div>{"}"}</div>
				</CodeWindow>
			</CodeGrid>

			<DocSection title="Body parameters">
				<ParamsTable
					rows={[
						{
							n: "command",
							t: "string",
							d: "MAV_CMD enum name, e.g. MAV_CMD_COMPONENT_ARM_DISARM, MAV_CMD_NAV_TAKEOFF.",
						},
						{
							n: "params",
							t: "number[7]",
							d: "Positional MAVLink params 1–7 for the command. Unused trailing params may be omitted.",
						},
						{
							n: "idempotency_key",
							t: "string",
							d: "Replaying the same key within 5 minutes returns the original ack instead of resending.",
						},
					]}
				/>
			</DocSection>

			<DocSection title="Commonly used commands">
				<DocTable
					head={["MAV_CMD", "Effect"]}
					rows={[
						[
							<code key="1" className="font-code text-secondary">
								MAV_CMD_COMPONENT_ARM_DISARM
							</code>,
							"Arm (params[0]=1) or disarm (0) the vehicle",
						],
						[
							<code key="2" className="font-code text-secondary">
								MAV_CMD_NAV_TAKEOFF
							</code>,
							"Initiate takeoff to the altitude in params[6]",
						],
						[
							<code key="3" className="font-code text-secondary">
								MAV_CMD_NAV_RETURN_TO_LAUNCH
							</code>,
							"Return-to-launch, ignores the current mission",
						],
						[
							<code key="4" className="font-code text-secondary">
								MAV_CMD_DO_SET_SERVO
							</code>,
							"Drive a servo channel — payload release, gimbal, camera trigger",
						],
						[
							<code key="5" className="font-code text-secondary">
								MAV_CMD_DO_FLIGHTTERMINATION
							</code>,
							"Kill switch. Requires vehicle:control and is always audit-logged",
						],
					]}
				/>
			</DocSection>

			<Callout tone="destructive" title="422 unsupported_command">
				Not every autopilot implements every MAV_CMD. RDOS forwards the command as-is and surfaces
				whatever <code className="font-code text-destructive">MAV_RESULT</code> the vehicle returns
				— it does not pretend a command succeeded, and it does not simulate one locally.
			</Callout>

			<DocPager />
		</>
	);
}

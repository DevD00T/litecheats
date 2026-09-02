import { Callout, DocHeader, DocPager, DocSection, DocTable, GuideKicker } from "./doc-ui";

export function TelemetryMessagesPage() {
	return (
		<>
			<DocHeader
				kicker={<GuideKicker label="Reference" />}
				title="Message reference"
				description="RDOS decodes 83 MAVLink messages and 65 MSP frames (for Betaflight and iNav) into flat JSON. The table below covers the set most integrations actually subscribe to — the full list is on the reference tab in the console."
			/>

			<DocSection title="Frequently used messages">
				<DocTable
					head={["id", "Name", "Default rate", "Key fields"]}
					rows={[
						[
							"0",
							<code key="1" className="font-code text-secondary">
								HEARTBEAT
							</code>,
							"1 Hz",
							"autopilot, base_mode, custom_mode, system_status",
						],
						[
							"1",
							<code key="2" className="font-code text-secondary">
								SYS_STATUS
							</code>,
							"2 Hz",
							"voltage_battery, ekf_ok, sensor health bitmask",
						],
						[
							"24",
							<code key="3" className="font-code text-secondary">
								GPS_RAW_INT
							</code>,
							"5 Hz",
							"fix_type, satellites_visible, eph, epv",
						],
						[
							"30",
							<code key="4" className="font-code text-secondary">
								ATTITUDE
							</code>,
							"20 Hz",
							"roll, pitch, yaw, rollspeed, pitchspeed, yawspeed",
						],
						[
							"33",
							<code key="5" className="font-code text-secondary">
								GLOBAL_POSITION_INT
							</code>,
							"10 Hz",
							"lat, lon, alt, relative_alt, vx, vy, vz",
						],
						[
							"42",
							<code key="6" className="font-code text-secondary">
								MISSION_CURRENT
							</code>,
							"on change",
							"seq, mission_state",
						],
						[
							"65",
							<code key="7" className="font-code text-secondary">
								RC_CHANNELS
							</code>,
							"5 Hz",
							"chan1_raw … chan18_raw, rssi",
						],
						[
							"74",
							<code key="8" className="font-code text-secondary">
								VFR_HUD
							</code>,
							"4 Hz",
							"airspeed, groundspeed, throttle, climb",
						],
						[
							"147",
							<code key="9" className="font-code text-secondary">
								BATTERY_STATUS
							</code>,
							"2 Hz",
							"voltages[], current_battery, remaining",
						],
						[
							"253",
							<code key="10" className="font-code text-secondary">
								STATUSTEXT
							</code>,
							"on emit",
							"severity, text",
						],
					]}
				/>
			</DocSection>

			<DocSection title="Field naming">
				<p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
					Field names match the MAVLink XML dialect exactly (common.xml plus ardupilotmega.xml) —
					RDOS doesn't rename or rescale anything. Units stay in whatever the dialect specifies:
					<code className="font-code text-secondary"> relative_alt</code> is millimetres,{" "}
					<code className="font-code text-secondary">lat</code>/
					<code className="font-code text-secondary">lon</code> are degrees × 1e7. Convert on your
					side, not ours, so a raw frame you download later still matches the stream you saw live.
				</p>
			</DocSection>

			<Callout tone="primary" title="MSP for Betaflight and iNav">
				Vehicles running Betaflight or iNav are decoded from MSP v1/v2 into the same JSON envelope,
				under message names like <code className="font-code text-primary">MSP_ATTITUDE</code> and{" "}
				<code className="font-code text-primary">MSP_RAW_GPS</code>. Subscribing with{" "}
				<code className="font-code text-primary">msgs=</code> works identically regardless of which
				protocol the vehicle actually speaks — pick the fields you need by message name.
			</Callout>

			<DocPager />
		</>
	);
}

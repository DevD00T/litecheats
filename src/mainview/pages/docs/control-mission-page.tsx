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

export function ControlMissionPage() {
	return (
		<>
			<DocHeader
				kicker={<EndpointKicker method="PUT" path="/v1/vehicles/{sysid}/mission" />}
				title="Upload a mission"
				description="Replaces the vehicle's active mission with the plan you send. RDOS validates waypoint ordering, geofence containment and altitude sanity before a single byte reaches the autopilot — a rejected plan never partially uploads."
			/>

			<CodeGrid>
				<CodeWindow label="Request">
					<div>curl -X PUT \</div>
					<div>
						{"  "}
						<span className="text-secondary">
							https://api.rdos.litecheats.in/v1/vehicles/114/mission
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
								'\'{"items":[{"seq":0,"cmd":"MAV_CMD_NAV_WAYPOINT","lat":12.9716,"lon":77.5946,"alt":60}]}\''
							}
						</span>
					</div>
				</CodeWindow>
				<CodeWindow label="200 · application/json" tone="success">
					<div>{"{"}</div>
					<div>
						{"  "}
						<span className="text-primary">"accepted"</span>: true,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"item_count"</span>: 1,
					</div>
					<div>
						{"  "}
						<span className="text-primary">"warnings"</span>: []
					</div>
					<div>{"}"}</div>
				</CodeWindow>
			</CodeGrid>

			<DocSection title="Body parameters">
				<ParamsTable
					rows={[
						{
							n: "items",
							t: "MissionItem[]",
							d: "Ordered waypoints. Each has seq, cmd (a MAV_CMD_NAV_* name), lat, lon and alt at minimum.",
						},
						{
							n: "geofence",
							t: "Polygon | null",
							d: "Optional inclusion fence, checked against every waypoint before upload proceeds.",
						},
						{
							n: "rally_points",
							t: "LatLon[]",
							d: "Optional. Used as RTL fallback points where the firmware supports rally points.",
						},
					]}
				/>
			</DocSection>

			<DocSection title="Import an existing plan file">
				<p className="mb-3 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
					Prefer working in a file format? Send it as a multipart upload instead of raw JSON items —
					RDOS parses it into the same validated internal representation.
				</p>
				<DocTable
					head={["Format", "Typical source"]}
					rows={[
						[
							<code key="1" className="font-code text-secondary">
								.plan
							</code>,
							"QGroundControl",
						],
						[
							<code key="2" className="font-code text-secondary">
								.waypoints
							</code>,
							"Mission Planner",
						],
						[
							<code key="3" className="font-code text-secondary">
								KML / KMZ
							</code>,
							"Google Earth, survey tools",
						],
						[
							<code key="4" className="font-code text-secondary">
								CSV
							</code>,
							"Spreadsheet-authored batch waypoints",
						],
					]}
				/>
			</DocSection>

			<Callout tone="destructive" title="400 mission_invalid">
				A rejected plan lists every offending waypoint by{" "}
				<code className="font-code text-destructive">seq</code> in the response body — a waypoint
				outside the geofence, a climb rate the airframe can't make, or an altitude reference the
				firmware doesn't support. Nothing is written to the vehicle until validation passes.
			</Callout>

			<DocPager />
		</>
	);
}

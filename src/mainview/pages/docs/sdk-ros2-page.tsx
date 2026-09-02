import {
	Callout,
	CodeWindow,
	DocHeader,
	DocPager,
	DocSection,
	DocTable,
	GuideKicker,
} from "./doc-ui";

export function SdkRos2Page() {
	return (
		<>
			<DocHeader
				kicker={<GuideKicker label="SDK" />}
				title="ROS 2 bridge"
				description="rdos_ros2 mirrors the shape of MAVROS but talks to the RDOS cloud API instead of a local MAVLink link — useful when the vehicle itself is far away and your ROS graph runs on a ground-side workstation."
			/>

			<DocSection title="Install">
				<CodeWindow label="shell">
					<div>sudo apt install ros-humble-rdos-bridge</div>
					<div className="text-muted-foreground/70">
						# or build from source against your ROS 2 distro
					</div>
				</CodeWindow>
			</DocSection>

			<DocSection title="Launch">
				<CodeWindow label="shell">
					<div>export RDOS_TOKEN=rdos_live_…</div>
					<div>ros2 launch rdos_bridge bridge.launch.py vehicle:=114</div>
				</CodeWindow>
			</DocSection>

			<DocSection title="Topic and service mapping">
				<DocTable
					head={["RDOS", "ROS 2 topic / service", "Type"]}
					rows={[
						["GLOBAL_POSITION_INT stream", "/rdos/global_position", "sensor_msgs/NavSatFix"],
						["ATTITUDE stream", "/rdos/attitude", "geometry_msgs/QuaternionStamped"],
						["BATTERY_STATUS stream", "/rdos/battery", "sensor_msgs/BatteryState"],
						["POST /command", "/rdos/command (service)", "rdos_bridge/srv/SendCommand"],
						["POST /mode", "/rdos/set_mode (service)", "rdos_bridge/srv/SetMode"],
					]}
				/>
			</DocSection>

			<Callout tone="primary" title="One bridge node, any number of subscribers">
				The bridge node holds a single authenticated stream to RDOS and republishes locally on the
				ROS graph — every subscriber on the machine shares that one connection rather than each
				opening its own SSE stream against your rate limit.
			</Callout>

			<DocPager />
		</>
	);
}

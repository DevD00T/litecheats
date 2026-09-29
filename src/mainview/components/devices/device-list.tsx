import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LocationAccess, UserDeviceSummary } from "shared/devices";

function formatDateTime(value: string): string {
	return new Date(value).toLocaleString("en-IN", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "Asia/Kolkata",
	});
}

function Allowed({ label, on, value }: { label: string; on: boolean; value?: string }) {
	return (
		<Badge
			variant="secondary"
			className={on ? "bg-success/12 text-success" : "bg-muted text-muted-foreground"}
		>
			{label}: {value ?? (on ? "allowed" : "off")}
		</Badge>
	);
}

const locationLabel: Record<LocationAccess, string> = {
	precise: "precise",
	approximate: "approximate",
	denied: "off",
};

/**
 * What each of a user's devices allowed in the Android app. Only permission
 * status is stored, never the data behind it.
 */
export function DeviceList({
	devices,
	onRemove,
	removingId,
}: {
	devices: UserDeviceSummary[];
	onRemove?: (device: UserDeviceSummary) => void;
	removingId?: string | null;
}) {
	if (!devices.length) {
		return (
			<p className="text-sm text-muted-foreground">
				No devices yet. Sign in to the Android app and its permission choices appear here.
			</p>
		);
	}

	return (
		<div className="grid gap-3">
			{devices.map((device) => (
				<div
					key={device.deviceId}
					className="grid gap-2 rounded-lg border border-border/65 bg-muted/25 p-4 text-sm"
				>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<span className="font-medium text-foreground">
							{device.deviceModel || "Android device"}
						</span>
						<span className="text-xs text-muted-foreground">
							App {device.appVersionName} ({device.appVersionCode}) · {device.osVersion}
						</span>
					</div>
					<div className="flex flex-wrap gap-1.5">
						<Allowed label="Notifications" on={device.permissions.notifications} />
						<Allowed label="Install updates" on={device.permissions.installUpdates} />
						<Allowed label="Photos & files" on={device.permissions.storage} />
						<Allowed
							label="Location"
							on={device.permissions.location !== "denied"}
							value={locationLabel[device.permissions.location]}
						/>
					</div>
					<div className="flex flex-wrap gap-1.5">
						<Allowed
							label="Auto-update"
							on={device.preferences.autoUpdate}
							value={device.preferences.autoUpdate ? "on" : "off"}
						/>
						<Allowed
							label="Wi-Fi only"
							on={device.preferences.updateWifiOnly}
							value={device.preferences.updateWifiOnly ? "on" : "off"}
						/>
						<Allowed
							label="Terms"
							on={device.consents.termsAccepted}
							value={device.consents.termsAccepted ? "accepted" : "not yet"}
						/>
						<Allowed
							label="Update disclaimer"
							on={device.consents.updateDisclaimerAccepted}
							value={
								device.updateDisclaimerAcceptedAt
									? `accepted ${formatDateTime(device.updateDisclaimerAcceptedAt)}`
									: "not yet"
							}
						/>
					</div>
					<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
						<span>Last saved {formatDateTime(device.updatedAt)} IST</span>
						{onRemove ? (
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={removingId === device.deviceId}
								onClick={() => onRemove(device)}
							>
								{removingId === device.deviceId ? "Removing..." : "Remove"}
							</Button>
						) : null}
					</div>
				</div>
			))}
		</div>
	);
}

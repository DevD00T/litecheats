import {
	Callout,
	CodeGrid,
	CodeWindow,
	DocHeader,
	DocPager,
	DocSection,
	DocTable,
	GuideKicker,
} from "./doc-ui";

export function ScopesPage() {
	return (
		<>
			<DocHeader
				kicker={<GuideKicker label="Guide" />}
				title="Scopes & tokens"
				description="Scopes are granted per token, not per user. A pilot's dashboard token and a nightly log-export script should never carry the same permissions — issue one token per purpose."
			/>

			<DocSection title="Available scopes">
				<DocTable
					head={["Scope", "Grants"]}
					rows={[
						[
							<code key="vr" className="font-code text-secondary">
								vehicle:read
							</code>,
							"List vehicles, read telemetry (stream and snapshot), read pre-arm and health status",
						],
						[
							<code key="vc" className="font-code text-secondary">
								vehicle:control
							</code>,
							"Send MAV_CMD commands, change flight mode, arm/disarm, trigger the kill switch",
						],
						[
							<code key="vm" className="font-code text-secondary">
								vehicle:mission
							</code>,
							"Upload, read and clear a vehicle's mission, geofence and rally points",
						],
						[
							<code key="ar" className="font-code text-secondary">
								archive:read
							</code>,
							"Search the log archive and download artifacts",
						],
						[
							<code key="aw" className="font-code text-secondary">
								archive:write
							</code>,
							"Queue analysis jobs (PID tuning, vibration, motor health) against a stored log",
						],
						[
							<code key="fa" className="font-code text-secondary">
								fleet:admin
							</code>,
							"Add or remove vehicles and nodes, issue device enrollment tokens, manage roles",
						],
						[
							<code key="ob" className="font-code text-secondary">
								org:billing
							</code>,
							"Read invoices and change the plan — never bundle this with an automation token",
						],
					]}
				/>
			</DocSection>

			<DocSection title="Least privilege in practice">
				<div className="grid gap-2.5 sm:grid-cols-2">
					<div className="rounded-[12px] border border-border bg-card/55 p-3.5">
						<div className="font-heading text-[13px] font-bold text-foreground">
							A telemetry dashboard
						</div>
						<p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
							Needs only <code className="font-code text-secondary">vehicle:read</code>. It should
							never be able to send a command even if compromised.
						</p>
					</div>
					<div className="rounded-[12px] border border-border bg-card/55 p-3.5">
						<div className="font-heading text-[13px] font-bold text-foreground">
							A mission-upload CI step
						</div>
						<p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
							Needs <code className="font-code text-secondary">vehicle:read</code> +{" "}
							<code className="font-code text-secondary">vehicle:mission</code>, nothing broader.
						</p>
					</div>
				</div>
			</DocSection>

			<DocSection title="Revoking a token">
				<CodeGrid>
					<CodeWindow label="Request">
						<div>
							curl -X POST{" "}
							<span className="text-secondary">
								https://api.rdos.litecheats.in/v1/tokens/tok_8h2/revoke
							</span>{" "}
							\
						</div>
						<div>
							{"  "}-H <span className="text-warning">"Authorization: Bearer $RDOS_TOKEN"</span>
						</div>
					</CodeWindow>
					<CodeWindow label="204 · no content" tone="success">
						<div className="text-muted-foreground/70">
							Revocation takes effect within seconds. In-flight requests already accepted are not
							rolled back.
						</div>
					</CodeWindow>
				</CodeGrid>
			</DocSection>

			<Callout tone="warning" title="Rotate, don't share">
				Every token is tied to the identity that created it for the audit log. If two systems need
				the same access, issue two tokens with matching scopes rather than sharing one — revocation
				and the audit trail both stay meaningful.
			</Callout>

			<DocPager />
		</>
	);
}

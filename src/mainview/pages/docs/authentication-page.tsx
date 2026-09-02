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
} from "./doc-ui";

export function AuthenticationPage() {
	return (
		<>
			<DocHeader
				kicker={<GuideKicker label="Guide" />}
				title="Authentication"
				description="Every RDOS request carries a bearer token over TLS 1.3. Commands that reach the vehicle itself go through a second, independent layer: signed MAVLink v2 frames, so a stolen API token alone can never move a rotor."
			/>

			<DocSection title="Bearer tokens">
				<p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
					Pass your token in the <code className="font-code text-secondary">Authorization</code>{" "}
					header on every request. There is no session cookie and no query-string token — anything
					in a URL ends up in proxy logs.
				</p>
				<div className="mt-3.5">
					<CodeWindow label="Every request">
						<div>Authorization: Bearer rdos_live_9f2a1c8e4b7d…</div>
					</CodeWindow>
				</div>
			</DocSection>

			<DocSection title="Two kinds of token">
				<DocTable
					head={["Token", "Issued by", "Lifetime", "Used for"]}
					rows={[
						[
							<code key="pat" className="font-code text-secondary">
								Personal access token
							</code>,
							"Account → API tokens",
							"Until revoked",
							"Scripts, dashboards, CI, anything a human owns",
						],
						[
							<code key="dat" className="font-code text-secondary">
								Device enrollment token
							</code>,
							"Fleet → Add node",
							"One-time, 15 min",
							"Exchanged by an RDOS agent for a long-lived device credential on first boot",
						],
					]}
				/>
				<p className="mt-3 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
					A device credential is bound to one node and cannot list or control other vehicles in the
					org — compromising a field unit doesn't hand over the fleet.
				</p>
			</DocSection>

			<DocSection title="MAVLink command signing">
				<p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
					Your API token authenticates you to <span className="text-foreground/85">RDOS</span>. It
					does not, by itself, authenticate a command to the{" "}
					<span className="text-foreground/85">autopilot</span> — MAVLink has its own signing scheme
					for that, and RDOS implements it end to end:
				</p>
				<div className="mt-3.5 grid gap-2.5 sm:grid-cols-3">
					<div className="rounded-[12px] border border-border bg-card/55 p-3.5">
						<div className="font-code text-[11px] text-primary">HMAC-SHA256</div>
						<p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
							Every outbound MAVLink v2 frame is signed with a 32-byte key.
						</p>
					</div>
					<div className="rounded-[12px] border border-border bg-card/55 p-3.5">
						<div className="font-code text-[11px] text-primary">Non-extractable</div>
						<p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
							The key lives as a Web Crypto key in your browser and never leaves it in plaintext.
						</p>
					</div>
					<div className="rounded-[12px] border border-border bg-card/55 p-3.5">
						<div className="font-code text-[11px] text-primary">SETUP_SIGNING</div>
						<p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
							Enrolled with the flight controller once; ArduPilot 4.0+ supports it today.
						</p>
					</div>
				</div>
				<div className="mt-3.5">
					<Callout tone="warning" title="Require mode">
						Flip <span className="font-code">require signing</span> in the Configure → Security
						panel to make the flight controller reject any unsigned command outright, including ones
						sent from a different ground station on the same link.
					</Callout>
				</div>
			</DocSection>

			<DocSection title="mTLS for enterprise">
				<p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
					Institutional plans can additionally require mutual TLS on the API connection itself —
					useful when a fixed set of campus or ops-center IPs should be the only callers, layered on
					top of bearer tokens rather than replacing them.
				</p>
			</DocSection>

			<DocSection title="Example: authenticated read">
				<CodeGrid>
					<CodeWindow label="Request">
						<div>
							curl{" "}
							<span className="text-secondary">https://api.rdos.litecheats.in/v1/vehicles/114</span>{" "}
							\
						</div>
						<div>
							{"  "}-H <span className="text-warning">"Authorization: Bearer $RDOS_TOKEN"</span>
						</div>
					</CodeWindow>
					<CodeWindow label="401 · application/json" tone="destructive">
						<div>{"{"}</div>
						<div>
							{"  "}
							<span className="text-primary">"error"</span>: {"{"}
						</div>
						<div>
							{"    "}
							<span className="text-primary">"code"</span>:{" "}
							<span className="text-warning">"invalid_token"</span>,
						</div>
						<div>
							{"    "}
							<span className="text-primary">"message"</span>:{" "}
							<span className="text-warning">"Token is expired or revoked."</span>
						</div>
						<div>{"  }"}</div>
						<div>{"}"}</div>
					</CodeWindow>
				</CodeGrid>
			</DocSection>

			<Callout tone="primary" title="Next: pick the right scope">
				Tokens are useless without scopes attached. See{" "}
				<Link to="/docs/scopes" className="font-semibold underline underline-offset-2">
					Scopes &amp; tokens
				</Link>{" "}
				for the full list and how revocation works.
			</Callout>

			<DocPager />
		</>
	);
}

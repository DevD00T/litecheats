import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";

const cloudFeatures = [
	{
		title: "Any transport in, one stream out",
		body: "Point an autopilot at us over LTE, an RF relay, or fibre for subsea vehicles. Frames land in ap-south-1, get signature-checked and timestamped, then fan out to every subscriber.",
	},
	{
		title: "Signed, encrypted links",
		body: "MAVLink v2 command signing end to end, TLS 1.3 on the wire, and optional mTLS for institutions that require client certificates.",
	},
	{
		title: "Multi-GCS fan-out",
		body: "The same vehicle can be watched from RDOS Console and QGroundControl at the same time — the router doesn't pick a single owner for the link.",
	},
	{
		title: "Automatic SIM failover",
		body: "Dual-SIM onboard modems fail over automatically; the router keeps the session alive across the switch instead of dropping it.",
	},
];

export function MavlinkCloudPage() {
	return (
		<AnimatedPage>
			<section className="space-y-4">
				<div className="flex flex-wrap items-center gap-2.5">
					<span className="font-code rounded-md border border-primary/40 bg-primary/12 px-2 py-0.5 text-[10.5px] font-bold tracking-[0.06em] text-primary uppercase">
						MAVLink Cloud
					</span>
					<Badge variant="secondary" className="bg-warning/12 text-warning">
						Coming soon
					</Badge>
					<span className="font-code ml-auto text-[10.5px] text-muted-foreground/70">
						Litecheats MavTech · a Rotorcraftory Private Limited company
					</span>
				</div>

				<h1 className="font-heading text-[34px] font-bold tracking-tight text-balance md:text-[44px]">
					A managed MAVLink router, not another GCS
				</h1>
				<p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
					MAVLink Cloud is the link itself — the always-on relay that carries MAVLink v2 between
					your autopilot and whatever is watching it, including{" "}
					<Link
						to="/platform/rdos-console"
						className="text-secondary underline-offset-2 hover:underline"
					>
						RDOS Console
					</Link>
					. It doesn't replace your ground station; it's what your ground station talks to when your
					vehicle is nowhere near it.
				</p>

				<div className="flex flex-wrap gap-3 pt-1">
					<Link to="/signup" className={cn(buttonVariants({ size: "lg" }), "glow-ring")}>
						Join the early access list
					</Link>
					<Link
						to="/docs/authentication"
						className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
					>
						Read the signing docs
					</Link>
				</div>
			</section>

			<section className="mt-2">
				<div className="text-[11px] tracking-[0.16em] text-secondary uppercase">How it works</div>
				<h2 className="mt-2.5 font-heading text-2xl font-bold tracking-tight md:text-[30px]">
					The link, hardened
				</h2>
				<div className="mt-6 grid gap-4 md:grid-cols-2">
					{cloudFeatures.map((feature, index) => (
						<motion.div
							key={feature.title}
							initial={{ opacity: 0, y: 18 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: true, amount: 0.3 }}
							transition={{ duration: 0.4, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
							className="rounded-[16px] border border-border bg-card/65 p-5"
						>
							<h3 className="font-heading text-[16px] font-bold tracking-tight">{feature.title}</h3>
							<p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
								{feature.body}
							</p>
						</motion.div>
					))}
				</div>
			</section>

			<motion.section
				initial={{ opacity: 0, y: 18 }}
				whileInView={{ opacity: 1, y: 0 }}
				viewport={{ once: true, amount: 0.3 }}
				transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
				className="glass-panel rounded-[20px] border border-warning/25 p-6 md:p-8"
			>
				<div className="text-[11px] tracking-[0.16em] text-warning uppercase">Status</div>
				<h2 className="mt-2.5 font-heading text-[24px] font-bold tracking-tight md:text-[27px]">
					The router is being built against a stable, documented API
				</h2>
				<p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
					The telemetry, command, and archive endpoints in the{" "}
					<Link to="/docs" className="text-primary underline-offset-2 hover:underline">
						API docs
					</Link>{" "}
					describe the contract MAVLink Cloud will expose at launch. Sign up for early access and
					we'll reach out when your org can point a vehicle at it.
				</p>
				<Link to="/signup" className={cn(buttonVariants({ size: "lg" }), "mt-5 w-fit")}>
					Get notified at launch
				</Link>
			</motion.section>
		</AnimatedPage>
	);
}

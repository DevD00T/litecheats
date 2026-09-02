import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

const consoleFeatures = [
	{
		id: "live-map",
		title: "Live map, HUD & MAVLink inspector",
		body: "Every vehicle your org owns on one dense screen — position, attitude, battery, EKF and link health, plus a raw MAVLink message inspector for when you need to see the actual frames.",
	},
	{
		id: "mission-planner",
		title: "Mission planner",
		body: "Draw a mission on the map, validate it against DGCA airspace rules before upload, and watch it execute waypoint by waypoint with a live progress readout.",
	},
	{
		id: "video-wall",
		title: "FPV video wall",
		body: "Pull FPV feeds from every airborne unit into one wall over a WebRTC relay — no separate viewer app, no plugin.",
	},
	{
		id: "roles",
		title: "Role-separated access",
		body: "Pilots fly, analysts read telemetry, owners hold the kill switch. Every command a role can send is scoped and audit-logged.",
	},
];

export function RdosConsolePage() {
	const location = useLocation();

	useEffect(() => {
		if (!location.hash) return;
		const target = document.getElementById(location.hash.slice(1));
		target?.scrollIntoView({ behavior: "smooth", block: "start" });
	}, [location.hash]);

	return (
		<AnimatedPage>
			<section className="space-y-4">
				<div className="flex flex-wrap items-center gap-2.5">
					<span className="font-code rounded-md border border-secondary/40 bg-secondary/12 px-2 py-0.5 text-[10.5px] font-bold tracking-[0.06em] text-secondary uppercase">
						RDOS
					</span>
					<Badge variant="secondary" className="bg-warning/12 text-warning">
						Coming soon
					</Badge>
					<span className="font-code ml-auto text-[10.5px] text-muted-foreground/70">
						Litecheats MavTech · a Rotorcraftory Private Limited company
					</span>
				</div>

				<h1 className="font-heading text-[34px] font-bold tracking-tight text-balance md:text-[44px]">
					RDOS Console — a browser-based ground control station
				</h1>
				<p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
					RDOS Console is a Ground Control Station (GCS) that runs entirely in the browser. It talks
					to your vehicles through{" "}
					<Link
						to="/platform/mavlink-cloud"
						className="text-secondary underline-offset-2 hover:underline"
					>
						MAVLink Cloud
					</Link>{" "}
					— our managed MAVLink router — so live telemetry, mission control and FPV video reach any
					browser your institution has a login for, with no client to install and no port to
					forward.
				</p>

				<div className="flex flex-wrap gap-3 pt-1">
					<Link to="/signup" className={cn(buttonVariants({ size: "lg" }), "glow-ring")}>
						Join the early access list
					</Link>
					<Link to="/docs" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
						Read the API docs
					</Link>
				</div>
			</section>

			<section className="mt-2">
				<div className="text-[11px] tracking-[0.16em] text-primary uppercase">What it does</div>
				<h2 className="mt-2.5 font-heading text-2xl font-bold tracking-tight md:text-[30px]">
					One console, every vehicle
				</h2>
				<div className="mt-6 grid gap-4 md:grid-cols-2">
					{consoleFeatures.map((feature, index) => (
						<motion.div
							key={feature.id}
							id={feature.id}
							initial={{ opacity: 0, y: 18 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: true, amount: 0.3 }}
							transition={{ duration: 0.4, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
							className="scroll-mt-24 rounded-[16px] border border-border bg-card/65 p-5"
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
					RDOS Console is in build, not yet generally available
				</h2>
				<p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
					The{" "}
					<Link to="/docs" className="text-primary underline-offset-2 hover:underline">
						API
					</Link>{" "}
					is documented ahead of the console itself, so integrators can start against a stable
					contract. Sign up for early access and we'll email you the moment your org can log in.
				</p>
				<Link to="/signup" className={cn(buttonVariants({ size: "lg" }), "mt-5 w-fit")}>
					Get notified at launch
				</Link>
			</motion.section>
		</AnimatedPage>
	);
}

import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";

const heroStats = [
	{ v: "18 ms", k: "Median added latency", tone: "text-foreground" },
	{ v: "99.95%", k: "Link uptime, 90 days", tone: "text-success" },
	{ v: "24 mo", k: "Raw frame retention", tone: "text-foreground" },
	{ v: "ap-south-1", k: "Sole data region", tone: "text-secondary" },
];

const heroTelemetry = [
	{ k: "Alt AGL", v: "118 m", tone: "text-foreground" },
	{ k: "Speed", v: "14.2", tone: "text-foreground" },
	{ k: "GPS", v: "RTK", tone: "text-success" },
	{ k: "Batt", v: "68%", tone: "text-success" },
];

const pillars = [
	{
		tag: "RDOS",
		title: "Fleet operations console",
		body: "One dense screen for every vehicle your institution owns — airborne, subsea or on wheels.",
		bullets: [
			"Live map, HUD and MAVLink inspector",
			"Mission planner with DGCA airspace checks",
			"FPV video wall over WebRTC relay",
		],
		tone: "primary",
	},
	{
		tag: "MAVLINK CLOUD",
		title: "The link itself",
		body: "A managed MAVLink router. Point any autopilot at it over LTE, RF relay or subsea fibre.",
		bullets: [
			"MAVLink v2 signed, TLS 1.3, optional mTLS",
			"Multi-GCS fan-out — QGC and RDOS at once",
			"Automatic failover between two SIMs",
		],
		tone: "secondary",
	},
	{
		tag: "LITECHEATS",
		title: "FPV airframes & gear",
		body: "Our own FPV line, sold direct — and the reason RDOS understands hobby-grade telemetry too.",
		bullets: [
			"X7 quad, 7-inch long range, cinelifter",
			"Spares and bench-tested flight controllers",
			"Ships pre-registered to your RDOS org",
		],
		tone: "destructive",
	},
] as const;

const hops = [
	{
		n: "01",
		title: "Autopilot",
		body: "ArduPilot or PX4 emits MAVLink v2 on its serial port, exactly as it already does.",
		meta: "no firmware fork",
	},
	{
		n: "02",
		title: "Onboard link",
		body: "An LTE modem, RF relay or the ROV umbilical carries frames off the vehicle.",
		meta: "LTE · 915 MHz · fibre",
	},
	{
		n: "03",
		title: "RDOS router",
		body: "Frames land in Mumbai, are signature-checked, timestamped and fanned out to subscribers.",
		meta: "+18 ms median",
	},
	{
		n: "04",
		title: "Console & API",
		body: "Your browser, your QGroundControl and your scripts all read the same stream.",
		meta: "SSE · WebSocket · REST",
	},
];

const institutionSignals = [
	{
		k: "Data residency",
		v: "Single region, Mumbai. Nothing replicates outside India.",
		tone: "text-secondary",
	},
	{
		k: "Role separation",
		v: "Pilots fly, analysts read. Terminate is owner-only.",
		tone: "text-primary",
	},
	{
		k: "Audit trail",
		v: "Every command, export and role change, retained 24 months.",
		tone: "text-success",
	},
	{
		k: "Per-unit budgets",
		v: "Split spend across departments on one invoice.",
		tone: "text-warning",
	},
	{
		k: "SSO",
		v: "Shibboleth, SAML 2.0 and Google Workspace for education.",
		tone: "text-secondary",
	},
	{
		k: "Procurement",
		v: "GST invoicing, GeM listing, three-year rate lock available.",
		tone: "text-destructive",
	},
];

const pillarToneClasses: Record<
	(typeof pillars)[number]["tone"],
	{ border: string; chip: string; text: string; dot: string }
> = {
	primary: {
		border: "border-primary/30",
		chip: "border-primary/30 bg-primary/12 text-primary",
		text: "text-primary",
		dot: "bg-primary",
	},
	secondary: {
		border: "border-secondary/30",
		chip: "border-secondary/30 bg-secondary/12 text-secondary",
		text: "text-secondary",
		dot: "bg-secondary",
	},
	destructive: {
		border: "border-destructive/30",
		chip: "border-destructive/30 bg-destructive/12 text-destructive",
		text: "text-destructive",
		dot: "bg-destructive",
	},
};

export function HomePage() {
	const scopeRef = useRef<HTMLElement | null>(null);

	useLayoutEffect(() => {
		if (!scopeRef.current) return;

		const ctx = gsap.context(() => {
			const introTimeline = gsap.timeline();
			introTimeline
				.from(".home-chip", { y: 14, opacity: 0, duration: 0.5, ease: "power2.out" })
				.from(".home-title", { y: 22, opacity: 0, duration: 0.65, ease: "power3.out" }, "-=0.32")
				.from(".home-copy", { y: 16, opacity: 0, duration: 0.55, ease: "power2.out" }, "-=0.38")
				.from(
					".home-cta",
					{ y: 12, opacity: 0, duration: 0.4, stagger: 0.07, ease: "power2.out" },
					"-=0.3",
				)
				.from(
					".home-stat",
					{ y: 10, opacity: 0, duration: 0.4, stagger: 0.06, ease: "power2.out" },
					"-=0.25",
				);

			gsap.from(".hero-panel", {
				y: 20,
				opacity: 0,
				duration: 0.6,
				ease: "power2.out",
				delay: 0.15,
			});
		}, scopeRef);

		return () => ctx.revert();
	}, []);

	return (
		<AnimatedPage>
			<section ref={scopeRef} className="grid gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
				<div className="space-y-5">
					<Badge
						variant="secondary"
						className="home-chip w-fit gap-2 border-destructive/35 bg-destructive/10 py-1.5 pr-3.5 pl-2 text-destructive"
					>
						<span className="relative flex h-1.5 w-1.5">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
							<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-destructive" />
						</span>
						<span className="text-[11px] font-semibold tracking-[0.11em] uppercase">
							Built and hosted in India
						</span>
					</Badge>

					<h1 className="home-title font-heading text-4xl leading-[1.05] font-bold tracking-tight text-balance md:text-[57px]">
						Every vehicle you fly, dive or drive —{" "}
						<span className="text-gradient">on one MAVLink link.</span>
					</h1>

					<p className="home-copy max-w-xl text-[17px] leading-relaxed text-muted-foreground">
						RDOS routes MAVLink from any autopilot to a cloud console your whole institution can
						share. Live telemetry, mission control, FPV video and a full raw-frame archive — inside
						Indian jurisdiction, with an API for everything.
					</p>

					<div className="flex flex-wrap gap-3 pt-1">
						<Link to="/signup" className={cn(buttonVariants({ size: "lg" }), "home-cta glow-ring")}>
							Start a 30-day pilot
						</Link>
						<Link
							to="/docs"
							className={cn(buttonVariants({ variant: "outline", size: "lg" }), "home-cta")}
						>
							Read the API docs
						</Link>
					</div>

					<div className="flex flex-wrap gap-x-7 gap-y-4 pt-2">
						{heroStats.map((stat) => (
							<div key={stat.k} className="home-stat">
								<div className={cn("font-code text-xl font-semibold", stat.tone)}>{stat.v}</div>
								<div className="mt-0.5 text-[11px] text-muted-foreground">{stat.k}</div>
							</div>
						))}
					</div>
				</div>

				<div className="hero-panel glass-panel overflow-hidden rounded-2xl shadow-[0_40px_90px_-50px_oklch(0.55_0.2_293/0.7)]">
					<div className="flex items-center gap-2 border-b border-border/70 px-3.5 py-2.5">
						<span className="relative flex h-2 w-2">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
							<span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
						</span>
						<span className="font-code text-[10.5px] tracking-[0.08em] text-muted-foreground">
							RDOS · LIVE LINK · RCX-114
						</span>
						<span className="font-code ml-auto text-[10px] text-muted-foreground/70">18 ms</span>
					</div>

					<div className="relative h-[216px] bg-background">
						<svg
							viewBox="0 0 470 216"
							className="absolute inset-0 h-full w-full"
							aria-hidden="true"
						>
							<defs>
								<pattern id="hero-grid" width="33" height="33" patternUnits="userSpaceOnUse">
									<path d="M33 0H0v33" fill="none" stroke="oklch(1 0 0 / 6%)" strokeWidth="1" />
								</pattern>
							</defs>
							<rect width="470" height="216" fill="url(#hero-grid)" />
							<path
								d="M0 158 C70 138, 128 152, 186 128 S 320 96, 386 112 S 452 92, 470 82 L470 216 L0 216 Z"
								fill="oklch(0.34 0.05 200 / 25%)"
								stroke="oklch(0.5 0.06 200 / 55%)"
								strokeWidth="1.1"
							/>
							<path
								d="M56 182 L56 46 L152 46 L152 182 L248 182 L248 46 L344 46 L344 182"
								fill="none"
								stroke="oklch(0.72 0.19 293 / 28%)"
								strokeWidth="8"
								strokeLinejoin="round"
								strokeLinecap="round"
							/>
							<path
								d="M56 182 L56 46 L152 46 L152 182 L248 182 L248 110"
								fill="none"
								stroke="oklch(0.8 0.15 192)"
								strokeWidth="1.8"
							/>
							<circle cx="248" cy="110" r="16" fill="oklch(0.8 0.15 192 / 14%)" />
							<g transform="translate(248 110) rotate(180)">
								<path
									d="M0 -9 L7 8 L0 3.5 L-7 8 Z"
									fill="oklch(0.8 0.15 192)"
									stroke="oklch(0.128 0.016 250)"
									strokeWidth="1.1"
								/>
							</g>
							<g fontFamily="JetBrains Mono, monospace" fontSize="7.5" fill="oklch(0.6 0.015 286)">
								{[
									[56, 182],
									[56, 46],
									[152, 46],
									[152, 182],
									[248, 182],
									[344, 46],
									[344, 182],
								].map(([cx, cy]) => (
									<circle
										key={`${cx}-${cy}`}
										cx={cx}
										cy={cy}
										r="3.4"
										fill="oklch(0.19 0.02 285)"
										stroke="oklch(0.72 0.19 293)"
										strokeWidth="1.4"
									/>
								))}
							</g>
							<rect
								x="12"
								y="12"
								width="112"
								height="34"
								rx="5"
								fill="oklch(0.145 0.017 285 / 88%)"
								stroke="oklch(1 0 0 / 10%)"
							/>
							<text
								x="20"
								y="26"
								fontFamily="JetBrains Mono, monospace"
								fontSize="8"
								fill="oklch(0.62 0.015 286)"
							>
								12.90411 N
							</text>
							<text
								x="20"
								y="38"
								fontFamily="JetBrains Mono, monospace"
								fontSize="8"
								fill="oklch(0.62 0.015 286)"
							>
								77.61344 E
							</text>
						</svg>
					</div>

					<div className="grid grid-cols-2 border-t border-border/70 sm:grid-cols-4">
						{heroTelemetry.map((t) => (
							<div key={t.k} className="border-r border-border/50 px-3 py-2.5 last:border-r-0">
								<div className="text-[8.5px] tracking-[0.12em] text-muted-foreground uppercase">
									{t.k}
								</div>
								<div className={cn("font-code mt-1 text-[15px] font-semibold", t.tone)}>{t.v}</div>
							</div>
						))}
					</div>

					<div className="font-code space-y-0.5 border-t border-border/70 px-3.5 py-2.5 text-[10px] leading-[1.75] text-muted-foreground">
						<div>
							<span className="text-muted-foreground/60">33</span>{" "}
							<span className="text-secondary">GLOBAL_POSITION_INT</span> 10 Hz
						</div>
						<div>
							<span className="text-muted-foreground/60">30</span>{" "}
							<span className="text-secondary">ATTITUDE</span> 20 Hz
						</div>
						<div>
							<span className="text-muted-foreground/60">253</span>{" "}
							<span className="text-success">STATUSTEXT</span> Reached waypoint #5
						</div>
					</div>
				</div>
			</section>

			<section>
				<div className="flex flex-wrap items-end justify-between gap-6">
					<div>
						<div className="text-[11px] tracking-[0.16em] text-primary uppercase">The platform</div>
						<h2 className="mt-2.5 font-heading text-3xl font-bold tracking-tight md:text-[36px]">
							Three products, one account
						</h2>
					</div>
					<p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
						Buy the airframe, run it on the cloud, and pull the data out through the API. Nothing is
						locked to our hardware — RDOS speaks plain MAVLink.
					</p>
				</div>
				<div className="mt-7 grid gap-4 md:grid-cols-3">
					{pillars.map((pillar, index) => {
						const tone = pillarToneClasses[pillar.tone];
						return (
							<motion.div
								key={pillar.title}
								initial={{ opacity: 0, y: 20 }}
								whileInView={{ opacity: 1, y: 0 }}
								viewport={{ once: true, amount: 0.25 }}
								transition={{ duration: 0.45, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] }}
								className={cn("glass-panel rounded-2xl border p-5", tone.border)}
							>
								<span
									className={cn(
										"font-code inline-flex items-center rounded-md border px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.06em]",
										tone.chip,
									)}
								>
									{pillar.tag}
								</span>
								<h3 className="mt-3.5 font-heading text-[19px] font-bold tracking-tight">
									{pillar.title}
								</h3>
								<p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
									{pillar.body}
								</p>
								<div className="mt-4 flex flex-col gap-1.5">
									{pillar.bullets.map((bullet) => (
										<div key={bullet} className="flex items-start gap-2">
											<span className={cn("mt-[7px] h-1 w-1 flex-none rounded-full", tone.dot)} />
											<span className="text-[12.5px] leading-relaxed text-foreground/80">
												{bullet}
											</span>
										</div>
									))}
								</div>
							</motion.div>
						);
					})}
				</div>
			</section>

			<section>
				<div className="text-[11px] tracking-[0.16em] text-secondary uppercase">
					How the link works
				</div>
				<h2 className="mt-2.5 font-heading text-3xl font-bold tracking-tight md:text-[36px]">
					Autopilot to browser in four hops
				</h2>
				<div className="mt-6 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
					{hops.map((hop, index) => (
						<motion.div
							key={hop.n}
							initial={{ opacity: 0, y: 18 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: true, amount: 0.3 }}
							transition={{ duration: 0.4, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] }}
							className="rounded-[14px] border border-border bg-card/65 p-4.5"
						>
							<div className="font-code text-[11px] text-primary">{hop.n}</div>
							<div className="mt-2 font-heading text-[15px] font-bold tracking-tight">
								{hop.title}
							</div>
							<p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
								{hop.body}
							</p>
							<div className="font-code mt-3 text-[10px] text-secondary">{hop.meta}</div>
						</motion.div>
					))}
				</div>
			</section>

			<motion.section
				initial={{ opacity: 0, y: 18 }}
				whileInView={{ opacity: 1, y: 0 }}
				viewport={{ once: true, amount: 0.3 }}
				transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
				className="glass-panel grid gap-8 rounded-[20px] p-6 md:grid-cols-[0.9fr_1.1fr] md:p-8"
			>
				<div>
					<div className="text-[11px] tracking-[0.16em] text-destructive uppercase">
						For institutions
					</div>
					<h2 className="mt-2.5 font-heading text-[28px] leading-[1.15] font-bold tracking-tight md:text-[31px]">
						Procurement-ready from day one
					</h2>
					<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
						Universities, research bodies and public agencies get the paperwork they actually need:
						data staying in India, per-unit budgets, role separation between pilots and analysts,
						and an audit trail for every command sent to a vehicle.
					</p>
					<a
						href="#compliance"
						className={cn(buttonVariants({ variant: "outline" }), "mt-5 w-fit")}
					>
						Download the compliance pack
					</a>
				</div>
				<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
					{institutionSignals.map((signal) => (
						<div key={signal.k} className="rounded-xl border border-border bg-background/80 p-3.5">
							<div className={cn("font-heading text-[13px] font-bold", signal.tone)}>
								{signal.k}
							</div>
							<p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{signal.v}</p>
						</div>
					))}
				</div>
			</motion.section>

			<motion.section
				initial={{ opacity: 0, y: 18 }}
				whileInView={{ opacity: 1, y: 0 }}
				viewport={{ once: true, amount: 0.35 }}
				transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
				className="glow-ring relative overflow-hidden rounded-[20px] border border-primary/25 bg-[linear-gradient(130deg,color-mix(in_oklch,var(--primary)_18%,transparent),color-mix(in_oklch,var(--destructive)_12%,transparent),color-mix(in_oklch,var(--secondary)_14%,transparent))] p-6 md:p-8"
			>
				<div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 className="font-heading text-2xl font-bold tracking-tight md:text-[29px]">
							Bring one vehicle. See the whole fleet by Friday.
						</h2>
						<p className="mt-2.5 max-w-xl text-sm leading-relaxed text-foreground/80">
							Pilots are free for 30 days on up to three vehicles, with a Litecheats engineer on the
							setup call.
						</p>
					</div>
					<div className="flex flex-none gap-2.5">
						<Link to="/signup" className={buttonVariants({ size: "lg" })}>
							Start a pilot
						</Link>
						<Link to="/pricing" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
							See pricing
						</Link>
					</div>
				</div>
			</motion.section>
		</AnimatedPage>
	);
}

import { AnimatedPage } from "@/components/layout/animated-page";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";

type Tone = "muted" | "primary" | "secondary" | "destructive";

const plans = [
	{
		name: "Lab",
		tag: "Free",
		who: "Single research group getting a first vehicle online.",
		price: "₹0",
		per: "/ month",
		note: "up to 2 vehicles",
		cta: "Start free",
		tone: "muted" as Tone,
		hero: false,
		feats: [
			"2 vehicles, 5 members",
			"Live telemetry + map",
			"7-day log retention",
			"Community support",
		],
	},
	{
		name: "Institution",
		tag: "Popular",
		who: "A department or university flying a mixed fleet weekly.",
		price: "₹4,900",
		per: "/ vehicle / mo",
		note: "billed annually, GST extra",
		cta: "Start 30-day pilot",
		tone: "primary" as Tone,
		hero: true,
		feats: [
			"Unlimited members and units",
			"Mission planner + airspace checks",
			"FPV wall, 6 concurrent feeds",
			"12-month log retention",
			"Full REST + streaming API",
			"Email support, 1 business day",
		],
	},
	{
		name: "Enterprise",
		tag: "Scale",
		who: "Commercial operators and agencies with SLA obligations.",
		price: "₹9,400",
		per: "/ vehicle / mo",
		note: "volume tiers from 25 vehicles",
		cta: "Talk to sales",
		tone: "secondary" as Tone,
		hero: false,
		feats: [
			"Everything in Institution",
			"24-month retention + custom decode",
			"Dual-SIM failover, priority relay",
			"99.95% uptime SLA, credits",
			"SSO + SCIM provisioning",
			"Named engineer, 4-hour response",
		],
	},
	{
		name: "Sovereign",
		tag: "On-prem",
		who: "Defence and critical-infrastructure deployments.",
		price: "Custom",
		per: "",
		note: "annual licence",
		cta: "Request briefing",
		tone: "destructive" as Tone,
		hero: false,
		feats: [
			"Air-gapped or VPC-isolated install",
			"Your keys, your hardware",
			"Source escrow available",
			"Security review support",
			"On-site commissioning",
		],
	},
];

const toneClasses: Record<Tone, { border: string; bg: string; text: string; chip: string }> = {
	muted: {
		border: "border-border",
		bg: "bg-card/62",
		text: "text-muted-foreground",
		chip: "border-border text-muted-foreground",
	},
	primary: {
		border: "border-primary/50",
		bg: "bg-primary/[0.09]",
		text: "text-primary",
		chip: "border-primary/40 bg-primary/14 text-primary",
	},
	secondary: {
		border: "border-secondary/35",
		bg: "bg-card/62",
		text: "text-secondary",
		chip: "border-secondary/40 bg-secondary/14 text-secondary",
	},
	destructive: {
		border: "border-destructive/35",
		bg: "bg-card/62",
		text: "text-destructive",
		chip: "border-destructive/40 bg-destructive/14 text-destructive",
	},
};

const compareRows = [
	{ k: "Vehicles included", a: "2", b: "per vehicle", c: "per vehicle", d: "unlimited" },
	{ k: "Members", a: "5", b: "unlimited", c: "unlimited", d: "unlimited" },
	{ k: "Log retention", a: "7 d", b: "12 mo", c: "24 mo", d: "your policy" },
	{ k: "Concurrent FPV feeds", a: "1", b: "6", c: "24", d: "unlimited" },
	{ k: "Mission planner", a: "—", b: "✓", c: "✓", d: "✓" },
	{ k: "ROV / subsea console", a: "—", b: "✓", c: "✓", d: "✓" },
	{ k: "Custom frame decoding", a: "—", b: "—", c: "✓", d: "✓" },
	{ k: "API rate limit", a: "60/min", b: "600/min", c: "6,000/min", d: "unmetered" },
	{ k: "SSO / SCIM", a: "—", b: "SSO", c: "SSO + SCIM", d: "SSO + SCIM" },
	{ k: "Uptime SLA", a: "—", b: "99.5%", c: "99.95%", d: "contracted" },
	{ k: "Deployment", a: "cloud", b: "cloud", c: "cloud", d: "on-prem / VPC" },
];

function compareCellClass(value: string) {
	if (value === "—") return "text-muted-foreground/45";
	if (value === "✓") return "text-success";
	return "text-foreground/85";
}

const faqs = [
	{
		q: "Does it work with my existing drone?",
		a: "If it speaks MAVLink v2 — ArduPilot, PX4, or anything derived from them — yes. You do not need Litecheats hardware.",
	},
	{
		q: "What counts as a vehicle?",
		a: "Any sysid that connects in a given month. Swap an airframe and re-register it under the same sysid at no extra cost.",
	},
	{
		q: "Can we self-host?",
		a: "The Sovereign tier ships the relay and console as a VPC or air-gapped install with your own keys.",
	},
	{
		q: "How is student access handled?",
		a: "Members are free. Give a class the Analyst role for read-only telemetry and logs without touching flight controls.",
	},
	{
		q: "Do you handle DGCA paperwork?",
		a: "RDOS checks missions against published airspace and pre-fills Digital Sky authorisation requests. Filing stays with your accountable manager.",
	},
	{
		q: "What happens if we leave?",
		a: "Bulk-export every raw log, point cloud and video from the archive. No egress charges, no proprietary container.",
	},
];

export function PricingPage() {
	const scopeRef = useRef<HTMLElement | null>(null);

	useLayoutEffect(() => {
		if (!scopeRef.current) return;
		const ctx = gsap.context(() => {
			gsap.from(".pricing-intro", { y: 22, opacity: 0, duration: 0.6, ease: "power3.out" });
			gsap.from(".pricing-plan", {
				y: 20,
				opacity: 0,
				duration: 0.5,
				stagger: 0.08,
				ease: "power2.out",
				delay: 0.12,
			});
		}, scopeRef);
		return () => ctx.revert();
	}, []);

	return (
		<AnimatedPage>
			<section ref={scopeRef} className="pricing-intro text-center">
				<div className="text-[11px] tracking-[0.16em] text-primary uppercase">Pricing</div>
				<h1 className="mt-3 font-heading text-4xl font-bold tracking-tight md:text-[44px]">
					Priced per vehicle, not per seat
				</h1>
				<p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
					Invite the whole department. You pay for the vehicles that actually connect, billed
					monthly in INR with GST invoicing.
				</p>
			</section>

			<section className="grid items-start gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
				{plans.map((plan) => {
					const tone = toneClasses[plan.tone];
					return (
						<div
							key={plan.name}
							className={cn(
								"pricing-plan glass-panel relative rounded-2xl border p-5",
								tone.border,
								tone.bg,
							)}
						>
							<div className="flex items-center gap-2">
								<span className="font-heading text-base font-bold tracking-tight">{plan.name}</span>
								<span
									className={cn(
										"rounded-md border px-1.5 py-0.5 text-[9.5px] font-bold tracking-[0.08em] uppercase",
										tone.chip,
									)}
								>
									{plan.tag}
								</span>
							</div>
							<p className="mt-2 min-h-[38px] text-[12.5px] leading-relaxed text-muted-foreground">
								{plan.who}
							</p>
							<div className="mt-3.5 flex items-baseline gap-1.5">
								<span className="font-code text-[28px] font-semibold tracking-tight text-foreground">
									{plan.price}
								</span>
								<span className="text-[11.5px] text-muted-foreground">{plan.per}</span>
							</div>
							<div className="mt-1 text-[11px] text-muted-foreground/70">{plan.note}</div>
							<Link
								to="/contact"
								className={cn(
									buttonVariants({ variant: plan.hero ? "default" : "outline" }),
									"mt-4 w-full",
								)}
							>
								{plan.cta}
							</Link>
							<div className="mt-4.5 h-px bg-border" />
							<div className="mt-3.5 flex flex-col gap-2">
								{plan.feats.map((feat) => (
									<div key={feat} className="flex items-start gap-2">
										<svg
											width="13"
											height="13"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2.6"
											strokeLinecap="round"
											strokeLinejoin="round"
											className={cn("mt-0.5 flex-none", tone.text)}
											aria-hidden="true"
										>
											<path d="M20 6 9 17l-5-5" />
										</svg>
										<span className="text-[12.5px] leading-relaxed text-foreground/85">{feat}</span>
									</div>
								))}
							</div>
						</div>
					);
				})}
			</section>

			<section className="overflow-hidden rounded-2xl border border-border bg-card/55">
				<div className="border-b border-border/70 px-5 py-3.5 font-heading text-[15px] font-bold">
					Compare in detail
				</div>
				<div className="overflow-x-auto">
					<div className="min-w-[720px]">
						<div className="grid grid-cols-[1.6fr_1fr_1fr_1fr_1fr] items-center bg-muted/40 px-5 py-2.5 text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
							<span />
							<span className="text-center">Lab</span>
							<span className="text-center">Institution</span>
							<span className="text-center">Enterprise</span>
							<span className="text-center">Sovereign</span>
						</div>
						{compareRows.map((row) => (
							<div
								key={row.k}
								className="grid grid-cols-[1.6fr_1fr_1fr_1fr_1fr] items-center border-t border-border/50 px-5 py-2.5"
							>
								<span className="text-[13px] text-foreground/85">{row.k}</span>
								<span className={cn("font-code text-center text-xs", compareCellClass(row.a))}>
									{row.a}
								</span>
								<span className={cn("font-code text-center text-xs", compareCellClass(row.b))}>
									{row.b}
								</span>
								<span className={cn("font-code text-center text-xs", compareCellClass(row.c))}>
									{row.c}
								</span>
								<span className={cn("font-code text-center text-xs", compareCellClass(row.d))}>
									{row.d}
								</span>
							</div>
						))}
					</div>
				</div>
			</section>

			<section className="grid gap-3.5 md:grid-cols-3">
				{faqs.map((faq, index) => (
					<motion.div
						key={faq.q}
						initial={{ opacity: 0, y: 16 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true, amount: 0.3 }}
						transition={{ duration: 0.4, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
						className="rounded-[14px] border border-border bg-card/55 p-4.5"
					>
						<div className="font-heading text-sm font-bold tracking-tight">{faq.q}</div>
						<p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{faq.a}</p>
					</motion.div>
				))}
			</section>
		</AnimatedPage>
	);
}

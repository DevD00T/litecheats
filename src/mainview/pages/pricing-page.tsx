import { useAuth } from "@/components/auth/auth-provider";
import { AnimatedPage } from "@/components/layout/animated-page";
import { Button, buttonVariants } from "@/components/ui/button";
import { billingApi } from "@/lib/billing-api";
import { CheckoutDismissedError, openRazorpayCheckout } from "@/lib/razorpay-checkout";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { gsap } from "gsap";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
	BILLING_CYCLES,
	BILLING_CYCLE_DAYS,
	BILLING_PLANS,
	type BillingCycle,
	type BillingPlan,
	type BillingPlanId,
	type BillingPlansResponse,
	calculateBillingAmount,
	findBillingPlan,
	formatInr,
} from "shared/billing";
import { toast } from "sonner";

type Tone = "muted" | "primary" | "secondary" | "destructive";

interface PlanPresentation {
	id: BillingPlanId;
	tag: string;
	who: string;
	/** Overrides the catalogue price for plans that are never charged online. */
	priceLabel?: string;
	per: string;
	note: string;
	cta: string;
	/** Cycle-aware label; "{days}" expands to the term length. Falls back to cta. */
	ctaTemplate?: string;
	tone: Tone;
	hero: boolean;
	feats: string[];
}

// Copy and styling live here; every rupee figure comes from the shared billing
// catalogue so the page can never advertise a price the server won't charge.
const planPresentation: PlanPresentation[] = [
	{
		id: "lab",
		tag: "Free",
		who: "Single research group getting a first vehicle online.",
		priceLabel: "₹0",
		per: "/ month",
		note: "up to 2 vehicles",
		cta: "Start free",
		tone: "muted",
		hero: false,
		feats: [
			"2 vehicles, 5 members",
			"Live telemetry + map",
			"7-day log retention",
			"Community support",
		],
	},
	{
		id: "operator",
		tag: "Starter",
		who: "Solo pilots and small commercial crews running a handful of airframes.",
		per: "/ vehicle / mo",
		note: "GST extra, up to 10 vehicles",
		cta: "Start with Operator",
		ctaTemplate: "Start {days}-day Operator",
		tone: "secondary",
		hero: false,
		feats: [
			"Up to 10 vehicles, 10 members",
			"Live telemetry + map",
			"Mission planner",
			"3-month log retention",
			"REST API, 180 req/min",
			"Email support",
		],
	},
	{
		id: "institution",
		tag: "Popular",
		who: "A department or university flying a mixed fleet weekly.",
		per: "/ vehicle / mo",
		note: "GST extra",
		cta: "Start 30-day pilot",
		ctaTemplate: "Start {days}-day pilot",
		tone: "primary",
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
		id: "enterprise",
		tag: "Scale",
		who: "Commercial operators and agencies with SLA obligations.",
		per: "/ vehicle / mo",
		note: "volume tiers from 25 vehicles",
		cta: "Buy Enterprise",
		ctaTemplate: "Buy {days}-day Enterprise",
		tone: "secondary",
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
		id: "sovereign",
		tag: "On-prem",
		who: "Defence and critical-infrastructure deployments.",
		priceLabel: "Custom",
		per: "",
		note: "annual licence",
		cta: "Request briefing",
		tone: "destructive",
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

const cycleLabels: Record<BillingCycle, string> = {
	monthly: "Monthly",
	annual: "Annual",
};

// Keyed by plan id rather than by column position, so adding a tier is a
// matter of adding one entry per row instead of renaming every column.
type CompareRow = { k: string; values: Record<BillingPlanId, string> };

const compareRows: CompareRow[] = [
	{
		k: "Vehicles included",
		values: {
			lab: "2",
			operator: "up to 10",
			institution: "per vehicle",
			enterprise: "per vehicle",
			sovereign: "unlimited",
		},
	},
	{
		k: "Members",
		values: {
			lab: "5",
			operator: "10",
			institution: "unlimited",
			enterprise: "unlimited",
			sovereign: "unlimited",
		},
	},
	{
		k: "Log retention",
		values: {
			lab: "7 d",
			operator: "3 mo",
			institution: "12 mo",
			enterprise: "24 mo",
			sovereign: "your policy",
		},
	},
	{
		k: "Concurrent FPV feeds",
		values: {
			lab: "1",
			operator: "2",
			institution: "6",
			enterprise: "24",
			sovereign: "unlimited",
		},
	},
	{
		k: "Mission planner",
		values: { lab: "—", operator: "✓", institution: "✓", enterprise: "✓", sovereign: "✓" },
	},
	{
		k: "ROV / subsea console",
		values: { lab: "—", operator: "—", institution: "✓", enterprise: "✓", sovereign: "✓" },
	},
	{
		k: "Custom frame decoding",
		values: { lab: "—", operator: "—", institution: "—", enterprise: "✓", sovereign: "✓" },
	},
	{
		k: "API rate limit",
		values: {
			lab: "60/min",
			operator: "180/min",
			institution: "600/min",
			enterprise: "6,000/min",
			sovereign: "unmetered",
		},
	},
	{
		k: "SSO / SCIM",
		values: {
			lab: "—",
			operator: "—",
			institution: "SSO",
			enterprise: "SSO + SCIM",
			sovereign: "SSO + SCIM",
		},
	},
	{
		k: "Uptime SLA",
		values: {
			lab: "—",
			operator: "99.0%",
			institution: "99.5%",
			enterprise: "99.95%",
			sovereign: "contracted",
		},
	},
	{
		k: "Deployment",
		values: {
			lab: "cloud",
			operator: "cloud",
			institution: "cloud",
			enterprise: "cloud",
			sovereign: "on-prem / VPC",
		},
	},
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
		q: "How do I pay?",
		a: "Checkout runs on Razorpay, so UPI, cards, net banking and wallets all work. Invoices are raised in INR with GST.",
	},
	{
		q: "Can we self-host?",
		a: "The Sovereign tier ships the relay and console as a VPC or air-gapped install with your own keys.",
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

// The term length belongs in the button label: "Start 30-day pilot" on a
// monthly cycle and "Start 365-day pilot" on an annual one. Without this the
// same label showed for both cycles, which misstated what was being bought.
function resolveCta(presentation: PlanPresentation, cycle: BillingCycle): string {
	if (!presentation.ctaTemplate) return presentation.cta;
	return presentation.ctaTemplate.replace("{days}", String(BILLING_CYCLE_DAYS[cycle]));
}

function clampQuantity(plan: BillingPlan, quantity: number): number {
	return Math.min(plan.maxQuantity, Math.max(plan.minQuantity, quantity));
}

export function PricingPage() {
	const scopeRef = useRef<HTMLElement | null>(null);
	const navigate = useNavigate();
	const { isAuthenticated } = useAuth();

	const [cycle, setCycle] = useState<BillingCycle>("annual");
	const [vehicles, setVehicles] = useState(2);
	const [catalogue, setCatalogue] = useState<BillingPlansResponse | null>(null);
	const [pendingPlanId, setPendingPlanId] = useState<BillingPlanId | null>(null);

	useEffect(() => {
		let cancelled = false;

		billingApi
			.getPlans()
			.then((response) => {
				if (!cancelled) setCatalogue(response);
			})
			.catch(() => {
				// Pricing must stay readable even when the billing API is down; the
				// catalogue only drives checkout availability and the tax figure.
				if (!cancelled) setCatalogue(null);
			});

		return () => {
			cancelled = true;
		};
	}, []);

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

	const handleCheckout = useCallback(
		async (planId: BillingPlanId) => {
			const plan = findBillingPlan(planId);
			if (!plan) return;

			if (!isAuthenticated) {
				navigate(`/login?redirect=${encodeURIComponent("/pricing")}`);
				return;
			}

			if (catalogue && !catalogue.configured) {
				toast.error("Online payments are not enabled on this deployment yet.");
				return;
			}

			setPendingPlanId(planId);
			try {
				const checkout = await billingApi.createCheckout({
					planId,
					cycle,
					quantity: clampQuantity(plan, vehicles),
				});
				const subscription = await openRazorpayCheckout(checkout);
				toast.success(`${subscription.planName} is active. Welcome aboard.`);
				navigate("/account");
			} catch (error) {
				if (error instanceof CheckoutDismissedError) {
					toast("Payment cancelled. Nothing was charged.");
				} else {
					toast.error(error instanceof Error ? error.message : "Checkout failed.");
				}
			} finally {
				setPendingPlanId(null);
			}
		},
		[catalogue, cycle, isAuthenticated, navigate, vehicles],
	);

	const taxPercent = catalogue?.taxPercent ?? 18;

	return (
		<AnimatedPage>
			<section ref={scopeRef} className="pricing-intro text-center">
				<div className="text-[11px] tracking-[0.16em] text-primary uppercase">Pricing</div>
				<h1 className="mt-3 font-heading text-4xl font-bold tracking-tight md:text-[44px]">
					Priced per vehicle, not per seat
				</h1>
				<p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
					Invite the whole department. You pay for the vehicles that actually connect, billed in INR
					with GST invoicing and checkout on Razorpay.
				</p>
			</section>

			<section className="flex flex-wrap items-center justify-center gap-3">
				<fieldset className="inline-flex rounded-lg border border-border bg-card/62 p-1">
					<legend className="sr-only">Billing cycle</legend>
					{BILLING_CYCLES.map((option) => (
						<button
							key={option}
							type="button"
							onClick={() => setCycle(option)}
							aria-pressed={cycle === option}
							className={cn(
								"rounded-md px-3.5 py-1.5 text-[12.5px] font-medium transition-colors",
								cycle === option
									? "bg-primary/15 text-primary"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{cycleLabels[option]}
						</button>
					))}
				</fieldset>

				<div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/62 px-3 py-1.5">
					<label htmlFor="vehicle-count" className="text-[12.5px] text-muted-foreground">
						Vehicles
					</label>
					<button
						type="button"
						aria-label="Decrease vehicle count"
						onClick={() => setVehicles((count) => Math.max(1, count - 1))}
						className="rounded-md px-2 text-base leading-none text-muted-foreground hover:text-foreground"
					>
						−
					</button>
					<input
						id="vehicle-count"
						type="number"
						min={1}
						max={500}
						value={vehicles}
						onChange={(event) => {
							const next = Number(event.target.value);
							setVehicles(Number.isFinite(next) ? Math.min(500, Math.max(1, next)) : 1);
						}}
						className="w-14 bg-transparent text-center font-code text-[13px] text-foreground outline-none"
					/>
					<button
						type="button"
						aria-label="Increase vehicle count"
						onClick={() => setVehicles((count) => Math.min(500, count + 1))}
						className="rounded-md px-2 text-base leading-none text-muted-foreground hover:text-foreground"
					>
						+
					</button>
				</div>
			</section>

			{!isAuthenticated ? (
				<p className="text-center text-[12.5px] text-muted-foreground">
					Paid plans need an account.{" "}
					<Link
						to={`/login?redirect=${encodeURIComponent("/pricing")}`}
						className="text-primary underline-offset-4 hover:underline"
					>
						Sign in
					</Link>{" "}
					or{" "}
					<Link
						to={`/signup?redirect=${encodeURIComponent("/pricing")}`}
						className="text-primary underline-offset-4 hover:underline"
					>
						create one
					</Link>{" "}
					— you will come straight back here to check out.
				</p>
			) : null}

			<section className="grid items-start gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
				{planPresentation.map((presentation) => {
					const plan = findBillingPlan(presentation.id);
					if (!plan) return null;

					const tone = toneClasses[presentation.tone];
					const quantity = clampQuantity(plan, vehicles);
					const breakdown =
						plan.kind === "checkout"
							? calculateBillingAmount(plan, cycle, quantity, taxPercent)
							: null;
					const isPending = pendingPlanId === presentation.id;
					const isBusy = pendingPlanId !== null;

					return (
						<div
							key={plan.id}
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
									{presentation.tag}
								</span>
							</div>
							<p className="mt-2 min-h-[38px] text-[12.5px] leading-relaxed text-muted-foreground">
								{presentation.who}
							</p>
							<div className="mt-3.5 flex items-baseline gap-1.5">
								<span className="font-code text-[28px] font-semibold tracking-tight text-foreground">
									{presentation.priceLabel ?? formatInr(plan.unitAmountPerMonth)}
								</span>
								<span className="text-[11.5px] text-muted-foreground">{presentation.per}</span>
							</div>
							<div className="mt-1 min-h-[16px] text-[11px] text-muted-foreground/70">
								{presentation.note}
							</div>

							{breakdown ? (
								<div className="mt-3 rounded-lg border border-border/60 bg-background/40 p-2.5 text-[11.5px]">
									<div className="flex items-baseline justify-between">
										<span className="text-muted-foreground">
											{quantity} vehicle{quantity === 1 ? "" : "s"} × {breakdown.months} mo
										</span>
										<span className="font-code text-foreground/85">
											{formatInr(breakdown.subtotal)}
										</span>
									</div>
									<div className="mt-1 flex items-baseline justify-between">
										<span className="text-muted-foreground">GST {breakdown.taxPercent}%</span>
										<span className="font-code text-foreground/85">
											{formatInr(breakdown.taxAmount)}
										</span>
									</div>
									<div className="mt-1.5 flex items-baseline justify-between border-t border-border/60 pt-1.5">
										<span className="font-medium text-foreground">Pay today</span>
										<span className={cn("font-code font-semibold", tone.text)}>
											{formatInr(breakdown.total)}
										</span>
									</div>
									{quantity !== vehicles ? (
										<p className="mt-1.5 text-[10.5px] text-muted-foreground/70">
											Minimum {plan.minQuantity} vehicles on this tier.
										</p>
									) : null}
								</div>
							) : null}

							{plan.kind === "checkout" ? (
								<Button
									type="button"
									variant={presentation.hero ? "default" : "outline"}
									className="mt-4 w-full"
									disabled={isBusy}
									onClick={() => void handleCheckout(plan.id)}
								>
									{isPending
										? "Opening checkout..."
										: isAuthenticated
											? resolveCta(presentation, cycle)
											: "Sign in to continue"}
								</Button>
							) : (
								<Link
									to={plan.kind === "free" ? "/signup" : "/contact"}
									className={cn(
										buttonVariants({ variant: presentation.hero ? "default" : "outline" }),
										"mt-4 w-full",
									)}
								>
									{presentation.cta}
								</Link>
							)}

							<div className="mt-4.5 h-px bg-border" />
							<div className="mt-3.5 flex flex-col gap-2">
								{presentation.feats.map((feat) => (
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

			{catalogue && !catalogue.configured ? (
				<p className="text-center text-[12px] text-warning">
					Online checkout is disabled on this deployment — Razorpay keys are not configured yet.
				</p>
			) : null}

			<section className="overflow-hidden rounded-2xl border border-border bg-card/55">
				<div className="border-b border-border/70 px-5 py-3.5 font-heading text-[15px] font-bold">
					Compare in detail
				</div>
				<div className="overflow-x-auto">
					<div className="min-w-[720px]">
						<div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr] items-center bg-muted/40 px-5 py-2.5 text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
							<span />
							{BILLING_PLANS.map((plan) => (
								<span key={plan.id} className="text-center">
									{plan.name}
								</span>
							))}
						</div>
						{compareRows.map((row) => (
							<div
								key={row.k}
								className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr] items-center border-t border-border/50 px-5 py-2.5"
							>
								<span className="text-[13px] text-foreground/85">{row.k}</span>
								{BILLING_PLANS.map((plan) => (
									<span
										key={plan.id}
										className={cn(
											"font-code text-center text-xs",
											compareCellClass(row.values[plan.id]),
										)}
									>
										{row.values[plan.id]}
									</span>
								))}
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

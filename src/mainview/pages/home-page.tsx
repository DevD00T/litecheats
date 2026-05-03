import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ZapHandle, ZapIcon } from "@/components/ui/zap";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { gsap } from "gsap";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";

const services = [
	{
		title: "Product Engineering",
		description:
			"Design and ship robust product experiences with clean architecture, thoughtful UX, and scalable application foundations.",
		stat: "Web + App Platforms",
	},
	{
		title: "Cloud & DevOps",
		description:
			"Move faster with secure CI/CD, performance-focused infrastructure, and automated reliability practices built for growth.",
		stat: "Release Stability",
	},
	{
		title: "AI Integration",
		description:
			"Implement useful AI workflows, copilots, and automation that reduce repetitive work and improve operational throughput.",
		stat: "Workflow Acceleration",
	},
];

const deliverySignals = [
	{ label: "Sprint Velocity", value: 86, note: "+18% in 8 weeks" },
	{ label: "Defect Escape", value: 21, note: "-42% post hardening" },
	{ label: "Deploy Cadence", value: 92, note: "Weekly to daily" },
];

const outcomeChips = [
	"120+ products delivered",
	"94% long-term retention",
	"36% cycle-time reduction",
];

const engagementSteps = [
	{
		title: "Architecture Discovery",
		description:
			"Assess goals, constraints, and technical debt to align roadmap scope with measurable business outcomes.",
	},
	{
		title: "Execution Sprints",
		description:
			"Deliver in short cycles with transparent demos, release notes, and quality gates at every milestone.",
	},
	{
		title: "Scale & Operate",
		description:
			"Strengthen monitoring, automate ops workflows, and hand off reliable systems with structured support.",
	},
];

export function HomePage() {
	const scopeRef = useRef<HTMLElement | null>(null);
	const heroLogoRef = useRef<ZapHandle | null>(null);

	useEffect(() => {
		heroLogoRef.current?.startAnimation();
		const timer = window.setTimeout(() => {
			heroLogoRef.current?.stopAnimation();
		}, 900);

		return () => {
			window.clearTimeout(timer);
		};
	}, []);

	useLayoutEffect(() => {
		if (!scopeRef.current) return;

		const ctx = gsap.context(() => {
			const introTimeline = gsap.timeline();
			introTimeline
				.from(".home-chip", {
					y: 18,
					opacity: 0,
					duration: 0.58,
					ease: "power2.out",
				})
				.from(
					".home-title",
					{
						y: 30,
						opacity: 0,
						duration: 0.82,
						ease: "power3.out",
					},
					"-=0.36",
				)
				.from(
					".home-copy",
					{
						y: 20,
						opacity: 0,
						duration: 0.66,
						ease: "power2.out",
					},
					"-=0.42",
				)
				.from(
					".home-cta",
					{
						y: 16,
						opacity: 0,
						duration: 0.45,
						stagger: 0.07,
						ease: "power2.out",
					},
					"-=0.35",
				);

			gsap.from(".signal-card", {
				y: 26,
				opacity: 0,
				duration: 0.62,
				ease: "power2.out",
				delay: 0.18,
			});
			gsap.fromTo(
				".signal-bar-fill",
				{ scaleX: 0 },
				{
					scaleX: 1,
					duration: 0.75,
					ease: "power2.out",
					stagger: 0.08,
					delay: 0.34,
					transformOrigin: "left center",
				},
			);
			gsap.from(".service-card", {
				y: 26,
				opacity: 0,
				duration: 0.56,
				ease: "power2.out",
				stagger: 0.09,
				delay: 0.26,
			});
			gsap.from(".process-step", {
				y: 24,
				opacity: 0,
				duration: 0.54,
				ease: "power2.out",
				stagger: 0.08,
				delay: 0.3,
			});
			gsap.from(".cta-panel", {
				y: 24,
				opacity: 0,
				duration: 0.6,
				ease: "power2.out",
				delay: 0.34,
			});

			gsap.to(".home-orb-a", {
				y: -16,
				x: 12,
				duration: 5,
				repeat: -1,
				yoyo: true,
				ease: "sine.inOut",
			});
			gsap.to(".home-orb-b", {
				y: 14,
				x: -15,
				duration: 6,
				repeat: -1,
				yoyo: true,
				ease: "sine.inOut",
			});
			gsap.to(".home-orb-c", {
				y: -10,
				x: 10,
				duration: 7,
				repeat: -1,
				yoyo: true,
				ease: "sine.inOut",
			});
			gsap.to(".hero-grid", {
				backgroundPosition: "220px 220px",
				duration: 15,
				repeat: -1,
				ease: "none",
			});
			gsap.to(".scroll-pill", {
				y: 10,
				duration: 1.2,
				repeat: -1,
				yoyo: true,
				ease: "sine.inOut",
			});
			gsap.to(".hero-outline", {
				rotation: 360,
				duration: 26,
				repeat: -1,
				ease: "none",
				transformOrigin: "50% 50%",
			});
		}, scopeRef);

		return () => ctx.revert();
	}, []);

	return (
		<AnimatedPage>
			<section
				ref={scopeRef}
				className="page-shell overflow-hidden rounded-3xl border border-border/60 bg-card/70 px-6 py-10 md:px-10 md:py-12"
			>
				<div className="hero-grid absolute inset-0 opacity-55" />
				<div className="orb home-orb-a -top-10 -right-10 h-40 w-40 bg-primary/35" />
				<div className="orb home-orb-b -bottom-16 -left-10 h-44 w-44 bg-secondary/35" />
				<div className="orb home-orb-c top-14 left-1/2 h-28 w-28 -translate-x-1/2 bg-accent/35" />
				<div className="hero-outline pointer-events-none absolute top-8 right-8 h-32 w-32 rounded-full border border-primary/28 md:h-40 md:w-40" />

				<div className="relative z-10 grid gap-8 lg:grid-cols-[1.15fr_0.95fr]">
					<div className="space-y-6">
						<Badge
							variant="secondary"
							className="home-chip inline-flex w-fit items-center gap-2 bg-primary/12 p-2 text-primary"
						>
							<ZapIcon ref={heroLogoRef} size={18} aria-hidden />
							<span className="text-xs font-semibold tracking-[0.1em] uppercase text-foreground/90">
								Litecheats Technologies
							</span>
						</Badge>
						<h1 className="home-title font-heading text-4xl font-semibold tracking-tight text-balance md:text-6xl">
							We design, build, and scale digital products with elite execution speed.
						</h1>
						<p className="home-copy max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
							From product strategy to production reliability, we partner with ambitious teams to
							ship high-quality platforms that perform under real-world growth pressure.
						</p>
						<div className="flex flex-wrap gap-3">
							<Link to="/contact" className={cn(buttonVariants({ size: "lg" }), "home-cta")}>
								Start Your Build
							</Link>
							<Link
								to="/about"
								className={cn(buttonVariants({ variant: "outline", size: "lg" }), "home-cta")}
							>
								Explore Our Process
							</Link>
						</div>
						<div className="flex flex-wrap gap-2 pt-1">
							{outcomeChips.map((chip) => (
								<span
									key={chip}
									className="home-cta rounded-full border border-border/60 bg-background/72 px-3 py-1 text-xs font-medium text-muted-foreground"
								>
									{chip}
								</span>
							))}
						</div>
					</div>

					<Card className="signal-card border-primary/24 bg-background/82">
						<CardHeader>
							<CardTitle className="font-heading text-xl">Live Delivery Signals</CardTitle>
							<CardDescription>
								Representative metrics from recent high-velocity engagements.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-5">
							{deliverySignals.map((signal) => (
								<div key={signal.label} className="space-y-2">
									<div className="flex items-center justify-between text-xs text-muted-foreground">
										<span className="tracking-[0.14em] uppercase">{signal.label}</span>
										<span>{signal.note}</span>
									</div>
									<div className="h-2 overflow-hidden rounded-full bg-muted/70">
										<div
											className="signal-bar-fill h-full rounded-full bg-[linear-gradient(90deg,rgba(58,134,255,0.95),rgba(255,163,89,0.95),rgba(88,237,197,0.9))]"
											style={{ width: `${signal.value}%` }}
										/>
									</div>
								</div>
							))}
							<div className="scroll-pill inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
								Tracking quality, velocity, and stability in every sprint.
							</div>
						</CardContent>
					</Card>
				</div>
			</section>

			<section className="grid gap-5 md:grid-cols-3">
				{services.map((service, index) => (
					<motion.article
						key={service.title}
						initial={{ opacity: 0, y: 26 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true, amount: 0.25 }}
						transition={{ duration: 0.5, delay: index * 0.08, ease: [0.24, 0.8, 0.24, 1] }}
						whileHover={{ y: -7, scale: 1.01 }}
					>
						<Card className="service-card h-full border-border/65 bg-background/83">
							<CardHeader>
								<CardTitle className="font-heading text-xl">{service.title}</CardTitle>
								<CardDescription>{service.stat}</CardDescription>
							</CardHeader>
							<CardContent>
								<p className="text-sm leading-relaxed text-muted-foreground">
									{service.description}
								</p>
							</CardContent>
						</Card>
					</motion.article>
				))}
			</section>

			<section className="rounded-2xl border border-border/65 bg-background/88 p-6 md:p-8">
				<div className="mb-5 flex items-center justify-between gap-4">
					<h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
						How We Engage
					</h2>
					<Link
						to="/terms"
						className={cn(buttonVariants({ variant: "outline" }), "hidden md:inline-flex")}
					>
						Read Delivery Terms
					</Link>
				</div>
				<div className="grid gap-4 md:grid-cols-3">
					{engagementSteps.map((step, index) => (
						<motion.div
							key={step.title}
							initial={{ opacity: 0, y: 22 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: true, amount: 0.25 }}
							transition={{ duration: 0.45, delay: index * 0.1, ease: [0.24, 0.8, 0.24, 1] }}
							className="process-step rounded-xl border border-border/70 bg-muted/45 p-4"
						>
							<p className="text-xs uppercase tracking-[0.16em] text-primary">Phase {index + 1}</p>
							<p className="mt-2 font-heading text-lg leading-tight text-foreground">
								{step.title}
							</p>
							<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
								{step.description}
							</p>
						</motion.div>
					))}
				</div>
				<Link
					to="/terms"
					className={cn(buttonVariants({ variant: "outline" }), "mt-5 inline-flex md:hidden")}
				>
					Read Delivery Terms
				</Link>
			</section>

			<motion.section
				initial={{ opacity: 0, y: 20 }}
				whileInView={{ opacity: 1, y: 0 }}
				viewport={{ once: true, amount: 0.35 }}
				transition={{ duration: 0.5, ease: [0.24, 0.8, 0.24, 1] }}
				className="cta-panel rounded-3xl border border-primary/24 bg-[linear-gradient(130deg,rgba(58,134,255,0.16),rgba(255,178,95,0.14),rgba(81,216,182,0.12))] p-6 md:p-8"
			>
				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div>
						<p className="text-xs uppercase tracking-[0.16em] text-primary">Ready To Start</p>
						<h3 className="mt-2 font-heading text-2xl font-semibold tracking-tight md:text-3xl">
							Bring your next release to market with confidence.
						</h3>
						<p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
							Share your scope and timeline. We’ll return a practical execution plan tailored for
							speed, stability, and measurable impact.
						</p>
					</div>
					<Link to="/contact" className={cn(buttonVariants({ size: "lg" }), "w-fit")}>
						Talk to Litecheats
					</Link>
				</div>
			</motion.section>
		</AnimatedPage>
	);
}

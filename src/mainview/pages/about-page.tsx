import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";
import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";

const values = [
	{
		title: "National Capability Focus",
		text: "We build advanced data-mining, defense-ready, and reverse-engineering software capabilities with a long-term India-first engineering vision.",
	},
	{
		title: "Authorized Reverse Engineering",
		text: "Our reverse-engineering programs are designed for lawful, authorized analysis, optimization, interoperability, and modernization of software systems.",
	},
	{
		title: "Mission-Grade Delivery",
		text: "We prioritize precision architecture, secure software practices, and measurable outcomes for high-stakes operational environments.",
	},
];

const journey = [
	{
		year: "Foundational Phase",
		event:
			"Litecheats Technologies established its core focus on data mining, software hardening, and reverse-engineering workflows for advanced technical use-cases.",
	},
	{
		year: "Strategic Alignment",
		event:
			"The team deepened its work toward defense-ready engineering standards, performance optimization, and reliability for critical systems.",
	},
	{
		year: "Brand Positioning",
		event:
			"Litecheats Technologies operates as a brand under Rotorcraftory Private Limited, with leadership and execution driven by the Litecheats team.",
	},
	{
		year: "Current Mission",
		event:
			"Headquartered in Hooghly, West Bengal, India, the organization is focused on advancing India's growth in reverse-engineering software capability.",
	},
];

export function AboutPage() {
	const scopeRef = useRef<HTMLElement | null>(null);

	useLayoutEffect(() => {
		if (!scopeRef.current) return;

		const ctx = gsap.context(() => {
			gsap.from(".about-title", {
				y: 24,
				opacity: 0,
				duration: 0.7,
				ease: "power3.out",
			});
			gsap.from(".about-card", {
				y: 22,
				opacity: 0,
				duration: 0.52,
				stagger: 0.09,
				ease: "power2.out",
				delay: 0.08,
			});
			gsap.from(".journey-item", {
				x: -18,
				opacity: 0,
				duration: 0.5,
				stagger: 0.07,
				ease: "power2.out",
				delay: 0.14,
			});
		}, scopeRef);

		return () => ctx.revert();
	}, []);

	return (
		<AnimatedPage>
			<section ref={scopeRef} className="space-y-8">
				<div className="about-title space-y-4 rounded-2xl border border-border/65 bg-card/70 p-6 md:p-8">
					<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
						About Us
					</Badge>
					<h1 className="font-heading text-3xl font-semibold tracking-tight md:text-5xl">
						Litecheats Technologies: Data Mining, Defense-Ready Software, and Reverse Engineering
					</h1>
					<p className="max-w-4xl text-sm leading-relaxed text-muted-foreground md:text-base">
						Litecheats Technologies focuses on extracting maximum software potential through
						advanced data-mining systems and reverse-engineering methodologies. We design and
						deliver defense-ready software capabilities with a commitment to resilient engineering
						outcomes. Litecheats Technologies is a brand under Rotorcraftory Private Limited in
						India, and the Rotorcraftory ownership and execution team is the Litecheats Technologies
						team. Our main office is in Hooghly, West Bengal, India.
					</p>
				</div>

				<div className="grid gap-5 md:grid-cols-3">
					{values.map((value) => (
						<motion.div key={value.title} whileHover={{ y: -5 }} transition={{ duration: 0.2 }}>
							<Card className="about-card h-full bg-background/80">
								<CardHeader>
									<CardTitle className="font-heading text-xl">{value.title}</CardTitle>
								</CardHeader>
								<CardContent>
									<p className="text-sm leading-relaxed text-muted-foreground">{value.text}</p>
								</CardContent>
							</Card>
						</motion.div>
					))}
				</div>

				<Card className="about-card bg-background/85">
					<CardHeader>
						<CardTitle className="font-heading text-2xl">Identity and Mission Timeline</CardTitle>
						<CardDescription>
							Key points defining Litecheats Technologies and Rotorcraftory Private Limited
							alignment.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{journey.map((item) => (
							<div
								key={item.year}
								className="journey-item rounded-lg border border-border/65 bg-muted/35 p-4"
							>
								<p className="text-xs uppercase tracking-[0.16em] text-primary">{item.year}</p>
								<p className="mt-2 text-sm leading-relaxed text-foreground">{item.event}</p>
							</div>
						))}
					</CardContent>
				</Card>
			</section>
		</AnimatedPage>
	);
}

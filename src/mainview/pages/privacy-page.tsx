import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";

const privacySections = [
	{
		title: "Who We Are",
		points: [
			"Litecheats Technologies operates as a brand under Rotorcraftory Private Limited in India.",
			"Primary operations are based in Hooghly, West Bengal, India.",
		],
	},
	{
		title: "Data We Collect",
		points: [
			"Identity and contact details such as name, email, phone number, organization details, and communication records.",
			"Project and technical data you submit, including software artifacts, logs, documentation, test material, and system metadata relevant to service delivery.",
			"Operational and security telemetry such as IP data, browser/device information, and service diagnostics.",
		],
	},
	{
		title: "Why We Process Data",
		points: [
			"To evaluate inquiries, execute contracts, deliver services, and provide technical support.",
			"To maintain platform reliability, security monitoring, fraud prevention, and incident response.",
			"To meet statutory, regulatory, audit, and law-enforcement obligations where legally required.",
		],
	},
	{
		title: "Legal and Regulatory Context",
		points: [
			"Data handling is designed to align with applicable Indian legal requirements, including the Information Technology Act, 2000 and related rules.",
			"Where applicable, processing of digital personal data is intended to align with the Digital Personal Data Protection Act, 2023, to the extent notified and applicable.",
		],
	},
	{
		title: "Sharing and Disclosure",
		points: [
			"We do not sell personal data.",
			"Data may be shared with vetted service providers, contractors, or infrastructure partners strictly for legitimate business purposes under contractual confidentiality safeguards.",
			"Data may be disclosed where required by law, court order, or lawful governmental request.",
		],
	},
	{
		title: "Retention and Deletion",
		points: [
			"Data is retained only for as long as necessary for service delivery, legal compliance, dispute management, and legitimate business records.",
			"Retention periods may differ based on contract obligations, audit requirements, and statutory mandates.",
		],
	},
	{
		title: "Cross-Border Processing",
		points: [
			"Where required for infrastructure, support, or client delivery, certain processing may occur outside India using appropriate contractual and security controls.",
			"Cross-border handling is subject to applicable legal restrictions and internal compliance review.",
		],
	},
	{
		title: "Your Rights and Requests",
		points: [
			"You may request access, correction, update, or deletion of personal data, subject to legal and contractual limitations.",
			"You may withdraw consent where processing is consent-based, subject to consequences under applicable law and service feasibility.",
			"For privacy requests, email support@litecheats.com with complete request details.",
		],
	},
	{
		title: "Security and Incident Management",
		points: [
			"We implement technical, administrative, and organizational safeguards proportionate to data sensitivity and risk.",
			"No transmission or storage mechanism is fully risk-free; however, we maintain controls for prevention, detection, and response.",
		],
	},
	{
		title: "Governing Law and Jurisdiction",
		points: [
			"This Privacy Policy is governed by the laws of India.",
			"Disputes related to this policy are subject to the jurisdiction of competent courts in West Bengal, India, including courts at Hooghly and courts having appellate or supervisory jurisdiction over Hooghly.",
		],
	},
];

export function PrivacyPage() {
	const scopeRef = useRef<HTMLElement | null>(null);

	useLayoutEffect(() => {
		if (!scopeRef.current) return;

		const ctx = gsap.context(() => {
			gsap.from(".privacy-heading", {
				y: 22,
				opacity: 0,
				duration: 0.65,
				ease: "power3.out",
			});
			gsap.from(".privacy-section", {
				y: 20,
				opacity: 0,
				duration: 0.5,
				stagger: 0.07,
				ease: "power2.out",
				delay: 0.08,
			});
		}, scopeRef);

		return () => ctx.revert();
	}, []);

	return (
		<AnimatedPage>
			<section ref={scopeRef} className="space-y-6">
				<div className="privacy-heading rounded-2xl border border-border/65 bg-card/75 p-6 md:p-8">
					<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
						Privacy Policy
					</Badge>
					<h1 className="mt-4 font-heading text-3xl font-semibold tracking-tight md:text-5xl">
						Privacy Policy
					</h1>
					<p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted-foreground md:text-base">
						Effective date: May 2, 2026. This policy explains how Litecheats Technologies, a brand
						under Rotorcraftory Private Limited, collects, uses, and protects personal and technical
						data.
					</p>
				</div>

				<div className="grid gap-4">
					{privacySections.map((section) => (
						<Card key={section.title} className="privacy-section bg-background/85">
							<CardHeader>
								<CardTitle className="font-heading text-xl">{section.title}</CardTitle>
							</CardHeader>
							<CardContent>
								<ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
									{section.points.map((point) => (
										<li key={point}>{point}</li>
									))}
								</ul>
							</CardContent>
						</Card>
					))}
				</div>
			</section>
		</AnimatedPage>
	);
}

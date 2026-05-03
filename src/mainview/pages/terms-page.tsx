import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";

const termsSections = [
	{
		title: "Corporate Identity and Acceptance",
		points: [
			"These Terms govern use of the Litecheats Technologies website, communications, and services. Litecheats Technologies operates as a brand under Rotorcraftory Private Limited, India.",
			"By accessing this website or engaging our services, you agree to these Terms. If you do not agree, you must discontinue use.",
		],
	},
	{
		title: "Services and Authorized Use",
		points: [
			"Our services may include data mining solutions, defense-ready software engineering, and reverse-engineering services for authorized technical purposes.",
			"You represent and warrant that you have lawful rights, permissions, and authority for any software, systems, binaries, firmware, data, or materials you provide for analysis or reverse engineering.",
			"Services must not be used for unlawful access, infringement, unauthorized surveillance, malware activity, or any prohibited purpose under applicable law.",
		],
	},
	{
		title: "Applicable Law and Compliance Framework",
		points: [
			"These Terms are read with applicable Indian laws, including the Indian Contract Act, 1872 and the Information Technology Act, 2000, together with applicable rules, notifications, and amendments.",
			"Personal-data handling obligations are addressed in our Privacy Policy and are intended to align with the Digital Personal Data Protection Act, 2023, to the extent notified and applicable.",
			"Both parties agree to comply with all applicable legal and regulatory obligations relevant to the project scope, including sector-specific and security-related requirements.",
		],
	},
	{
		title: "Defense and Security Restrictions",
		points: [
			"Where services involve defense, critical infrastructure, or sensitive environments, additional controls, screening, and contractual safeguards may apply.",
			"Client is responsible for obtaining all required clearances, licenses, and internal approvals before sharing controlled or restricted materials.",
		],
	},
	{
		title: "Intellectual Property and Deliverables",
		points: [
			"Each party retains ownership of its pre-existing intellectual property, methods, tools, and proprietary know-how.",
			"Subject to full payment and specific contract terms, client-specific deliverables are licensed or assigned as defined in the signed agreement.",
			"No transfer of rights is implied for third-party components, open-source software, or Litecheats/Rotorcraftory pre-existing frameworks unless expressly stated.",
		],
	},
	{
		title: "Confidentiality and Data Handling",
		points: [
			"Both parties must keep confidential information secure and use it only for agreed project purposes.",
			"Technical artifacts, reports, and extracted intelligence generated through reverse-engineering engagements are treated as confidential unless otherwise agreed in writing.",
		],
	},
	{
		title: "Commercial Terms, Warranty, and Liability",
		points: [
			"Commercial terms, milestones, invoicing, acceptance, and support obligations are governed by the signed proposal, statement of work, or master agreement.",
			"Except as explicitly agreed, services are provided on an as-is and as-available basis within commercially reasonable professional standards.",
			"To the maximum extent permitted by law, Litecheats Technologies and Rotorcraftory Private Limited are not liable for indirect, incidental, special, or consequential damages.",
		],
	},
	{
		title: "Governing Law, Jurisdiction, and Dispute Resolution",
		points: [
			"These Terms are governed by the laws of India.",
			"Subject to any agreed dispute-resolution mechanism, parties submit to the exclusive jurisdiction of competent courts in West Bengal, India, including courts at Hooghly and courts having appellate or supervisory jurisdiction over Hooghly.",
			"Where legally required, parties may first attempt good-faith resolution through written notice and structured commercial discussion before litigation.",
		],
	},
];

export function TermsPage() {
	const scopeRef = useRef<HTMLElement | null>(null);

	useLayoutEffect(() => {
		if (!scopeRef.current) return;

		const ctx = gsap.context(() => {
			gsap.from(".legal-heading", {
				y: 22,
				opacity: 0,
				duration: 0.65,
				ease: "power3.out",
			});
			gsap.from(".legal-section", {
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
				<div className="legal-heading rounded-2xl border border-border/65 bg-card/75 p-6 md:p-8">
					<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
						Terms & Conditions
					</Badge>
					<h1 className="mt-4 font-heading text-3xl font-semibold tracking-tight md:text-5xl">
						Terms of Service
					</h1>
					<p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted-foreground md:text-base">
						Effective date: May 2, 2026. These terms apply to Litecheats Technologies, a brand of
						Rotorcraftory Private Limited, with principal operations in Hooghly, West Bengal, India.
					</p>
				</div>

				<div className="grid gap-4">
					{termsSections.map((section) => (
						<Card key={section.title} className="legal-section bg-background/85">
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

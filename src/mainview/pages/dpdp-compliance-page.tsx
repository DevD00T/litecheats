import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";

const dpdpSections = [
	{
		title: "Scope of This Policy",
		points: [
			"This policy explains how Litecheats Technologies, a brand under Rotorcraftory Private Limited, handles personal data as a Data Fiduciary under the Digital Personal Data Protection Act, 2023 (DPDP Act), to the extent notified and applicable.",
			"It applies alongside, not instead of, our Privacy Policy — this page focuses specifically on DPDP Act rights and obligations.",
		],
	},
	{
		title: "Your Rights as a Data Principal",
		points: [
			"Right to a summary of the personal data we hold about you and the processing activities carried out on it.",
			"Right to correction, completion, and updating of inaccurate or outdated personal data.",
			"Right to erasure of personal data once it is no longer necessary for the purpose it was collected for, subject to legal retention obligations.",
			"Right to withdraw consent at any time, as easily as it was given, without affecting processing already carried out lawfully before withdrawal.",
			"Right to nominate another individual to exercise these rights on your behalf in the event of death or incapacity.",
			"Right to grievance redressal through our Grievance Officer before approaching the Data Protection Board of India.",
		],
	},
	{
		title: "Consent and Notice",
		points: [
			"Wherever consent is the basis for processing, we ask for it through a clear, itemized notice in plain language before or at the time of collection, specifying the personal data collected and the purpose of processing.",
			"Consent requests are presented separately from other terms and can be withdrawn as easily as they were given, using the same channel you gave consent through wherever technically feasible.",
			"Where a request is made in English or a language listed in the Eighth Schedule to the Constitution of India, we make reasonable efforts to honor that language for the consent notice.",
		],
	},
	{
		title: "Processing Without Consent",
		points: [
			"In narrow cases permitted under the DPDP Act — such as compliance with a legal obligation, a medical emergency, or personal data voluntarily provided to us by you for a specified purpose — we may process personal data without separately seeking consent.",
			"These grounds are applied narrowly and do not extend to unrelated secondary uses of your data.",
		],
	},
	{
		title: "Our Obligations as a Data Fiduciary",
		points: [
			"We process personal data only for the purpose it was collected for, or a purpose you would reasonably expect.",
			"We take reasonable security safeguards — encryption in transit, access controls, and audit logging — to prevent personal data breaches.",
			"We erase personal data, and require processors acting on our behalf to erase it, once the specified purpose is no longer being served and retention is not required by law.",
			"Where we engage data processors, we do so under a valid contract that binds them to equivalent obligations.",
		],
	},
	{
		title: "Children's Data",
		points: [
			"We do not knowingly process personal data of a child (under 18 years) without verifiable consent from a parent or lawful guardian.",
			"We do not undertake tracking, behavioral monitoring, or targeted advertising directed at children.",
		],
	},
	{
		title: "Data Breach Notification",
		points: [
			"In the event of a personal data breach, we will notify the Data Protection Board of India and affected Data Principals in the manner and timeline prescribed under the DPDP Act and its rules.",
			"Notifications will describe the nature of the breach, the likely consequences, and the measures taken or proposed to mitigate risk.",
		],
	},
	{
		title: "Cross-Border Data Transfer",
		points: [
			"Personal data may be transferred outside India for processing, except to countries or territories restricted by the Central Government by notification under the DPDP Act.",
			"Our primary infrastructure is hosted in ap-south-1 (Mumbai); any transfer outside that region is subject to internal compliance review.",
		],
	},
	{
		title: "Grievance Officer",
		points: [
			'For any DPDP Act request, complaint, or grievance, contact our Grievance Officer at support@litecheats.com with the subject line "DPDP Grievance".',
			"We aim to acknowledge grievances within 7 business days and resolve them within the timeline prescribed under applicable rules.",
			"If you are not satisfied with our response, you may approach the Data Protection Board of India as provided under the DPDP Act.",
		],
	},
	{
		title: "Governing Law and Updates",
		points: [
			"This policy is governed by the laws of India and will be updated as the DPDP Act's rules are notified and phased in.",
			"Material changes will be reflected here with an updated effective date; continued use of our services after an update constitutes acknowledgment of the revised policy.",
		],
	},
];

export function DpdpCompliancePage() {
	const scopeRef = useRef<HTMLElement | null>(null);

	useLayoutEffect(() => {
		if (!scopeRef.current) return;

		const ctx = gsap.context(() => {
			gsap.from(".dpdp-heading", { y: 22, opacity: 0, duration: 0.65, ease: "power3.out" });
			gsap.from(".dpdp-section", {
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
				<div className="dpdp-heading rounded-2xl border border-border/65 bg-card/75 p-6 md:p-8">
					<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
						DPDP Compliance
					</Badge>
					<h1 className="mt-4 font-heading text-3xl font-semibold tracking-tight md:text-5xl">
						Digital Personal Data Protection Act Compliance
					</h1>
					<p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted-foreground md:text-base">
						Effective date: May 2, 2026. This page sets out how Litecheats Technologies, a brand
						under Rotorcraftory Private Limited, meets its obligations and your rights as a Data
						Principal under India's Digital Personal Data Protection Act, 2023.
					</p>
				</div>

				<div className="grid gap-4">
					{dpdpSections.map((section) => (
						<Card key={section.title} className="dpdp-section bg-background/85">
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

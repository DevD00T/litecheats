import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";

const whatWeValue = [
	{
		title: "Small, senior team",
		text: "We stay small on purpose. Everyone who joins owns a real surface of the product, from the MAVLink router to the RDOS console.",
	},
	{
		title: "Hooghly-based, remote-friendly",
		text: "Our core team works out of Hooghly, West Bengal, with remote engineering support for specialised roles.",
	},
	{
		title: "Reverse-engineering rigor",
		text: "Whether it is a flight controller or a legacy binary, we value precision, authorised methodology, and defensible engineering decisions.",
	},
];

export function CareersPage() {
	const scopeRef = useRef<HTMLElement | null>(null);

	useLayoutEffect(() => {
		if (!scopeRef.current) return;
		const ctx = gsap.context(() => {
			gsap.from(".careers-intro", { y: 24, opacity: 0, duration: 0.65, ease: "power3.out" });
			gsap.from(".careers-card", {
				y: 20,
				opacity: 0,
				duration: 0.5,
				stagger: 0.08,
				ease: "power2.out",
				delay: 0.1,
			});
		}, scopeRef);
		return () => ctx.revert();
	}, []);

	return (
		<AnimatedPage>
			<section ref={scopeRef} className="space-y-6">
				<div className="careers-intro space-y-3 rounded-2xl border border-border/65 bg-card/70 p-6 md:p-8">
					<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
						Careers
					</Badge>
					<h1 className="font-heading text-3xl font-semibold tracking-tight md:text-5xl">
						No open roles right now — but we keep a list
					</h1>
					<p className="max-w-3xl text-sm leading-relaxed text-muted-foreground md:text-base">
						Litecheats Technologies hires in small, deliberate batches rather than running a
						continuous pipeline. We do not have an open requisition at the moment, but we keep a
						list of people to reach out to when a role opens on the RDOS platform, MAVLink cloud, or
						reverse-engineering team.
					</p>
				</div>

				<div className="grid gap-4 md:grid-cols-3">
					{whatWeValue.map((item) => (
						<Card key={item.title} className="careers-card h-full bg-background/85">
							<CardHeader>
								<CardTitle className="font-heading text-lg">{item.title}</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="text-sm leading-relaxed text-muted-foreground">{item.text}</p>
							</CardContent>
						</Card>
					))}
				</div>

				<Card className="careers-card bg-background/85">
					<CardHeader>
						<CardTitle className="font-heading text-xl">Get on the list</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
							Send your background and the kind of problems you want to work on to{" "}
							<a href="mailto:support@litecheats.com" className="text-primary hover:underline">
								support@litecheats.com
							</a>
							. We read every message, even without an open role to reply with.
						</p>
						<Link to="/contact" className={cn(buttonVariants(), "w-fit")}>
							Contact us instead
						</Link>
					</CardContent>
				</Card>
			</section>
		</AnimatedPage>
	);
}

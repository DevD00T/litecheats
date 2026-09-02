import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ZapIcon } from "@/components/ui/zap";
import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";

const factSheet = [
	{ k: "Legal name", v: "Litecheats Technologies" },
	{ k: "Headquarters", v: "Hooghly, West Bengal, India" },
	{ k: "Focus areas", v: "Data mining, defense-ready software, authorised reverse engineering" },
	{ k: "Platform", v: "RDOS fleet console and the MAVLink cloud service" },
	{ k: "Press contact", v: "support@litecheats.com" },
];

export function PressKitPage() {
	const scopeRef = useRef<HTMLElement | null>(null);

	useLayoutEffect(() => {
		if (!scopeRef.current) return;
		const ctx = gsap.context(() => {
			gsap.from(".press-intro", { y: 24, opacity: 0, duration: 0.65, ease: "power3.out" });
			gsap.from(".press-card", {
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
				<div className="press-intro space-y-3 rounded-2xl border border-border/65 bg-card/70 p-6 md:p-8">
					<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
						Press kit
					</Badge>
					<h1 className="font-heading text-3xl font-semibold tracking-tight md:text-5xl">
						Brand basics for press & partners
					</h1>
					<p className="max-w-3xl text-sm leading-relaxed text-muted-foreground md:text-base">
						We do not host a public asset bundle yet. For logo files, screenshots, or an interview,
						email us directly and we will send what you need.
					</p>
				</div>

				<div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
					<Card className="press-card bg-background/85">
						<CardHeader>
							<CardTitle className="font-heading text-lg">Mark</CardTitle>
						</CardHeader>
						<CardContent className="flex items-center gap-3">
							<span
								className="flex h-12 w-12 items-center justify-center rounded-xl"
								style={{
									background: "linear-gradient(145deg, var(--destructive), oklch(0.3 0.1 27))",
								}}
							>
								<ZapIcon size={22} style={{ color: "oklch(0.93 0.16 92)" }} aria-hidden />
							</span>
							<p className="text-sm leading-relaxed text-muted-foreground">
								The mark stays on a dark ground. Please do not recolor it, add effects, or place it
								on a busy background.
							</p>
						</CardContent>
					</Card>

					<Card className="press-card bg-background/85">
						<CardHeader>
							<CardTitle className="font-heading text-lg">Fact sheet</CardTitle>
						</CardHeader>
						<CardContent className="space-y-2.5">
							{factSheet.map((row) => (
								<div key={row.k} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
									<span className="w-40 flex-none text-xs font-semibold tracking-wide text-muted-foreground uppercase">
										{row.k}
									</span>
									<span className="text-sm text-foreground/85">{row.v}</span>
								</div>
							))}
						</CardContent>
					</Card>
				</div>

				<Card className="press-card bg-background/85">
					<CardHeader>
						<CardTitle className="font-heading text-xl">Request assets</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-sm leading-relaxed text-muted-foreground">
							Email{" "}
							<a href="mailto:support@litecheats.com" className="text-primary hover:underline">
								support@litecheats.com
							</a>{" "}
							with what you are working on and a deadline, and we will get logo files or a comment
							back to you.
						</p>
					</CardContent>
				</Card>
			</section>
		</AnimatedPage>
	);
}

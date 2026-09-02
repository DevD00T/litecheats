import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";

const practices = [
	{
		title: "Password & session handling",
		text: "Passwords are hashed with Bun's built-in Argon2 password hasher, never stored or logged in plain text. Sessions are HttpOnly, SameSite cookies bound to a device fingerprint, so a stolen cookie alone cannot be replayed from another device.",
	},
	{
		title: "Rate limiting & abuse controls",
		text: "Login, signup, and session endpoints are rate-limited per client IP with a rolling window, and every account is capped on concurrent active sessions to limit the blast radius of credential stuffing.",
	},
	{
		title: "Data residency",
		text: "Application data is served from infrastructure in the ap-south-1 (Mumbai) region for our RDOS and MAVLink cloud services, keeping operational data inside Indian jurisdiction by default.",
	},
	{
		title: "Transport & response hardening",
		text: "All API responses set strict Content-Type, X-Content-Options, X-Frame-Options, and Referrer-Policy headers, with CORS scoped to the requesting origin rather than left open.",
	},
];

export function SecurityPage() {
	const scopeRef = useRef<HTMLElement | null>(null);

	useLayoutEffect(() => {
		if (!scopeRef.current) return;
		const ctx = gsap.context(() => {
			gsap.from(".security-intro", { y: 24, opacity: 0, duration: 0.65, ease: "power3.out" });
			gsap.from(".security-card", {
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
				<div className="security-intro space-y-3 rounded-2xl border border-border/65 bg-card/70 p-6 md:p-8">
					<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
						Security
					</Badge>
					<h1 className="font-heading text-3xl font-semibold tracking-tight md:text-5xl">
						How Litecheats protects your account and data
					</h1>
					<p className="max-w-3xl text-sm leading-relaxed text-muted-foreground md:text-base">
						A summary of the practical controls behind accounts, sessions, and the RDOS platform. If
						you find a vulnerability, please report it to{" "}
						<a href="mailto:support@litecheats.com" className="text-primary hover:underline">
							support@litecheats.com
						</a>{" "}
						rather than filing it publicly.
					</p>
				</div>

				<div className="grid gap-4 md:grid-cols-2">
					{practices.map((practice) => (
						<Card key={practice.title} className="security-card h-full bg-background/85">
							<CardHeader>
								<CardTitle className="font-heading text-lg">{practice.title}</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="text-sm leading-relaxed text-muted-foreground">{practice.text}</p>
							</CardContent>
						</Card>
					))}
				</div>

				<Card className="security-card bg-background/85">
					<CardHeader>
						<CardTitle className="font-heading text-xl">Reporting an issue</CardTitle>
						<CardDescription>
							We take reports seriously and respond within one business day.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-sm leading-relaxed text-muted-foreground">
							Email a description, reproduction steps, and impact assessment to{" "}
							<a href="mailto:support@litecheats.com" className="text-primary hover:underline">
								support@litecheats.com
							</a>
							. Please avoid automated scanning against production accounts or the release archive
							without prior coordination.
						</p>
					</CardContent>
				</Card>
			</section>
		</AnimatedPage>
	);
}

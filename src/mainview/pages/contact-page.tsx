import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { electrobun } from "@/lib/electrobun";
import { gsap } from "gsap";
import { type FormEvent, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

const channels = [
	{
		title: "Email",
		value: "support@litecheats.com",
		description: "Primary channel for project inquiries and proposals.",
	},
	{
		title: "Phone",
		value: "+91 3379623379",
		description: "Mon-Fri, 9:00 AM to 6:00 PM IST for active engagements.",
	},
	{
		title: "Office",
		value: "Hooghly, India",
		description: "Hybrid delivery model with global remote engineering support.",
	},
];

export function ContactPage() {
	const scopeRef = useRef<HTMLElement | null>(null);
	const [submitted, setSubmitted] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);

	useLayoutEffect(() => {
		if (!scopeRef.current) return;

		const ctx = gsap.context(() => {
			gsap.from(".contact-intro", {
				y: 24,
				opacity: 0,
				duration: 0.7,
				ease: "power3.out",
			});
			gsap.from(".contact-card", {
				y: 22,
				opacity: 0,
				duration: 0.55,
				stagger: 0.08,
				ease: "power2.out",
				delay: 0.1,
			});
			gsap.from(".contact-field", {
				y: 16,
				opacity: 0,
				duration: 0.45,
				stagger: 0.06,
				ease: "power2.out",
				delay: 0.18,
			});
		}, scopeRef);

		return () => ctx.revert();
	}, []);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = event.currentTarget;
		const formData = new FormData(form);

		const payload = {
			fullName: String(formData.get("fullName") ?? "").trim(),
			email: String(formData.get("email") ?? "").trim(),
			company: String(formData.get("company") ?? "").trim(),
			projectScope: String(formData.get("projectScope") ?? "").trim(),
		};

		if (!payload.fullName || !payload.email || !payload.company || !payload.projectScope) {
			toast.error("Please fill all enquiry fields before sending.");
			return;
		}

		if (!electrobun.rpc) {
			toast.error("RPC bridge is not ready yet. Please try again.");
			return;
		}

		setIsSubmitting(true);
		setSubmitted(false);

		try {
			await electrobun.rpc.request.sendContactInquiry(payload);
			form.reset();
			setSubmitted(true);
			toast.success("Enquiry sent successfully. We will get back to you soon.");
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to send enquiry.";
			toast.error(message);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<AnimatedPage>
			<section ref={scopeRef} className="space-y-7">
				<div className="contact-intro rounded-2xl border border-border/65 bg-card/70 p-6 md:p-8">
					<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
						Contact
					</Badge>
					<h1 className="mt-4 font-heading text-3xl font-semibold tracking-tight md:text-5xl">
						Let’s build your next product milestone.
					</h1>
					<p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground md:text-base">
						Share your goals, current constraints, and timeline. We will respond with a focused
						engagement plan and a clear execution path.
					</p>
				</div>

				<div className="grid gap-5 md:grid-cols-3">
					{channels.map((channel) => (
						<Card key={channel.title} className="contact-card bg-background/85">
							<CardHeader>
								<CardTitle className="font-heading text-lg">{channel.title}</CardTitle>
							</CardHeader>
							<CardContent className="space-y-2">
								<p className="text-sm font-medium text-foreground">{channel.value}</p>
								<p className="text-sm text-muted-foreground">{channel.description}</p>
							</CardContent>
						</Card>
					))}
				</div>

				<Card className="contact-card bg-background/90">
					<CardHeader>
						<CardTitle className="font-heading text-2xl">Project Inquiry Form</CardTitle>
						<CardDescription>
							Provide key details and we will reach out within one business day.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form className="grid gap-4" onSubmit={handleSubmit}>
							<div className="contact-field grid gap-2">
								<label htmlFor="fullName" className="text-sm font-medium">
									Full Name
								</label>
								<Input id="fullName" name="fullName" placeholder="Jane Doe" required />
							</div>
							<div className="contact-field grid gap-2 md:grid-cols-2 md:gap-4">
								<div className="grid gap-2">
									<label htmlFor="email" className="text-sm font-medium">
										Work Email
									</label>
									<Input
										id="email"
										name="email"
										type="email"
										placeholder="you@company.com"
										required
									/>
								</div>
								<div className="grid gap-2">
									<label htmlFor="company" className="text-sm font-medium">
										Company
									</label>
									<Input id="company" name="company" placeholder="Your Company" required />
								</div>
							</div>
							<div className="contact-field grid gap-2">
								<label htmlFor="projectScope" className="text-sm font-medium">
									Project Scope
								</label>
								<Textarea
									id="projectScope"
									name="projectScope"
									placeholder="Tell us the product goals, expected users, and any current technical constraints."
									required
								/>
							</div>
							<div className="contact-field flex flex-wrap items-center gap-3">
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting ? "Sending..." : "Send Inquiry"}
								</Button>
								<p className="text-xs text-muted-foreground">
									By submitting, you agree to our terms and privacy policy.
								</p>
							</div>
							{submitted ? (
								<p className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
									Thanks. Your inquiry has been sent to support@litecheats.com.
								</p>
							) : null}
						</form>
					</CardContent>
				</Card>
			</section>
		</AnimatedPage>
	);
}

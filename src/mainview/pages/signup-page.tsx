import { useAuth } from "@/components/auth/auth-provider";
import {
	type AuthMethod,
	AuthMethodToggle,
	WhatsAppCodeStep,
	WhatsAppPhoneField,
	useCountdown,
} from "@/components/auth/whatsapp-auth";
import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { authApi } from "@/lib/auth-api";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { WhatsAppSignupStartPayload } from "shared/auth";
import { toast } from "sonner";

function useRedirectPath(defaultPath: string): string {
	const location = useLocation();
	return useMemo(() => {
		const searchParams = new URLSearchParams(location.search);
		const redirect = searchParams.get("redirect");
		if (!redirect || !redirect.startsWith("/")) {
			return defaultPath;
		}
		return redirect;
	}, [location.search, defaultPath]);
}

function evaluatePasswordStrength(password: string): { score: number; label: string } {
	if (!password) {
		return { score: 0, label: "Enter a password" };
	}

	let score = 0;
	if (password.length >= 8) score += 25;
	if (password.length >= 12) score += 15;
	if (/[A-Za-z]/.test(password)) score += 20;
	if (/\d/.test(password)) score += 20;
	if (/[^A-Za-z0-9]/.test(password)) score += 20;

	if (score < 45) return { score, label: "Weak" };
	if (score < 75) return { score, label: "Medium" };
	if (score < 95) return { score, label: "Strong" };
	return { score: 100, label: "Very Strong" };
}

function isStrongPassword(password: string): boolean {
	return (
		password.length >= 8 &&
		/[A-Za-z]/.test(password) &&
		/\d/.test(password) &&
		/[^A-Za-z0-9]/.test(password)
	);
}

export function SignupPage() {
	const navigate = useNavigate();
	const location = useLocation();
	const { signup, signupWithWhatsApp } = useAuth();
	const redirectTo = useRedirectPath("/account");
	const searchParams = new URLSearchParams(location.search);
	const [method, setMethod] = useState<AuthMethod>(
		searchParams.get("method") === "whatsapp" ? "whatsapp" : "email",
	);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [password, setPassword] = useState("");
	const passwordStrength = useMemo(() => evaluatePasswordStrength(password), [password]);

	// WhatsApp flow: the profile is kept here once a code has been sent for it,
	// because the server takes it again, with the code, to create the account.
	const [pending, setPending] = useState<WhatsAppSignupStartPayload | null>(null);
	const [draft, setDraft] = useState<WhatsAppSignupStartPayload>({
		fullName: "",
		company: "",
		email: "",
		phone: searchParams.get("phone") ?? "",
	});
	const [isResending, setIsResending] = useState(false);
	const [resendCooldown, startResendCooldown] = useCountdown();
	const loginLink = `/login?redirect=${encodeURIComponent(redirectTo)}`;

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = event.currentTarget;
		const formData = new FormData(form);

		const fullName = String(formData.get("fullName") ?? "").trim();
		const company = String(formData.get("company") ?? "").trim();
		const email = String(formData.get("email") ?? "").trim();
		const passwordValue = String(formData.get("password") ?? "");

		if (!fullName || !company || !email || !passwordValue) {
			toast.error("Please complete all registration fields.");
			return;
		}

		if (!isStrongPassword(passwordValue)) {
			toast.error("Password must include letters, numbers, and symbols (min 8 chars).");
			return;
		}

		setIsSubmitting(true);
		try {
			await signup({ fullName, company, email, password: passwordValue });
			toast.success("Account created. Check your email for a verification code.");
			// Signup is not finished until the emailed code is confirmed, so send
			// them to step 2 and carry the original destination through.
			navigate(`/verify-email?redirect=${encodeURIComponent(redirectTo)}`, { replace: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unable to create account.";
			toast.error(message);
		} finally {
			setIsSubmitting(false);
		}
	};

	const requestWhatsAppCode = async (details: WhatsAppSignupStartPayload) => {
		try {
			const response = await authApi.sendWhatsAppSignupCode(details);
			setPending({ ...details, phone: response.phone });
			startResendCooldown(response.retryAfterSeconds);
			toast.success("Code sent. Check WhatsApp.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not send a code.");
		}
	};

	const handleWhatsAppStart = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		const details: WhatsAppSignupStartPayload = {
			fullName: String(formData.get("fullName") ?? "").trim(),
			company: String(formData.get("company") ?? "").trim(),
			email: String(formData.get("email") ?? "").trim(),
			phone: String(formData.get("phone") ?? "").trim(),
		};

		if (!details.fullName || !details.company || !details.email || !details.phone) {
			toast.error("Please complete all registration fields.");
			return;
		}

		setDraft(details);
		setIsSubmitting(true);
		try {
			await requestWhatsAppCode(details);
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleWhatsAppResend = async () => {
		if (!pending) return;
		setIsResending(true);
		try {
			await requestWhatsAppCode(pending);
		} finally {
			setIsResending(false);
		}
	};

	const handleWhatsAppVerify = async (code: string): Promise<boolean> => {
		if (!pending) return false;
		setIsSubmitting(true);
		try {
			await signupWithWhatsApp({ ...pending, code });
			toast.success("Account created. We also emailed a code so you can confirm your email.");
			navigate(redirectTo, { replace: true });
			return true;
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Unable to create account.");
			return false;
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<AnimatedPage>
			<section className="mx-auto w-full max-w-xl">
				<Card className="bg-background/90">
					<CardHeader className="space-y-3">
						<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
							Sign Up
						</Badge>
						<CardTitle className="font-heading text-3xl">Create your account</CardTitle>
						<CardDescription>
							Create an account to manage your fleet, billing, and downloads.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-5">
						<AuthMethodToggle
							value={method}
							onChange={setMethod}
							disabled={isSubmitting || isResending}
						/>

						{method === "whatsapp" && pending ? (
							<WhatsAppCodeStep
								phone={pending.phone}
								resendCooldown={resendCooldown}
								isSubmitting={isSubmitting}
								isResending={isResending}
								submitLabel="Create Account"
								onSubmit={handleWhatsAppVerify}
								onResend={() => void handleWhatsAppResend()}
								onChangeNumber={() => setPending(null)}
							/>
						) : (
							<form
								// Remount per method so each form starts from its own defaults.
								key={method}
								className="grid gap-4"
								onSubmit={method === "email" ? handleSubmit : handleWhatsAppStart}
							>
								<div className="grid gap-2">
									<label htmlFor="fullName" className="text-sm font-medium">
										Full Name
									</label>
									<Input
										id="fullName"
										name="fullName"
										placeholder="Jane Doe"
										defaultValue={method === "whatsapp" ? draft.fullName : undefined}
										required
									/>
								</div>
								<div className="grid gap-2">
									<label htmlFor="company" className="text-sm font-medium">
										Company
									</label>
									<Input
										id="company"
										name="company"
										placeholder="Acme Robotics"
										defaultValue={method === "whatsapp" ? draft.company : undefined}
										required
									/>
								</div>
								<div className="grid gap-2">
									<label htmlFor="email" className="text-sm font-medium">
										Email
									</label>
									<Input
										id="email"
										name="email"
										type="email"
										placeholder="you@company.com"
										defaultValue={method === "whatsapp" ? draft.email : undefined}
										required
									/>
									{method === "whatsapp" ? (
										<p className="text-xs text-muted-foreground">
											Receipts and renewal reminders are sent here.
										</p>
									) : null}
								</div>

								{method === "email" ? (
									<div className="grid gap-2">
										<label htmlFor="password" className="text-sm font-medium">
											Password
										</label>
										<Input
											id="password"
											name="password"
											type="password"
											value={password}
											onChange={(event) => setPassword(event.target.value)}
											required
										/>
										<div className="grid gap-2">
											<div className="flex items-center justify-between text-xs text-muted-foreground">
												<span>Password strength</span>
												<span>{passwordStrength.label}</span>
											</div>
											<Progress value={passwordStrength.score} className="h-2 w-full" />
											<p className="text-xs text-muted-foreground">
												Use letters, numbers, and symbols for a stronger password.
											</p>
										</div>
									</div>
								) : (
									<WhatsAppPhoneField defaultValue={draft.phone} />
								)}

								<Button type="submit" disabled={isSubmitting}>
									{method === "email"
										? isSubmitting
											? "Creating account..."
											: "Create Account"
										: isSubmitting
											? "Sending code..."
											: "Send code on WhatsApp"}
								</Button>
							</form>
						)}

						<p className="text-sm text-muted-foreground">
							Already registered?{" "}
							<Link
								to={method === "whatsapp" ? `${loginLink}&method=whatsapp` : loginLink}
								className="font-medium text-primary hover:underline"
							>
								Sign in
							</Link>
						</p>
					</CardContent>
				</Card>
			</section>
		</AnimatedPage>
	);
}

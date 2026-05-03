import { useAuth } from "@/components/auth/auth-provider";
import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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

export function SignupPage() {
	const navigate = useNavigate();
	const { signup } = useAuth();
	const redirectTo = useRedirectPath("/account");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [password, setPassword] = useState("");
	const passwordStrength = useMemo(() => evaluatePasswordStrength(password), [password]);

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

		if (passwordValue.length < 8) {
			toast.error("Password must be at least 8 characters.");
			return;
		}

		setIsSubmitting(true);
		try {
			await signup({ fullName, company, email, password: passwordValue });
			toast.success("Registration completed.");
			navigate(redirectTo, { replace: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unable to create account.";
			toast.error(message);
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
							Register to open a secure session with Bun-managed cookies.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form className="grid gap-4" onSubmit={handleSubmit}>
							<div className="grid gap-2">
								<label htmlFor="fullName" className="text-sm font-medium">
									Full Name
								</label>
								<Input id="fullName" name="fullName" placeholder="Jane Doe" required />
							</div>
							<div className="grid gap-2">
								<label htmlFor="company" className="text-sm font-medium">
									Company
								</label>
								<Input id="company" name="company" placeholder="Litecheats Technologies" required />
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
									required
								/>
							</div>
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
							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting ? "Creating account..." : "Create Account"}
							</Button>
							<p className="text-sm text-muted-foreground">
								Already registered?{" "}
								<Link
									to={`/login?redirect=${encodeURIComponent(redirectTo)}`}
									className="font-medium text-primary hover:underline"
								>
									Sign in
								</Link>
							</p>
						</form>
					</CardContent>
				</Card>
			</section>
		</AnimatedPage>
	);
}

import { useAuth } from "@/components/auth/auth-provider";
import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

export function LoginPage() {
	const navigate = useNavigate();
	const { login } = useAuth();
	const redirectTo = useRedirectPath("/account");
	const [isSubmitting, setIsSubmitting] = useState(false);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = event.currentTarget;
		const formData = new FormData(form);

		const email = String(formData.get("email") ?? "").trim();
		const password = String(formData.get("password") ?? "");

		if (!email || !password) {
			toast.error("Please enter your email and password.");
			return;
		}

		setIsSubmitting(true);
		try {
			await login({ email, password });
			toast.success("Signed in successfully.");
			navigate(redirectTo, { replace: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unable to sign in.";
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
							Sign In
						</Badge>
						<CardTitle className="font-heading text-3xl">Welcome back</CardTitle>
						<CardDescription>Sign in to manage your Litecheats account session.</CardDescription>
					</CardHeader>
					<CardContent>
						<form className="grid gap-4" onSubmit={handleSubmit}>
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
								<Input id="password" name="password" type="password" required />
							</div>
							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting ? "Signing in..." : "Sign In"}
							</Button>
							<p className="text-sm text-muted-foreground">
								No account yet?{" "}
								<Link
									to={`/signup?redirect=${encodeURIComponent(redirectTo)}`}
									className="font-medium text-primary hover:underline"
								>
									Create one
								</Link>
							</p>
						</form>
					</CardContent>
				</Card>
			</section>
		</AnimatedPage>
	);
}

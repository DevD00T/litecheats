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
import { AuthApiError, authApi } from "@/lib/auth-api";
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

function useInitialMethod(): AuthMethod {
	const location = useLocation();
	return new URLSearchParams(location.search).get("method") === "whatsapp" ? "whatsapp" : "email";
}

export function LoginPage() {
	const navigate = useNavigate();
	const { login, loginWithWhatsApp } = useAuth();
	const redirectTo = useRedirectPath("/account");
	const initialMethod = useInitialMethod();
	const [method, setMethod] = useState<AuthMethod>(initialMethod);
	const [isSubmitting, setIsSubmitting] = useState(false);

	// WhatsApp flow: `codePhone` is set once a code has gone out to that number.
	const [codePhone, setCodePhone] = useState<string | null>(null);
	const [enteredPhone, setEnteredPhone] = useState("");
	const [isResending, setIsResending] = useState(false);
	const [resendCooldown, startResendCooldown] = useCountdown();
	const signupLink = `/signup?redirect=${encodeURIComponent(redirectTo)}`;

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

	const requestWhatsAppCode = async (phone: string): Promise<boolean> => {
		try {
			const response = await authApi.sendWhatsAppLoginCode({ phone });
			setCodePhone(response.phone);
			startResendCooldown(response.retryAfterSeconds);
			toast.success("Code sent. Check WhatsApp.");
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not send a code.";
			if (error instanceof AuthApiError && error.status === 404) {
				// No account on this number: point straight at signup, carrying the number.
				toast.error(message, {
					action: {
						label: "Create account",
						onClick: () =>
							navigate(`${signupLink}&method=whatsapp&phone=${encodeURIComponent(phone)}`),
					},
				});
			} else {
				toast.error(message);
			}
			return false;
		}
	};

	const handleWhatsAppStart = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const phone = String(new FormData(event.currentTarget).get("phone") ?? "").trim();
		if (!phone) {
			toast.error("Please enter your WhatsApp number.");
			return;
		}

		setEnteredPhone(phone);
		setIsSubmitting(true);
		try {
			await requestWhatsAppCode(phone);
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleWhatsAppResend = async () => {
		if (!codePhone) return;
		setIsResending(true);
		try {
			await requestWhatsAppCode(codePhone);
		} finally {
			setIsResending(false);
		}
	};

	const handleWhatsAppVerify = async (code: string): Promise<boolean> => {
		if (!codePhone) return false;
		setIsSubmitting(true);
		try {
			await loginWithWhatsApp({ phone: codePhone, code });
			toast.success("Signed in successfully.");
			navigate(redirectTo, { replace: true });
			return true;
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "That code could not be verified.");
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
							Sign In
						</Badge>
						<CardTitle className="font-heading text-3xl">Welcome back</CardTitle>
						<CardDescription>Sign in to manage your Litecheats account.</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-5">
						<AuthMethodToggle
							value={method}
							onChange={setMethod}
							disabled={isSubmitting || isResending}
						/>

						{method === "email" ? (
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
							</form>
						) : codePhone ? (
							<WhatsAppCodeStep
								phone={codePhone}
								resendCooldown={resendCooldown}
								isSubmitting={isSubmitting}
								isResending={isResending}
								submitLabel="Sign In"
								onSubmit={handleWhatsAppVerify}
								onResend={() => void handleWhatsAppResend()}
								onChangeNumber={() => setCodePhone(null)}
							/>
						) : (
							<form className="grid gap-4" onSubmit={handleWhatsAppStart}>
								<WhatsAppPhoneField defaultValue={enteredPhone} />
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting ? "Sending code..." : "Send code on WhatsApp"}
								</Button>
							</form>
						)}

						<p className="text-sm text-muted-foreground">
							No account yet?{" "}
							<Link
								to={method === "whatsapp" ? `${signupLink}&method=whatsapp` : signupLink}
								className="font-medium text-primary hover:underline"
							>
								Create one
							</Link>
						</p>
					</CardContent>
				</Card>
			</section>
		</AnimatedPage>
	);
}

import { useAuth } from "@/components/auth/auth-provider";
import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authApi } from "@/lib/auth-api";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { EMAIL_VERIFICATION_CODE_LENGTH } from "shared/auth";
import { toast } from "sonner";

function useRedirectPath(fallback: string): string {
	const [searchParams] = useSearchParams();
	const redirect = searchParams.get("redirect");
	if (!redirect || !redirect.startsWith("/")) return fallback;
	return redirect;
}

export function VerifyEmailPage() {
	const { user, status, isAuthenticated, refreshSession } = useAuth();
	const navigate = useNavigate();
	const redirectTo = useRedirectPath("/account");

	const [code, setCode] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isResending, setIsResending] = useState(false);
	const [cooldown, setCooldown] = useState(0);

	const alreadyVerified = Boolean(user?.emailVerified);

	// A short countdown mirrors the server-side resend cooldown, so the button
	// tells the user when it will work instead of failing when they press it.
	useEffect(() => {
		if (cooldown <= 0) return;
		const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
		return () => clearTimeout(timer);
	}, [cooldown]);

	const handleSubmit = useCallback(
		async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const digits = code.replace(/\D/g, "");
			if (digits.length !== EMAIL_VERIFICATION_CODE_LENGTH) {
				toast.error(`Enter the ${EMAIL_VERIFICATION_CODE_LENGTH}-digit code from your email.`);
				return;
			}

			setIsSubmitting(true);
			try {
				const response = await authApi.verifyEmail({ code: digits });
				await refreshSession({ withLoading: false });
				toast.success(`${response.email} is verified.`);
				navigate(redirectTo, { replace: true });
			} catch (error) {
				setCode("");
				toast.error(error instanceof Error ? error.message : "That code could not be verified.");
			} finally {
				setIsSubmitting(false);
			}
		},
		[code, navigate, redirectTo, refreshSession],
	);

	const handleResend = useCallback(async () => {
		setIsResending(true);
		try {
			const response = await authApi.resendVerification();
			setCooldown(response.retryAfterSeconds);
			toast.success("A new code is on its way.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not send a new code.");
		} finally {
			setIsResending(false);
		}
	}, []);

	if (status === "loading") {
		return (
			<AnimatedPage>
				<section className="mx-auto w-full max-w-xl">
					<Card className="bg-background/90">
						<CardContent className="pt-6 text-sm text-muted-foreground">Loading...</CardContent>
					</Card>
				</section>
			</AnimatedPage>
		);
	}

	if (!isAuthenticated) {
		return (
			<AnimatedPage>
				<section className="mx-auto w-full max-w-xl">
					<Card className="bg-background/90">
						<CardHeader className="space-y-3">
							<CardTitle className="font-heading text-3xl">Verify your email</CardTitle>
							<CardDescription>
								Sign in first and we will send a fresh code to your inbox.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Link to="/login" className="text-sm font-medium text-primary hover:underline">
								Go to sign in
							</Link>
						</CardContent>
					</Card>
				</section>
			</AnimatedPage>
		);
	}

	if (alreadyVerified) {
		return (
			<AnimatedPage>
				<section className="mx-auto w-full max-w-xl">
					<Card className="bg-background/90">
						<CardHeader className="space-y-3">
							<Badge variant="secondary" className="w-fit bg-success/12 text-success">
								Verified
							</Badge>
							<CardTitle className="font-heading text-3xl">Email verified</CardTitle>
							<CardDescription>
								{user?.email} is confirmed. Your account is fully set up.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Link to="/account" className="text-sm font-medium text-primary hover:underline">
								Go to your account
							</Link>
						</CardContent>
					</Card>
				</section>
			</AnimatedPage>
		);
	}

	return (
		<AnimatedPage>
			<section className="mx-auto w-full max-w-xl">
				<Card className="bg-background/90">
					<CardHeader className="space-y-3">
						<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
							Step 2 of 2
						</Badge>
						<CardTitle className="font-heading text-3xl">Enter your code</CardTitle>
						<CardDescription>
							We sent a {EMAIL_VERIFICATION_CODE_LENGTH}-digit code to{" "}
							<span className="font-medium text-foreground">{user?.email}</span>. Enter it below to
							finish signing up and get your verified badge.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5">
						<form className="grid gap-4" onSubmit={handleSubmit}>
							<div className="grid gap-2">
								<label htmlFor="code" className="text-sm font-medium">
									Verification code
								</label>
								<Input
									id="code"
									name="code"
									inputMode="numeric"
									autoComplete="one-time-code"
									// biome-ignore lint/a11y/noAutofocus: the code field is the only
									// purpose of this page, so focusing it saves a click.
									autoFocus
									maxLength={EMAIL_VERIFICATION_CODE_LENGTH + 6}
									placeholder="000000"
									value={code}
									onChange={(event) => setCode(event.target.value)}
									className="text-center font-code text-2xl tracking-[0.5em]"
								/>
							</div>

							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting ? "Verifying..." : "Verify and continue"}
							</Button>
						</form>

						<div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
							<p className="text-xs text-muted-foreground">Didn't get it? Check spam, or</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={isResending || cooldown > 0}
								onClick={() => void handleResend()}
							>
								{isResending
									? "Sending..."
									: cooldown > 0
										? `Resend in ${cooldown}s`
										: "Send a new code"}
							</Button>
						</div>
					</CardContent>
				</Card>
			</section>
		</AnimatedPage>
	);
}

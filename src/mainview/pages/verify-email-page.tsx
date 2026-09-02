import { useAuth } from "@/components/auth/auth-provider";
import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authApi } from "@/lib/auth-api";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

type VerifyState = "verifying" | "success" | "error";

export function VerifyEmailPage() {
	const [searchParams] = useSearchParams();
	const token = searchParams.get("token") ?? "";
	const { refreshSession, isAuthenticated } = useAuth();
	const [state, setState] = useState<VerifyState>(token ? "verifying" : "error");
	const [message, setMessage] = useState(token ? "" : "This verification link is missing a token.");
	const requestedRef = useRef(false);

	useEffect(() => {
		if (!token || requestedRef.current) return;
		requestedRef.current = true;

		void (async () => {
			try {
				const response = await authApi.verifyEmail({ token });
				setState("success");
				setMessage(`${response.email} is now verified.`);
				await refreshSession({ withLoading: false });
			} catch (error) {
				setState("error");
				setMessage(
					error instanceof Error
						? error.message
						: "This verification link is invalid or has expired.",
				);
			}
		})();
	}, [token, refreshSession]);

	return (
		<AnimatedPage>
			<section className="mx-auto w-full max-w-xl">
				<Card className="bg-background/90">
					<CardHeader className="space-y-3">
						<Badge
							variant="secondary"
							className={
								state === "success"
									? "w-fit bg-success/12 text-success"
									: state === "error"
										? "w-fit bg-destructive/12 text-destructive"
										: "w-fit bg-primary/12 text-primary"
							}
						>
							{state === "success" ? "Verified" : state === "error" ? "Failed" : "Verifying"}
						</Badge>
						<CardTitle className="font-heading text-3xl">
							{state === "verifying" && "Verifying your email..."}
							{state === "success" && "Email verified"}
							{state === "error" && "Verification failed"}
						</CardTitle>
						<CardDescription>
							{state === "verifying" ? "Hang on while we confirm your address." : message}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{state !== "verifying" ? (
							<Link to={isAuthenticated ? "/account" : "/login"}>
								<Button type="button">{isAuthenticated ? "Go to account" : "Sign in"}</Button>
							</Link>
						) : null}
					</CardContent>
				</Card>
			</section>
		</AnimatedPage>
	);
}

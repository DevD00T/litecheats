import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CONSENT_STORAGE_KEY } from "@/lib/consent";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

function useRedirectPath(defaultPath: string): string {
	const location = useLocation();
	return useMemo(() => {
		const searchParams = new URLSearchParams(location.search);
		const redirect = searchParams.get("redirect");
		if (!redirect || !redirect.startsWith("/") || redirect.startsWith("//")) {
			return defaultPath;
		}
		return redirect;
	}, [location.search, defaultPath]);
}

export function AcceptTermsPage() {
	const navigate = useNavigate();
	const redirectTo = useRedirectPath("/");
	const [agreed, setAgreed] = useState(false);

	const handleContinue = () => {
		if (!agreed) {
			toast.error("Please confirm you've read and agree before continuing.");
			return;
		}

		try {
			window.localStorage.setItem(CONSENT_STORAGE_KEY, "true");
		} catch {
			// If storage is unavailable, still let the visitor through this session.
		}

		navigate(redirectTo, { replace: true });
	};

	return (
		<AnimatedPage>
			<section className="mx-auto w-full max-w-xl">
				<Card className="bg-background/90">
					<CardHeader className="space-y-3">
						<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
							Before you continue
						</Badge>
						<CardTitle className="font-heading text-3xl">Terms & data policy</CardTitle>
						<CardDescription>
							Litecheats Technologies operates in India and processes personal data under the
							Digital Personal Data Protection Act, 2023. Please review the three documents below
							before using the site.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5">
						<div className="grid gap-2 sm:grid-cols-3">
							<Link
								to="/terms"
								className="rounded-lg border border-border/65 bg-muted/25 px-3.5 py-2.5 text-center text-[12.5px] font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
							>
								Terms of Service
							</Link>
							<Link
								to="/privacy-policy"
								className="rounded-lg border border-border/65 bg-muted/25 px-3.5 py-2.5 text-center text-[12.5px] font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
							>
								Privacy Policy
							</Link>
							<Link
								to="/dpdp-compliance"
								className="rounded-lg border border-border/65 bg-muted/25 px-3.5 py-2.5 text-center text-[12.5px] font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
							>
								DPDP Compliance
							</Link>
						</div>

						<label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/65 bg-muted/20 p-4 text-sm">
							<input
								type="checkbox"
								checked={agreed}
								onChange={(event) => setAgreed(event.target.checked)}
								className="mt-0.5 h-4 w-4 flex-none accent-primary"
							/>
							<span className="leading-relaxed text-foreground/90">
								I have read and agree to the Terms of Service, Privacy Policy, and DPDP Compliance
								Policy.
							</span>
						</label>

						<Button
							type="button"
							size="lg"
							className={cn("w-full", agreed ? "glow-ring" : "")}
							onClick={handleContinue}
						>
							Accept & continue
						</Button>
					</CardContent>
				</Card>
			</section>
		</AnimatedPage>
	);
}

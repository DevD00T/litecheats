import { useAuth } from "@/components/auth/auth-provider";
import {
	WhatsAppCodeStep,
	WhatsAppPhoneField,
	formatWhatsAppPhone,
	useCountdown,
} from "@/components/auth/whatsapp-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authApi } from "@/lib/auth-api";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

/**
 * Lets a signed-in account that has no WhatsApp number add one. A link code is
 * sent to the number and the number is saved only once that code is entered,
 * so nobody can attach a number they do not hold. After linking, the account
 * can also sign in with WhatsApp.
 */
export function LinkWhatsAppCard() {
	const { linkWhatsApp } = useAuth();
	const [codePhone, setCodePhone] = useState<string | null>(null);
	const [enteredPhone, setEnteredPhone] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isResending, setIsResending] = useState(false);
	const [resendCooldown, startResendCooldown] = useCountdown();

	const requestLinkCode = async (phone: string) => {
		try {
			const response = await authApi.sendWhatsAppLinkCode({ phone });
			setCodePhone(response.phone);
			startResendCooldown(response.retryAfterSeconds);
			toast.success("Link code sent. Check WhatsApp.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not send a link code.");
		}
	};

	const handleStart = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const phone = String(new FormData(event.currentTarget).get("phone") ?? "").trim();
		if (!phone) {
			toast.error("Please enter your WhatsApp number.");
			return;
		}
		setEnteredPhone(phone);
		setIsSubmitting(true);
		try {
			await requestLinkCode(phone);
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleResend = async () => {
		if (!codePhone) return;
		setIsResending(true);
		try {
			await requestLinkCode(codePhone);
		} finally {
			setIsResending(false);
		}
	};

	const handleVerify = async (code: string): Promise<boolean> => {
		if (!codePhone) return false;
		setIsSubmitting(true);
		try {
			const user = await linkWhatsApp({ phone: codePhone, code });
			toast.success(
				`${formatWhatsAppPhone(user.phone ?? codePhone)} is linked. You can now sign in with WhatsApp.`,
			);
			return true;
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "That link code could not be verified.");
			return false;
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Card className="bg-background/90">
			<CardHeader className="space-y-3">
				<Badge variant="secondary" className="w-fit bg-warning/12 text-warning">
					WhatsApp not linked
				</Badge>
				<CardTitle className="font-heading text-xl">Link your WhatsApp</CardTitle>
				<CardDescription>
					Add your WhatsApp number to sign in with a code instead of your password. We will send a
					link code to the number to confirm it is yours.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{codePhone ? (
					<WhatsAppCodeStep
						phone={codePhone}
						codeName="link code"
						resendCooldown={resendCooldown}
						isSubmitting={isSubmitting}
						isResending={isResending}
						submitLabel="Link WhatsApp"
						onSubmit={handleVerify}
						onResend={() => void handleResend()}
						onChangeNumber={() => setCodePhone(null)}
					/>
				) : (
					<form className="grid gap-4" onSubmit={handleStart}>
						<WhatsAppPhoneField defaultValue={enteredPhone} />
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting ? "Sending link code..." : "Send link code"}
						</Button>
					</form>
				)}
			</CardContent>
		</Card>
	);
}

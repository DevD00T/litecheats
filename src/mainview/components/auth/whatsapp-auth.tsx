import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { type FormEvent, useEffect, useState } from "react";
import { WHATSAPP_CODE_LENGTH } from "shared/auth";

export type AuthMethod = "email" | "whatsapp";

/** Two-way switch between signing in with email and with WhatsApp. */
export function AuthMethodToggle({
	value,
	onChange,
	disabled,
}: {
	value: AuthMethod;
	onChange: (method: AuthMethod) => void;
	disabled?: boolean;
}) {
	const options: { method: AuthMethod; label: string }[] = [
		{ method: "email", label: "Email" },
		{ method: "whatsapp", label: "WhatsApp" },
	];

	return (
		<fieldset
			disabled={disabled}
			className="grid grid-cols-2 gap-1 rounded-lg border border-border/65 bg-muted/25 p-1 disabled:opacity-45"
		>
			<legend className="sr-only">Sign-in method</legend>
			{options.map((option) => {
				const selected = option.method === value;
				return (
					<label
						key={option.method}
						className={cn(
							"flex h-8 cursor-pointer items-center justify-center rounded-md text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
							selected
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						<input
							type="radio"
							name="auth-method"
							value={option.method}
							checked={selected}
							onChange={() => onChange(option.method)}
							className="sr-only"
						/>
						{option.label}
					</label>
				);
			})}
		</fieldset>
	);
}

/** Shows "919876543210" as "+91 98765 43210" when it looks Indian, else "+<digits>". */
export function formatWhatsAppPhone(phone: string): string {
	if (phone.length === 12 && phone.startsWith("91")) {
		return `+91 ${phone.slice(2, 7)} ${phone.slice(7)}`;
	}
	return `+${phone}`;
}

/** Counts down from `seconds` to zero, once a second. Restart by passing a new value. */
export function useCountdown(): [number, (seconds: number) => void] {
	const [remaining, setRemaining] = useState(0);

	useEffect(() => {
		if (remaining <= 0) return;
		const timer = setTimeout(() => setRemaining((seconds) => seconds - 1), 1000);
		return () => clearTimeout(timer);
	}, [remaining]);

	return [remaining, setRemaining];
}

export function WhatsAppPhoneField({ defaultValue }: { defaultValue?: string }) {
	return (
		<div className="grid gap-2">
			<label htmlFor="phone" className="text-sm font-medium">
				WhatsApp number
			</label>
			<Input
				id="phone"
				name="phone"
				type="tel"
				inputMode="tel"
				autoComplete="tel"
				placeholder="+91 98765 43210"
				defaultValue={defaultValue}
				required
			/>
			<p className="text-xs text-muted-foreground">
				Include your country code. A 10-digit number is treated as Indian (+91).
			</p>
		</div>
	);
}

/**
 * Step two of any WhatsApp flow: enter the code that was just sent. The parent
 * owns the network calls; this only collects digits and paces the resend.
 */
export function WhatsAppCodeStep({
	phone,
	resendCooldown,
	isSubmitting,
	isResending,
	submitLabel,
	onSubmit,
	onResend,
	onChangeNumber,
}: {
	phone: string;
	resendCooldown: number;
	isSubmitting: boolean;
	isResending: boolean;
	submitLabel: string;
	onSubmit: (code: string) => Promise<boolean>;
	onResend: () => void;
	onChangeNumber: () => void;
}) {
	const [code, setCode] = useState("");

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const accepted = await onSubmit(code.replace(/\D/g, ""));
		// A rejected code is cleared so the next attempt starts from empty.
		if (!accepted) setCode("");
	};

	return (
		<div className="space-y-5">
			<p className="text-sm text-muted-foreground">
				We sent a {WHATSAPP_CODE_LENGTH}-digit code on WhatsApp to{" "}
				<span className="font-medium text-foreground">{formatWhatsAppPhone(phone)}</span>.
			</p>
			<form className="grid gap-4" onSubmit={handleSubmit}>
				<div className="grid gap-2">
					<label htmlFor="whatsapp-code" className="text-sm font-medium">
						WhatsApp code
					</label>
					<Input
						id="whatsapp-code"
						name="code"
						inputMode="numeric"
						autoComplete="one-time-code"
						autoFocus
						maxLength={WHATSAPP_CODE_LENGTH + 6}
						placeholder="000000"
						value={code}
						onChange={(event) => setCode(event.target.value)}
						className="text-center font-code text-2xl tracking-[0.5em]"
					/>
				</div>
				<Button
					type="submit"
					disabled={isSubmitting || code.replace(/\D/g, "").length !== WHATSAPP_CODE_LENGTH}
				>
					{isSubmitting ? "Checking..." : submitLabel}
				</Button>
			</form>
			<div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={isResending || resendCooldown > 0}
					onClick={onResend}
				>
					{isResending
						? "Sending..."
						: resendCooldown > 0
							? `Resend in ${resendCooldown}s`
							: "Send a new code"}
				</Button>
				<Button type="button" variant="ghost" size="sm" onClick={onChangeNumber}>
					Use a different number
				</Button>
			</div>
		</div>
	);
}

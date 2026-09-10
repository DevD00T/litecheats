import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { type RenewalNotice, formatInr } from "shared/billing";

/**
 * The ten-day renewal notice. Tone follows whether the customer actually has to
 * do something: a covered wallet renewal is reassurance, anything else is a
 * call to load up or switch payment mode before service is interrupted.
 */
export function RenewalWarning({
	renewal,
	showAction = true,
}: { renewal: RenewalNotice; showAction?: boolean }) {
	const needsAction = !renewal.willAutoRenew;
	const dayLabel =
		renewal.daysRemaining <= 0
			? "today"
			: renewal.daysRemaining === 1
				? "tomorrow"
				: `in ${renewal.daysRemaining} days`;

	return (
		<Card
			className={cn(
				needsAction ? "border-warning/45 bg-warning/[0.07]" : "border-success/40 bg-success/[0.06]",
			)}
		>
			<CardContent className="space-y-2 pt-6">
				<p className={cn("text-sm font-semibold", needsAction ? "text-warning" : "text-success")}>
					{renewal.planName} renews {dayLabel}
				</p>

				{needsAction ? (
					<p className="text-xs leading-relaxed text-warning/90">
						{renewal.paymentMode !== "wallet" || !renewal.autoRenew ? (
							<>
								Your account is set to pay manually, so this term will not renew on its own.{" "}
								<strong>Load up your wallet or change your payment mode</strong> to continue using
								RDOS and its services.
							</>
						) : (
							<>
								Your wallet holds {formatInr(renewal.walletBalance)} but the renewal needs{" "}
								{formatInr(renewal.amountDue)} — short by{" "}
								<strong>{formatInr(renewal.shortfall)}</strong>.{" "}
								<strong>Load up your wallet or change your payment mode</strong> to continue using
								RDOS and its services.
							</>
						)}
					</p>
				) : (
					<p className="text-xs leading-relaxed text-success/90">
						Your wallet holds {formatInr(renewal.walletBalance)} and the renewal needs{" "}
						{formatInr(renewal.amountDue)}. We will debit it automatically — nothing for you to do.
					</p>
				)}

				{showAction ? (
					<Link
						to="/billing"
						className={cn(
							"inline-block text-xs font-medium underline-offset-4 hover:underline",
							needsAction ? "text-warning" : "text-success",
						)}
					>
						Open billing
					</Link>
				) : null}
			</CardContent>
		</Card>
	);
}

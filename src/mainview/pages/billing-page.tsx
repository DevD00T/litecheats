import { RenewalWarning } from "@/components/billing/renewal-warning";
import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { billingApi } from "@/lib/billing-api";
import { CheckoutDismissedError, openWalletTopupCheckout } from "@/lib/razorpay-checkout";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
	type BillingSubscription,
	type RenewalNotice,
	WALLET_MIN_TOPUP_PAISE,
	type WalletPaymentMode,
	type WalletResponse,
	type WalletTransaction,
	formatInr,
} from "shared/billing";
import { toast } from "sonner";

const TOPUP_PRESETS_PAISE = [100_000, 500_000, 1_000_000, 5_000_000];

function formatDateTime(value: string): string {
	return new Date(value).toLocaleString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function BillingPage() {
	const [wallet, setWallet] = useState<WalletResponse | null>(null);
	const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
	const [renewal, setRenewal] = useState<RenewalNotice | null>(null);
	const [loading, setLoading] = useState(true);
	const [savingPrefs, setSavingPrefs] = useState(false);
	const [toppingUp, setToppingUp] = useState(false);
	const [customAmount, setCustomAmount] = useState("");

	const refresh = useCallback(async () => {
		try {
			const [walletResponse, subscriptionResponse, renewalResponse] = await Promise.all([
				billingApi.getWallet(),
				billingApi.getSubscription(),
				billingApi.getRenewalNotice(),
			]);
			setWallet(walletResponse);
			setSubscription(subscriptionResponse.subscription);
			setRenewal(renewalResponse.renewal);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not load billing.");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const savePreferences = useCallback(
		async (patch: { autoRenew?: boolean; paymentMode?: WalletPaymentMode }) => {
			setSavingPrefs(true);
			try {
				const updated = await billingApi.updateWalletPreferences(patch);
				setWallet(updated);
				// The renewal notice depends on these settings, so re-read it.
				setRenewal((await billingApi.getRenewalNotice()).renewal);
				toast.success("Billing preferences saved.");
			} catch (error) {
				toast.error(error instanceof Error ? error.message : "Could not save preferences.");
			} finally {
				setSavingPrefs(false);
			}
		},
		[],
	);

	const topUp = useCallback(async (amountPaise: number) => {
		if (!Number.isInteger(amountPaise) || amountPaise < WALLET_MIN_TOPUP_PAISE) {
			toast.error(`Minimum top-up is ${formatInr(WALLET_MIN_TOPUP_PAISE)}.`);
			return;
		}

		setToppingUp(true);
		try {
			const topup = await billingApi.createWalletTopup({ amount: amountPaise });
			const updated = await openWalletTopupCheckout(topup);
			setWallet(updated);
			setRenewal((await billingApi.getRenewalNotice()).renewal);
			setCustomAmount("");
			toast.success(`Wallet topped up. Balance is now ${formatInr(updated.wallet.balance)}.`);
		} catch (error) {
			if (error instanceof CheckoutDismissedError) {
				toast("Top-up cancelled. Nothing was charged.");
			} else {
				toast.error(error instanceof Error ? error.message : "Top-up failed.");
			}
		} finally {
			setToppingUp(false);
		}
	}, []);

	if (loading) {
		return (
			<AnimatedPage>
				<section className="mx-auto w-full max-w-3xl">
					<Card className="bg-background/90">
						<CardContent className="pt-6 text-sm text-muted-foreground">
							Loading billing...
						</CardContent>
					</Card>
				</section>
			</AnimatedPage>
		);
	}

	const balance = wallet?.wallet.balance ?? 0;
	const paymentMode = wallet?.wallet.paymentMode ?? "wallet";
	const autoRenew = wallet?.wallet.autoRenew ?? true;

	return (
		<AnimatedPage>
			<section className="mx-auto grid w-full max-w-3xl gap-5">
				{renewal ? <RenewalWarning renewal={renewal} /> : null}

				<Card className="bg-background/90">
					<CardHeader className="space-y-3">
						<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
							Wallet
						</Badge>
						<CardTitle className="font-heading text-3xl">Billing</CardTitle>
						<CardDescription>
							Keep a balance here and renewals are taken automatically — no card entry each term.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5">
						<div className="rounded-lg border border-border/65 bg-muted/25 p-4">
							<p className="text-xs tracking-[0.12em] text-muted-foreground uppercase">Balance</p>
							<p className="mt-1 font-code text-3xl font-semibold text-foreground">
								{formatInr(balance)}
							</p>
							{subscription?.status === "active" ? (
								<p className="mt-1 text-xs text-muted-foreground">
									Next renewal {formatInr(subscription.amount)} —{" "}
									{balance >= subscription.amount
										? "your balance covers it."
										: `you are short by ${formatInr(subscription.amount - balance)}.`}
								</p>
							) : null}
						</div>

						<div className="grid gap-3">
							<p className="text-sm font-medium">Load up wallet</p>
							<div className="flex flex-wrap gap-2">
								{TOPUP_PRESETS_PAISE.map((amount) => (
									<Button
										key={amount}
										type="button"
										variant="outline"
										size="sm"
										disabled={toppingUp}
										onClick={() => void topUp(amount)}
									>
										{formatInr(amount)}
									</Button>
								))}
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Input
									type="number"
									min={WALLET_MIN_TOPUP_PAISE / 100}
									placeholder={`Custom amount in ₹ (min ${WALLET_MIN_TOPUP_PAISE / 100})`}
									value={customAmount}
									onChange={(event) => setCustomAmount(event.target.value)}
									className="max-w-[260px]"
								/>
								<Button
									type="button"
									disabled={toppingUp || !customAmount}
									onClick={() => void topUp(Math.round(Number(customAmount) * 100))}
								>
									{toppingUp ? "Opening checkout..." : "Add money"}
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>

				<Card className="bg-background/90">
					<CardHeader>
						<CardTitle className="font-heading text-xl">Payment mode</CardTitle>
						<CardDescription>How your plan renews when the current term ends.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-3 sm:grid-cols-2">
							{[
								{
									mode: "wallet" as const,
									title: "Wallet auto-renew",
									blurb: "We debit your wallet balance on renewal day. Default.",
								},
								{
									mode: "checkout" as const,
									title: "Manual checkout",
									blurb: "You pay by card or UPI each term. Nothing is taken automatically.",
								},
							].map((option) => (
								<button
									key={option.mode}
									type="button"
									disabled={savingPrefs}
									onClick={() => void savePreferences({ paymentMode: option.mode })}
									className={cn(
										"rounded-lg border p-4 text-left transition-colors",
										paymentMode === option.mode
											? "border-primary/50 bg-primary/[0.08]"
											: "border-border/65 bg-muted/25 hover:border-border",
									)}
								>
									<div className="flex items-center justify-between gap-2">
										<span className="text-sm font-semibold">{option.title}</span>
										{paymentMode === option.mode ? (
											<Badge variant="secondary" className="bg-primary/12 text-primary">
												Active
											</Badge>
										) : null}
									</div>
									<p className="mt-1 text-xs text-muted-foreground">{option.blurb}</p>
								</button>
							))}
						</div>

						<label className="inline-flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={autoRenew}
								disabled={savingPrefs || paymentMode !== "wallet"}
								onChange={(event) => void savePreferences({ autoRenew: event.target.checked })}
							/>
							Renew automatically from wallet
						</label>
						{paymentMode !== "wallet" ? (
							<p className="text-xs text-muted-foreground">
								Auto-renew only applies to the wallet mode. On manual checkout you complete a
								payment each term from{" "}
								<Link to="/pricing" className="text-primary underline-offset-4 hover:underline">
									pricing
								</Link>
								.
							</p>
						) : null}
					</CardContent>
				</Card>

				{wallet?.transactions.length ? (
					<Card className="bg-background/90">
						<CardHeader>
							<CardTitle className="font-heading text-xl">Wallet activity</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex flex-col gap-2">
								{wallet.transactions.map((transaction: WalletTransaction) => (
									<div
										key={transaction.id}
										className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2 text-xs first:border-t-0 first:pt-0"
									>
										<span className="text-foreground/85">{transaction.reason}</span>
										<span className="text-muted-foreground">
											{formatDateTime(transaction.createdAt)}
										</span>
										<span
											className={cn(
												"font-code",
												transaction.type === "credit" ? "text-success" : "text-foreground/85",
											)}
										>
											{transaction.type === "credit" ? "+" : "−"}
											{formatInr(transaction.amount)}
										</span>
										<span className="font-code text-muted-foreground">
											bal {formatInr(transaction.balanceAfter)}
										</span>
									</div>
								))}
							</div>
						</CardContent>
					</Card>
				) : null}
			</section>
		</AnimatedPage>
	);
}

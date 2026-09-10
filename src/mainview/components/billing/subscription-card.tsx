import { RenewalWarning } from "@/components/billing/renewal-warning";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { billingApi } from "@/lib/billing-api";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
	BillingPaymentSummary,
	BillingSubscription,
	BillingSubscriptionStatus,
	RenewalNotice,
} from "shared/billing";
import { formatInr } from "shared/billing";
import { toast } from "sonner";

const statusTone: Record<BillingSubscriptionStatus, string> = {
	created: "bg-muted text-muted-foreground",
	pending: "bg-warning/12 text-warning",
	active: "bg-success/12 text-success",
	paused: "bg-warning/12 text-warning",
	halted: "bg-warning/12 text-warning",
	cancelled: "bg-muted text-muted-foreground",
	expired: "bg-muted text-muted-foreground",
	failed: "bg-destructive/12 text-destructive",
};

function formatDate(value: string | null): string {
	if (!value) return "—";
	return new Date(value).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export function SubscriptionCard() {
	const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
	const [orders, setOrders] = useState<BillingSubscription[]>([]);
	const [payments, setPayments] = useState<BillingPaymentSummary[]>([]);
	const [renewal, setRenewal] = useState<RenewalNotice | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isCancelling, setIsCancelling] = useState(false);

	const refresh = useCallback(async () => {
		try {
			const [subscriptionResponse, ordersResponse, historyResponse, renewalResponse] =
				await Promise.all([
					billingApi.getSubscription(),
					billingApi.getOrders(),
					billingApi.getPayments(),
					billingApi.getRenewalNotice(),
				]);
			setSubscription(subscriptionResponse.subscription);
			setOrders(ordersResponse.orders);
			setPayments(historyResponse.payments);
			setRenewal(renewalResponse.renewal);
		} catch {
			// Billing is not essential to the account page; leave the card in its
			// empty state rather than blocking the rest of the profile.
			setSubscription(null);
			setOrders([]);
			setPayments([]);
			setRenewal(null);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const handleCancel = useCallback(async () => {
		if (!subscription) return;

		setIsCancelling(true);
		try {
			const response = await billingApi.cancelSubscription({
				subscriptionId: subscription.id,
				atPeriodEnd: true,
			});
			setSubscription(response.subscription);
			toast.success("Subscription will not renew. Access continues until the period ends.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not cancel the subscription.");
		} finally {
			setIsCancelling(false);
		}
	}, [subscription]);

	if (isLoading) {
		return (
			<Card className="bg-background/90">
				<CardContent className="pt-6 text-sm text-muted-foreground">
					Loading subscription...
				</CardContent>
			</Card>
		);
	}

	const isBillable = subscription && subscription.status !== "created";

	return (
		<Card className="bg-background/90">
			<CardHeader className="space-y-3">
				<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
					Billing
				</Badge>
				<CardTitle className="font-heading text-2xl">Subscription</CardTitle>
				<CardDescription>
					Your current plan, billing period and recent Razorpay payments.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-5">
				{isBillable && subscription ? (
					<>
						<div className="grid gap-3 rounded-lg border border-border/65 bg-muted/25 p-4 text-sm">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="flex items-center gap-2">
									<span className="font-heading text-lg font-bold">{subscription.planName}</span>
									<Badge variant="secondary" className={statusTone[subscription.status]}>
										{subscription.status}
									</Badge>
								</div>
								<span className="font-code text-sm text-foreground/85">
									{formatInr(subscription.amount)}
								</span>
							</div>
							<div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
								<span>
									{subscription.quantity} vehicle{subscription.quantity === 1 ? "" : "s"}, billed{" "}
									{subscription.cycle}
								</span>
								<span>
									{subscription.mode === "subscription" ? "Auto-renewing" : "Prepaid term"}
								</span>
								<span>Started {formatDate(subscription.currentPeriodStart)}</span>
								<span>
									{subscription.cancelAtPeriodEnd ? "Ends" : "Renews"}{" "}
									{formatDate(subscription.currentPeriodEnd)}
								</span>
							</div>
							{subscription.cancelAtPeriodEnd ? (
								<p className="text-xs text-warning">
									Cancellation scheduled — this plan will not renew.
								</p>
							) : null}
						</div>

						{renewal ? <RenewalWarning renewal={renewal} /> : null}

						<div className="flex flex-wrap gap-3">
							<Link
								to="/pricing"
								className="text-sm font-medium text-primary underline-offset-4 hover:underline"
							>
								Change plan
							</Link>
							<Link
								to="/billing"
								className="text-sm font-medium text-primary underline-offset-4 hover:underline"
							>
								Wallet & payment mode
							</Link>
							{subscription.status === "active" && !subscription.cancelAtPeriodEnd ? (
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={isCancelling}
									onClick={() => void handleCancel()}
								>
									{isCancelling ? "Cancelling..." : "Cancel renewal"}
								</Button>
							) : null}
						</div>
					</>
				) : (
					<div className="rounded-lg border border-border/65 bg-muted/25 p-4 text-sm">
						<p className="font-medium text-foreground">You are on the free Lab plan.</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Up to 2 vehicles and 5 members.{" "}
							<Link to="/pricing" className="text-primary underline-offset-4 hover:underline">
								Compare plans
							</Link>
							.
						</p>
					</div>
				)}

				{orders.length ? (
					<div className="rounded-lg border border-border/65 bg-muted/25 p-4">
						<p className="text-xs tracking-[0.12em] text-muted-foreground uppercase">Orders</p>
						<div className="mt-3 flex flex-col gap-2">
							{orders.map((order) => (
								<div
									key={order.id}
									className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2 text-xs first:border-t-0 first:pt-0"
								>
									<span className="font-medium text-foreground/90">{order.planName}</span>
									<span className="text-muted-foreground">
										{order.quantity} × {order.cycle}
									</span>
									<span className="text-muted-foreground">{formatDate(order.createdAt)}</span>
									<span className="font-code text-foreground/85">{formatInr(order.amount)}</span>
									<Badge variant="secondary" className={statusTone[order.status]}>
										{order.status}
									</Badge>
								</div>
							))}
						</div>
					</div>
				) : null}

				{payments.length ? (
					<div className="rounded-lg border border-border/65 bg-muted/25 p-4">
						<p className="text-xs tracking-[0.12em] text-muted-foreground uppercase">Payments</p>
						<div className="mt-3 flex flex-col gap-2">
							{payments.map((payment) => (
								<div
									key={payment.id}
									className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2 text-xs first:border-t-0 first:pt-0"
								>
									<span className="font-code text-foreground/75">
										{payment.razorpayPaymentId ?? payment.id}
									</span>
									<span className="text-muted-foreground">{formatDate(payment.createdAt)}</span>
									<span className="text-muted-foreground">{payment.method ?? "—"}</span>
									<span className="font-code text-foreground/85">{formatInr(payment.amount)}</span>
									<Badge variant="secondary" className="text-[10px]">
										{payment.status}
									</Badge>
								</div>
							))}
						</div>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}

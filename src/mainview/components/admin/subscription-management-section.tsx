import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { billingApi } from "@/lib/billing-api";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import type { AuthUser } from "shared/auth";
import {
	type AdminBillingOrder,
	type AdminBillingOrdersResponse,
	type AdminBillingStats,
	BILLING_CYCLES,
	BILLING_PLANS,
	BILLING_SUBSCRIPTION_STATUSES,
	type BillingCycle,
	type BillingPlanId,
	type BillingSubscriptionStatus,
	findBillingPlan,
	formatInr,
} from "shared/billing";
import { toast } from "sonner";

const EMPTY_STATS: AdminBillingStats = {
	totalOrders: 0,
	activeOrders: 0,
	capturedRevenue: 0,
	currency: "INR",
};

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

const purchasablePlans = BILLING_PLANS.filter((plan) => plan.kind !== "contact");

interface OrderDraft {
	status: BillingSubscriptionStatus;
	quantity: string;
	periodEndLocal: string;
	cancelAtPeriodEnd: boolean;
	notes: string;
}

function toDatetimeLocal(value: string | null): string {
	if (!value) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	const offset = date.getTimezoneOffset() * 60_000;
	return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toDraft(order: AdminBillingOrder): OrderDraft {
	return {
		status: order.status,
		quantity: String(order.quantity),
		periodEndLocal: toDatetimeLocal(order.currentPeriodEnd),
		cancelAtPeriodEnd: order.cancelAtPeriodEnd,
		notes: order.notes,
	};
}

function formatDateTime(value: string | null): string {
	if (!value) return "—";
	return new Date(value).toLocaleString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function SubscriptionManagementSection({ users }: { users: AuthUser[] }) {
	const [orders, setOrders] = useState<AdminBillingOrder[]>([]);
	const [stats, setStats] = useState<AdminBillingStats>(EMPTY_STATS);
	const [drafts, setDrafts] = useState<Record<string, OrderDraft>>({});
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [savingId, setSavingId] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const [query, setQuery] = useState("");

	const [granting, setGranting] = useState(false);
	const [grantForm, setGrantForm] = useState<{
		userId: string;
		planId: BillingPlanId;
		cycle: BillingCycle;
		quantity: string;
		months: string;
		notes: string;
	}>({
		userId: "",
		planId: "operator",
		cycle: "monthly",
		quantity: "1",
		months: "",
		notes: "",
	});

	const applyResponse = useCallback((response: AdminBillingOrdersResponse) => {
		setOrders(response.orders);
		setStats(response.stats);
		setDrafts(Object.fromEntries(response.orders.map((order) => [order.id, toDraft(order)])));
	}, []);

	const refresh = useCallback(
		async (options?: { showToast?: boolean; withLoading?: boolean }) => {
			if (options?.withLoading) setLoading(true);
			else setRefreshing(true);

			try {
				applyResponse(await billingApi.getAdminOrders());
				if (options?.showToast) toast.success("Subscriptions refreshed.");
			} catch (error) {
				toast.error(error instanceof Error ? error.message : "Failed to load subscriptions.");
			} finally {
				setLoading(false);
				setRefreshing(false);
			}
		},
		[applyResponse],
	);

	useEffect(() => {
		void refresh({ withLoading: true });
	}, [refresh]);

	const handleSave = useCallback(
		async (order: AdminBillingOrder) => {
			const draft = drafts[order.id];
			if (!draft) return;

			const quantity = Number(draft.quantity);
			if (!Number.isInteger(quantity) || quantity < 1) {
				toast.error("Quantity must be a whole number of at least 1.");
				return;
			}

			setSavingId(order.id);
			try {
				applyResponse(
					await billingApi.updateAdminOrder(order.id, {
						status: draft.status,
						quantity,
						notes: draft.notes,
						cancelAtPeriodEnd: draft.cancelAtPeriodEnd,
						currentPeriodEnd: draft.periodEndLocal
							? new Date(draft.periodEndLocal).toISOString()
							: null,
					}),
				);
				toast.success(`${order.privateId} updated.`);
			} catch (error) {
				toast.error(error instanceof Error ? error.message : "Failed to update the subscription.");
			} finally {
				setSavingId(null);
			}
		},
		[applyResponse, drafts],
	);

	/** Pause and resume are the same PATCH, just a different target status. */
	const handleSetStatus = useCallback(
		async (order: AdminBillingOrder, status: BillingSubscriptionStatus) => {
			setSavingId(order.id);
			try {
				applyResponse(await billingApi.updateAdminOrder(order.id, { status }));
				toast.success(`${order.privateId} is now ${status}.`);
			} catch (error) {
				toast.error(error instanceof Error ? error.message : "Failed to change the status.");
			} finally {
				setSavingId(null);
			}
		},
		[applyResponse],
	);

	const handleDelete = useCallback(
		async (order: AdminBillingOrder) => {
			setDeletingId(order.id);
			try {
				applyResponse(await billingApi.deleteAdminSubscription(order.id));
				toast.success(`${order.privateId} deleted.`);
				setConfirmDeleteId(null);
			} catch (error) {
				toast.error(error instanceof Error ? error.message : "Failed to delete the subscription.");
			} finally {
				setDeletingId(null);
			}
		},
		[applyResponse],
	);

	const handleGrant = useCallback(async () => {
		if (!grantForm.userId) {
			toast.error("Pick an account to activate the plan on.");
			return;
		}

		const quantity = Number(grantForm.quantity);
		if (!Number.isInteger(quantity) || quantity < 1) {
			toast.error("Vehicles must be a whole number of at least 1.");
			return;
		}

		setGranting(true);
		try {
			const response = await billingApi.createAdminSubscription({
				userId: grantForm.userId,
				planId: grantForm.planId,
				cycle: grantForm.cycle,
				quantity,
				notes: grantForm.notes.trim() || undefined,
				months: grantForm.months ? Number(grantForm.months) : undefined,
			});
			applyResponse(response);
			const created = response.orders[0];
			toast.success(
				created ? `Activated ${created.planName} as ${created.privateId}.` : "Plan activated.",
			);
			setGrantForm((previous) => ({ ...previous, notes: "", months: "" }));
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to activate the plan.");
		} finally {
			setGranting(false);
		}
	}, [applyResponse, grantForm]);

	const needle = query.trim().toLowerCase();
	const visibleOrders = needle
		? orders.filter((order) =>
				[order.userEmail, order.userFullName, order.planName, order.status, order.privateId]
					.join(" ")
					.toLowerCase()
					.includes(needle),
			)
		: orders;

	const selectedPlan = findBillingPlan(grantForm.planId);

	return (
		<div className="space-y-5">
			<Card className="bg-background/90">
				<CardHeader className="space-y-3">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<CardTitle className="font-heading text-xl">Subscription management</CardTitle>
							<CardDescription>
								Every subscription across all accounts, each with its own private id. Amounts are
								read-only — they record what Razorpay actually captured.
							</CardDescription>
						</div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={refreshing}
							onClick={() => void refresh({ showToast: true })}
						>
							{refreshing ? "Refreshing..." : "Refresh"}
						</Button>
					</div>
					<div className="grid gap-3 sm:grid-cols-3">
						<div className="rounded-lg border border-border/65 bg-muted/25 p-3">
							<p className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Total</p>
							<p className="font-code text-lg text-foreground">{stats.totalOrders}</p>
						</div>
						<div className="rounded-lg border border-border/65 bg-muted/25 p-3">
							<p className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
								Active
							</p>
							<p className="font-code text-lg text-success">{stats.activeOrders}</p>
						</div>
						<div className="rounded-lg border border-border/65 bg-muted/25 p-3">
							<p className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
								Captured
							</p>
							<p className="font-code text-lg text-primary">{formatInr(stats.capturedRevenue)}</p>
						</div>
					</div>
				</CardHeader>
			</Card>

			<Card className="bg-background/90">
				<CardHeader>
					<CardTitle className="font-heading text-lg">Activate a plan on an account</CardTitle>
					<CardDescription>
						Creates a new subscription with a fresh private id, active immediately. No payment is
						taken — use this for comped, manually invoiced or support grants.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<label htmlFor="grant-user" className="text-xs font-medium">
								Account
							</label>
							<select
								id="grant-user"
								value={grantForm.userId}
								onChange={(event) =>
									setGrantForm((previous) => ({ ...previous, userId: event.target.value }))
								}
								className="h-9 rounded-md border border-border bg-background px-2 text-sm"
							>
								<option value="">Select an account...</option>
								{users.map((user) => (
									<option key={user.id} value={user.id}>
										{user.email} — {user.fullName}
									</option>
								))}
							</select>
						</div>
						<div className="grid gap-1.5">
							<label htmlFor="grant-plan" className="text-xs font-medium">
								Plan
							</label>
							<select
								id="grant-plan"
								value={grantForm.planId}
								onChange={(event) =>
									setGrantForm((previous) => ({
										...previous,
										planId: event.target.value as BillingPlanId,
									}))
								}
								className="h-9 rounded-md border border-border bg-background px-2 text-sm"
							>
								{purchasablePlans.map((plan) => (
									<option key={plan.id} value={plan.id}>
										{plan.name}
										{plan.unitAmountPerMonth
											? ` — ${formatInr(plan.unitAmountPerMonth)}/vehicle/mo`
											: " — free"}
									</option>
								))}
							</select>
						</div>
					</div>

					<div className="grid gap-3 sm:grid-cols-3">
						<div className="grid gap-1.5">
							<label htmlFor="grant-cycle" className="text-xs font-medium">
								Cycle
							</label>
							<select
								id="grant-cycle"
								value={grantForm.cycle}
								onChange={(event) =>
									setGrantForm((previous) => ({
										...previous,
										cycle: event.target.value as BillingCycle,
									}))
								}
								className="h-9 rounded-md border border-border bg-background px-2 text-sm"
							>
								{BILLING_CYCLES.map((cycle) => (
									<option key={cycle} value={cycle}>
										{cycle}
									</option>
								))}
							</select>
						</div>
						<div className="grid gap-1.5">
							<label htmlFor="grant-quantity" className="text-xs font-medium">
								Vehicles
							</label>
							<Input
								id="grant-quantity"
								type="number"
								min={1}
								max={selectedPlan?.maxQuantity ?? 500}
								value={grantForm.quantity}
								onChange={(event) =>
									setGrantForm((previous) => ({ ...previous, quantity: event.target.value }))
								}
							/>
						</div>
						<div className="grid gap-1.5">
							<label htmlFor="grant-months" className="text-xs font-medium">
								Months (optional)
							</label>
							<Input
								id="grant-months"
								type="number"
								min={1}
								max={60}
								placeholder={grantForm.cycle === "annual" ? "12" : "1"}
								value={grantForm.months}
								onChange={(event) =>
									setGrantForm((previous) => ({ ...previous, months: event.target.value }))
								}
							/>
						</div>
					</div>

					<div className="grid gap-1.5">
						<label htmlFor="grant-notes" className="text-xs font-medium">
							Notes
						</label>
						<Textarea
							id="grant-notes"
							rows={2}
							placeholder="Why this was granted, invoice reference, who approved it..."
							value={grantForm.notes}
							onChange={(event) =>
								setGrantForm((previous) => ({ ...previous, notes: event.target.value }))
							}
						/>
					</div>

					<Button type="button" disabled={granting} onClick={() => void handleGrant()}>
						{granting ? "Activating..." : "Activate plan"}
					</Button>
				</CardContent>
			</Card>

			<Card className="bg-background/90">
				<CardHeader>
					<CardTitle className="font-heading text-lg">All subscriptions</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<Input
						placeholder="Filter by private id, email, name, plan or status..."
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>

					{loading ? (
						<p className="text-sm text-muted-foreground">Loading subscriptions...</p>
					) : visibleOrders.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{orders.length === 0 ? "No subscriptions yet." : "Nothing matches that filter."}
						</p>
					) : (
						visibleOrders.map((order) => {
							const draft = drafts[order.id] ?? toDraft(order);
							const busy = savingId === order.id || deletingId === order.id;

							return (
								<div
									key={order.id}
									className="grid gap-3 rounded-lg border border-border/65 bg-muted/25 p-4"
								>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-code text-sm font-semibold text-primary">
												{order.privateId}
											</span>
											<span className="font-heading text-sm font-bold">{order.planName}</span>
											<Badge variant="secondary" className={cn(statusTone[order.status])}>
												{order.status}
											</Badge>
											<Badge variant="secondary" className="text-[10px]">
												{order.mode}
											</Badge>
										</div>
										<span className="font-code text-sm text-foreground/85">
											{formatInr(order.amount)}
										</span>
									</div>

									<div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
										<span>
											{order.userFullName || "Unknown"}{" "}
											<span className="text-foreground/70">
												&lt;{order.userEmail || "deleted account"}&gt;
											</span>
										</span>
										<span>Created {formatDateTime(order.createdAt)}</span>
										<span>
											Period {formatDateTime(order.currentPeriodStart)} →{" "}
											{formatDateTime(order.currentPeriodEnd)}
										</span>
										<span>
											{order.paymentCount} payment{order.paymentCount === 1 ? "" : "s"}
										</span>
										{order.razorpayOrderId ? (
											<span className="font-code">{order.razorpayOrderId}</span>
										) : (
											<span className="italic">No Razorpay order (admin grant)</span>
										)}
										{order.razorpaySubscriptionId ? (
											<span className="font-code">{order.razorpaySubscriptionId}</span>
										) : null}
									</div>

									<div className="grid gap-3 sm:grid-cols-3">
										<div className="grid gap-1.5">
											<label htmlFor={`order-${order.id}-status`} className="text-xs font-medium">
												Status
											</label>
											<select
												id={`order-${order.id}-status`}
												value={draft.status}
												onChange={(event) =>
													setDrafts((previous) => ({
														...previous,
														[order.id]: {
															...draft,
															status: event.target.value as BillingSubscriptionStatus,
														},
													}))
												}
												className="h-9 rounded-md border border-border bg-background px-2 text-sm"
											>
												{BILLING_SUBSCRIPTION_STATUSES.map((status) => (
													<option key={status} value={status}>
														{status}
													</option>
												))}
											</select>
										</div>
										<div className="grid gap-1.5">
											<label htmlFor={`order-${order.id}-quantity`} className="text-xs font-medium">
												Vehicles
											</label>
											<Input
												id={`order-${order.id}-quantity`}
												type="number"
												min={1}
												value={draft.quantity}
												onChange={(event) =>
													setDrafts((previous) => ({
														...previous,
														[order.id]: { ...draft, quantity: event.target.value },
													}))
												}
											/>
										</div>
										<div className="grid gap-1.5">
											<label htmlFor={`order-${order.id}-end`} className="text-xs font-medium">
												Period ends
											</label>
											<Input
												id={`order-${order.id}-end`}
												type="datetime-local"
												value={draft.periodEndLocal}
												onChange={(event) =>
													setDrafts((previous) => ({
														...previous,
														[order.id]: { ...draft, periodEndLocal: event.target.value },
													}))
												}
											/>
										</div>
									</div>

									<div className="grid gap-1.5">
										<label htmlFor={`order-${order.id}-notes`} className="text-xs font-medium">
											Notes
										</label>
										<Textarea
											id={`order-${order.id}-notes`}
											rows={2}
											value={draft.notes}
											onChange={(event) =>
												setDrafts((previous) => ({
													...previous,
													[order.id]: { ...draft, notes: event.target.value },
												}))
											}
										/>
									</div>

									<div className="flex flex-wrap items-center gap-3">
										<label className="inline-flex items-center gap-2 text-xs">
											<input
												type="checkbox"
												checked={draft.cancelAtPeriodEnd}
												onChange={(event) =>
													setDrafts((previous) => ({
														...previous,
														[order.id]: { ...draft, cancelAtPeriodEnd: event.target.checked },
													}))
												}
											/>
											Do not renew
										</label>

										<Button
											type="button"
											size="sm"
											disabled={busy}
											onClick={() => void handleSave(order)}
										>
											{savingId === order.id ? "Saving..." : "Save"}
										</Button>

										{order.status === "active" ? (
											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={busy}
												onClick={() => void handleSetStatus(order, "paused")}
											>
												Pause
											</Button>
										) : order.status === "paused" || order.status === "halted" ? (
											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={busy}
												onClick={() => void handleSetStatus(order, "active")}
											>
												Resume
											</Button>
										) : null}

										{confirmDeleteId === order.id ? (
											<div className="flex flex-wrap items-center gap-2">
												<span className="text-xs text-destructive">
													Delete {order.privateId} permanently?
												</span>
												<Button
													type="button"
													size="sm"
													variant="destructive"
													disabled={busy}
													onClick={() => void handleDelete(order)}
												>
													{deletingId === order.id ? "Deleting..." : "Confirm delete"}
												</Button>
												<Button
													type="button"
													size="sm"
													variant="outline"
													onClick={() => setConfirmDeleteId(null)}
												>
													Cancel
												</Button>
											</div>
										) : (
											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={busy}
												onClick={() => setConfirmDeleteId(order.id)}
											>
												Delete
											</Button>
										)}
									</div>
								</div>
							);
						})
					)}
				</CardContent>
			</Card>
		</div>
	);
}

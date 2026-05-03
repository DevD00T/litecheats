import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authApi } from "@/lib/auth-api";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { AdminCreateUserPayload, AdminUserListStats, AuthUser } from "shared/auth";
import { toast } from "sonner";

type UserDraft = {
	fullName: string;
	company: string;
	email: string;
	password: string;
	isAdmin: boolean;
	isOwner: boolean;
};

const EMPTY_STATS: AdminUserListStats = {
	totalUsers: 0,
	adminUsers: 0,
	ownerUsers: 0,
};

function formatDate(value: string): string {
	try {
		return new Date(value).toLocaleString("en-IN", {
			dateStyle: "medium",
			timeStyle: "short",
			timeZone: "Asia/Kolkata",
		});
	} catch {
		return value;
	}
}

function toDraft(user: AuthUser): UserDraft {
	return {
		fullName: user.fullName,
		company: user.company,
		email: user.email,
		password: "",
		isAdmin: user.isAdmin,
		isOwner: user.isOwner,
	};
}

export function AdminPage() {
	const [users, setUsers] = useState<AuthUser[]>([]);
	const [stats, setStats] = useState<AdminUserListStats>(EMPTY_STATS);
	const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [savingId, setSavingId] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [createForm, setCreateForm] = useState<AdminCreateUserPayload>({
		id: "",
		fullName: "",
		company: "",
		email: "",
		password: "",
		isAdmin: false,
		isOwner: false,
	});

	const refreshAdminData = useCallback(
		async (options?: { showToast?: boolean; withLoading?: boolean }) => {
			const withLoading = options?.withLoading ?? false;
			if (withLoading) {
				setLoading(true);
			} else {
				setRefreshing(true);
			}

			try {
				const response = await authApi.getAdminUsers();
				setUsers(response.users);
				setStats(response.stats);
				setDrafts(
					Object.fromEntries(response.users.map((user) => [user.id, toDraft(user)])) as Record<
						string,
						UserDraft
					>,
				);
				if (options?.showToast) {
					toast.success("Admin dashboard refreshed.");
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : "Failed to load admin dashboard.";
				toast.error(message);
			} finally {
				setLoading(false);
				setRefreshing(false);
			}
		},
		[],
	);

	useEffect(() => {
		void refreshAdminData({ withLoading: true });
	}, [refreshAdminData]);

	const roleBreakdown = useMemo(
		() => [
			{ label: "Total Users", value: stats.totalUsers },
			{ label: "Admins", value: stats.adminUsers },
			{ label: "Owners", value: stats.ownerUsers },
		],
		[stats],
	);

	const updateDraft = (userId: string, patch: Partial<UserDraft>) => {
		setDrafts((previous) => ({
			...previous,
			[userId]: {
				...(previous[userId] ?? {
					fullName: "",
					company: "",
					email: "",
					password: "",
					isAdmin: false,
					isOwner: false,
				}),
				...patch,
			},
		}));
	};

	const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const payload: AdminCreateUserPayload = {
			id: createForm.id?.trim() || undefined,
			fullName: createForm.fullName.trim(),
			company: createForm.company.trim(),
			email: createForm.email.trim(),
			password: createForm.password,
			isAdmin: createForm.isAdmin,
			isOwner: createForm.isOwner,
		};

		if (!payload.fullName || !payload.company || !payload.email || !payload.password) {
			toast.error("fullName, company, email, and password are required.");
			return;
		}

		setCreating(true);
		try {
			await authApi.createAdminUser(payload);
			toast.success("User created.");
			setCreateForm({
				id: "",
				fullName: "",
				company: "",
				email: "",
				password: "",
				isAdmin: false,
				isOwner: false,
			});
			await refreshAdminData();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to create user.";
			toast.error(message);
		} finally {
			setCreating(false);
		}
	};

	const handleSaveUser = async (user: AuthUser) => {
		const draft = drafts[user.id];
		if (!draft) return;

		const payload: Record<string, unknown> = {};
		if (draft.fullName.trim() !== user.fullName) payload.fullName = draft.fullName.trim();
		if (draft.company.trim() !== user.company) payload.company = draft.company.trim();
		if (draft.email.trim() !== user.email) payload.email = draft.email.trim();
		if (draft.isAdmin !== user.isAdmin) payload.isAdmin = draft.isAdmin;
		if (draft.isOwner !== user.isOwner) payload.isOwner = draft.isOwner;
		if (draft.password.trim()) payload.password = draft.password;

		if (!Object.keys(payload).length) {
			toast.message("No changes to save.");
			return;
		}

		setSavingId(user.id);
		try {
			await authApi.updateAdminUser(user.id, payload);
			toast.success("User updated.");
			await refreshAdminData();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to update user.";
			toast.error(message);
		} finally {
			setSavingId(null);
		}
	};

	const handleDeleteUser = async (user: AuthUser) => {
		const accepted = window.confirm(
			`Delete ${user.email}? This removes user sessions permanently.`,
		);
		if (!accepted) return;

		setDeletingId(user.id);
		try {
			await authApi.deleteAdminUser(user.id);
			toast.success("User deleted.");
			await refreshAdminData();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to delete user.";
			toast.error(message);
		} finally {
			setDeletingId(null);
		}
	};

	if (loading) {
		return (
			<AnimatedPage>
				<div className="rounded-xl border border-border/65 bg-card/70 p-6 text-sm text-muted-foreground">
					Loading admin dashboard...
				</div>
			</AnimatedPage>
		);
	}

	return (
		<AnimatedPage>
			<section className="space-y-5">
				<Card className="bg-background/90">
					<CardHeader className="space-y-3">
						<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
							Admin Panel
						</Badge>
						<CardTitle className="font-heading text-3xl">User Access Dashboard</CardTitle>
						<CardDescription>
							Manage users, privileged roles, and account lifecycle controls.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-3 md:grid-cols-3">
							{roleBreakdown.map((item) => (
								<div
									key={item.label}
									className="rounded-lg border border-border/65 bg-muted/25 p-4 text-sm"
								>
									<p className="text-muted-foreground">{item.label}</p>
									<p className="mt-1 text-2xl font-semibold text-foreground">{item.value}</p>
								</div>
							))}
						</div>
						<div className="flex items-center gap-3">
							<Button
								type="button"
								variant="outline"
								onClick={() => void refreshAdminData({ showToast: true })}
							>
								{refreshing ? "Refreshing..." : "Refresh"}
							</Button>
						</div>
					</CardContent>
				</Card>

				<Card className="bg-background/90">
					<CardHeader>
						<CardTitle className="font-heading text-xl">Create User</CardTitle>
						<CardDescription>Create a new user with id, email, and password.</CardDescription>
					</CardHeader>
					<CardContent>
						<form className="grid gap-4" onSubmit={handleCreateUser}>
							<div className="grid gap-2 md:grid-cols-2">
								<div className="grid gap-2">
									<label htmlFor="new-id" className="text-sm font-medium">
										User ID
									</label>
									<Input
										id="new-id"
										value={createForm.id ?? ""}
										onChange={(event) =>
											setCreateForm((previous) => ({ ...previous, id: event.target.value }))
										}
										placeholder="Optional custom id"
									/>
								</div>
								<div className="grid gap-2">
									<label htmlFor="new-email" className="text-sm font-medium">
										Email
									</label>
									<Input
										id="new-email"
										type="email"
										value={createForm.email}
										onChange={(event) =>
											setCreateForm((previous) => ({ ...previous, email: event.target.value }))
										}
										required
									/>
								</div>
							</div>
							<div className="grid gap-2 md:grid-cols-2">
								<div className="grid gap-2">
									<label htmlFor="new-fullName" className="text-sm font-medium">
										Full Name
									</label>
									<Input
										id="new-fullName"
										value={createForm.fullName}
										onChange={(event) =>
											setCreateForm((previous) => ({ ...previous, fullName: event.target.value }))
										}
										required
									/>
								</div>
								<div className="grid gap-2">
									<label htmlFor="new-company" className="text-sm font-medium">
										Company
									</label>
									<Input
										id="new-company"
										value={createForm.company}
										onChange={(event) =>
											setCreateForm((previous) => ({ ...previous, company: event.target.value }))
										}
										required
									/>
								</div>
							</div>
							<div className="grid gap-2">
								<label htmlFor="new-password" className="text-sm font-medium">
									Password
								</label>
								<Input
									id="new-password"
									type="password"
									value={createForm.password}
									onChange={(event) =>
										setCreateForm((previous) => ({ ...previous, password: event.target.value }))
									}
									required
								/>
							</div>
							<div className="flex flex-wrap gap-4">
								<label className="inline-flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										checked={Boolean(createForm.isAdmin)}
										onChange={(event) =>
											setCreateForm((previous) => ({ ...previous, isAdmin: event.target.checked }))
										}
									/>
									Grant Admin
								</label>
								<label className="inline-flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										checked={Boolean(createForm.isOwner)}
										onChange={(event) =>
											setCreateForm((previous) => ({ ...previous, isOwner: event.target.checked }))
										}
									/>
									Grant Owner
								</label>
							</div>
							<Button type="submit" disabled={creating}>
								{creating ? "Creating..." : "Create User"}
							</Button>
						</form>
					</CardContent>
				</Card>

				<Card className="bg-background/90">
					<CardHeader>
						<CardTitle className="font-heading text-xl">Users</CardTitle>
						<CardDescription>
							Edit role flags, profile data, password, or delete accounts.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{users.length === 0 ? (
							<p className="text-sm text-muted-foreground">No users found.</p>
						) : (
							users.map((user) => {
								const draft = drafts[user.id] ?? toDraft(user);
								const fullNameInputId = `user-${user.id}-fullName`;
								const companyInputId = `user-${user.id}-company`;
								const emailInputId = `user-${user.id}-email`;
								const passwordInputId = `user-${user.id}-password`;
								return (
									<div key={user.id} className="rounded-xl border border-border/65 bg-muted/20 p-4">
										<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
											<div>
												<p className="text-sm font-semibold text-foreground">{user.email}</p>
												<p className="text-xs text-muted-foreground">
													ID: {user.id} • Created: {formatDate(user.createdAt)}
												</p>
											</div>
											<div className="flex flex-wrap gap-2">
												{user.roles.map((role) => (
													<Badge key={`${user.id}-${role}`} variant="secondary">
														{role}
													</Badge>
												))}
											</div>
										</div>
										<div className="grid gap-3 md:grid-cols-2">
											<div className="grid gap-2">
												<label
													htmlFor={fullNameInputId}
													className="text-xs font-medium text-muted-foreground"
												>
													Full Name
												</label>
												<Input
													id={fullNameInputId}
													value={draft.fullName}
													onChange={(event) =>
														updateDraft(user.id, { fullName: event.target.value })
													}
												/>
											</div>
											<div className="grid gap-2">
												<label
													htmlFor={companyInputId}
													className="text-xs font-medium text-muted-foreground"
												>
													Company
												</label>
												<Input
													id={companyInputId}
													value={draft.company}
													onChange={(event) =>
														updateDraft(user.id, { company: event.target.value })
													}
												/>
											</div>
											<div className="grid gap-2">
												<label
													htmlFor={emailInputId}
													className="text-xs font-medium text-muted-foreground"
												>
													Email
												</label>
												<Input
													id={emailInputId}
													type="email"
													value={draft.email}
													onChange={(event) => updateDraft(user.id, { email: event.target.value })}
												/>
											</div>
											<div className="grid gap-2">
												<label
													htmlFor={passwordInputId}
													className="text-xs font-medium text-muted-foreground"
												>
													New Password
												</label>
												<Input
													id={passwordInputId}
													type="password"
													placeholder="Leave blank to keep current"
													value={draft.password}
													onChange={(event) =>
														updateDraft(user.id, { password: event.target.value })
													}
												/>
											</div>
										</div>
										<div className="mt-3 flex flex-wrap items-center gap-4">
											<label className="inline-flex items-center gap-2 text-sm">
												<input
													type="checkbox"
													checked={draft.isAdmin}
													onChange={(event) =>
														updateDraft(user.id, { isAdmin: event.target.checked })
													}
												/>
												Admin
											</label>
											<label className="inline-flex items-center gap-2 text-sm">
												<input
													type="checkbox"
													checked={draft.isOwner}
													onChange={(event) =>
														updateDraft(user.id, { isOwner: event.target.checked })
													}
												/>
												Owner
											</label>
										</div>
										<div className="mt-4 flex flex-wrap gap-3">
											<Button
												type="button"
												disabled={savingId === user.id}
												onClick={() => void handleSaveUser(user)}
											>
												{savingId === user.id ? "Saving..." : "Save Changes"}
											</Button>
											<Button
												type="button"
												variant="destructive"
												disabled={deletingId === user.id}
												onClick={() => void handleDeleteUser(user)}
											>
												{deletingId === user.id ? "Deleting..." : "Delete User"}
											</Button>
										</div>
									</div>
								);
							})
						)}
					</CardContent>
				</Card>
			</section>
		</AnimatedPage>
	);
}

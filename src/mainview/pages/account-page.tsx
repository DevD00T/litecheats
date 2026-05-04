import { useAuth } from "@/components/auth/auth-provider";
import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authApi } from "@/lib/auth-api";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthSession } from "shared/auth";
import { toast } from "sonner";

function formatRole(role: string): string {
	if (!role) return role;
	return role.charAt(0).toUpperCase() + role.slice(1);
}

export function AccountPage() {
	const navigate = useNavigate();
	const { user, logout, refreshSession, updateProfile, deleteAccount } = useAuth();
	const [fullName, setFullName] = useState("");
	const [company, setCompany] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [isLoggingOut, setIsLoggingOut] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [sessions, setSessions] = useState<AuthSession[]>([]);
	const [isLoadingSessions, setIsLoadingSessions] = useState(false);
	const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);
	const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

	useEffect(() => {
		setFullName(user?.fullName ?? "");
		setCompany(user?.company ?? "");
	}, [user]);

	const formatSessionDate = useCallback((value: string) => {
		try {
			return new Date(value).toLocaleString("en-IN", {
				dateStyle: "medium",
				timeStyle: "short",
				timeZone: "Asia/Kolkata",
			});
		} catch {
			return value;
		}
	}, []);

	const loadSessions = useCallback(async () => {
		setIsLoadingSessions(true);
		try {
			const response = await authApi.getSessions();
			setSessions(response.sessions);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to load active sessions.";
			toast.error(message);
		} finally {
			setIsLoadingSessions(false);
		}
	}, []);

	useEffect(() => {
		void loadSessions();
	}, [loadSessions]);

	const handleSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!fullName.trim() || !company.trim()) {
			toast.error("Full name and company are required.");
			return;
		}

		setIsSaving(true);
		try {
			await updateProfile({ fullName, company });
			toast.success("Profile updated.");
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to update profile.";
			toast.error(message);
		} finally {
			setIsSaving(false);
		}
	};

	const handleLogout = async () => {
		setIsLoggingOut(true);
		try {
			await logout();
			toast.success("Logged out.");
			navigate("/login", { replace: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to log out.";
			toast.error(message);
		} finally {
			setIsLoggingOut(false);
		}
	};

	const handleDeleteAccount = async () => {
		const accepted = window.confirm(
			"Delete your account permanently? This removes your profile and active sessions.",
		);
		if (!accepted) return;

		setIsDeleting(true);
		try {
			await deleteAccount();
			toast.success("Account deleted.");
			navigate("/signup", { replace: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to delete account.";
			toast.error(message);
		} finally {
			setIsDeleting(false);
		}
	};

	const handleLogoutAllSessions = async () => {
		const accepted = window.confirm("Log out from all devices? You will need to sign in again.");
		if (!accepted) return;

		setIsLoggingOutAll(true);
		try {
			const response = await authApi.logoutAllSessions();
			await refreshSession({ withLoading: false });
			toast.success(`Logged out from ${response.revokedCount} session(s).`);
			navigate("/login", { replace: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to log out all sessions.";
			toast.error(message);
		} finally {
			setIsLoggingOutAll(false);
		}
	};

	const handleRevokeSession = async (sessionId: string, current: boolean) => {
		setRevokingSessionId(sessionId);
		try {
			await authApi.revokeSession({ sessionId });
			if (current) {
				await refreshSession({ withLoading: false });
				toast.success("Current session revoked. Please sign in again.");
				navigate("/login", { replace: true });
				return;
			}
			await loadSessions();
			toast.success("Session revoked.");
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to revoke session.";
			toast.error(message);
		} finally {
			setRevokingSessionId(null);
		}
	};

	return (
		<AnimatedPage>
			<section className="mx-auto grid w-full max-w-3xl gap-5">
				<Card className="bg-background/90">
					<CardHeader className="space-y-3">
						<Badge variant="secondary" className="w-fit bg-primary/12 text-primary">
							Account
						</Badge>
						<CardTitle className="font-heading text-3xl">Session Profile</CardTitle>
						<CardDescription>
							View your assigned roles and maintain your account details.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5">
						<div className="rounded-lg border border-border/65 bg-muted/25 p-4 text-sm">
							<p className="text-muted-foreground">Signed in as</p>
							<p className="font-medium text-foreground">{user?.email ?? "Unknown"}</p>
						</div>
						<div className="grid gap-3 rounded-lg border border-border/65 bg-muted/25 p-4 text-sm">
							<div className="space-y-2">
								<p className="text-muted-foreground">Your Roles</p>
								<div className="flex flex-wrap gap-2">
									{(user?.roles?.length ? user.roles : ["user"]).map((role) => (
										<Badge key={role} variant="secondary" className="bg-primary/12 text-primary">
											{formatRole(role)}
										</Badge>
									))}
								</div>
							</div>
						</div>
						<form className="grid gap-4" onSubmit={handleSaveProfile}>
							<div className="grid gap-2">
								<label htmlFor="fullName" className="text-sm font-medium">
									Full Name
								</label>
								<Input
									id="fullName"
									name="fullName"
									value={fullName}
									onChange={(event) => setFullName(event.target.value)}
									required
								/>
							</div>
							<div className="grid gap-2">
								<label htmlFor="company" className="text-sm font-medium">
									Company
								</label>
								<Input
									id="company"
									name="company"
									value={company}
									onChange={(event) => setCompany(event.target.value)}
									required
								/>
							</div>
							<div className="flex flex-wrap items-center gap-3">
								<Button type="submit" disabled={isSaving}>
									{isSaving ? "Saving..." : "Save Profile"}
								</Button>
								<Button
									type="button"
									variant="outline"
									disabled={isLoggingOutAll}
									onClick={handleLogoutAllSessions}
								>
									{isLoggingOutAll ? "Logging out all..." : "Logout All Sessions"}
								</Button>
								<Button
									type="button"
									variant="outline"
									disabled={isLoggingOut}
									onClick={handleLogout}
								>
									{isLoggingOut ? "Signing out..." : "Sign Out"}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>

				<Card className="bg-background/90">
					<CardHeader>
						<CardTitle className="font-heading text-xl">Active Sessions</CardTitle>
						<CardDescription>Manage active device sessions for this account.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						<div className="flex gap-3">
							<Button type="button" variant="outline" onClick={() => void loadSessions()}>
								{isLoadingSessions ? "Refreshing..." : "Refresh Sessions"}
							</Button>
						</div>
						{sessions.length === 0 ? (
							<p className="text-sm text-muted-foreground">No active sessions found.</p>
						) : (
							<div className="grid gap-3">
								{sessions.map((session) => (
									<div
										key={session.id}
										className="rounded-lg border border-border/65 bg-muted/25 p-4 text-sm"
									>
										<div className="mb-2 flex flex-wrap items-center gap-2">
											{session.current ? (
												<Badge className="bg-primary/15 text-primary" variant="secondary">
													Current
												</Badge>
											) : null}
											<Badge variant="outline">{session.ipAddress}</Badge>
										</div>
										<p className="font-medium text-foreground">{session.userAgent}</p>
										<p className="mt-1 text-xs text-muted-foreground">
											Signed in: {formatSessionDate(session.createdAt)}
										</p>
										<p className="text-xs text-muted-foreground">
											Last active: {formatSessionDate(session.updatedAt)}
										</p>
										<p className="text-xs text-muted-foreground">
											Expires: {formatSessionDate(session.expiresAt)}
										</p>
										<div className="mt-3">
											<Button
												type="button"
												variant="outline"
												size="sm"
												disabled={revokingSessionId === session.id}
												onClick={() => void handleRevokeSession(session.id, session.current)}
											>
												{revokingSessionId === session.id ? "Revoking..." : "Revoke Session"}
											</Button>
										</div>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				<Card className="border-destructive/45 bg-background/90">
					<CardHeader>
						<CardTitle className="font-heading text-xl text-destructive">Danger Zone</CardTitle>
						<CardDescription>
							Deleting your account removes your profile and all active sessions.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button
							type="button"
							variant="destructive"
							disabled={isDeleting}
							onClick={handleDeleteAccount}
						>
							{isDeleting ? "Deleting..." : "Delete Account"}
						</Button>
					</CardContent>
				</Card>
			</section>
		</AnimatedPage>
	);
}

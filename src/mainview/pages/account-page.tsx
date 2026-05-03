import { useAuth } from "@/components/auth/auth-provider";
import { AnimatedPage } from "@/components/layout/animated-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

function formatRole(role: string): string {
	if (!role) return role;
	return role.charAt(0).toUpperCase() + role.slice(1);
}

export function AccountPage() {
	const navigate = useNavigate();
	const { user, logout, updateProfile, deleteAccount } = useAuth();
	const [fullName, setFullName] = useState("");
	const [company, setCompany] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [isLoggingOut, setIsLoggingOut] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	useEffect(() => {
		setFullName(user?.fullName ?? "");
		setCompany(user?.company ?? "");
	}, [user]);

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
									disabled={isLoggingOut}
									onClick={handleLogout}
								>
									{isLoggingOut ? "Signing out..." : "Sign Out"}
								</Button>
							</div>
						</form>
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

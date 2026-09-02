import { useAuth } from "@/components/auth/auth-provider";
import { buttonVariants } from "@/components/ui/button";
import { type ZapHandle, ZapIcon } from "@/components/ui/zap";
import { isBundledElectrobunRuntime } from "@/lib/electrobun";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

type ThemeMode = "light" | "dark";

interface SiteHeaderProps {
	themeMode: ThemeMode;
	onToggleTheme: () => void;
}

const primaryTabs = [
	{ to: "/", label: "Platform", end: true },
	{ to: "/pricing", label: "Pricing", end: false },
	{ to: "/docs", label: "Developers", end: false },
];

const mobileNavigation = [
	{ to: "/", label: "Platform", end: true },
	{ to: "/pricing", label: "Pricing", end: false },
	{ to: "/docs", label: "Developers", end: false },
	{ to: "/downloads", label: "Downloads", end: false },
	{ to: "/about", label: "About", end: false },
	{ to: "/contact", label: "Contact", end: false },
];

const ZAP_RESET_DELAY_MS = 900;
const BRAND_NAME = "Litecheats Technologies";

function ShieldIcon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			aria-hidden="true"
		>
			<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
			<path d="M9.5 12l1.8 1.8L14.8 10" />
		</svg>
	);
}

export function SiteHeader({ themeMode, onToggleTheme }: SiteHeaderProps) {
	const navigate = useNavigate();
	const { isAuthenticated, status, user, logout } = useAuth();
	const { pathname } = useLocation();
	const showIconOnlyBrand = isBundledElectrobunRuntime();
	const logoRef = useRef<ZapHandle | null>(null);
	const logoResetTimerRef = useRef<number | null>(null);
	const [isLoggingOut, setIsLoggingOut] = useState(false);

	const hasPrivilegedAccess = Boolean(user?.isAdmin || user?.isOwner);

	const mobileItems = useMemo(() => {
		if (isAuthenticated) {
			return [
				...mobileNavigation,
				...(hasPrivilegedAccess ? [{ to: "/admin", label: "Admin", end: false }] : []),
				{ to: "/account", label: "Account", end: false },
			];
		}
		return [
			...mobileNavigation,
			{ to: "/login", label: "Login", end: false },
			{ to: "/signup", label: "Sign Up", end: false },
		];
	}, [isAuthenticated, hasPrivilegedAccess]);

	useEffect(() => {
		if (!pathname) return;

		if (logoResetTimerRef.current !== null) {
			window.clearTimeout(logoResetTimerRef.current);
		}

		logoRef.current?.startAnimation();
		logoResetTimerRef.current = window.setTimeout(() => {
			logoRef.current?.stopAnimation();
			logoResetTimerRef.current = null;
		}, ZAP_RESET_DELAY_MS);

		return () => {
			if (logoResetTimerRef.current !== null) {
				window.clearTimeout(logoResetTimerRef.current);
				logoResetTimerRef.current = null;
			}
		};
	}, [pathname]);

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

	return (
		<motion.header
			className="glass-panel sticky top-0 z-30 border-x-0 border-t-0"
			initial={{ opacity: 0, y: -14 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
		>
			<div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3 md:px-10">
				<Link
					to="/"
					aria-label={showIconOnlyBrand ? "Home" : BRAND_NAME}
					className="group inline-flex items-center gap-2.5"
				>
					<span
						className="flex h-8 w-8 items-center justify-center rounded-[9px] shadow-[0_8px_22px_-10px_oklch(0.68_0.2_25/0.75)]"
						style={{
							background: "linear-gradient(145deg, var(--destructive), oklch(0.3 0.1 27))",
						}}
					>
						<ZapIcon
							ref={logoRef}
							size={16}
							className="pointer-events-none shrink-0"
							style={{ color: "oklch(0.93 0.16 92)" }}
							aria-hidden
						/>
					</span>
					{showIconOnlyBrand ? null : (
						<motion.span
							initial={{ opacity: 0, x: -6 }}
							animate={{ opacity: 1, x: 0 }}
							transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
							className="leading-[1.15]"
						>
							<span className="block font-heading text-sm font-bold tracking-tight text-foreground">
								Litecheats
							</span>
							<span className="block text-[9.5px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
								Technologies
							</span>
						</motion.span>
					)}
				</Link>

				<nav className="hidden items-center gap-0.5 md:flex">
					{primaryTabs.map((item) => (
						<NavLink
							key={item.to}
							to={item.to}
							end={item.end}
							className={({ isActive }) =>
								cn(
									"relative rounded-[9px] px-3.5 py-2 text-[13px] font-medium transition-colors",
									isActive
										? "text-primary"
										: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
								)
							}
						>
							{({ isActive }) => (
								<>
									{item.label}
									{isActive ? (
										<motion.span
											layoutId="nav-active-pill"
											className="absolute inset-0 -z-10 rounded-[9px] bg-primary/15"
											transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
										/>
									) : null}
								</>
							)}
						</NavLink>
					))}
					<span className="mx-2 h-[18px] w-px bg-border" aria-hidden />
					<Link
						to="/downloads"
						className="hidden rounded-[9px] px-3.5 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground lg:inline-flex"
					>
						Downloads
					</Link>
				</nav>

				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onToggleTheme}
						aria-label={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
						className="hidden h-9 items-center gap-2 rounded-lg border border-border bg-background/40 px-3 text-xs font-semibold text-foreground transition-colors hover:bg-accent/70 sm:inline-flex"
					>
						<span
							className={cn(
								"h-2 w-2 rounded-full transition-colors",
								themeMode === "dark"
									? "bg-secondary shadow-[0_0_8px_var(--secondary)]"
									: "bg-primary shadow-[0_0_8px_var(--primary)]",
							)}
						/>
						{themeMode === "dark" ? "Dark" : "Light"}
					</button>

					{status !== "loading" && isAuthenticated ? (
						<>
							{hasPrivilegedAccess ? (
								<Link
									to="/admin"
									className="hidden items-center gap-1.5 text-[13px] font-medium text-primary transition-colors hover:text-primary/80 md:inline-flex"
								>
									<ShieldIcon className="h-3.5 w-3.5" aria-hidden />
									Admin
								</Link>
							) : null}
							<Link
								to="/account"
								className="hidden text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
							>
								Account
							</Link>
							<button
								type="button"
								onClick={handleLogout}
								disabled={isLoggingOut}
								className={cn(
									buttonVariants({ variant: "outline", size: "sm" }),
									"hidden md:inline-flex",
								)}
							>
								{isLoggingOut ? "Signing out..." : "Logout"}
							</button>
						</>
					) : (
						<>
							<Link
								to="/login"
								className="hidden text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
							>
								Sign in
							</Link>
							<Link
								to="/signup"
								className={cn(buttonVariants({ size: "sm" }), "hidden md:inline-flex")}
							>
								Book a pilot
							</Link>
						</>
					)}
				</div>
			</div>
			<div className="border-t border-border/70 px-6 py-3 md:hidden">
				<div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2">
					{mobileItems.map((item) => (
						<NavLink
							key={`mobile-${item.to}`}
							to={item.to}
							end={item.end}
							className={({ isActive }) =>
								cn(
									"rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
									isActive
										? "bg-primary/15 text-primary"
										: "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
								)
							}
						>
							{item.label}
						</NavLink>
					))}
					{isAuthenticated ? (
						<button
							type="button"
							onClick={handleLogout}
							disabled={isLoggingOut}
							className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto")}
						>
							{isLoggingOut ? "Signing out..." : "Logout"}
						</button>
					) : null}
				</div>
			</div>
		</motion.header>
	);
}

import { useAuth } from "@/components/auth/auth-provider";
import { buttonVariants } from "@/components/ui/button";
import { type ZapHandle, ZapIcon } from "@/components/ui/zap";
import { isBundledElectrobunRuntime } from "@/lib/electrobun";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { gsap } from "gsap";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

type ThemeMode = "light" | "dark";

interface SiteHeaderProps {
	themeMode: ThemeMode;
	onToggleTheme: () => void;
}

const baseNavigation = [
	{ to: "/", label: "Home" },
	{ to: "/about", label: "About" },
	{ to: "/contact", label: "Contact" },
	{ to: "/privacy-policy", label: "Privacy" },
	{ to: "/terms", label: "Terms" },
];

const ZAP_RESET_DELAY_MS = 900;
const BRAND_NAME = "Litecheats Technologies";
const BRAND_CHARACTERS = BRAND_NAME.split("").map((char, position) => ({
	id: `${char}-${position}-${char.charCodeAt(0)}`,
	char,
}));

export function SiteHeader({ themeMode, onToggleTheme }: SiteHeaderProps) {
	const navigate = useNavigate();
	const { isAuthenticated, status, user, logout } = useAuth();
	const { pathname } = useLocation();
	const showIconOnlyBrand = isBundledElectrobunRuntime();
	const logoRef = useRef<ZapHandle | null>(null);
	const brandTextRef = useRef<HTMLSpanElement | null>(null);
	const logoResetTimerRef = useRef<number | null>(null);
	const [isLoggingOut, setIsLoggingOut] = useState(false);

	const navigation = useMemo(() => {
		const hasPrivilegedAccess = Boolean(user?.isAdmin || user?.isOwner);
		if (isAuthenticated) {
			return [
				...baseNavigation,
				...(hasPrivilegedAccess ? [{ to: "/admin", label: "Admin" }] : []),
				{ to: "/account", label: "Account" },
			];
		}
		return [
			...baseNavigation,
			{ to: "/login", label: "Login" },
			{ to: "/signup", label: "Sign Up" },
		];
	}, [isAuthenticated, user]);

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

	useLayoutEffect(() => {
		if (!pathname) return;

		const textNode = brandTextRef.current;
		if (!textNode) return;

		const chars = textNode.querySelectorAll<HTMLElement>(".brand-char");
		if (!chars.length) return;

		const ctx = gsap.context(() => {
			gsap.killTweensOf(chars);
			gsap.fromTo(
				chars,
				{ opacity: 0, scale: 4 },
				{
					opacity: 1,
					scale: 1,
					stagger: 0.07,
					duration: 1,
					ease: "expo.out",
					delay: 0.2,
				},
			);
		}, textNode);

		return () => {
			ctx.revert();
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
			className="sticky top-0 z-30 border-b border-border/50 bg-background/82 backdrop-blur"
			initial={{ opacity: 0, y: -16 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.45, ease: [0.24, 0.8, 0.24, 1] }}
		>
			<div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4 md:px-10">
				<Link
					to="/"
					aria-label={showIconOnlyBrand ? "Home" : "Litecheats Technologies"}
					className="inline-flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-primary shadow-[0_12px_24px_-18px_rgba(59,130,246,0.7)] transition-colors hover:bg-primary/16"
				>
					<ZapIcon ref={logoRef} size={28} className="pointer-events-none shrink-0" aria-hidden />
					{showIconOnlyBrand ? null : (
						<span
							ref={brandTextRef}
							className="font-heading text-sm font-semibold leading-none tracking-[0.01em] text-foreground sm:text-base"
						>
							{BRAND_CHARACTERS.map((item) => (
								<span key={item.id} className="brand-char inline-block">
									{item.char === " " ? "\u00A0" : item.char}
								</span>
							))}
						</span>
					)}
				</Link>
				<nav className="hidden items-center gap-1 md:flex">
					{navigation.map((item) => (
						<NavLink
							key={item.to}
							to={item.to}
							className={({ isActive }) =>
								cn(
									"rounded-md px-3 py-2 text-sm font-medium transition-colors",
									isActive
										? "bg-primary/14 text-primary"
										: "text-muted-foreground hover:bg-accent/80 hover:text-accent-foreground",
								)
							}
						>
							{item.label}
						</NavLink>
					))}
				</nav>
				<div className="flex items-center gap-2">
					{status === "authenticated" ? (
						<>
							<span className="hidden max-w-[180px] truncate text-xs text-muted-foreground md:inline">
								{user?.email}
							</span>
							{user?.isAdmin ? (
								<span className="hidden rounded-md border border-primary/35 bg-primary/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary md:inline">
									Admin Access
								</span>
							) : null}
							{user?.isOwner ? (
								<span className="hidden rounded-md border border-primary/35 bg-primary/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary md:inline">
									Owner Access
								</span>
							) : null}
						</>
					) : null}
					<button
						type="button"
						onClick={onToggleTheme}
						aria-label={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
						className="inline-flex h-9 items-center gap-2 rounded-md border border-border/70 bg-background/75 px-3 text-xs font-semibold text-foreground transition-colors hover:bg-accent/80"
					>
						<span
							className={cn(
								"h-2.5 w-2.5 rounded-full",
								themeMode === "dark"
									? "bg-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.7)]"
									: "bg-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.55)]",
							)}
						/>
						{themeMode === "dark" ? "Dark" : "Light"}
					</button>
					{isAuthenticated ? (
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
					) : (
						<Link
							to="/contact"
							className={cn(buttonVariants({ size: "sm" }), "hidden md:inline-flex")}
						>
							Start a Project
						</Link>
					)}
				</div>
			</div>
			<div className="border-t border-border/50 px-6 py-3 md:hidden">
				<div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2">
					{navigation.map((item) => (
						<NavLink
							key={`mobile-${item.to}`}
							to={item.to}
							className={({ isActive }) =>
								cn(
									"rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
									isActive
										? "bg-primary/14 text-primary"
										: "text-muted-foreground hover:bg-accent/80 hover:text-accent-foreground",
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
					) : (
						<Link to="/contact" className={cn(buttonVariants({ size: "sm" }), "ml-auto")}>
							Start
						</Link>
					)}
				</div>
			</div>
		</motion.header>
	);
}

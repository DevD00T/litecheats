import { AuthProvider, useAuth } from "@/components/auth/auth-provider";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Toaster } from "@/components/ui/sonner";
import { AboutPage } from "@/pages/about-page";
import { AccountPage } from "@/pages/account-page";
import { AdminPage } from "@/pages/admin-page";
import { ContactPage } from "@/pages/contact-page";
import { DownloadsPage } from "@/pages/downloads-page";
import { HomePage } from "@/pages/home-page";
import { LoginPage } from "@/pages/login-page";
import { PrivacyPage } from "@/pages/privacy-page";
import { SignupPage } from "@/pages/signup-page";
import { TermsPage } from "@/pages/terms-page";
import { AnimatePresence } from "framer-motion";
import { type ReactNode, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "litecheats-theme-mode";

function getInitialTheme(): ThemeMode {
	if (typeof window === "undefined") return "light";

	const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
	if (storedTheme === "light" || storedTheme === "dark") {
		return storedTheme;
	}

	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function AnimatedRoutes() {
	const location = useLocation();

	return (
		<AnimatePresence mode="wait" initial={false}>
			<Routes location={location} key={location.pathname}>
				<Route path="/" element={<HomePage />} />
				<Route path="/about" element={<AboutPage />} />
				<Route path="/contact" element={<ContactPage />} />
				<Route path="/downloads" element={<DownloadsPage />} />
				<Route path="/privacy-policy" element={<PrivacyPage />} />
				<Route path="/terms" element={<TermsPage />} />
				<Route
					path="/login"
					element={
						<GuestOnlyRoute>
							<LoginPage />
						</GuestOnlyRoute>
					}
				/>
				<Route
					path="/signup"
					element={
						<GuestOnlyRoute>
							<SignupPage />
						</GuestOnlyRoute>
					}
				/>
				<Route
					path="/account"
					element={
						<ProtectedRoute>
							<AccountPage />
						</ProtectedRoute>
					}
				/>
				<Route
					path="/admin"
					element={
						<PrivilegedRoute>
							<AdminPage />
						</PrivilegedRoute>
					}
				/>
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</AnimatePresence>
	);
}

function AuthBootScreen() {
	return (
		<div className="mx-auto my-12 w-full max-w-2xl rounded-xl border border-border/60 bg-card/65 p-6 text-center text-sm text-muted-foreground">
			Restoring session...
		</div>
	);
}

function ProtectedRoute({ children }: { children: ReactNode }) {
	const { status, isAuthenticated } = useAuth();
	const location = useLocation();

	if (status === "loading") return <AuthBootScreen />;
	if (!isAuthenticated) {
		const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
		return <Navigate to={`/login?redirect=${redirect}`} replace />;
	}

	return <>{children}</>;
}

function GuestOnlyRoute({ children }: { children: ReactNode }) {
	const { status, isAuthenticated } = useAuth();

	if (status === "loading") return <AuthBootScreen />;
	if (isAuthenticated) return <Navigate to="/account" replace />;

	return <>{children}</>;
}

function PrivilegedRoute({ children }: { children: ReactNode }) {
	const { status, isAuthenticated, user } = useAuth();
	const location = useLocation();

	if (status === "loading") return <AuthBootScreen />;
	if (!isAuthenticated) {
		const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
		return <Navigate to={`/login?redirect=${redirect}`} replace />;
	}

	const hasPrivilegedAccess = Boolean(user?.isAdmin || user?.isOwner);
	if (!hasPrivilegedAccess) {
		return <Navigate to="/account" replace />;
	}

	return <>{children}</>;
}

function SessionRouteSync() {
	const { pathname, search } = useLocation();
	const { refreshSession } = useAuth();
	const routeKey = `${pathname}${search}`;

	useEffect(() => {
		if (!routeKey) return;
		void refreshSession({ withLoading: false });
	}, [routeKey, refreshSession]);

	return null;
}

function AppShell({
	themeMode,
	onToggleTheme,
}: { themeMode: ThemeMode; onToggleTheme: () => void }) {
	return (
		<div className="relative min-h-screen overflow-hidden">
			<div className="pointer-events-none fixed inset-0 -z-10 bg-[linear-gradient(125deg,rgba(56,141,236,0.15),rgba(255,200,93,0.1)_45%,rgba(38,173,139,0.12))] dark:bg-[linear-gradient(130deg,rgba(12,28,58,0.86),rgba(39,18,47,0.78)_45%,rgba(14,48,58,0.8))]" />
			<div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_11%_14%,rgba(57,126,255,0.27),transparent_28%),radial-gradient(circle_at_90%_84%,rgba(255,147,84,0.23),transparent_27%)] dark:bg-[radial-gradient(circle_at_14%_18%,rgba(58,134,255,0.2),transparent_30%),radial-gradient(circle_at_86%_76%,rgba(255,122,90,0.18),transparent_28%)]" />
			<SessionRouteSync />
			<SiteHeader themeMode={themeMode} onToggleTheme={onToggleTheme} />
			<AnimatedRoutes />
			<SiteFooter />
			<Toaster />
		</div>
	);
}

export function App() {
	const [themeMode, setThemeMode] = useState<ThemeMode>(() => getInitialTheme());

	useEffect(() => {
		document.documentElement.classList.toggle("dark", themeMode === "dark");
		document.documentElement.classList.toggle("light", themeMode === "light");
		document.documentElement.style.colorScheme = themeMode;
		window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
	}, [themeMode]);

	const handleToggleTheme = () => {
		setThemeMode((previousTheme) => (previousTheme === "dark" ? "light" : "dark"));
	};

	return (
		<BrowserRouter>
			<AuthProvider>
				<AppShell themeMode={themeMode} onToggleTheme={handleToggleTheme} />
			</AuthProvider>
		</BrowserRouter>
	);
}

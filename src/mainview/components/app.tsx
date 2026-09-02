import { AuthProvider, useAuth } from "@/components/auth/auth-provider";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Toaster } from "@/components/ui/sonner";
import { hasAcceptedConsent } from "@/lib/consent";
import { AboutPage } from "@/pages/about-page";
import { AcceptTermsPage } from "@/pages/accept-terms-page";
import { AccountPage } from "@/pages/account-page";
import { AdminPage } from "@/pages/admin-page";
import { CareersPage } from "@/pages/careers-page";
import { ContactPage } from "@/pages/contact-page";
import { ArchiveArtifactsPage } from "@/pages/docs/archive-artifacts-page";
import { ArchiveJobsPage } from "@/pages/docs/archive-jobs-page";
import { ArchiveLogsPage } from "@/pages/docs/archive-logs-page";
import { AuthenticationPage } from "@/pages/docs/authentication-page";
import { ControlCommandPage } from "@/pages/docs/control-command-page";
import { ControlMissionPage } from "@/pages/docs/control-mission-page";
import { ControlModePage } from "@/pages/docs/control-mode-page";
import { DocsLayout } from "@/pages/docs/docs-layout";
import { ErrorsPage } from "@/pages/docs/errors-page";
import { QuickstartPage } from "@/pages/docs/quickstart-page";
import { ScopesPage } from "@/pages/docs/scopes-page";
import { SdkPythonPage } from "@/pages/docs/sdk-python-page";
import { SdkRos2Page } from "@/pages/docs/sdk-ros2-page";
import { SdkTypescriptPage } from "@/pages/docs/sdk-typescript-page";
import { TelemetryMessagesPage } from "@/pages/docs/telemetry-messages-page";
import { TelemetrySnapshotPage } from "@/pages/docs/telemetry-snapshot-page";
import { TelemetryStreamPage } from "@/pages/docs/telemetry-stream-page";
import { DownloadsPage } from "@/pages/downloads-page";
import { DpdpCompliancePage } from "@/pages/dpdp-compliance-page";
import { HomePage } from "@/pages/home-page";
import { LoginPage } from "@/pages/login-page";
import { MavlinkCloudPage } from "@/pages/platform/mavlink-cloud-page";
import { RdosConsolePage } from "@/pages/platform/rdos-console-page";
import { PressKitPage } from "@/pages/press-kit-page";
import { PricingPage } from "@/pages/pricing-page";
import { PrivacyPage } from "@/pages/privacy-page";
import { SecurityPage } from "@/pages/security-page";
import { SignupPage } from "@/pages/signup-page";
import { StatusPage } from "@/pages/status-page";
import { TermsPage } from "@/pages/terms-page";
import { VerifyEmailPage } from "@/pages/verify-email-page";
import { AnimatePresence } from "framer-motion";
import { type ReactNode, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "litecheats-theme-mode";

function getInitialTheme(): ThemeMode {
	if (typeof window === "undefined") return "dark";

	const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
	if (storedTheme === "light" || storedTheme === "dark") {
		return storedTheme;
	}

	// Litecheats is designed dark-first; light mode is opt-in via the toggle.
	return "dark";
}

const CONSENT_EXEMPT_PATHS = new Set([
	"/accept-terms",
	"/terms",
	"/privacy-policy",
	"/dpdp-compliance",
]);

function AnimatedRoutes() {
	const location = useLocation();

	if (!hasAcceptedConsent() && !CONSENT_EXEMPT_PATHS.has(location.pathname)) {
		const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
		return <Navigate to={`/accept-terms?redirect=${redirect}`} replace />;
	}

	return (
		<AnimatePresence mode="wait" initial={false}>
			<Routes location={location} key={location.pathname}>
				<Route path="/" element={<HomePage />} />
				<Route path="/pricing" element={<PricingPage />} />
				<Route path="/platform/rdos-console" element={<RdosConsolePage />} />
				<Route path="/platform/mavlink-cloud" element={<MavlinkCloudPage />} />
				<Route path="/dpdp-compliance" element={<DpdpCompliancePage />} />
				<Route path="/accept-terms" element={<AcceptTermsPage />} />
				<Route path="/docs" element={<DocsLayout />}>
					<Route index element={<Navigate to="quickstart" replace />} />
					<Route path="quickstart" element={<QuickstartPage />} />
					<Route path="authentication" element={<AuthenticationPage />} />
					<Route path="scopes" element={<ScopesPage />} />
					<Route path="errors" element={<ErrorsPage />} />
					<Route path="telemetry/stream" element={<TelemetryStreamPage />} />
					<Route path="telemetry/snapshot" element={<TelemetrySnapshotPage />} />
					<Route path="telemetry/messages" element={<TelemetryMessagesPage />} />
					<Route path="control/command" element={<ControlCommandPage />} />
					<Route path="control/mode" element={<ControlModePage />} />
					<Route path="control/mission" element={<ControlMissionPage />} />
					<Route path="archive/logs" element={<ArchiveLogsPage />} />
					<Route path="archive/artifacts" element={<ArchiveArtifactsPage />} />
					<Route path="archive/jobs" element={<ArchiveJobsPage />} />
					<Route path="sdks/python" element={<SdkPythonPage />} />
					<Route path="sdks/typescript" element={<SdkTypescriptPage />} />
					<Route path="sdks/ros2" element={<SdkRos2Page />} />
					<Route path="*" element={<Navigate to="/docs/quickstart" replace />} />
				</Route>
				<Route path="/about" element={<AboutPage />} />
				<Route path="/contact" element={<ContactPage />} />
				<Route path="/downloads" element={<DownloadsPage />} />
				<Route path="/status" element={<StatusPage />} />
				<Route path="/security" element={<SecurityPage />} />
				<Route path="/careers" element={<CareersPage />} />
				<Route path="/press-kit" element={<PressKitPage />} />
				<Route path="/privacy-policy" element={<PrivacyPage />} />
				<Route path="/terms" element={<TermsPage />} />
				<Route path="/verify-email" element={<VerifyEmailPage />} />
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
		<div className="app-canvas relative min-h-screen overflow-hidden">
			<div className="app-glow" aria-hidden />
			<div className="app-grid" aria-hidden />
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

import { authApi } from "@/lib/auth-api";
import {
	type PropsWithChildren,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useReducer,
} from "react";
import type { AuthUser, LoginPayload, SignupPayload, UpdateProfilePayload } from "shared/auth";

type AuthStatus = "loading" | "authenticated" | "anonymous";
const AUTH_SYNC_STORAGE_KEY = "litecheats-auth-sync";

interface AuthState {
	status: AuthStatus;
	user: AuthUser | null;
}

type AuthAction =
	| { type: "SESSION_LOADING" }
	| { type: "AUTHENTICATED"; user: AuthUser }
	| { type: "ANONYMOUS" };

function authReducer(state: AuthState, action: AuthAction): AuthState {
	switch (action.type) {
		case "SESSION_LOADING":
			return { ...state, status: "loading" };
		case "AUTHENTICATED":
			return { status: "authenticated", user: action.user };
		case "ANONYMOUS":
			return { status: "anonymous", user: null };
		default:
			return state;
	}
}

interface AuthContextValue {
	status: AuthStatus;
	user: AuthUser | null;
	isAuthenticated: boolean;
	refreshSession: (options?: { withLoading?: boolean }) => Promise<void>;
	login: (payload: LoginPayload) => Promise<AuthUser>;
	signup: (payload: SignupPayload) => Promise<AuthUser>;
	logout: () => Promise<void>;
	updateProfile: (payload: UpdateProfilePayload) => Promise<AuthUser>;
	deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function broadcastAuthSync() {
	try {
		window.localStorage.setItem(AUTH_SYNC_STORAGE_KEY, String(Date.now()));
	} catch {
		// Ignore storage write failures.
	}
}

export function AuthProvider({ children }: PropsWithChildren) {
	const [state, dispatch] = useReducer(authReducer, {
		status: "loading",
		user: null,
	});

	const refreshSession = useCallback(async (options?: { withLoading?: boolean }) => {
		const withLoading = options?.withLoading ?? true;
		if (withLoading) {
			dispatch({ type: "SESSION_LOADING" });
		}

		try {
			const session = await authApi.getSession();
			if (session.authenticated && session.user) {
				dispatch({ type: "AUTHENTICATED", user: session.user });
				return;
			}
			dispatch({ type: "ANONYMOUS" });
		} catch {
			dispatch({ type: "ANONYMOUS" });
		}
	}, []);

	const login = useCallback(async (payload: LoginPayload) => {
		const response = await authApi.login(payload);
		dispatch({ type: "AUTHENTICATED", user: response.user });
		broadcastAuthSync();
		return response.user;
	}, []);

	const signup = useCallback(async (payload: SignupPayload) => {
		const response = await authApi.signup(payload);
		dispatch({ type: "AUTHENTICATED", user: response.user });
		broadcastAuthSync();
		return response.user;
	}, []);

	const logout = useCallback(async () => {
		try {
			await authApi.logout();
		} finally {
			dispatch({ type: "ANONYMOUS" });
			broadcastAuthSync();
		}
	}, []);

	const updateProfile = useCallback(async (payload: UpdateProfilePayload) => {
		const response = await authApi.updateMe(payload);
		dispatch({ type: "AUTHENTICATED", user: response.user });
		broadcastAuthSync();
		return response.user;
	}, []);

	const deleteAccount = useCallback(async () => {
		await authApi.deleteMe();
		dispatch({ type: "ANONYMOUS" });
		broadcastAuthSync();
	}, []);

	useEffect(() => {
		void refreshSession();
	}, [refreshSession]);

	useEffect(() => {
		const refreshSessionSilently = () => {
			void refreshSession({ withLoading: false });
		};

		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				refreshSessionSilently();
			}
		};

		const handleStorage = (event: StorageEvent) => {
			if (event.key === AUTH_SYNC_STORAGE_KEY) {
				refreshSessionSilently();
			}
		};

		window.addEventListener("focus", refreshSessionSilently);
		window.addEventListener("pageshow", refreshSessionSilently);
		document.addEventListener("visibilitychange", handleVisibilityChange);
		window.addEventListener("storage", handleStorage);

		return () => {
			window.removeEventListener("focus", refreshSessionSilently);
			window.removeEventListener("pageshow", refreshSessionSilently);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			window.removeEventListener("storage", handleStorage);
		};
	}, [refreshSession]);

	const value = useMemo<AuthContextValue>(
		() => ({
			status: state.status,
			user: state.user,
			isAuthenticated: state.status === "authenticated" && Boolean(state.user),
			refreshSession,
			login,
			signup,
			logout,
			updateProfile,
			deleteAccount,
		}),
		[state, refreshSession, login, signup, logout, updateProfile, deleteAccount],
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error("useAuth must be used within an AuthProvider.");
	}
	return context;
}

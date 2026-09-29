import { useAuth } from "@/components/auth/auth-provider";
import { notificationsApi } from "@/lib/notifications-api";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { UserNotification } from "shared/notifications";

/**
 * The signed-in user's notification inbox, shared by the header bell and the
 * inbox page. Refreshed on sign-in, when the tab becomes visible, and every
 * minute while it's visible.
 */
interface Store {
	notifications: UserNotification[];
	unread: number;
	loaded: boolean;
}

let state: Store = { notifications: [], unread: 0, loaded: false };
const listeners = new Set<() => void>();
const set = (next: Partial<Store>) => {
	state = { ...state, ...next };
	for (const listener of listeners) listener();
};

async function load(): Promise<void> {
	try {
		const response = await notificationsApi.mine(50);
		set({ notifications: response.notifications, unread: response.unread, loaded: true });
	} catch {
		set({ loaded: true });
	}
}

export function useNotifications() {
	const { isAuthenticated } = useAuth();
	const snapshot = useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => state,
		() => state,
	);

	useEffect(() => {
		if (!isAuthenticated) {
			set({ notifications: [], unread: 0, loaded: false });
			return;
		}
		void load();
		const onVisible = () => {
			if (document.visibilityState === "visible") void load();
		};
		document.addEventListener("visibilitychange", onVisible);
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") void load();
		}, 60_000);
		return () => {
			document.removeEventListener("visibilitychange", onVisible);
			window.clearInterval(timer);
		};
	}, [isAuthenticated]);

	const markRead = useCallback(async (id: string) => {
		const target = state.notifications.find((item) => item.id === id);
		if (!target || target.readAt) return;
		set({
			notifications: state.notifications.map((item) =>
				item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
			),
			unread: Math.max(0, state.unread - 1),
		});
		await notificationsApi.markRead(id).catch(() => undefined);
	}, []);

	const markAllRead = useCallback(async () => {
		const now = new Date().toISOString();
		set({
			notifications: state.notifications.map((item) => ({ ...item, readAt: item.readAt ?? now })),
			unread: 0,
		});
		await notificationsApi.markAllRead().catch(() => undefined);
	}, []);

	return { ...snapshot, refresh: load, markRead, markAllRead };
}

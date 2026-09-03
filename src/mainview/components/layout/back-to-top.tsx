import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

const SHOW_AFTER_PX = 480;

export function BackToTop() {
	const [visible, setVisible] = useState(false);
	const { pathname } = useLocation();

	// A page you land on already scrolled (e.g. via hash) shouldn't show a
	// stale "visible" state from the previous page.
	useEffect(() => {
		setVisible(window.scrollY > SHOW_AFTER_PX);
	}, [pathname]);

	useEffect(() => {
		const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX);
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	return (
		<button
			type="button"
			onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
			aria-label="Back to top"
			tabIndex={visible ? 0 : -1}
			className={cn(
				"fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-[0_12px_30px_-12px_rgba(0,0,0,0.55)] backdrop-blur-xl transition-all duration-300 hover:bg-accent/80 active:scale-95 sm:right-6 sm:bottom-6 md:right-8 md:bottom-8",
				visible
					? "translate-y-0 opacity-100"
					: "pointer-events-none translate-y-3 opacity-0",
			)}
		>
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.2"
				strokeLinecap="round"
				strokeLinejoin="round"
				className="h-5 w-5"
				aria-hidden="true"
			>
				<path d="M12 19V5" />
				<path d="M6 11l6-6 6 6" />
			</svg>
		</button>
	);
}

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Resets scroll position on every route change. Without this, react-router
 * (and the browser) preserve scroll offset across navigations, so leaving a
 * long page halfway down lands the next page halfway down too.
 */
export function ScrollToTop() {
	const { pathname, hash } = useLocation();

	useEffect(() => {
		if (hash) {
			const target = document.getElementById(hash.slice(1));
			if (target) {
				target.scrollIntoView({ behavior: "smooth", block: "start" });
				return;
			}
		}
		window.scrollTo({ top: 0, left: 0, behavior: "auto" });
	}, [pathname, hash]);

	return null;
}

import { AnimatedPage } from "@/components/layout/animated-page";
import { cn } from "@/lib/utils";
import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { docNavGroups } from "./nav";

export function DocsLayout() {
	const scopeRef = useRef<HTMLElement | null>(null);

	useLayoutEffect(() => {
		if (!scopeRef.current) return;
		const ctx = gsap.context(() => {
			gsap.from(".docs-nav-group", {
				x: -14,
				opacity: 0,
				duration: 0.45,
				stagger: 0.06,
				ease: "power2.out",
			});
			gsap.from(".docs-main", {
				y: 20,
				opacity: 0,
				duration: 0.5,
				ease: "power2.out",
				delay: 0.08,
			});
		}, scopeRef);
		return () => ctx.revert();
	}, []);

	return (
		<AnimatedPage>
			<section ref={scopeRef} className="grid gap-7 md:grid-cols-[196px_1fr] md:items-start">
				<nav className="flex flex-col gap-4 md:sticky md:top-24">
					{docNavGroups.map((group) => (
						<div key={group.group} className="docs-nav-group">
							<div className="px-2 pb-1.5 text-[10px] tracking-[0.14em] text-muted-foreground/70 uppercase">
								{group.group}
							</div>
							<div className="flex flex-col gap-0.5">
								{group.items.map((item) => (
									<NavLink
										key={item.to}
										to={`/docs/${item.to}`}
										className={({ isActive }) =>
											cn(
												"rounded-[7px] px-2.5 py-1.5 text-[12.5px] transition-colors",
												isActive
													? "bg-secondary/14 text-secondary"
													: "text-foreground/75 hover:bg-accent/50 hover:text-foreground",
											)
										}
									>
										{item.label}
									</NavLink>
								))}
							</div>
						</div>
					))}
				</nav>

				<div className="docs-main min-w-0">
					<Outlet />
				</div>
			</section>
		</AnimatedPage>
	);
}

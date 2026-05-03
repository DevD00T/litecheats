import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface AnimatedPageProps {
	children: ReactNode;
	className?: string;
}

export function AnimatedPage({ children, className }: AnimatedPageProps) {
	return (
		<motion.main
			className={cn(
				"relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-10 md:px-10",
				className,
			)}
			initial={{ opacity: 0, y: 22 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: -18 }}
			transition={{ duration: 0.45, ease: [0.24, 0.8, 0.24, 1] }}
		>
			{children}
		</motion.main>
	);
}

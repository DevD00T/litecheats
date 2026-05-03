import { cn } from "@/lib/utils";
import type * as React from "react";

interface SeparatorProps extends React.ComponentProps<"div"> {
	orientation?: "horizontal" | "vertical";
}

function Separator({ className, orientation = "horizontal", ...props }: SeparatorProps) {
	return (
		<div
			aria-hidden="true"
			className={cn(
				"shrink-0 bg-border/70",
				orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
				className,
			)}
			{...props}
		/>
	);
}

export { Separator };

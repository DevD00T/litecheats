import { cn } from "@/lib/utils";
import type * as React from "react";

function Card({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"rounded-2xl border border-border bg-card/70 text-card-foreground shadow-[0_20px_44px_-28px_rgba(0,0,0,0.65)] backdrop-blur-xl transition-colors",
				className,
			)}
			{...props}
		/>
	);
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("flex flex-col gap-2 p-6", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("font-heading font-semibold leading-tight tracking-tight", className)}
			{...props}
		/>
	);
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div className={cn("text-sm leading-relaxed text-muted-foreground", className)} {...props} />
	);
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("px-6 pb-6", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("flex items-center gap-3 px-6 pb-6", className)} {...props} />;
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };

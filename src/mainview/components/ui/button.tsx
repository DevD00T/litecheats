import { cn } from "@/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium tracking-tight transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98]",
	{
		variants: {
			variant: {
				default:
					"bg-primary text-primary-foreground shadow-[0_10px_30px_-12px_oklch(0.72_0.19_293/0.65)] hover:shadow-[0_14px_36px_-12px_oklch(0.72_0.19_293/0.8)] hover:brightness-110",
				destructive: "bg-destructive text-destructive-foreground shadow-sm hover:brightness-110",
				outline:
					"border border-border bg-transparent text-foreground hover:border-primary/50 hover:bg-accent/60",
				secondary: "bg-secondary text-secondary-foreground shadow-sm hover:brightness-105",
				ghost: "text-foreground hover:bg-accent/70",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-10 px-4 py-2",
				sm: "h-8 rounded-md px-3 text-xs",
				lg: "h-11 rounded-lg px-7 text-[0.95rem]",
				icon: "h-10 w-10",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {}

function Button({ className, variant, size, ...props }: ButtonProps) {
	return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };

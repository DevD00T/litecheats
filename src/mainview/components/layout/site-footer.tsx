import { Separator } from "@/components/ui/separator";
import { ZapIcon } from "@/components/ui/zap";
import { Link } from "react-router-dom";

export function SiteFooter() {
	return (
		<footer className="relative z-10 mt-auto border-t border-border/60 bg-card/50">
			<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 md:px-10">
				<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
					<div>
						<div className="inline-flex items-center gap-2">
							<ZapIcon size={18} className="text-primary" aria-hidden />
							<p className="font-heading text-lg font-semibold">Litecheats Technologies</p>
						</div>
						<p className="text-sm text-muted-foreground">
							Building modern products with elegant engineering, strong security, and measurable
							business outcomes.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
						<Link className="transition-colors hover:text-primary" to="/about">
							About
						</Link>
						<Link className="transition-colors hover:text-primary" to="/contact">
							Contact
						</Link>
						<Link className="transition-colors hover:text-primary" to="/privacy-policy">
							Privacy Policy
						</Link>
						<Link className="transition-colors hover:text-primary" to="/terms">
							Terms
						</Link>
					</div>
				</div>
				<Separator />
				<p className="text-xs text-muted-foreground">
					© {new Date().getFullYear()} Litecheats Technologies. All rights reserved.
				</p>
			</div>
		</footer>
	);
}

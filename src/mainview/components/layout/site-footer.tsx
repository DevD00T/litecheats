import { ZapIcon } from "@/components/ui/zap";
import { Link } from "react-router-dom";

const footerColumns = [
	{
		heading: "Platform",
		links: [
			{ label: "RDOS console", to: "/platform/rdos-console" },
			{ label: "MAVLink cloud", to: "/platform/mavlink-cloud" },
			{ label: "Mission planner", to: "/platform/rdos-console#mission-planner" },
			{ label: "Data archive", to: "/docs/archive/logs" },
			{ label: "Status", to: "/status" },
		],
	},
	{
		heading: "Company",
		links: [
			{ label: "About", to: "/about" },
			{ label: "FPV store", to: "/downloads" },
			{ label: "Careers", to: "/careers" },
			{ label: "Press kit", to: "/press-kit" },
			{ label: "Contact", to: "/contact" },
		],
	},
	{
		heading: "Legal",
		links: [
			{ label: "Privacy policy", to: "/privacy-policy" },
			{ label: "Terms of service", to: "/terms" },
			{ label: "DPDP compliance", to: "/dpdp-compliance" },
			{ label: "Security", to: "/security" },
			{ label: "SLA", to: "/pricing" },
		],
	},
];

export function SiteFooter() {
	return (
		<footer className="relative z-10 mt-auto border-t border-border/70 bg-card/30 backdrop-blur-xl">
			<div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-9 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:px-10">
				<div>
					<div className="inline-flex items-center gap-2.5">
						<span
							className="flex h-7 w-7 items-center justify-center rounded-lg"
							style={{
								background: "linear-gradient(145deg, var(--destructive), oklch(0.3 0.1 27))",
							}}
						>
							<ZapIcon size={15} style={{ color: "oklch(0.93 0.16 92)" }} aria-hidden />
						</span>
						<p className="font-heading text-[15px] font-bold tracking-tight">
							Litecheats Technologies
						</p>
					</div>
					<p className="mt-3 max-w-[340px] text-[12.5px] leading-relaxed text-muted-foreground">
						MAVLink cloud infrastructure for rotorcraft fleets. Built in India.
					</p>
				</div>
				{footerColumns.map((column) => (
					<div key={column.heading}>
						<div className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground/80 uppercase">
							{column.heading}
						</div>
						<div className="mt-2.5 flex flex-col gap-2">
							{column.links.map((link) => (
								<Link
									key={`${column.heading}-${link.label}`}
									to={link.to}
									className="text-[12.5px] text-muted-foreground transition-colors hover:text-secondary"
								>
									{link.label}
								</Link>
							))}
						</div>
					</div>
				))}
			</div>
			<div className="border-t border-border/60">
				<div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-3.5 text-[11px] text-muted-foreground md:px-10">
					<span>© {new Date().getFullYear()} Litecheats Technologies. All rights reserved.</span>
					<span>Data residency: ap-south-1 (Mumbai)</span>
				</div>
			</div>
		</footer>
	);
}

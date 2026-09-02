import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { docNavFlat } from "./nav";

const methodToneClasses: Record<string, string> = {
	GET: "border-success/40 bg-success/12 text-success",
	POST: "border-primary/40 bg-primary/12 text-primary",
	PUT: "border-warning/40 bg-warning/12 text-warning",
	DELETE: "border-destructive/40 bg-destructive/12 text-destructive",
};

export const endpointToneClasses: Record<string, string> = {
	success: "border-success/40 bg-success/12 text-success",
	primary: "border-primary/40 bg-primary/12 text-primary",
	warning: "border-warning/40 bg-warning/12 text-warning",
	destructive: "border-destructive/40 bg-destructive/12 text-destructive",
};

export function EndpointKicker({
	method,
	path,
	version = "RDOS API v1 · stable",
}: { method: "GET" | "POST" | "PUT" | "DELETE"; path: ReactNode; version?: string }) {
	return (
		<>
			<span
				className={cn(
					"font-code rounded-md border px-2 py-0.5 text-[10.5px] font-bold",
					methodToneClasses[method],
				)}
			>
				{method}
			</span>
			<code className="font-code text-sm text-foreground/90">{path}</code>
			<span className="font-code ml-auto text-[10.5px] text-muted-foreground/70">{version}</span>
		</>
	);
}

export function GuideKicker({
	label = "Guide",
	version = "RDOS API v1 · stable",
}: { label?: string; version?: string }) {
	return (
		<>
			<span className="font-code rounded-md border border-secondary/40 bg-secondary/12 px-2 py-0.5 text-[10.5px] font-bold tracking-[0.06em] text-secondary uppercase">
				{label}
			</span>
			<span className="font-code ml-auto text-[10.5px] text-muted-foreground/70">{version}</span>
		</>
	);
}

export function DocHeader({
	kicker,
	title,
	description,
}: { kicker?: ReactNode; title: string; description: ReactNode }) {
	return (
		<>
			{kicker ? <div className="flex flex-wrap items-center gap-2.5">{kicker}</div> : null}
			<h1 className={cn("font-heading text-[30px] font-bold tracking-tight", kicker ? "mt-4" : "")}>
				{title}
			</h1>
			<p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
				{description}
			</p>
		</>
	);
}

export function DocSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="mt-8">
			<h2 className="font-heading text-[19px] font-bold tracking-tight">{title}</h2>
			<div className="mt-3">{children}</div>
		</section>
	);
}

const codeWindowToneText: Record<string, string> = {
	secondary: "text-secondary",
	success: "text-success",
	warning: "text-warning",
	primary: "text-primary",
	muted: "text-muted-foreground",
	destructive: "text-destructive",
};

export function CodeWindow({
	label,
	tone = "secondary",
	meta,
	children,
}: {
	label: string;
	tone?: "secondary" | "success" | "warning" | "primary" | "muted" | "destructive";
	meta?: string;
	children: ReactNode;
}) {
	return (
		<div className="overflow-hidden rounded-[14px] border border-border bg-background">
			<div className="flex items-center gap-2 border-b border-border/70 px-3.5 py-2.5">
				<span className={cn("font-code text-[11px] font-semibold", codeWindowToneText[tone])}>
					{label}
				</span>
				{meta ? (
					<span className="font-code ml-auto text-[9.5px] text-muted-foreground/70">{meta}</span>
				) : null}
			</div>
			<div className="font-code space-y-0.5 overflow-auto p-3.5 text-[11px] leading-[1.8] text-foreground/85">
				{children}
			</div>
		</div>
	);
}

export function CodeGrid({ children }: { children: ReactNode }) {
	return <div className="mt-5.5 grid gap-3.5 md:grid-cols-2">{children}</div>;
}

interface ParamRow {
	n: string;
	t: string;
	d: string;
}

export function ParamsTable({ rows }: { rows: ParamRow[] }) {
	return (
		<div className="overflow-hidden rounded-[14px] border border-border bg-background">
			<div className="overflow-x-auto">
				<div className="min-w-[560px]">
					<div className="grid grid-cols-[150px_96px_1fr] items-center bg-muted/40 px-4 py-2 text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
						<span>Name</span>
						<span>Type</span>
						<span>Description</span>
					</div>
					{rows.map((param) => (
						<div
							key={param.n}
							className="grid grid-cols-[150px_96px_1fr] items-start gap-2 border-t border-border/50 px-4 py-2.5"
						>
							<span className="font-code text-[11.5px] text-secondary">{param.n}</span>
							<span className="font-code text-[11px] text-muted-foreground">{param.t}</span>
							<span className="text-[12.5px] leading-relaxed text-foreground/85">{param.d}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

export function DocTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
	const template = `repeat(${head.length}, minmax(0,1fr))`;
	return (
		<div className="overflow-hidden rounded-[14px] border border-border bg-background">
			<div className="overflow-x-auto">
				<div style={{ minWidth: `${head.length * 128}px` }}>
					<div
						className="grid items-center gap-2 bg-muted/40 px-4 py-2 text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
						style={{ gridTemplateColumns: template }}
					>
						{head.map((h) => (
							<span key={h}>{h}</span>
						))}
					</div>
					{rows.map((row, i) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: rows are a static, never-reordered table
							key={i}
							className="grid items-start gap-2 border-t border-border/50 px-4 py-2.5"
							style={{ gridTemplateColumns: template }}
						>
							{row.map((cell, j) => (
								<span
									// biome-ignore lint/suspicious/noArrayIndexKey: cells are a static, never-reordered row
									key={j}
									className="text-[12px] leading-relaxed text-foreground/85"
								>
									{cell}
								</span>
							))}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

interface EndpointRow {
	m: "GET" | "POST" | "PUT" | "DELETE";
	path: string;
	desc: string;
	tone: "success" | "primary" | "warning" | "destructive";
}

export function EndpointList({ items }: { items: EndpointRow[] }) {
	return (
		<div className="grid gap-2.5 sm:grid-cols-2">
			{items.map((endpoint) => (
				<div
					key={`${endpoint.m}-${endpoint.path}`}
					className="flex items-center gap-2.5 rounded-[11px] border border-border bg-card/55 px-3.5 py-2.5"
				>
					<span
						className={cn(
							"font-code w-[46px] flex-none rounded-[5px] border px-1.5 py-0.5 text-center text-[9.5px] font-bold",
							endpointToneClasses[endpoint.tone],
						)}
					>
						{endpoint.m}
					</span>
					<code className="font-code overflow-hidden text-[11.5px] text-ellipsis whitespace-nowrap text-foreground/85">
						{endpoint.path}
					</code>
					<span className="ml-auto flex-none text-[11px] text-muted-foreground">
						{endpoint.desc}
					</span>
				</div>
			))}
		</div>
	);
}

const calloutToneClasses: Record<
	string,
	{ border: string; bg: string; text: string; sub: string }
> = {
	warning: {
		border: "border-warning/30",
		bg: "bg-warning/[0.07]",
		text: "text-warning",
		sub: "text-warning/85",
	},
	primary: {
		border: "border-primary/30",
		bg: "bg-primary/[0.07]",
		text: "text-primary",
		sub: "text-primary/85",
	},
	success: {
		border: "border-success/30",
		bg: "bg-success/[0.07]",
		text: "text-success",
		sub: "text-success/85",
	},
	destructive: {
		border: "border-destructive/30",
		bg: "bg-destructive/[0.07]",
		text: "text-destructive",
		sub: "text-destructive/85",
	},
};

export function Callout({
	tone = "warning",
	title,
	children,
}: {
	tone?: "warning" | "primary" | "success" | "destructive";
	title: string;
	children: ReactNode;
}) {
	const t = calloutToneClasses[tone];
	return (
		<div className={cn("rounded-[14px] border p-4.5", t.border, t.bg)}>
			<div className={cn("flex items-center gap-2 text-sm font-bold", t.text)}>
				<svg
					width="15"
					height="15"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.2"
					strokeLinecap="round"
					aria-hidden="true"
				>
					<circle cx="12" cy="12" r="9" />
					<path d="M12 8v5M12 16h.01" />
				</svg>
				{title}
			</div>
			<div className={cn("mt-2 max-w-2xl text-[12.5px] leading-relaxed", t.sub)}>{children}</div>
		</div>
	);
}

interface StepCard {
	n: string;
	title: string;
	body: ReactNode;
	meta?: string;
}

export function StepGrid({ steps }: { steps: StepCard[] }) {
	return (
		<div className="grid gap-3.5 sm:grid-cols-2">
			{steps.map((step) => (
				<div key={step.n} className="rounded-[14px] border border-border bg-card/55 p-4.5">
					<div className="font-code text-[11px] text-primary">{step.n}</div>
					<div className="mt-2 font-heading text-[15px] font-bold tracking-tight">{step.title}</div>
					<div className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
						{step.body}
					</div>
					{step.meta ? (
						<div className="font-code mt-3 text-[10px] text-secondary">{step.meta}</div>
					) : null}
				</div>
			))}
		</div>
	);
}

export function DocPager() {
	const { pathname } = useLocation();
	const current = pathname.replace(/^\/docs\/?/, "");
	const idx = docNavFlat.findIndex((item) => item.to === current);
	const prev = idx > 0 ? docNavFlat[idx - 1] : null;
	const next = idx >= 0 && idx < docNavFlat.length - 1 ? docNavFlat[idx + 1] : null;

	if (!prev && !next) return null;

	return (
		<div className="mt-10 flex items-center justify-between gap-3 border-t border-border/60 pt-5">
			{prev ? (
				<Link
					to={`/docs/${prev.to}`}
					className="group flex flex-col items-start rounded-[12px] border border-border px-4 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
				>
					<span className="text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
						Previous
					</span>
					<span className="text-[13px] font-medium text-foreground">{prev.label}</span>
				</Link>
			) : (
				<span />
			)}
			{next ? (
				<Link
					to={`/docs/${next.to}`}
					className="group flex flex-col items-end rounded-[12px] border border-border px-4 py-2.5 text-right transition-colors hover:border-primary/40 hover:bg-accent/40"
				>
					<span className="text-[10px] tracking-[0.1em] text-muted-foreground uppercase">Next</span>
					<span className="text-[13px] font-medium text-foreground">{next.label}</span>
				</Link>
			) : (
				<span />
			)}
		</div>
	);
}

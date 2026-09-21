import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { gsap } from "gsap";
import { useCallback, useEffect, useRef, useState } from "react";

const heroTelemetry = [
	{ k: "Alt AGL", v: "118 m", tone: "text-foreground" },
	{ k: "Speed", v: "14.2", tone: "text-foreground" },
	{ k: "GPS", v: "RTK", tone: "text-success" },
	{ k: "Batt", v: "68%", tone: "text-success" },
];

type LinkStatus = "idle" | "running" | "recorded";

/** The corners of the flight route, in the 470 x 216 map's coordinate space. */
const ROUTE_POINTS: readonly (readonly [number, number])[] = [
	[56, 182],
	[56, 46],
	[152, 46],
	[152, 182],
	[248, 182],
	[248, 46],
	[344, 46],
	[344, 182],
];

/** Indices into ROUTE_POINTS that are drawn as numbered waypoints. */
const WAYPOINT_POINT_INDEX = [0, 1, 2, 3, 4, 6, 7] as const;

const ROUTE_D = `M${ROUTE_POINTS.map(([x, y]) => `${x} ${y}`).join(" L")}`;

/** Distance along the route at each corner. The route is axis-aligned, so this is exact. */
const CUMULATIVE: number[] = [0];
for (let index = 1; index < ROUTE_POINTS.length; index++) {
	const [px, py] = ROUTE_POINTS[index - 1] as readonly [number, number];
	const [x, y] = ROUTE_POINTS[index] as readonly [number, number];
	CUMULATIVE.push((CUMULATIVE[index - 1] as number) + Math.abs(x - px) + Math.abs(y - py));
}

const TOTAL_LENGTH = CUMULATIVE[CUMULATIVE.length - 1] as number;
/** Where the vehicle rests before the route is completed: 72 units up the third climb. */
const START_LENGTH = (CUMULATIVE[4] as number) + 72;
const WAYPOINT_LENGTHS = WAYPOINT_POINT_INDEX.map((index) => CUMULATIVE[index] as number);
/** Route units per second, averaged over the whole run: it eases in at the start and out at the end. */
const RUN_SPEED = 175;
/** How far ahead the arrow looks to pick its heading, so it starts turning just before a corner. */
const LOOKAHEAD = 16;
const TURN_SMOOTHING = 0.35;
const START_LAT = 12.90411;
const START_LON = 77.61344;

const waypointFor = (length: number) => WAYPOINT_LENGTHS.filter((at) => at <= length + 0.01).length;

const shortestAngle = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

export function HeroLinkPanel() {
	const reduceMotion = useReducedMotion();
	const [status, setStatus] = useState<LinkStatus>("idle");
	const [waypoint, setWaypoint] = useState(() => waypointFor(START_LENGTH));

	const routeRef = useRef<SVGPathElement>(null);
	const trailRef = useRef<SVGPathElement>(null);
	const arrowRef = useRef<SVGGElement>(null);
	const haloRef = useRef<SVGCircleElement>(null);
	const latRef = useRef<SVGTextElement>(null);
	const lonRef = useRef<SVGTextElement>(null);

	// The tweens animate this plain object; everything visible is derived from it.
	const vehicle = useRef({ length: START_LENGTH, heading: 0, scale: 1 });
	const waypointRef = useRef(waypointFor(START_LENGTH));
	const timelineRef = useRef<gsap.core.Timeline | null>(null);
	const pulseRef = useRef<gsap.core.Tween | null>(null);

	useEffect(
		() => () => {
			timelineRef.current?.kill();
			pulseRef.current?.kill();
		},
		[],
	);

	/** Puts the arrow, halo, trail and coordinates at `length` along the route. */
	const paint = useCallback((length: number, smoothing: number, trackWaypoints = true) => {
		const route = routeRef.current;
		const trail = trailRef.current;
		const arrow = arrowRef.current;
		const halo = haloRef.current;
		if (!route || !trail || !arrow || !halo) return;

		const at = Math.min(Math.max(length, 0), TOTAL_LENGTH);
		const point = route.getPointAtLength(at);
		const ahead = route.getPointAtLength(Math.min(at + LOOKAHEAD, TOTAL_LENGTH));
		const behind = route.getPointAtLength(Math.max(at - 0.75, 0));

		// The arrow artwork points up, so its heading is the direction of travel + 90 degrees.
		// Easing toward that heading, rather than snapping, is what makes it turn at a corner.
		const target = (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI + 90;
		const state = vehicle.current;
		state.heading += shortestAngle(target - state.heading) * smoothing;

		arrow.setAttribute(
			"transform",
			`translate(${point.x} ${point.y}) rotate(${state.heading}) scale(${state.scale})`,
		);
		halo.setAttribute("cx", String(point.x));
		halo.setAttribute("cy", String(point.y));
		trail.style.strokeDashoffset = String(TOTAL_LENGTH - at);

		if (latRef.current) {
			latRef.current.textContent = `${(START_LAT + (110 - point.y) * 0.00009).toFixed(5)} N`;
		}
		if (lonRef.current) {
			lonRef.current.textContent = `${(START_LON + (point.x - 248) * 0.00006).toFixed(5)} E`;
		}

		// While the trail is being reeled back the waypoint readout holds still, rather than flickering.
		const reached = waypointFor(at);
		if (trackWaypoints && reached !== waypointRef.current) {
			waypointRef.current = reached;
			setWaypoint(reached);
		}
	}, []);

	const finish = useCallback(() => {
		pulseRef.current?.kill();
		if (haloRef.current) gsap.to(haloRef.current, { attr: { r: 16 }, duration: 0.3 });
		setStatus("recorded");
	}, []);

	const run = () => {
		if (status === "running") return;
		timelineRef.current?.kill();
		pulseRef.current?.kill();

		const state = vehicle.current;
		const arrowAndHalo = [arrowRef.current, haloRef.current];

		if (reduceMotion) {
			state.length = TOTAL_LENGTH;
			paint(TOTAL_LENGTH, 1);
			finish();
			return;
		}

		setStatus("running");
		const timeline = gsap.timeline({ onComplete: finish });
		timelineRef.current = timeline;

		// Every run starts at the first waypoint. From anywhere else, the arrow is hidden, the
		// trail is reeled back in, and the arrow pops in at the start.
		if (state.length > 0.5) {
			timeline
				.to(arrowAndHalo, { opacity: 0, duration: 0.16 })
				.to(state, {
					length: 0,
					duration: Math.min(0.6, Math.max(0.35, state.length / 1400)),
					ease: "power2.inOut",
					onUpdate: () => paint(state.length, 1, false),
				})
				.add(() => {
					state.heading = 0;
					state.scale = 0.35;
					paint(0, 1, false);
					waypointRef.current = 1;
					setWaypoint(1);
				})
				.to(arrowAndHalo, { opacity: 1, duration: 0.25 })
				.to(
					state,
					{
						scale: 1,
						duration: 0.4,
						ease: "back.out(2.6)",
						onUpdate: () => paint(state.length, 1, false),
					},
					"<",
				);
		}

		timeline
			.add(() => {
				if (haloRef.current) {
					pulseRef.current = gsap.to(haloRef.current, {
						attr: { r: 24 },
						duration: 0.45,
						ease: "sine.inOut",
						yoyo: true,
						repeat: -1,
					});
				}
			})
			// One continuous pass from the first waypoint to the last, easing in and out.
			.to(
				state,
				{
					length: TOTAL_LENGTH,
					duration: TOTAL_LENGTH / RUN_SPEED,
					ease: "sine.inOut",
					onUpdate: () => paint(state.length, TURN_SMOOTHING),
				},
				"+=0.1",
			);
	};

	const recorded = status === "recorded";
	const label = recorded
		? "Route recorded. Press to replay the flight."
		: status === "running"
			? "Recording the route"
			: "Press to fly the whole route, from the first waypoint to the last, and record it";
	const logKey = recorded ? "recorded" : `waypoint-${waypoint}`;

	// A ring pings from each waypoint the arrow reaches. The last one has its own celebration.
	const pingIndex = WAYPOINT_POINT_INDEX[waypoint - 1];
	const pingPoint =
		status === "running" && waypoint < WAYPOINT_POINT_INDEX.length && pingIndex !== undefined
			? ROUTE_POINTS[pingIndex]
			: undefined;

	return (
		<div className="hero-panel glass-panel overflow-hidden rounded-2xl shadow-[0_40px_90px_-50px_oklch(0.55_0.2_293/0.7)]">
			<div className="flex items-center gap-2 border-b border-border/70 px-3.5 py-2.5">
				<span className="relative flex h-2 w-2">
					<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
					<span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
				</span>
				<span className="font-code text-[10.5px] tracking-[0.08em] text-muted-foreground">
					RDOS · LIVE LINK · RCX-114
				</span>
				<span className="font-code ml-auto text-[10px] text-muted-foreground/70">18 ms</span>
			</div>

			<div className="relative h-[216px] bg-background">
				<svg viewBox="0 0 470 216" className="absolute inset-0 h-full w-full" aria-hidden="true">
					<defs>
						<pattern id="hero-grid" width="33" height="33" patternUnits="userSpaceOnUse">
							<path d="M33 0H0v33" fill="none" stroke="oklch(1 0 0 / 6%)" strokeWidth="1" />
						</pattern>
					</defs>
					<rect width="470" height="216" fill="url(#hero-grid)" />
					<path
						d="M0 158 C70 138, 128 152, 186 128 S 320 96, 386 112 S 452 92, 470 82 L470 216 L0 216 Z"
						fill="oklch(0.34 0.05 200 / 25%)"
						stroke="oklch(0.5 0.06 200 / 55%)"
						strokeWidth="1.1"
					/>

					{/* The full route, faint. The arrow is measured against this path. */}
					<path
						ref={routeRef}
						d={ROUTE_D}
						fill="none"
						stroke="oklch(0.72 0.19 293 / 28%)"
						strokeWidth="8"
						strokeLinejoin="round"
						strokeLinecap="round"
					/>

					{/* The flown part of the route. Its dash offset is what the animation drives. */}
					<path
						ref={trailRef}
						d={ROUTE_D}
						fill="none"
						stroke="oklch(0.8 0.15 192)"
						strokeWidth="1.8"
						strokeLinejoin="round"
						strokeDasharray={TOTAL_LENGTH}
						strokeDashoffset={TOTAL_LENGTH - START_LENGTH}
					/>

					{WAYPOINT_POINT_INDEX.map((pointIndex, index) => {
						const [cx, cy] = ROUTE_POINTS[pointIndex] as readonly [number, number];
						const visited = waypoint >= index + 1;
						const isLast = index === WAYPOINT_POINT_INDEX.length - 1;
						return (
							<g key={`${cx}-${cy}`}>
								<circle
									cx={cx}
									cy={cy}
									r="3.4"
									fill="oklch(0.19 0.02 285)"
									stroke="oklch(0.72 0.19 293)"
									strokeWidth="1.4"
								/>
								<motion.circle
									cx={cx}
									cy={cy}
									className={isLast && recorded ? "fill-success" : "fill-secondary"}
									initial={false}
									animate={{ r: visited ? (isLast && recorded ? 2.6 : 1.6) : 0 }}
									transition={{ type: "spring", stiffness: 500, damping: 18 }}
								/>
							</g>
						);
					})}

					{pingPoint && (
						<motion.circle
							key={`ping-${waypoint}`}
							cx={pingPoint[0]}
							cy={pingPoint[1]}
							className="fill-none stroke-secondary"
							strokeWidth="1.2"
							initial={{ r: 3.4, opacity: 0.85 }}
							animate={{ r: 13, opacity: 0 }}
							transition={{ duration: 0.6, ease: "easeOut" }}
						/>
					)}

					{/* Rings that spread from the final waypoint when the route is recorded. */}
					{recorded &&
						[0, 0.28].map((delay) => (
							<motion.circle
								key={delay}
								cx={344}
								cy={182}
								className="fill-none stroke-success"
								strokeWidth="1.4"
								initial={{ r: 3.4, opacity: 0.9 }}
								animate={{ r: 20, opacity: 0 }}
								transition={{ duration: 1, delay, ease: "easeOut" }}
							/>
						))}

					<circle ref={haloRef} cx="248" cy="110" r="16" fill="oklch(0.8 0.15 192 / 14%)" />
					<g ref={arrowRef} transform="translate(248 110) rotate(0)">
						<path
							d="M0 -9 L7 8 L0 3.5 L-7 8 Z"
							fill="oklch(0.8 0.15 192)"
							stroke="oklch(0.128 0.016 250)"
							strokeWidth="1.1"
						/>
					</g>

					<rect
						x="12"
						y="12"
						width="112"
						height="34"
						rx="5"
						fill="oklch(0.145 0.017 285 / 88%)"
						stroke="oklch(1 0 0 / 10%)"
					/>
					<text
						ref={latRef}
						x="20"
						y="26"
						fontFamily="JetBrains Mono, monospace"
						fontSize="8"
						fill="oklch(0.62 0.015 286)"
					>
						12.90411 N
					</text>
					<text
						ref={lonRef}
						x="20"
						y="38"
						fontFamily="JetBrains Mono, monospace"
						fontSize="8"
						fill="oklch(0.62 0.015 286)"
					>
						77.61344 E
					</text>
				</svg>

				<button
					type="button"
					onClick={run}
					aria-label={label}
					aria-disabled={status === "running"}
					className={cn(
						"absolute inset-0 z-10 block w-full cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-secondary/70",
						status === "running" && "cursor-progress",
					)}
				/>

				<div className="pointer-events-none absolute top-2.5 right-2.5 z-20">
					<AnimatePresence mode="wait" initial={false}>
						{status === "running" && (
							<motion.div
								key="recording"
								initial={{ opacity: 0, x: 10 }}
								animate={{ opacity: 1, x: 0 }}
								exit={{ opacity: 0, x: 10 }}
								transition={{ duration: 0.18 }}
								className="font-code flex items-center gap-1.5 rounded-md border border-destructive/40 bg-background/80 px-2 py-1 text-[9.5px] font-semibold tracking-[0.12em] text-destructive backdrop-blur"
							>
								<motion.span
									className="h-1.5 w-1.5 rounded-full bg-destructive"
									animate={{ opacity: [1, 0.2, 1] }}
									transition={{ duration: 0.9, repeat: Number.POSITIVE_INFINITY }}
								/>
								REC
							</motion.div>
						)}
						{recorded && (
							<motion.div
								key="recorded"
								initial={{ opacity: 0, scale: 0.7, y: -6 }}
								animate={{ opacity: 1, scale: 1, y: 0 }}
								exit={{ opacity: 0, scale: 0.9 }}
								transition={{ type: "spring", stiffness: 420, damping: 24 }}
								className="font-code flex items-center gap-1.5 rounded-md border border-success/45 bg-success/12 px-2 py-1 text-[9.5px] font-semibold tracking-[0.12em] text-success backdrop-blur"
							>
								<svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
									<motion.path
										d="M2.4 6.5 L5 9 L9.7 3.3"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.7"
										strokeLinecap="round"
										strokeLinejoin="round"
										initial={{ pathLength: 0 }}
										animate={{ pathLength: 1 }}
										transition={{ delay: 0.12, duration: 0.32, ease: "easeOut" }}
									/>
								</svg>
								RECORDED
							</motion.div>
						)}
					</AnimatePresence>
				</div>

				<div className="pointer-events-none absolute right-2.5 bottom-1 z-20">
					<AnimatePresence initial={false}>
						{status !== "running" && (
							<motion.div
								key={status}
								initial={{ opacity: 0, y: 6 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, y: 4 }}
								transition={{ duration: 0.2 }}
								className="font-code flex items-center gap-1.5 rounded-md border border-border/70 bg-background/80 px-2 py-1 text-[9px] tracking-[0.08em] text-muted-foreground backdrop-blur"
							>
								<span className="relative flex h-1.5 w-1.5">
									<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-secondary opacity-75" />
									<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-secondary" />
								</span>
								{recorded ? "Press to replay" : "Press to fly the route"}
							</motion.div>
						)}
					</AnimatePresence>
				</div>

				<span className="sr-only" aria-live="polite">
					{recorded ? "Route recorded." : status === "running" ? "Recording the route." : ""}
				</span>
			</div>

			<div className="grid grid-cols-2 border-t border-border/70 sm:grid-cols-4">
				{heroTelemetry.map((t) => (
					<div key={t.k} className="border-r border-border/50 px-3 py-2.5 last:border-r-0">
						<div className="text-[8.5px] tracking-[0.12em] text-muted-foreground uppercase">
							{t.k}
						</div>
						<div className={cn("font-code mt-1 text-[15px] font-semibold", t.tone)}>{t.v}</div>
					</div>
				))}
			</div>

			<div className="font-code space-y-0.5 border-t border-border/70 px-3.5 py-2.5 text-[10px] leading-[1.75] text-muted-foreground">
				<div>
					<span className="text-muted-foreground/60">33</span>{" "}
					<span className="text-secondary">GLOBAL_POSITION_INT</span> 10 Hz
				</div>
				<div>
					<span className="text-muted-foreground/60">30</span>{" "}
					<span className="text-secondary">ATTITUDE</span> 20 Hz
				</div>
				{/* Fixed height, so swapping the message never moves the panel. */}
				<div className="relative h-[17.5px] overflow-hidden">
					<AnimatePresence mode="wait" initial={false}>
						<motion.div
							key={logKey}
							initial={{ opacity: 0, y: 9 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -9 }}
							transition={{ duration: 0.18 }}
							className="absolute inset-0 whitespace-nowrap"
						>
							<span className="text-muted-foreground/60">253</span>{" "}
							<span className="text-success">STATUSTEXT</span>{" "}
							{recorded
								? `Route recorded · ${WAYPOINT_LENGTHS.length} waypoints archived`
								: `Reached waypoint #${waypoint}`}
						</motion.div>
					</AnimatePresence>
				</div>
			</div>
		</div>
	);
}

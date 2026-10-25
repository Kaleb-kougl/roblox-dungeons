/**
 * Floor markings as line segments, in sim world units: telegraph previews (enemy aim lines and shockwaves, the Act I
 * boss's fans / rings / spiral / slam, the arena seal, the roar) and weapon arcs. Pure geometry: each builder writes
 * segments into a SegmentSink; the client's dash layers turn segments into fixed-size dash Parts (`dashLayout`).
 *
 * Ported from project-kaleb-vale @ 42897e2: src/boss/BossView.tsx (LineBatch.ray / arc / rect, fanLanes, ringArcs,
 * shockArc, drawTelegraph, drawSlam), src/bullets/ActorsView.tsx (ActorFx aim line and shockwave), and
 * src/bullets/WeaponView.tsx (fans). Presentation only: trig is fine here, nothing feeds back into the sim.
 *
 * Headings follow the sim's patterns.ts: heading h <-> unit direction (sin h, cos h); h = 0 is +Z.
 */
import { AiState, SIM_HZ, type ActorState } from "shared/sim";
import { MARKING_VIEW, TELEGRAPH_VIEW } from "./config";

const TAU = 2 * math.pi;

export interface SegmentSink {
	seg(x0: number, z0: number, x1: number, z1: number): void;
}

/** Heading of a direction vector: direction (sin h, cos h). */
export function heading(x: number, z: number): number {
	return math.atan2(x, z);
}

/** Ray from (x, z) along heading h, from distance r0 to r1. */
export function ray(sink: SegmentSink, x: number, z: number, h: number, r0: number, r1: number): void {
	const s = math.sin(h);
	const c = math.cos(h);
	sink.seg(x + s * r0, z + c * r0, x + s * r1, z + c * r1);
}

/** Arc around (x, z) at `radius`, headings h0..h1, cut into straight pieces of at most MARKING_VIEW.arcStepTiles. */
export function arc(sink: SegmentSink, x: number, z: number, radius: number, h0: number, h1: number): void {
	if (!(radius > 0)) {
		return;
	}
	const steps = math.max(2, math.ceil((math.abs(h1 - h0) * radius) / MARKING_VIEW.arcStepTiles));
	let px = x + math.sin(h0) * radius;
	let pz = z + math.cos(h0) * radius;
	for (let i = 1; i <= steps; i++) {
		const h = h0 + ((h1 - h0) * i) / steps;
		const nx = x + math.sin(h) * radius;
		const nz = z + math.cos(h) * radius;
		sink.seg(px, pz, nx, nz);
		px = nx;
		pz = nz;
	}
}

export function rect(sink: SegmentSink, minX: number, minZ: number, maxX: number, maxZ: number): void {
	sink.seg(minX, minZ, maxX, minZ);
	sink.seg(maxX, minZ, maxX, maxZ);
	sink.seg(maxX, maxZ, minX, maxZ);
	sink.seg(minX, maxZ, minX, minZ);
}

/** One ray per bullet lane of a gen.arc of `count` over `spread` around heading h, from r0 to `length`. */
export function fanLanes(
	sink: SegmentSink,
	x: number,
	z: number,
	h: number,
	count: number,
	spread: number,
	r0: number,
	length: number,
): void {
	if (count <= 1) {
		ray(sink, x, z, h, r0, length);
		return;
	}
	for (let i = 0; i < count; i++) {
		ray(sink, x, z, h + (i / (count - 1) - 0.5) * spread, r0, length);
	}
}

/** A 2-gap ring preview: arcs centred on h and h + PI, each `spread` wide; optional ticks at the gap edges. */
export function ringArcs(
	sink: SegmentSink,
	x: number,
	z: number,
	h: number,
	spread: number,
	radius: number,
	ticks: boolean,
): void {
	for (const c of [h, h + math.pi]) {
		arc(sink, x, z, radius, c - spread / 2, c + spread / 2);
		if (ticks) {
			const t = TELEGRAPH_VIEW.tickHalf;
			ray(sink, x, z, c - spread / 2, radius - t, radius + t);
			ray(sink, x, z, c + spread / 2, radius - t, radius + t);
		}
	}
}

/** A 1-gap shockwave preview: the arc centred on h, `spread` wide, gap edges ticked. */
export function shockArc(sink: SegmentSink, x: number, z: number, h: number, spread: number, radius: number): void {
	const t = TELEGRAPH_VIEW.tickHalf;
	arc(sink, x, z, radius, h - spread / 2, h + spread / 2);
	ray(sink, x, z, h - spread / 2, radius - t, radius + t);
	ray(sink, x, z, h + spread / 2, radius - t, radius + t);
}

/**
 * A weapon fan (circle sector) at (x, z) toward the unit direction (dirX, dirZ): the two edges (unless it is a full
 * circle), the outer arc and inner arcs at `fills` fractions of the radius. `halfCos` is the cosine of the half-angle,
 * as the sim stores it (sweepArc).
 */
export function sector(
	sink: SegmentSink,
	x: number,
	z: number,
	dirX: number,
	dirZ: number,
	radius: number,
	halfCos: number,
	fills: ReadonlyArray<number>,
): void {
	const half = math.acos(math.clamp(halfCos, -1, 1));
	const h = heading(dirX, dirZ);
	if (half < math.pi) {
		ray(sink, x, z, h - half, 0, radius);
		ray(sink, x, z, h + half, 0, radius);
	}
	arc(sink, x, z, radius, h - half, h + half);
	for (const f of fills) {
		arc(sink, x, z, radius * f, h - half, h + half);
	}
}

// ---------------------------------------------------------------------------------------------
// Dashes

/** Where the dashes of a dashed line go: `count` dashes, the first centred at `first`, then every `step`. */
export interface DashLayout {
	readonly count: number;
	readonly first: number;
	readonly step: number;
}

/**
 * Lays dashes of `dash` length with `gap` between them along a line of `length`, centred on it. A line shorter than
 * one dash still gets one dash (centred), so short markings never vanish. All three in the same unit.
 */
export function dashLayout(length: number, dash: number, gap: number): DashLayout {
	const step = dash + gap;
	if (!(length > 0) || !(step > 0)) {
		return { count: 0, first: 0, step };
	}
	const count = math.max(1, math.floor((length + gap) / step));
	const total = count * dash + (count - 1) * gap;
	return { count, first: (length - total) / 2 + dash / 2, step };
}

// ---------------------------------------------------------------------------------------------
// Enemy attack warnings (archetype data.fx; web ActorFx)

/**
 * Presentation hints an archetype may carry as `data.fx` (mirror of the sim's ActorFxHints, read structurally so this
 * module does not depend on the archetype files). Indices are ActorState.v slots.
 */
export interface ActorFxHintsView {
	readonly aimLine?: {
		readonly dirX: number;
		readonly dirZ: number;
		readonly lenSlot?: number;
		readonly length?: number;
		readonly boldTicks: number;
	};
	readonly shockwave?: {
		readonly state: number;
		readonly startTicks: number;
		readonly showTicks: number;
		readonly radius: number;
		readonly speed: number;
		readonly gapX: number;
		readonly gapZ: number;
		readonly gapHalfAngle: number;
	};
}

/**
 * The aim line (while winding up) and the expanding shockwave of one actor at its drawn position (x, z). Bold / young
 * markings go to `bright`, the rest to `dim`. Returns true when it drew anything.
 */
export function actorFxMarkings(
	bright: SegmentSink,
	dim: SegmentSink,
	a: Readonly<ActorState>,
	fx: ActorFxHintsView,
	x: number,
	z: number,
	alpha: number,
): boolean {
	let drew = false;
	const aim = fx.aimLine;
	if (aim !== undefined && a.aiState === AiState.TELEGRAPH) {
		const dx = a.v[aim.dirX];
		const dz = a.v[aim.dirZ];
		const len = aim.lenSlot !== undefined ? a.v[aim.lenSlot] : aim.length ?? 1;
		const sink = a.aiTicks < aim.boldTicks ? bright : dim;
		sink.seg(x, z, x + dx * len, z + dz * len);
		drew = true;
	}
	const wave = fx.shockwave;
	if (wave !== undefined && a.aiState === wave.state) {
		const age = wave.startTicks - a.aiTicks + alpha;
		if (age >= 0 && age < wave.showTicks) {
			const radius = wave.radius + (wave.speed * age) / SIM_HZ;
			const hg = heading(a.v[wave.gapX], a.v[wave.gapZ]);
			const sink = age < wave.showTicks / 2 ? bright : dim;
			arc(sink, x, z, radius, hg + wave.gapHalfAngle, hg + TAU - wave.gapHalfAngle);
			drew = true;
		}
	}
	return drew;
}

// ---------------------------------------------------------------------------------------------
// The Act I boss (web BossView drawTelegraph / drawSlam)

export interface BurstShape {
	readonly count: number;
	readonly spread: number;
}

/**
 * What the boss previews need from the boss.act1 archetype module (its exported constants), passed in so this stays
 * independent of the archetype files. The client resolves it from shared/sim (client/controllers/render).
 */
export interface BossAct1Consts {
	readonly attack: {
		readonly FAN: number;
		readonly RING: number;
		readonly DOUBLE_RING: number;
		readonly SPIRAL: number;
		readonly SLAM: number;
		readonly FAST_FAN: number;
	};
	readonly state: { readonly ACTIVE: number; readonly TRANSITION: number };
	readonly telegraphTicks: ReadonlyArray<number>;
	readonly fan: BurstShape;
	readonly fastFan: BurstShape;
	readonly ringArc: BurstShape;
	readonly doubleRingArc: BurstShape;
	readonly spiralArms: BurstShape;
	readonly shockwave: BurstShape;
	readonly shock2Turns: number;
	/** One TURN step and half a TURN, radians (render only: the sim turns by exact (cos, sin) pairs). */
	readonly turnAngle: number;
	readonly halfTurnAngle: number;
	/** ActorState.v slots. */
	readonly slots: {
		readonly dirX: number;
		readonly dirZ: number;
		readonly auxX: number;
		readonly auxZ: number;
		readonly sign: number;
		readonly mark: number;
	};
}

/** The slam preview: the body-wide charge lane to the target, the impact circle and its shockwave arc(s). */
export function slamMarkings(main: SegmentSink, second: SegmentSink, a: Readonly<ActorState>, c: BossAct1Consts): void {
	const v = a.v;
	const tx = v[c.slots.auxX];
	const tz = v[c.slots.auxZ];
	const dx = v[c.slots.dirX];
	const dz = v[c.slots.dirZ];
	const r = a.radius;
	main.seg(a.x - dz * r, a.z + dx * r, tx - dz * r, tz + dx * r);
	main.seg(a.x + dz * r, a.z - dx * r, tx + dz * r, tz - dx * r);
	arc(main, tx, tz, r, 0, TAU);
	const h = heading(dx, dz);
	shockArc(main, tx, tz, h, c.shockwave.spread, r + TELEGRAPH_VIEW.slamOffset);
	if (v[c.slots.sign] !== 1) {
		shockArc(
			second,
			tx,
			tz,
			h + c.shock2Turns * c.turnAngle,
			c.shockwave.spread,
			r + TELEGRAPH_VIEW.slamOffsetSecond,
		);
	}
}

/**
 * The wind-up preview of the boss's current attack (aiState === TELEGRAPH): exactly where its bullets will go. The
 * primary marking goes to `bright` once the wind-up is past TELEGRAPH_VIEW.brightFrom (and blinks between the layers
 * in the last blinkTicks); secondary lanes / rings always go to `dim`.
 */
export function bossTelegraphMarkings(
	bright: SegmentSink,
	dim: SegmentSink,
	a: Readonly<ActorState>,
	c: BossAct1Consts,
	tick: number,
): void {
	const total = c.telegraphTicks[a.attack] ?? 0;
	const left = a.aiTicks;
	const progress = total > 0 ? 1 - left / total : 1;
	const blinking = left <= TELEGRAPH_VIEW.blinkTicks;
	const blinkOn = math.floor(tick / TELEGRAPH_VIEW.blinkPeriodTicks) % 2 === 0;
	const main = blinking ? (blinkOn ? bright : dim) : progress >= TELEGRAPH_VIEW.brightFrom ? bright : dim;
	const v = a.v;
	const s = c.slots;
	const h = heading(v[s.dirX], v[s.dirZ]);
	const lane = TELEGRAPH_VIEW.laneLength;
	switch (a.attack) {
		case c.attack.FAN:
			fanLanes(main, a.x, a.z, h, c.fan.count, c.fan.spread, a.radius, lane);
			break;
		case c.attack.FAST_FAN:
			fanLanes(main, a.x, a.z, h, c.fastFan.count, c.fastFan.spread, a.radius, lane);
			fanLanes(dim, a.x, a.z, h + v[s.sign] * c.halfTurnAngle, c.fastFan.count, c.fastFan.spread, a.radius, lane);
			break;
		case c.attack.RING:
			ringArcs(main, a.x, a.z, h, c.ringArc.spread, a.radius + TELEGRAPH_VIEW.ringOffset, true);
			ringArcs(main, a.x, a.z, h, c.ringArc.spread, a.radius + TELEGRAPH_VIEW.ringOffsetOuter, false);
			break;
		case c.attack.DOUBLE_RING:
			ringArcs(main, a.x, a.z, h, c.doubleRingArc.spread, a.radius + TELEGRAPH_VIEW.ringOffset, true);
			ringArcs(
				dim,
				a.x,
				a.z,
				heading(v[s.auxX], v[s.auxZ]),
				c.doubleRingArc.spread,
				a.radius + TELEGRAPH_VIEW.doubleRingOffsetOuter,
				true,
			);
			break;
		case c.attack.SPIRAL: {
			const h0 = heading(v[s.auxX], v[s.auxZ]);
			const sign = v[s.sign];
			const arm = TELEGRAPH_VIEW.armLength;
			const turn = TELEGRAPH_VIEW.spiralHeadTurn;
			for (let i = 0; i < c.spiralArms.count; i++) {
				const ha = h0 + (i * TAU) / c.spiralArms.count;
				ray(main, a.x, a.z, ha, a.radius, arm);
				arc(main, a.x, a.z, arm, ha, ha + sign * turn);
				const tipH = ha + sign * turn;
				const tx = a.x + math.sin(tipH) * arm;
				const tz = a.z + math.cos(tipH) * arm;
				ray(main, tx, tz, tipH + sign * TELEGRAPH_VIEW.spiralBarbAngle, 0, TELEGRAPH_VIEW.spiralBarbLength);
			}
			break;
		}
		case c.attack.SLAM:
			slamMarkings(main, dim, a, c);
			break;
	}
}

/** The roar (intro / phase transition): two expanding rings around the boss. `t` in [0, 1] is the roar's progress. */
export function roarMarkings(sink: SegmentSink, x: number, z: number, t: number): void {
	const radius = TELEGRAPH_VIEW.roarStart + math.clamp(t, 0, 1) * TELEGRAPH_VIEW.roarRadius;
	arc(sink, x, z, radius, 0, TAU);
	arc(sink, x, z, radius * TELEGRAPH_VIEW.roarInner, 0, TAU);
}

/** A plain ring around an actor that winds up an attack with no preview of its own. */
export function genericWindupMarkings(sink: SegmentSink, x: number, z: number, radius: number): void {
	arc(sink, x, z, radius + TELEGRAPH_VIEW.genericRingOffset, 0, TAU);
}

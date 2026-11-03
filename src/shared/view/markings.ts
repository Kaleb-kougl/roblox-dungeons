/**
 * Floor markings as line segments, in sim world units: telegraph previews (enemy aim lines and shockwaves, the Act I
 * boss's fans / rings / spiral / slam, the Demon Lord's cleaves / hellfire ring / charge / summon spots, the arena
 * seal, the roar) and weapon arcs. Pure geometry: each builder writes
 * segments into a SegmentSink; the client's dash layers turn segments into fixed-size dash Parts (`dashLayout`).
 *
 * Ported from project-kaleb-vale @ 42897e2: src/boss/BossView.tsx (LineBatch.ray / arc / rect, fanLanes, ringArcs,
 * shockArc, drawTelegraph, drawSlam), src/bullets/ActorsView.tsx (ActorFx aim line and shockwave), and
 * src/bullets/WeaponView.tsx (fans). The Demon Lord's previews are the Roblox port's (docs/BOSS_DEMONLORD.md D6, no web
 * source). Presentation only: trig is fine here, nothing feeds back into the sim.
 *
 * Headings follow the sim's patterns.ts: heading h <-> unit direction (sin h, cos h); h = 0 is +Z.
 */
import {
	AiState,
	SIM_HZ,
	scaledEnemyBulletSpeedMultiplier,
	teamEnemyBulletSpeedMultiplier,
	tutorialScalingFloor,
	type ActorState,
	type SimState,
} from "shared/sim";
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
		/** Roblox port (docs/ENEMY_VARIANTS.md): drawn only while ActorState.attack equals it. */
		readonly attack?: number;
		/**
		 * Roblox port (docs/NEW_ENEMIES.md NE8, view only): false draws the full length past intact breakables (the
		 * Charger's lane: its charge breaks them). Unset: clipped like a bullet's line.
		 */
		readonly clip?: boolean;
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
	/**
	 * Roblox port (docs/ENEMY_VARIANTS.md EV9): a flat circle on the floor while aiState === state (and attack, when
	 * set), centred on (v[xSlot], v[zSlot]) or on the actor (both absent), filling over fillTicks (ringMarkings).
	 */
	readonly ring?: {
		readonly state: number;
		readonly xSlot?: number;
		readonly zSlot?: number;
		readonly radius: number;
		readonly fillTicks?: number;
		readonly attack?: number;
	};
	/**
	 * Roblox port (docs/NEW_ENEMIES.md NE1 / NE8; the Stormcaller's cast): `count` filling circles of `radius` while
	 * aiState === state (and attack, when set), circle i centred on (v[centreX], v[centreZ]) + (i - (count - 1) / 2) x
	 * (v[offsetX], v[offsetZ]) (strikeRowPoint), each filling over fillTicks like `ring`.
	 */
	readonly strikeRow?: {
		readonly state: number;
		readonly centreX: number;
		readonly centreZ: number;
		readonly offsetX: number;
		readonly offsetZ: number;
		readonly count: number;
		readonly radius: number;
		readonly fillTicks?: number;
		readonly attack?: number;
	};
}

/** The v[] slots and count of a `strikeRow` hint (ActorFxHintsView.strikeRow). */
export type StrikeRowHint = NonNullable<ActorFxHintsView["strikeRow"]>;

/**
 * Circle `i` (0 .. count - 1) of a `strikeRow` hint on actor `a`, world units: the centre slots plus (i - (count - 1) /
 * 2) times the offset slots, so the row runs through the centre (the middle circle on it for an odd count) and the
 * sim's strike points land exactly there (stormcaller.ts). Writes `out` ([x, z]) and returns it.
 */
export function strikeRowPoint(
	hint: StrikeRowHint,
	a: Readonly<ActorState>,
	i: number,
	out: [number, number],
): [number, number] {
	const k = i - (hint.count - 1) / 2;
	out[0] = a.v[hint.centreX] + k * a.v[hint.offsetX];
	out[1] = a.v[hint.centreZ] + k * a.v[hint.offsetZ];
	return out;
}

const rowScratch: [number, number] = [0, 0];

/** True when a hint with an optional `attack` filter applies to an actor whose ActorState.attack is `attack`. */
export function hintAttackMatches(hintAttack: number | undefined, attack: number): boolean {
	return hintAttack === undefined || hintAttack === attack;
}

/**
 * How full a `ring` hint is: 0 on the wind-up's first tick (aiTicks = fillTicks, set by ctx.telegraph) up to 1 at the
 * render moment the telegraph runs out (aiTicks 1 with alpha 1: the tick the sim acts), render-interpolated like the
 * other wind-ups; clamped to [0, 1]. No fillTicks (or 0): always full.
 */
export function ringFill(aiTicks: number, fillTicks: number | undefined, alpha: number): number {
	if (fillTicks === undefined || !(fillTicks > 0)) return 1;
	return math.clamp((fillTicks - aiTicks + alpha) / fillTicks, 0, 1);
}

/**
 * A filling floor circle (the imp's landing spot, the summoner's casting circle): the full outline at `radius` on `dim`
 * until the fill passes TELEGRAPH_VIEW.brightFrom, then on `bright`; and the filled part as a second circle growing
 * from the centre to `radius` x fill on `bright` (nothing at fill 0).
 */
export function ringMarkings(
	bright: SegmentSink,
	dim: SegmentSink,
	x: number,
	z: number,
	radius: number,
	fill: number,
): void {
	arc(fill >= TELEGRAPH_VIEW.brightFrom ? bright : dim, x, z, radius, 0, TAU);
	const inner = radius * math.clamp(fill, 0, 1);
	if (inner > 0 && fill < 1) arc(bright, x, z, inner, 0, TAU);
}

/**
 * Cuts an aim line from (x, z) along (dx, dz) x len to the length kept (the client passes the intact breakables:
 * shared/view clipToSolidCells, so the line ends where the bullet will stop).
 */
export type AimClip = (x: number, z: number, dx: number, dz: number, len: number) => number;

/**
 * The aim line (while winding up), the expanding shockwave, the filling floor ring and the strike row (Roblox port) of
 * one actor at its drawn position (x, z); a hint with `attack` draws only while ActorState.attack equals it. Bold / young markings go
 * to `bright`, the rest to `dim`; `clip` (optional) shortens the aim line. Returns true when it drew anything.
 */
export function actorFxMarkings(
	bright: SegmentSink,
	dim: SegmentSink,
	a: Readonly<ActorState>,
	fx: ActorFxHintsView,
	x: number,
	z: number,
	alpha: number,
	clip?: AimClip,
): boolean {
	let drew = false;
	const aim = fx.aimLine;
	if (aim !== undefined && a.aiState === AiState.TELEGRAPH && hintAttackMatches(aim.attack, a.attack)) {
		const dx = a.v[aim.dirX];
		const dz = a.v[aim.dirZ];
		const full = aim.lenSlot !== undefined ? a.v[aim.lenSlot] : aim.length ?? 1;
		const len = clip !== undefined && aim.clip !== false ? clip(x, z, dx, dz, full) : full;
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
	const ring = fx.ring;
	if (ring !== undefined && a.aiState === ring.state && hintAttackMatches(ring.attack, a.attack)) {
		const at = ring.xSlot !== undefined && ring.zSlot !== undefined;
		const cx = at ? a.v[ring.xSlot!] : x;
		const cz = at ? a.v[ring.zSlot!] : z;
		ringMarkings(bright, dim, cx, cz, ring.radius, ringFill(a.aiTicks, ring.fillTicks, alpha));
		drew = true;
	}
	const row = fx.strikeRow;
	if (row !== undefined && a.aiState === row.state && hintAttackMatches(row.attack, a.attack)) {
		const fill = ringFill(a.aiTicks, row.fillTicks, alpha);
		for (let i = 0; i < row.count; i++) {
			const p = strikeRowPoint(row, a, i, rowScratch);
			ringMarkings(bright, dim, p[0], p[1], row.radius, fill);
		}
		if (row.count > 0) drew = true;
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

/**
 * A charge to (tx, tz) along the unit (dx, dz) by a body of `radius` from (x, z): the body-wide lane, the impact circle
 * and the impact shockwave's arc (centred on the charge heading, so its gap points back), `shockOffset` past the body.
 */
export function chargeLaneMarkings(
	sink: SegmentSink,
	x: number,
	z: number,
	radius: number,
	tx: number,
	tz: number,
	dx: number,
	dz: number,
	shockSpread: number,
	shockOffset: number,
): void {
	const r = radius;
	sink.seg(x - dz * r, z + dx * r, tx - dz * r, tz + dx * r);
	sink.seg(x + dz * r, z - dx * r, tx + dz * r, tz - dx * r);
	arc(sink, tx, tz, r, 0, TAU);
	shockArc(sink, tx, tz, heading(dx, dz), shockSpread, r + shockOffset);
}

/**
 * Which layer a boss wind-up's primary marking goes to: `bright` once the wind-up is past TELEGRAPH_VIEW.brightFrom,
 * blinking between the layers in its last blinkTicks; `dim` before. `total` = the attack's telegraph length, `left` =
 * the ticks left (aiTicks).
 */
export function telegraphMainSink(
	bright: SegmentSink,
	dim: SegmentSink,
	total: number,
	left: number,
	tick: number,
): SegmentSink {
	const progress = total > 0 ? 1 - left / total : 1;
	const blinking = left <= TELEGRAPH_VIEW.blinkTicks;
	const blinkOn = math.floor(tick / TELEGRAPH_VIEW.blinkPeriodTicks) % 2 === 0;
	return blinking ? (blinkOn ? bright : dim) : progress >= TELEGRAPH_VIEW.brightFrom ? bright : dim;
}

/** The slam preview: the body-wide charge lane to the target, the impact circle and its shockwave arc(s). */
export function slamMarkings(main: SegmentSink, second: SegmentSink, a: Readonly<ActorState>, c: BossAct1Consts): void {
	const v = a.v;
	const tx = v[c.slots.auxX];
	const tz = v[c.slots.auxZ];
	const dx = v[c.slots.dirX];
	const dz = v[c.slots.dirZ];
	const r = a.radius;
	chargeLaneMarkings(main, a.x, a.z, r, tx, tz, dx, dz, c.shockwave.spread, TELEGRAPH_VIEW.slamOffset);
	const h = heading(dx, dz);
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
	const main = telegraphMainSink(bright, dim, c.telegraphTicks[a.attack] ?? 0, a.aiTicks, tick);
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

// ---------------------------------------------------------------------------------------------
// The Demon Lord (boss.demonlord; docs/BOSS_DEMONLORD.md D6, Roblox port)

/** A burst whose reach the preview draws: shape, speed (world units / s), life (s) and spawn radius. */
export interface BurstReach extends BurstShape {
	readonly speed: number;
	readonly life: number;
	readonly radius?: number;
}

/**
 * What the Demon Lord's previews need from the boss.demonlord archetype module (its exported constants), passed in
 * like BossAct1Consts. The client resolves it from shared/sim (client/controllers/render/demonlord.ts).
 */
export interface DemonlordConsts {
	readonly attack: {
		readonly CLEAVE: number;
		readonly HELLFIRE: number;
		readonly DOUBLE_CLEAVE: number;
		readonly CHARGE: number;
		readonly SUMMON: number;
	};
	readonly state: { readonly ACTIVE: number };
	readonly telegraphTicks: ReadonlyArray<number>;
	readonly cleave: BurstReach;
	readonly hellfireArc: BurstShape;
	readonly shockwave: BurstShape;
	/** DOUBLE_CLEAVE: ACTIVE ticks between the two arcs (the lunge) and the lunge's length, world units. */
	readonly doubleCleaveDelayTicks: number;
	readonly doubleCleaveStep: number;
	/** SUMMON: adds per summon and how far from his centre they land, world units. */
	readonly summon: { readonly count: number; readonly radius: number };
	/** ActorState.v slots (DEMONLORD_V_*). */
	readonly slots: {
		readonly dirX: number;
		readonly dirZ: number;
		readonly auxX: number;
		readonly auxZ: number;
		readonly sign: number;
		readonly mark: number;
	};
}

/**
 * Enemy bullet speed scale of the state (endless Depth scaling and the team's run mods), the factor ctx.fireEnemy
 * applies: 1 outside endless. The cleave preview's reach uses it.
 */
export function enemyBulletSpeedScale(state: Readonly<SimState>): number {
	const endless = state.endless;
	if (endless === undefined) return 1;
	return scaledEnemyBulletSpeedMultiplier(
		tutorialScalingFloor(state, endless.floor),
		teamEnemyBulletSpeedMultiplier(state),
	);
}

/** How far a burst's bullets fly from the shooter's centre: spawn radius + speed x speedScale x life, world units. */
export function burstReach(b: BurstReach, speedScale = 1): number {
	return (b.radius ?? 0) + b.speed * speedScale * b.life;
}

/**
 * A cleave preview: one lane per bullet of `cleave` around heading h, from the body (r0) to the bullets' reach, and
 * the reach's arc joining the lane ends.
 */
export function cleaveMarkings(
	sink: SegmentSink,
	x: number,
	z: number,
	h: number,
	cleave: BurstReach,
	r0: number,
	speedScale = 1,
): void {
	const reach = math.max(r0, burstReach(cleave, speedScale));
	fanLanes(sink, x, z, h, cleave.count, cleave.spread, r0, reach);
	arc(sink, x, z, reach, h - cleave.spread / 2, h + cleave.spread / 2);
}

/** Headings of the hellfire ring's three arc centres around heading h (60, 180 and 300 degrees off it). */
export function hellfireArcCentres(h: number): [number, number, number] {
	return [h + math.pi / 3, h + math.pi, h - math.pi / 3];
}

/**
 * The hellfire ring preview: its three arcs (each `arcSpread` wide, centred 60 / 180 / 300 degrees off heading h, so
 * the gaps sit on h and +-120 degrees), gap edges ticked, at `radius`.
 */
export function hellfireMarkings(
	sink: SegmentSink,
	x: number,
	z: number,
	h: number,
	arcSpread: number,
	radius: number,
): void {
	const t = TELEGRAPH_VIEW.tickHalf;
	for (const c of hellfireArcCentres(h)) {
		arc(sink, x, z, radius, c - arcSpread / 2, c + arcSpread / 2);
		ray(sink, x, z, c - arcSpread / 2, radius - t, radius + t);
		ray(sink, x, z, c + arcSpread / 2, radius - t, radius + t);
	}
}

/**
 * Where the summoned adds land: `count` spots `radius` from (x, z), the first along the unit (dx, dz), then every 120
 * degrees (the sim's summonAdds order; walls may stop an add short).
 */
export function summonSpots(
	x: number,
	z: number,
	dx: number,
	dz: number,
	count: number,
	radius: number,
): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	const h = heading(dx, dz);
	for (let i = 0; i < count; i++) {
		const hi = h + (i * TAU) / 3;
		out.push([x + math.sin(hi) * radius, z + math.cos(hi) * radius]);
	}
	return out;
}

/** The summon preview: a ring on each add's landing spot and a short ray from the body toward it. */
export function summonMarkings(
	sink: SegmentSink,
	x: number,
	z: number,
	dx: number,
	dz: number,
	count: number,
	radius: number,
	bodyRadius: number,
): void {
	const spot = TELEGRAPH_VIEW.summonSpotRadius;
	for (const [sx, sz] of summonSpots(x, z, dx, dz, count, radius)) {
		arc(sink, sx, sz, spot, 0, TAU);
		const h = heading(sx - x, sz - z);
		ray(sink, x, z, h, bodyRadius, math.max(bodyRadius, radius - spot));
	}
}

/**
 * The Demon Lord's wind-up preview (aiState === TELEGRAPH; every direction is locked in v[] when it starts): exactly
 * where the attack's bullets will go. Primary markings as telegraphMainSink picks; secondary ones (the double
 * cleave's second arc) on `dim`. `speedScale` = enemyBulletSpeedScale(state) (the cleave's reach).
 *   CLEAVE         the arc's lanes along v[DIR] to the bullets' reach
 *   DOUBLE_CLEAVE  that, plus the second arc along v[AUX] from the lunge's end (v[DIR] x doubleCleaveStep ahead)
 *   HELLFIRE       the three arcs, gaps on v[DIR] and +-120 degrees
 *   CHARGE         the lane to the target v[AUX], the impact circle, the shockwave arc (gap pointing back)
 *   SUMMON         v[SIGN] 1: the adds' landing spots; 0: the hellfire ring it fires instead
 */
export function demonlordTelegraphMarkings(
	bright: SegmentSink,
	dim: SegmentSink,
	a: Readonly<ActorState>,
	c: DemonlordConsts,
	tick: number,
	speedScale = 1,
): void {
	const main = telegraphMainSink(bright, dim, c.telegraphTicks[a.attack] ?? 0, a.aiTicks, tick);
	const v = a.v;
	const s = c.slots;
	const dx = v[s.dirX];
	const dz = v[s.dirZ];
	const h = heading(dx, dz);
	const ringRadius = a.radius + TELEGRAPH_VIEW.ringOffset;
	switch (a.attack) {
		case c.attack.CLEAVE:
			cleaveMarkings(main, a.x, a.z, h, c.cleave, a.radius, speedScale);
			break;
		case c.attack.DOUBLE_CLEAVE: {
			cleaveMarkings(main, a.x, a.z, h, c.cleave, a.radius, speedScale);
			const step = c.doubleCleaveStep;
			const h2 = heading(v[s.auxX], v[s.auxZ]);
			cleaveMarkings(dim, a.x + dx * step, a.z + dz * step, h2, c.cleave, a.radius, speedScale);
			break;
		}
		case c.attack.HELLFIRE:
			hellfireMarkings(main, a.x, a.z, h, c.hellfireArc.spread, ringRadius);
			break;
		case c.attack.CHARGE:
			chargeLaneMarkings(
				main,
				a.x,
				a.z,
				a.radius,
				v[s.auxX],
				v[s.auxZ],
				dx,
				dz,
				c.shockwave.spread,
				TELEGRAPH_VIEW.slamOffset,
			);
			break;
		case c.attack.SUMMON:
			if (v[s.sign] === 1) summonMarkings(main, a.x, a.z, dx, dz, c.summon.count, c.summon.radius, a.radius);
			else hellfireMarkings(main, a.x, a.z, h, c.hellfireArc.spread, ringRadius);
			break;
	}
}

/**
 * While a Demon Lord attack runs (aiState === ACTIVE): the charge's lane, impact circle and shockwave until the impact
 * (v[MARK] 0), on `dim` (as Mother Bramble's slam); the double cleave's second arc from its first arc to the lunge's
 * end (ACTIVE ticks 0..doubleCleaveDelayTicks - 1), from where the lunge will stop, on `bright`. Returns true when it
 * drew anything.
 */
export function demonlordActiveMarkings(
	bright: SegmentSink,
	dim: SegmentSink,
	a: Readonly<ActorState>,
	c: DemonlordConsts,
	speedScale = 1,
): boolean {
	const v = a.v;
	const s = c.slots;
	const dx = v[s.dirX];
	const dz = v[s.dirZ];
	if (a.attack === c.attack.CHARGE && v[s.mark] === 0) {
		chargeLaneMarkings(
			dim,
			a.x,
			a.z,
			a.radius,
			v[s.auxX],
			v[s.auxZ],
			dx,
			dz,
			c.shockwave.spread,
			TELEGRAPH_VIEW.slamOffset,
		);
		return true;
	}
	const delay = c.doubleCleaveDelayTicks;
	if (a.attack === c.attack.DOUBLE_CLEAVE && a.aiTicks >= 0 && a.aiTicks < delay) {
		// The lunge goes doubleCleaveStep / delay per tick on ticks 1..delay: what is left of it after this tick.
		const left = (c.doubleCleaveStep * (delay - a.aiTicks)) / delay;
		const h2 = heading(v[s.auxX], v[s.auxZ]);
		cleaveMarkings(bright, a.x + dx * left, a.z + dz * left, h2, c.cleave, a.radius, speedScale);
		return true;
	}
	return false;
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

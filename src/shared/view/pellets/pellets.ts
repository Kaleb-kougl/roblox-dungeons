/**
 * Pellets on screen (docs/PELLETS.md PL7), the pure rules: what each pellet looks like this frame (PelletViewTracker:
 * dormant rooms hidden, the pop-in wave on the engagement tick, the last-few pulse, the power pellet's slow pulse, the
 * shrink at the clear; reduced-motion variants), the tiny score pops (merged per player per frame, their fade and
 * rise), the power pellet's fly-in cubes (PelletFlyIns), its solo freeze and the first-sighting check. Presentation only,
 * read-only on the sim; drawn by the client's PelletRenderController, ScorePopController and ParticleController.
 *
 * Time is sim time (state.tick + alpha) / SIM_HZ for the pellets themselves (they hold still under pause and the
 * freeze, like boost drops), the particle clock for the fly-in, and the score pops' SimClock for the pops.
 */
import { NO_POWER_PELLET } from "shared/dungeon";
import { PelletPhase, SIM_HZ, type PelletEaten, type SimState } from "shared/sim";
import type { JuiceSettings } from "shared/settings";
import { easeOutBack, freezeFrameOn } from "shared/view/fx";
import { PELLETS_VIEW } from "./config";
import type { PelletFrameSource, PelletPowerTaken } from "./events";

const TAU = 2 * math.pi;
const HALF = 0.5;
const SOLO = 1;

function clamp01(u: number): number {
	return u <= 0 ? 0 : u >= 1 ? 1 : u;
}

/** 0..1 and back once per `periodSec` (a raised cosine: 0 at t = 0). */
export function pulse01(t: number, periodSec: number): number {
	if (!(periodSec > 0)) return 0;
	return HALF - HALF * math.cos((TAU * t) / periodSec);
}

/** How one pellet is drawn this frame. */
export interface PelletLook {
	/** Drawn at all (a dormant room, a taken pellet, one fully shrunk or not popped in yet: false). */
	shown: boolean;
	/** Size factor (1 = the kind's full size). */
	scale: number;
	/** 0 opaque .. 1 invisible (the reduced-motion fade at the clear). */
	transparency: number;
	/** 0..1 of the way from the kind's colour to PELLETS_VIEW.glowRole (the last-few hint, the power pulse). */
	glow: number;
}

export function newPelletLook(): PelletLook {
	return { shown: false, scale: 1, transparency: 0, glow: 0 };
}

/**
 * Pop-in delay of a pellet at (x, z) in a room spanning minX..maxX x minZ..maxZ: PELLETS_VIEW.popIn.waveSec x its
 * distance from the room's centre over the room's half diagonal (0 at the centre, waveSec at a corner).
 */
export function pelletWaveDelay(x: number, z: number, minX: number, maxX: number, minZ: number, maxZ: number): number {
	const cx = (minX + maxX) * HALF;
	const cz = (minZ + maxZ) * HALF;
	const hx = (maxX - minX) * HALF;
	const hz = (maxZ - minZ) * HALF;
	const reach = math.sqrt(hx * hx + hz * hz);
	if (!(reach > 0)) return 0;
	const dx = x - cx;
	const dz = z - cz;
	return PELLETS_VIEW.popIn.waveSec * clamp01(math.sqrt(dx * dx + dz * dz) / reach);
}

/**
 * Pop-in scale `sinceLive` seconds after the room went live, for a pellet whose wave delay is `delay`: 0 before its
 * turn, then an ease-out-back growth to 1 over popIn.popSec. Reduced motion (motion 0): 1 at once.
 */
export function pelletPopInScale(sinceLive: number, delay: number, motion: number): number {
	if (motion <= 0) return 1;
	const u = (sinceLive - delay) / PELLETS_VIEW.popIn.popSec;
	if (u <= 0) return 0;
	return u >= 1 ? 1 : easeOutBack(u);
}

/** A pulse's glow and scale (pelletLastFew / powerPelletPulse). */
export interface PelletPulse {
	glow: number;
	scale: number;
}

/** The tracker's scratch for the pulses (one look at a time: no object per pellet per frame). */
const PULSE_SCRATCH: PelletPulse = { glow: 0, scale: 1 };

function writePulse(out: PelletPulse, glow: number, scale: number): PelletPulse {
	out.glow = glow;
	out.scale = scale;
	return out;
}

/**
 * The last-few hint at time t: glow and scale. Reduced motion: a steady glowMax, scale 1. Writes `out` (a new object
 * when omitted) and returns it.
 */
export function pelletLastFew(t: number, motion: number, out: PelletPulse = { glow: 0, scale: 1 }): PelletPulse {
	const L = PELLETS_VIEW.lastFew;
	if (motion <= 0) return writePulse(out, L.glowMax, 1);
	const w = pulse01(t, L.periodSec);
	return writePulse(out, L.glowMax * w, 1 + L.scaleAmp * w * motion);
}

/**
 * The power pellet's slow pulse at time t: glow and scale. Reduced motion: still (glow 0, scale 1). Writes `out` (a new
 * object when omitted) and returns it.
 */
export function powerPelletPulse(t: number, motion: number, out: PelletPulse = { glow: 0, scale: 1 }): PelletPulse {
	const P = PELLETS_VIEW.power;
	if (motion <= 0) return writePulse(out, 0, 1);
	const w = pulse01(t, P.periodSec);
	return writePulse(out, P.glowMax * w, 1 + P.scaleAmp * w * motion);
}

/**
 * The shrink at the clear, `sinceGone` seconds after it: scale 1 -> 0 over shrinkSec (shown until then); reduced motion:
 * scale 1, transparency 0 -> 1 instead. Writes `out` (shown false once it is over) and returns it.
 */
export function pelletGoneLook(sinceGone: number, motion: number, out: PelletLook): PelletLook {
	const u = sinceGone / PELLETS_VIEW.shrinkSec;
	out.glow = 0;
	if (!(u < 1)) {
		out.shown = false;
		return out;
	}
	const v = clamp01(u);
	out.shown = true;
	out.scale = motion > 0 ? 1 - v : 1;
	out.transparency = motion > 0 ? 0 : v;
	return out;
}

/**
 * Per room record: when its pellets went live and gone (sim seconds; NOT_SEEN when this view did not see it happen: a
 * live room is then fully shown, a gone one hidden). Fed once per frame with the run view's PelletFrameEvents; a new
 * floor (the endless floor, the pellet count or the record count changed), the tick going back (a new run on the same
 * floor: the dev world's instant restart) or `reset` (a new run) forgets everything. A room that clears before its
 * pop-in wave finished shrinks from the size each pellet had reached (one that never showed stays hidden).
 */
export class PelletViewTracker {
	static readonly NOT_SEEN = -1;
	private readonly liveAt: number[] = [];
	private readonly goneAt: number[] = [];
	private floor = -1;
	private pellets = -1;
	private records = -1;
	private lastTick = -1;

	reset(): void {
		this.floor = -1;
		this.pellets = -1;
		this.records = -1;
		this.lastTick = -1;
		this.liveAt.clear();
		this.goneAt.clear();
	}

	/** True when this frame's state is another floor than the last one synced (the renderer rebuilds then). */
	isNewFloor(state: Readonly<SimState>): boolean {
		const p = state.pellets;
		const pellets = p !== undefined ? p.x.size() : 0;
		const records = p !== undefined ? p.rooms.size() : 0;
		return (
			(state.endless?.floor ?? 0) !== this.floor ||
			pellets !== this.pellets ||
			records !== this.records ||
			state.tick < this.lastTick
		);
	}

	/** Once per frame, after the frame's ticks. Returns true when it took a new floor (everything forgotten). */
	sync(state: Readonly<SimState>, events: PelletFrameSource): boolean {
		const p = state.pellets;
		const fresh = this.isNewFloor(state);
		if (fresh) {
			this.floor = state.endless?.floor ?? 0;
			this.pellets = p !== undefined ? p.x.size() : 0;
			this.records = p !== undefined ? p.rooms.size() : 0;
			this.liveAt.clear();
			this.goneAt.clear();
			for (let k = 0; k < this.records; k++) {
				this.liveAt.push(PelletViewTracker.NOT_SEEN);
				this.goneAt.push(PelletViewTracker.NOT_SEEN);
			}
		}
		this.lastTick = state.tick;
		for (const e of events.live) if (e.rec >= 0 && e.rec < this.records) this.liveAt[e.rec] = e.tick / SIM_HZ;
		for (const e of events.gone) if (e.rec >= 0 && e.rec < this.records) this.goneAt[e.rec] = e.tick / SIM_HZ;
		return fresh;
	}

	/** When record `rec` went live / gone (sim seconds), or NOT_SEEN. */
	liveTime(rec: number): number {
		return this.liveAt[rec] ?? PelletViewTracker.NOT_SEEN;
	}

	goneTime(rec: number): number {
		return this.goneAt[rec] ?? PelletViewTracker.NOT_SEEN;
	}

	/** Pellet `i`'s pop-in delay in its record's room (0 without the record). */
	private waveDelay(state: Readonly<SimState>, rec: number, i: number): number {
		const p = state.pellets!;
		const r = state.score?.rooms[rec];
		return r !== undefined ? pelletWaveDelay(p.x[i], p.z[i], r.minX, r.maxX, r.minZ, r.maxZ) : 0;
	}

	/** Pellet `i`'s look at sim time `now` (see the file comment). Writes `out` and returns it. */
	look(state: Readonly<SimState>, i: number, now: number, motion: number, out: PelletLook): PelletLook {
		out.shown = false;
		out.scale = 1;
		out.transparency = 0;
		out.glow = 0;
		const p = state.pellets;
		if (p === undefined || i < 0 || i >= p.x.size() || p.taken[i] !== 0) return out;
		const rec = p.rec[i];
		const room = rec >= 0 ? p.rooms[rec] : undefined;
		if (room === undefined) return out;
		const liveAt = this.liveTime(rec);
		if (room.phase === PelletPhase.GONE) {
			const goneAt = this.goneTime(rec);
			if (goneAt === PelletViewTracker.NOT_SEEN) return out;
			// The size it had reached when the room cleared (a clear inside the pop-in wave).
			const from =
				liveAt !== PelletViewTracker.NOT_SEEN
					? pelletPopInScale(goneAt - liveAt, this.waveDelay(state, rec, i), motion)
					: 1;
			if (from <= 0) return out;
			pelletGoneLook(now - goneAt, motion, out);
			out.scale *= from;
			return out;
		}
		if (room.phase !== PelletPhase.LIVE) return out;
		let scale = 1;
		if (liveAt !== PelletViewTracker.NOT_SEEN) {
			scale = pelletPopInScale(now - liveAt, this.waveDelay(state, rec, i), motion);
			if (scale <= 0) return out;
		}
		if (i === p.power) {
			const w = powerPelletPulse(now, motion, PULSE_SCRATCH);
			scale *= w.scale;
			out.glow = w.glow;
		} else if (room.left > 0 && room.left <= PELLETS_VIEW.lastFewHint) {
			const w = pelletLastFew(now, motion, PULSE_SCRATCH);
			scale *= w.scale;
			out.glow = w.glow;
		}
		out.shown = true;
		out.scale = scale;
		return out;
	}
}

// ---------------------------------------------------------------------------------------------
// Pellet pops (PD11)

/** One player's pellets of one frame as a single pop: their summed points at the last one's spot. */
export interface PelletPop {
	player: number;
	x: number;
	z: number;
	points: number;
	/** Regular pellets merged into it (the power pellet is not counted: it is not an `eaten` pellet). */
	count: number;
}

function popOf(out: PelletPop[], player: number): PelletPop | undefined {
	for (const o of out) if (o.player === player) return o;
	return undefined;
}

/**
 * The frame's pellet pops: one per player (first-taken order), points summed, at the player's LAST pellet of the frame
 * (nearest to where they are now). `power` (the frame's power pellet pickups, docs/PELLETS.md PL4: no `eaten` event,
 * only the bullets' points) joins its picker's pop, or makes one at the power pellet's spot; a pickup that paid
 * nothing (no bullet on screen) adds no pop. Clears `out`, fills it and returns it.
 */
export function mergePelletPops(
	eaten: ReadonlyArray<PelletEaten>,
	out: PelletPop[],
	power: ReadonlyArray<PelletPowerTaken> = [],
): PelletPop[] {
	out.clear();
	for (const e of eaten) {
		const pop = popOf(out, e.player);
		if (pop === undefined) out.push({ player: e.player, x: e.x, z: e.z, points: e.points, count: 1 });
		else {
			pop.x = e.x;
			pop.z = e.z;
			pop.points += e.points;
			pop.count += 1;
		}
	}
	for (const p of power) {
		if (!(p.points > 0)) continue;
		const pop = popOf(out, p.player);
		if (pop === undefined) out.push({ player: p.player, x: p.px, z: p.pz, points: p.points, count: 0 });
		else pop.points += p.points;
	}
	return out;
}

/**
 * A pellet pop's opacity at `age` seconds: 1, then a linear fade over the last pop.fadeSec of pop.lifeSec; reduced
 * motion: a fade over the whole life. 0 outside the life.
 */
export function pelletPopAlpha(age: number, motion: number): number {
	const P = PELLETS_VIEW.pop;
	if (!(age >= 0) || age >= P.lifeSec) return 0;
	const left = P.lifeSec - age;
	const fade = motion > 0 ? P.fadeSec : P.lifeSec;
	return left >= fade ? 1 : left / fade;
}

/** Whole render px a pellet pop has risen at `age` (quadratic ease-out over its life); 0 under reduced motion. */
export function pelletPopRise(age: number, motion: number): number {
	const P = PELLETS_VIEW.pop;
	if (motion <= 0 || !(age > 0)) return 0;
	const t = clamp01(age / P.lifeSec);
	return math.round(P.risePx * motion * (1 - (1 - t) * (1 - t)));
}

// ---------------------------------------------------------------------------------------------
// The power pellet

/**
 * The power pellet's solo freeze for a pickup by `player` (docs/GRAZE_PARRY.md GPD7's rule): PELLETS_VIEW.freezeMs when
 * it is the view player's, in a solo run, with freezeFrameOn; else 0.
 */
export function pelletPowerFreezeMs(
	player: number,
	viewIndex: number,
	partySize: number,
	settings: Readonly<JuiceSettings>,
): number {
	return player === viewIndex && partySize === SOLO && freezeFrameOn(settings) ? PELLETS_VIEW.freezeMs : 0;
}

/** The index of the power pellet while it lies in a live room untaken (the first sighting), else -1. */
export function livePowerPellet(state: Readonly<SimState>): number {
	const p = state.pellets;
	if (p === undefined || p.power === NO_POWER_PELLET) return -1;
	const i = p.power;
	if (p.taken[i] !== 0) return -1;
	const rec = p.rec[i];
	const room = rec !== undefined && rec >= 0 ? p.rooms[rec] : undefined;
	return room !== undefined && room.phase === PelletPhase.LIVE ? i : -1;
}

/** What draws a fly-in cube (ParticleController's ParticleWriter). */
export interface FlyInWriter {
	push(x: number, z: number, hopPx: number, sizePx: number, color: number, alpha: number): void;
}

/**
 * The power pellet's fly-in (docs/PELLETS.md player experience 6): every erased bullet becomes a cube flying from where
 * the bullet was into its picker over flyIn.sec (ease-in, a small hop), at most flyIn.maxCubes at once (a full pool
 * drops the newest). The picker's position is read each frame (`targetOf`), so the cubes follow a moving player.
 * Reduced motion: the cubes stay where the bullets were and fade over the same time. Ages on the caller's clock.
 */
export class PelletFlyIns {
	private readonly fromX: number[] = [];
	private readonly fromZ: number[] = [];
	private readonly player: number[] = [];
	private readonly age: number[] = [];
	private readonly still: boolean[] = [];

	/** Cubes in flight. */
	size(): number {
		return this.age.size();
	}

	clear(): void {
		this.fromX.clear();
		this.fromZ.clear();
		this.player.clear();
		this.age.clear();
		this.still.clear();
	}

	/** One power pickup: a cube per erased bullet (up to the cap). `motion` 0: they fade in place. */
	add(taken: Readonly<PelletPowerTaken>, motion: number): void {
		const cap = PELLETS_VIEW.flyIn.maxCubes;
		for (let k = 0; k < taken.x.size(); k++) {
			if (this.age.size() >= cap) return;
			this.fromX.push(taken.x[k]);
			this.fromZ.push(taken.z[k]);
			this.player.push(taken.player);
			this.age.push(0);
			this.still.push(motion <= 0);
		}
	}

	/** Ages every cube by dt seconds and drops the ones that arrived. */
	update(dt: number): void {
		const d = math.max(0, dt);
		const sec = PELLETS_VIEW.flyIn.sec;
		let i = 0;
		while (i < this.age.size()) {
			const a = this.age[i] + d;
			if (a >= sec) {
				this.fromX.remove(i);
				this.fromZ.remove(i);
				this.player.remove(i);
				this.age.remove(i);
				this.still.remove(i);
			} else {
				this.age[i] = a;
				i++;
			}
		}
	}

	/**
	 * Draws every cube through `writer` in palette colour `color`: lerped (ease-in) from its bullet's spot to
	 * `targetOf(player)` (undefined: it stays put), or, reduced, still and fading.
	 */
	draw(writer: FlyInWriter, color: number, targetOf: (player: number) => { x: number; z: number } | undefined): void {
		const F = PELLETS_VIEW.flyIn;
		for (let i = 0; i < this.age.size(); i++) {
			const u = clamp01(this.age[i] / F.sec);
			const x0 = this.fromX[i];
			const z0 = this.fromZ[i];
			if (this.still[i]) {
				writer.push(x0, z0, 0, F.sizePx, color, 1 - u);
				continue;
			}
			const to = targetOf(this.player[i]);
			const e = u * u;
			const x = to !== undefined ? x0 + (to.x - x0) * e : x0;
			const z = to !== undefined ? z0 + (to.z - z0) * e : z0;
			writer.push(x, z, F.hopPx * 4 * u * (1 - u), F.sizePx, color, 1);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// KV_PelletDebug

/** The debug label of a live room (developer text, English): `pellets <left> / <count>`. */
export function pelletDebugText(left: number, count: number): string {
	return `pellets ${left} / ${count}`;
}

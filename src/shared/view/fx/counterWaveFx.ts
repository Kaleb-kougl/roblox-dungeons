/**
 * Riposte's counter-wave, COUNTER xN and the parry ladder, the pure rules (docs/BUILDS_V2.md Architecture 6, BV11;
 * Studio checklist 1-4, 8, 11, 12). CounterWaveFx turns the frame's `waves` (BuildFxFrameSource, one WaveRecord per wave
 * the sim spawned: Riposte's FORWARD crescent, Counterstrike's RING, Rebuke's REBUKE ring) into what the client draws,
 * once per rendered frame after the ticks:
 *
 *   - Each wave lives from its record's tick, aged on sim time (waveOneAgeSec: state.tick + alpha). Its radius is the
 *     sim's sweep exactly: speed x age, capped at the record's range (counterWaveRadius), so the leading edge is where it
 *     strikes. Once the radius reached the range it fades out over counter.fadeSec (counterWaveFade); then it is gone.
 *   - Shape: the record's direction and half-angle (counterWaveHalfAngle: acos(halfCos), a full ring below -1), the
 *     kind (FORWARD / RING / REBUKE) for the client to tell them apart, in build.counter. Full: a band of bandTiles
 *     behind the edge (never wider than the radius) and a glow; Reduced: reducedBandTiles, no glow, buildFxCount's
 *     segments (counterWaveSegments: an arc takes its share of a full ring's, at least minArcSegments).
 *   - Owner: `mine` (owner = the view player); a teammate's wave at teammateOpacity. A dead owner's wave keeps going
 *     (the sim's does). At most counter.maxAlive (the oldest goes first).
 *   - COUNTER xN (`shout`): the frame's view player wave with the highest counterCount (> 0) asks for the floor shout
 *     (`fx.counter.text`, n = that count) at FLOOR_SHOUT_PRIORITY.counter; a teammate's wave asks for nothing.
 *
 * The parry ladder (Player experience 1, "the parry tick climbing a step each"): riposteParrySemitones / Speed (the cue
 * mapper plays sfx.player.parry at it on every frame a Riposte owner's PARRY! count grows; shared/view/audio cues.ts).
 * It climbs the PARRY itself, not sfx.build.counter: the tick is the guard eating a bullet (the parry's sound, its
 * grouping and its flash count), the counter is the answer at the guard's end and stays one distinct sound there
 * (its fallback while silent is the parry, so a silent pack still hears the release apart: one unpitched ring-out
 * after a climb).
 *
 * Gates: `quiet` (comboQuiet: the stage cover, run over) puts nothing out and forgets every wave; a new run (another
 * state object, or the tick going back) forgets them too. No allocation in steady state. Presentation only.
 */
import { SIM_DT, partySize, type SimState } from "shared/sim";
import type { ColorRole } from "shared/theme";
// Not the shared/view/hud barrel (hud imports this barrel): both modules import only shared/sim.
import { semitonesToSpeed } from "../hud/comboConfig";
import { FLOOR_SHOUT_PRIORITY } from "../hud/dailyRankConfig";
import { buildFxCount, type BuildFxSettings } from "./buildFxRules";
import type { BuildFxFrameSource, WaveRecord } from "./buildFxEvents";
import { BUILDS_V2_FX } from "./buildsV2FxConfig";
import { FULL_RING_HALF_ANGLE, fanSegments, waveOneAgeSec, type FloorShoutRequest } from "./buildsV2Fx";

/** One live counter-wave as drawn this frame. */
export interface CounterWaveView {
	/** The origin and unit direction (sim units). */
	readonly x: number;
	readonly z: number;
	readonly dirX: number;
	readonly dirZ: number;
	/** The leading edge's radius now and where it stops (sim units). */
	readonly radius: number;
	readonly range: number;
	/** The cone: its half-angle cosine (the sim's) and half angle (FULL_RING_HALF_ANGLE: a full ring). */
	readonly halfCos: number;
	readonly halfAngleRad: number;
	readonly fullRing: boolean;
	/** WaveKind (FORWARD / RING / REBUKE). */
	readonly kind: number;
	/** The erases it answers (COUNTER xN). */
	readonly count: number;
	readonly owner: number;
	readonly mine: boolean;
	/** Opacity factor: counterWaveFade x the owner's opacity. */
	readonly fade: number;
	/** The band behind the edge, tiles (Full bandTiles, Reduced reducedBandTiles; never above the radius). */
	readonly bandTiles: number;
	/** Draw the glow (Full only) at glowTiles wider, glowOpacity x fade. */
	readonly glow: boolean;
	/** Segments along the arc (or the ring). */
	readonly segments: number;
	readonly role: ColorRole;
	readonly ageSec: number;
}

/** What CounterWaveFx.frame fills (reused: valid until the next frame call). */
export interface CounterWaveFrame {
	readonly waves: ReadonlyArray<CounterWaveView>;
	/** COUNTER xN for the view player's wave of this frame, or undefined. */
	readonly shout: FloorShoutRequest | undefined;
}

/** The wave's leading edge at `ageSec` (sim seconds): speed x age, capped at the range. */
export function counterWaveRadius(speed: number, range: number, ageSec: number): number {
	return math.clamp(speed * ageSec, 0, range);
}

/** Sim seconds the wave takes to reach its range (range / speed; 0 for a wave that cannot grow). */
export function counterWaveGrowSec(speed: number, range: number): number {
	return speed > 0 ? range / speed : 0;
}

/** The wave's whole life, sim seconds: its growth, then counter.fadeSec. */
export function counterWaveLifeSec(speed: number, range: number): number {
	return counterWaveGrowSec(speed, range) + BUILDS_V2_FX.counter.fadeSec;
}

/** The wave's opacity at `ageSec`: 1 while it grows, then linearly to 0 over counter.fadeSec; 0 after. */
export function counterWaveFade(speed: number, range: number, ageSec: number): number {
	const grow = counterWaveGrowSec(speed, range);
	const fadeSec = BUILDS_V2_FX.counter.fadeSec;
	if (ageSec <= grow) return 1;
	if (ageSec >= grow + fadeSec) return 0;
	return 1 - (ageSec - grow) / fadeSec;
}

/** The half angle of a cone of half-angle cosine `halfCos`: acos, or FULL_RING_HALF_ANGLE at or below -1 (a ring). */
export function counterWaveHalfAngle(halfCos: number): number {
	if (halfCos <= -1) return FULL_RING_HALF_ANGLE;
	return math.acos(math.min(halfCos, 1));
}

/** Segments of a wave of half angle `halfAngleRad` at `level`: an arc's share of a full ring's, at least minArcSegments. */
export function counterWaveSegments(halfAngleRad: number, level: BuildFxSettings["buildFx"]): number {
	const c = BUILDS_V2_FX.counter;
	const ring = buildFxCount(c.segments, level);
	if (halfAngleRad >= FULL_RING_HALF_ANGLE) return ring;
	return math.max(math.min(c.minArcSegments, ring), fanSegments(ring, halfAngleRad));
}

/** The band behind the edge at `level`, tiles, never above the radius. */
export function counterWaveBand(radius: number, level: BuildFxSettings["buildFx"]): number {
	const c = BUILDS_V2_FX.counter;
	return math.min(level === "full" ? c.bandTiles : c.reducedBandTiles, math.max(radius, 0));
}

/** The parry ladder's shift for a guard's `count`-th erase, semitones: (count - 1) x semitoneStep, capped. */
export function riposteParrySemitones(count: number): number {
	const l = BUILDS_V2_FX.parryLadder;
	return math.min(math.max(math.floor(count) - 1, 0) * l.semitoneStep, l.maxSemitones);
}

/** The parry ladder's PlaybackSpeed for a guard's `count`-th erase. */
export function riposteParrySpeed(count: number): number {
	return semitonesToSpeed(riposteParrySemitones(count));
}

/** COUNTER xN for `waves` (the frame's records): the view player's highest count (> 0), or undefined. */
export function counterShoutFor(waves: ReadonlyArray<WaveRecord>, viewIndex: number): FloorShoutRequest | undefined {
	let best: WaveRecord | undefined;
	for (const w of waves)
		if (w.owner === viewIndex && w.count > 0 && (best === undefined || w.count > best.count)) best = w;
	if (best === undefined) return undefined;
	const s = BUILDS_V2_FX.counter.shout;
	return {
		key: s.key,
		vars: { n: best.count },
		role: s.role,
		lifeSec: s.lifeSec,
		priority: FLOOR_SHOUT_PRIORITY.counter,
		player: best.owner,
	};
}

interface WaveSlot {
	x: number;
	z: number;
	dirX: number;
	dirZ: number;
	radius: number;
	range: number;
	speed: number;
	halfCos: number;
	halfAngleRad: number;
	fullRing: boolean;
	kind: number;
	count: number;
	owner: number;
	mine: boolean;
	fade: number;
	bandTiles: number;
	glow: boolean;
	segments: number;
	role: ColorRole;
	ageSec: number;
	bornTick: number;
}

interface FrameSlot {
	readonly waves: WaveSlot[];
	shout: FloorShoutRequest | undefined;
}

/** The counter-waves' per-frame planner (see the file comment). One per client. */
export class CounterWaveFx {
	readonly out: CounterWaveFrame;
	private readonly slot: FrameSlot = { waves: [], shout: undefined };
	private readonly free: WaveSlot[] = [];
	private lastState: Readonly<SimState> | undefined;
	private lastTick = 0;

	constructor() {
		this.out = this.slot;
	}

	/** Forgets every wave (a new run; quiet does this too). */
	resetAll(): void {
		for (const w of this.slot.waves) this.free.push(w);
		this.slot.waves.clear();
		this.slot.shout = undefined;
	}

	/**
	 * One rendered frame, after its ticks: `source` the frame's build effects (RunView.builds), `viewIndex` the view
	 * player, `quiet` comboQuiet(covered, runOver), `alpha` the run view's interpolation (getAlpha). Returns `out`.
	 */
	frame(
		source: BuildFxFrameSource,
		state: Readonly<SimState>,
		viewIndex: number,
		quiet: boolean,
		settings: Readonly<BuildFxSettings>,
		alpha: number,
	): CounterWaveFrame {
		const out = this.slot;
		out.shout = undefined;
		if (state !== this.lastState || state.tick < this.lastTick) this.resetAll();
		this.lastState = state;
		this.lastTick = state.tick;
		if (quiet) {
			this.resetAll();
			return this.out;
		}
		const n = partySize(state);
		const level = settings.buildFx;
		const c = BUILDS_V2_FX.counter;
		for (const r of source.waves) {
			if (r.owner < 0 || r.owner >= n) continue;
			if (out.waves.size() >= c.maxAlive) this.free.push(out.waves.remove(0)!);
			const w = this.free.pop() ?? newWave();
			w.x = r.x;
			w.z = r.z;
			w.dirX = r.dirX;
			w.dirZ = r.dirZ;
			w.range = r.range;
			w.speed = r.speed;
			w.halfCos = r.halfCos;
			w.halfAngleRad = counterWaveHalfAngle(r.halfCos);
			w.fullRing = w.halfAngleRad >= FULL_RING_HALF_ANGLE;
			w.kind = r.kind;
			w.count = r.count;
			w.owner = r.owner;
			w.mine = r.owner === viewIndex;
			w.bornTick = r.tick;
			out.waves.push(w);
		}
		out.shout = counterShoutFor(source.waves, viewIndex);
		this.age(state.tick, alpha, level);
		return this.out;
	}

	private age(tick: number, alpha: number, level: BuildFxSettings["buildFx"]): void {
		const waves = this.slot.waves;
		const c = BUILDS_V2_FX.counter;
		let k = 0;
		const n = waves.size();
		for (let r = 0; r < n; r++) {
			const w = waves[r];
			const age = waveOneAgeSec(w.bornTick, tick, alpha);
			if (age >= counterWaveLifeSec(w.speed, w.range)) {
				this.free.push(w);
				continue;
			}
			waves[k] = w;
			k++;
			w.ageSec = age;
			w.radius = counterWaveRadius(w.speed, w.range, age);
			w.fade = counterWaveFade(w.speed, w.range, age) * (w.mine ? 1 : BUILDS_V2_FX.teammateOpacity);
			w.bandTiles = counterWaveBand(w.radius, level);
			w.glow = level === "full";
			w.segments = counterWaveSegments(w.halfAngleRad, level);
			w.role = c.role;
		}
		while (waves.size() > k) waves.pop();
	}
}

function newWave(): WaveSlot {
	return {
		x: 0,
		z: 0,
		dirX: 0,
		dirZ: 0,
		radius: 0,
		range: 0,
		speed: 0,
		halfCos: 0,
		halfAngleRad: FULL_RING_HALF_ANGLE,
		fullRing: true,
		kind: 0,
		count: 0,
		owner: 0,
		mine: true,
		fade: 1,
		bandTiles: 0,
		glow: true,
		segments: 0,
		role: BUILDS_V2_FX.counter.role,
		ageSec: 0,
		bornTick: 0,
	};
}

/** The sim tick the wave's edge reaches distance `d` from its origin (the first tick a body there can be struck). */
export function counterWaveReachTick(r: Readonly<WaveRecord>, d: number): number {
	const perTick = r.speed * SIM_DT;
	if (perTick <= 0) return math.huge;
	// The record's tick already grew the wave once (radius perTick at its end).
	return r.tick + math.max(math.ceil(d / perTick) - 1, 0);
}

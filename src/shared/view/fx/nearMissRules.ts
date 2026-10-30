/**
 * Grazes and parries, the pure rules (docs/GRAZE_PARRY.md GP4). NearMissDirector turns a frame's grazes and guard
 * erases (NearMissFrameSource, GP2) into what the particle, audio and flash code draw and play, once per rendered
 * frame after the ticks. It owns every rule that spans frames:
 *
 *   - Graze sparks (GPD3): per graze, the closest point of the bullet's path to the grazer (the bullet's position and
 *     velocity at the award, the grazer's CURRENT position: projected onto the line and clamped so it is never ahead of
 *     the bullet), with the bullet's unit direction of travel. At most NEAR_MISS_VIEW.graze.sparksPerFrame per frame,
 *     the view player's grazes kept first.
 *   - The graze cue (GPD4): at most one per frame, only for the VIEW player's grazes. Grazes by one player less than
 *     chainGapSec apart chain; each graze in a chain is semitoneStep higher (the first +0), capped at maxSemitones; a
 *     longer gap resets it. Several grazes on one frame make one cue at the chain's final step; minIntervalSec apart
 *     at least (a skipped frame still climbs).
 *   - Parry groups (GPD5): one group per player per guard = erases within the sword's guard window
 *     (SWORD_DATA.guardTicks) of the group's first erase tick. On the frame a group starts: one parry cue (the view
 *     player's: local; else a teammate's), bigSemitones up when that first frame already erased bigFrom or more; and
 *     the PARRY! flash, which lives flash.sec from the group's start (its count follows later erases of the same guard).
 *   - Parry bursts: per erased bullet, its position and the unit direction away from the guarding player; at most
 *     burstsPerFrame per frame, the rest merged into the nearest kept burst (its weight counts them).
 *   - freezeMs (GPD7): NEAR_MISS_VIEW.freezeMs when a VIEW player's group starts, in a solo run, with freezeFrameOn
 *     (Freeze frame on, not reduced motion); else 0. The caller hands it to the hitstop clock.
 *
 * Gates: `quiet` (the stage cover or run over: comboQuiet) puts nothing out and resets every chain and group. A new
 * run (another state object, or the tick going back) resets everything. Particles off: no sparks or bursts (cues and
 * flashes stay). Reduced motion: the flash has no pop (`pop` is 1). Records of a player outside the party are ignored;
 * a dead player's flash ends.
 *
 * No allocation in steady state: the output and its records are reused frame to frame (per-player state grows once
 * per new player index). Presentation only.
 */
import { SOLO_PARTY_SIZE, SWORD_DATA, partySize, playerAt, type PlayerState, type SimState } from "shared/sim";
import type { JuiceSettings } from "shared/settings";
// Not the shared/view/hud barrel: hud imports this barrel (shared/view/fx), so the barrel would be a require cycle.
// comboConfig only imports shared/sim.
import { semitonesToSpeed } from "../hud/comboConfig";
import { effectiveParticles, freezeFrameOn } from "./juiceRules";
import { NEAR_MISS_VIEW } from "./nearMissConfig";
import type { GrazeRecord, GuardEraseRecord, NearMissFrameSource } from "./nearMissEvents";

/** One graze spark: where the bullet passed closest to the grazer, its unit direction of travel, who grazed. */
export interface GrazeSpark {
	readonly x: number;
	readonly z: number;
	readonly dirX: number;
	readonly dirZ: number;
	readonly player: number;
}

/** One parry burst at an erased bullet: unit direction away from the guarding player; weight = erases merged in. */
export interface ParryBurst {
	readonly x: number;
	readonly z: number;
	readonly dirX: number;
	readonly dirZ: number;
	readonly player: number;
	/** 1 + the erases beyond the frame's cap merged into this burst. */
	readonly weight: number;
}

/** The frame's graze cue (the view player's): sfx.player.graze at this PlaybackSpeed factor. */
export interface GrazeCue {
	/** The chain's shift, semitones (0..maxSemitones). */
	readonly semitones: number;
	/** semitonesToSpeed(semitones). */
	readonly speed: number;
}

/** A parry cue: sfx.player.parry once per guard, on the frame its group starts. */
export interface ParryCue {
	readonly player: number;
	/** The view player's guard (else a teammate's: teammate volume). */
	readonly local: boolean;
	/** 1, or semitonesToSpeed(bigSemitones) when the guard's first frame erased bigFrom or more. */
	readonly speed: number;
}

/** A live PARRY! flash (one per player at most). */
export interface ParryFlash {
	readonly player: number;
	/** Erases in the guard so far. */
	readonly count: number;
	/** The guard started this frame. */
	readonly isNew: boolean;
	/** The count rose this frame (isNew included). */
	readonly grew: boolean;
	/** Seconds since the guard's first erase (0 on its first frame). */
	readonly ageSec: number;
	/** 1 for the view player, flash.teammateScale for a teammate. */
	readonly scale: number;
	/** Pop-in factor (popScale -> 1 over popSec, eased out; 1 afterwards and under reduced motion). */
	readonly pop: number;
	/** Opacity factor (1, then -> 0 over the last fadeSec). The controller multiplies its own cap and duck. */
	readonly fade: number;
	/** count >= flash.countFrom: read "PARRY! xN". */
	readonly showCount: boolean;
	/** The guarding player's current position (sim units); the text sits flash.offsetTiles screen-down from it. */
	readonly x: number;
	readonly z: number;
}

/** What NearMissDirector.frame fills (reused: valid until the next frame call). */
export interface NearMissFrame {
	readonly grazeSparks: ReadonlyArray<GrazeSpark>;
	readonly parryBursts: ReadonlyArray<ParryBurst>;
	/** At most one per frame; undefined when none. */
	readonly grazeCue: GrazeCue | undefined;
	/** One per guard that started this frame (player order). */
	readonly parryCues: ReadonlyArray<ParryCue>;
	/** Every live flash (player order). */
	readonly flashes: ReadonlyArray<ParryFlash>;
	/** Solo freeze to request this frame (0: none). */
	readonly freezeMs: number;
}

/** Fallback spray direction when a bullet has no velocity and sits on the player (never in practice). */
const FALLBACK_DIR_X = 1;
const FALLBACK_DIR_Z = 0;

interface SparkSlot {
	x: number;
	z: number;
	dirX: number;
	dirZ: number;
	player: number;
}

interface BurstSlot extends SparkSlot {
	weight: number;
}

interface CueSlot {
	semitones: number;
	speed: number;
}

interface ParryCueSlot {
	player: number;
	local: boolean;
	speed: number;
}

interface FlashSlot {
	player: number;
	count: number;
	isNew: boolean;
	grew: boolean;
	ageSec: number;
	scale: number;
	pop: number;
	fade: number;
	showCount: boolean;
	x: number;
	z: number;
}

interface FrameSlot {
	readonly grazeSparks: SparkSlot[];
	readonly parryBursts: BurstSlot[];
	grazeCue: CueSlot | undefined;
	readonly parryCues: ParryCueSlot[];
	readonly flashes: FlashSlot[];
	freezeMs: number;
}

/** Per-player state that spans frames. */
interface PlayerTrack {
	/** Graze chain: steps so far (0 = the chain's first graze), the clock of its last graze (undefined: no chain). */
	chainStep: number;
	lastGrazeSec: number | undefined;
	/** Parry group: a guard seen (its first erase tick), its erase count, the clock of its first erase. */
	hasGroup: boolean;
	groupFirstTick: number;
	groupStartSec: number;
	/** The frame id the group started / last grew in. */
	startedFrame: number;
	grewFrame: number;
	/** The PARRY! flash of the group is on screen. */
	flashOn: boolean;
	readonly flash: FlashSlot;
}

function newTrack(player: number): PlayerTrack {
	return {
		chainStep: 0,
		lastGrazeSec: undefined,
		hasGroup: false,
		groupFirstTick: 0,
		groupStartSec: 0,
		startedFrame: -1,
		grewFrame: -1,
		flashOn: false,
		flash: {
			player,
			count: 0,
			isNew: false,
			grew: false,
			ageSec: 0,
			scale: 1,
			pop: 1,
			fade: 1,
			showCount: false,
			x: 0,
			z: 0,
		},
	};
}

function clearTrack(t: PlayerTrack): void {
	t.chainStep = 0;
	t.lastGrazeSec = undefined;
	t.hasGroup = false;
	t.flashOn = false;
	t.flash.count = 0;
}

/**
 * The closest point to (px, pz) of the bullet's path through (bx, bz) with velocity (vx, vz), never ahead of the bullet
 * (the line's parameter clamped to <= 0: the bullet has already passed it), written to `out` with the unit direction of
 * travel. No velocity: the bullet's position, and the direction away from the point (else FALLBACK_DIR).
 */
export function grazeClosestPoint(
	bx: number,
	bz: number,
	vx: number,
	vz: number,
	px: number,
	pz: number,
	out: { x: number; z: number; dirX: number; dirZ: number },
): void {
	const vv = vx * vx + vz * vz;
	if (vv > 0) {
		let t = ((px - bx) * vx + (pz - bz) * vz) / vv;
		if (t > 0) t = 0;
		out.x = bx + t * vx;
		out.z = bz + t * vz;
		const len = math.sqrt(vv);
		out.dirX = vx / len;
		out.dirZ = vz / len;
		return;
	}
	out.x = bx;
	out.z = bz;
	awayFrom(bx, bz, px, pz, FALLBACK_DIR_X, FALLBACK_DIR_Z, out);
}

/** The unit direction from (fromX, fromZ) to (x, z), or (fbX, fbZ) when they coincide, into out.dirX / dirZ. */
function awayFrom(
	x: number,
	z: number,
	fromX: number,
	fromZ: number,
	fbX: number,
	fbZ: number,
	out: { dirX: number; dirZ: number },
): void {
	const dx = x - fromX;
	const dz = z - fromZ;
	const len = math.sqrt(dx * dx + dz * dz);
	if (len > 0) {
		out.dirX = dx / len;
		out.dirZ = dz / len;
	} else {
		out.dirX = fbX;
		out.dirZ = fbZ;
	}
}

/** The graze chain's shift after `step` chained grazes (0 for the first), semitones. */
export function grazeChainSemitones(step: number): number {
	const g = NEAR_MISS_VIEW.graze;
	return math.min(step * g.semitoneStep, g.maxSemitones);
}

/** sfx.player.parry's PlaybackSpeed factor for a guard whose first frame erased `firstFrameErases` bullets. */
export function parryCueSpeed(firstFrameErases: number): number {
	const p = NEAR_MISS_VIEW.parry;
	return firstFrameErases >= p.bigFrom ? semitonesToSpeed(p.bigSemitones) : 1;
}

/** The flash's pop-in factor at `ageSec` (1 under reduced motion and after popSec). */
export function parryFlashPop(ageSec: number, reducedMotion: boolean): number {
	const f = NEAR_MISS_VIEW.flash;
	if (reducedMotion || ageSec >= f.popSec) return 1;
	const u = ageSec <= 0 ? 0 : ageSec / f.popSec;
	const eased = 1 - (1 - u) * (1 - u);
	return f.popScale + (1 - f.popScale) * eased;
}

/** The flash's opacity factor at `ageSec`: 1, then linearly to 0 over the last fadeSec of its life. */
export function parryFlashFade(ageSec: number): number {
	const f = NEAR_MISS_VIEW.flash;
	const left = f.sec - ageSec;
	if (left >= f.fadeSec) return 1;
	return left <= 0 ? 0 : left / f.fadeSec;
}

/** The grazes and parries' per-frame director (see the file comment). One per run view consumer. */
export class NearMissDirector {
	/** The last frame's output (also returned by frame()). */
	readonly out: NearMissFrame;

	private readonly slot: FrameSlot = {
		grazeSparks: [],
		parryBursts: [],
		grazeCue: undefined,
		parryCues: [],
		flashes: [],
		freezeMs: 0,
	};
	private readonly sparkPool: SparkSlot[] = [];
	private readonly burstPool: BurstSlot[] = [];
	private readonly parryCuePool: ParryCueSlot[] = [];
	private readonly cue: CueSlot = { semitones: 0, speed: 1 };
	private readonly tracks: PlayerTrack[] = [];
	private lastState: Readonly<SimState> | undefined;
	private lastTick = 0;
	private lastCueSec: number | undefined;
	private frameId = 0;

	constructor() {
		this.out = this.slot;
	}

	/** Forgets every chain, group and flash (a new run; quiet does this too). */
	resetAll(): void {
		for (const t of this.tracks) clearTrack(t);
		this.lastCueSec = undefined;
	}

	/**
	 * One rendered frame, after its ticks. `source`: the frame's grazes / erases (RunView.nearMiss). `viewIndex`: the
	 * view player (SimController.getViewPlayerIndex). `quiet`: comboQuiet(covered, runOver). `clockSec`: a clock in
	 * seconds that only moves forward (real time). Returns `out`.
	 */
	frame(
		source: NearMissFrameSource,
		state: Readonly<SimState>,
		viewIndex: number,
		quiet: boolean,
		settings: Readonly<JuiceSettings>,
		clockSec: number,
	): NearMissFrame {
		this.frameId += 1;
		const out = this.slot;
		out.grazeSparks.clear();
		out.parryBursts.clear();
		out.grazeCue = undefined;
		out.parryCues.clear();
		out.flashes.clear();
		out.freezeMs = 0;

		if (state !== this.lastState || state.tick < this.lastTick) this.resetAll();
		this.lastState = state;
		this.lastTick = state.tick;
		if (quiet) {
			this.resetAll();
			return this.out;
		}

		const n = partySize(state);
		const sparksOn = effectiveParticles(settings) !== "off";
		if (sparksOn) {
			this.grazeSparks(source.grazes, state, n, viewIndex, true);
			this.grazeSparks(source.grazes, state, n, viewIndex, false);
		}
		this.grazeChains(source.grazes, n, viewIndex, clockSec);
		this.parries(source.erases, state, n, clockSec, sparksOn);
		this.cuesAndFlashes(state, n, viewIndex, settings, clockSec);
		return this.out;
	}

	private track(player: number): PlayerTrack {
		while (this.tracks.size() <= player) this.tracks.push(newTrack(this.tracks.size()));
		return this.tracks[player];
	}

	/** One pass of graze sparks: the view player's (`viewPass`) or everyone else's, up to the frame's cap. */
	private grazeSparks(
		grazes: ReadonlyArray<GrazeRecord>,
		state: Readonly<SimState>,
		n: number,
		viewIndex: number,
		viewPass: boolean,
	): void {
		const out = this.slot.grazeSparks;
		const cap = NEAR_MISS_VIEW.graze.sparksPerFrame;
		for (const g of grazes) {
			if (out.size() >= cap) return;
			if (g.player < 0 || g.player >= n || (g.player === viewIndex) !== viewPass) continue;
			const p = playerAt(state, g.player);
			const i = out.size();
			let s = this.sparkPool[i];
			if (s === undefined) {
				s = { x: 0, z: 0, dirX: 0, dirZ: 0, player: 0 };
				this.sparkPool.push(s);
			}
			grazeClosestPoint(g.x, g.z, g.vx, g.vz, p.x, p.z, s);
			s.player = g.player;
			out.push(s);
		}
	}

	/** Steps every grazer's chain; the view player's sets the frame's cue (min interval permitting). */
	private grazeChains(grazes: ReadonlyArray<GrazeRecord>, n: number, viewIndex: number, clockSec: number): void {
		const gap = NEAR_MISS_VIEW.graze.chainGapSec;
		let viewGrazed = false;
		for (const g of grazes) {
			if (g.player < 0 || g.player >= n) continue;
			const t = this.track(g.player);
			if (t.lastGrazeSec !== undefined && clockSec - t.lastGrazeSec < gap) t.chainStep += 1;
			else t.chainStep = 0;
			t.lastGrazeSec = clockSec;
			if (g.player === viewIndex) viewGrazed = true;
		}
		if (!viewGrazed) return;
		const last = this.lastCueSec;
		if (last !== undefined && clockSec - last < NEAR_MISS_VIEW.graze.minIntervalSec) return;
		this.lastCueSec = clockSec;
		const st = grazeChainSemitones(this.track(viewIndex).chainStep);
		this.cue.semitones = st;
		this.cue.speed = semitonesToSpeed(st);
		this.slot.grazeCue = this.cue;
	}

	/** Groups the erases per player and guard; bursts (capped, merged) when sparks are on. */
	private parries(
		erases: ReadonlyArray<GuardEraseRecord>,
		state: Readonly<SimState>,
		n: number,
		clockSec: number,
		sparksOn: boolean,
	): void {
		const window = SWORD_DATA.guardTicks;
		for (const e of erases) {
			if (e.player < 0 || e.player >= n) continue;
			const t = this.track(e.player);
			const tick = e.tick;
			if (!t.hasGroup || tick < t.groupFirstTick || tick - t.groupFirstTick >= window) {
				t.hasGroup = true;
				t.groupFirstTick = tick;
				t.groupStartSec = clockSec;
				t.startedFrame = this.frameId;
				t.flashOn = true;
				t.flash.count = 0;
			}
			t.flash.count += 1;
			t.grewFrame = this.frameId;
			if (sparksOn) this.burst(e, playerAt(state, e.player));
		}
	}

	private burst(e: GuardEraseRecord, guard: Readonly<PlayerState>): void {
		const out = this.slot.parryBursts;
		if (out.size() >= NEAR_MISS_VIEW.parry.burstsPerFrame) {
			let best = out[0];
			let bestD = math.huge;
			for (const b of out) {
				const dx = b.x - e.x;
				const dz = b.z - e.z;
				const d = dx * dx + dz * dz;
				if (d < bestD) {
					bestD = d;
					best = b;
				}
			}
			best.weight += 1;
			return;
		}
		const i = out.size();
		let b = this.burstPool[i];
		if (b === undefined) {
			b = { x: 0, z: 0, dirX: 0, dirZ: 0, player: 0, weight: 0 };
			this.burstPool.push(b);
		}
		b.x = e.x;
		b.z = e.z;
		awayFrom(e.x, e.z, guard.x, guard.z, guard.faceX, guard.faceZ, b);
		b.player = e.player;
		b.weight = 1;
		out.push(b);
	}

	/** The frame's parry cues, the freeze request and every live flash. */
	private cuesAndFlashes(
		state: Readonly<SimState>,
		n: number,
		viewIndex: number,
		settings: Readonly<JuiceSettings>,
		clockSec: number,
	): void {
		const out = this.slot;
		const f = NEAR_MISS_VIEW.flash;
		const last = math.min(n, this.tracks.size()) - 1;
		for (let i = 0; i <= last; i++) {
			const t = this.tracks[i];
			const isView = i === viewIndex;
			if (t.startedFrame === this.frameId) {
				const k = out.parryCues.size();
				let c = this.parryCuePool[k];
				if (c === undefined) {
					c = { player: i, local: isView, speed: 1 };
					this.parryCuePool.push(c);
				}
				c.player = i;
				c.local = isView;
				c.speed = parryCueSpeed(t.flash.count);
				out.parryCues.push(c);
				if (isView && n === SOLO_PARTY_SIZE && freezeFrameOn(settings)) out.freezeMs = NEAR_MISS_VIEW.freezeMs;
			}
			if (!t.flashOn) continue;
			const p = playerAt(state, i);
			const age = clockSec - t.groupStartSec;
			if (p.dead !== 0 || age >= f.sec) {
				t.flashOn = false;
				continue;
			}
			const fl = t.flash;
			fl.isNew = t.startedFrame === this.frameId;
			fl.grew = t.grewFrame === this.frameId;
			fl.ageSec = age < 0 ? 0 : age;
			fl.scale = isView ? 1 : f.teammateScale;
			fl.pop = parryFlashPop(fl.ageSec, settings.reducedMotion);
			fl.fade = parryFlashFade(fl.ageSec);
			fl.showCount = fl.count >= f.countFrom;
			fl.x = p.x;
			fl.z = p.z;
			out.flashes.push(fl);
		}
	}
}

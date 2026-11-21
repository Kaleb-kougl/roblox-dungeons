/**
 * Tunables of the motion half of the game-feel pass (docs/FEEL.md J6 squash & stretch, J7 afterimages). Presentation
 * only: nothing here reaches the sim. Times are effect-clock seconds (the actor renderer's sprite clock: sim seconds of
 * the rendered frames, so they stop with pause and hitstop) except where they ride sim ticks.
 *
 * @module
 */
import { MAX_PARTY_SIZE } from "shared/sim";

/** One squash curve: the peak scale per axis, how long it runs and the share of it spent reaching the peak. */
export interface SquashCurve {
	/** Width / height scale at the peak (1 = as drawn). */
	readonly sx: number;
	readonly sy: number;
	readonly lengthSec: number;
	/** Fraction of lengthSec to reach the peak (0: starts at the peak), then it eases back to 1 x 1. */
	readonly attack: number;
}

/** The spawn pop: uniform scale `from` -> `peak` (an overshoot) -> 1. */
export interface SpawnCurve {
	readonly from: number;
	readonly peak: number;
	readonly lengthSec: number;
	/** Fraction of lengthSec at which `peak` is reached (ease out), then it settles to 1 (smoothstep). */
	readonly peakAt: number;
}

/**
 * The squash and stretch curves, one per SquashKind (roll start and end, hit, death, spawn), and their limits:
 * `maxDeform` and `maxSec` cap every curve, `hitMinSec` rate-limits the hit pop per actor, `bossHits` turns it on for
 * bosses. Scales are multiples of the drawn size (1 = as drawn). Read by squash.ts; the client's actor renderer applies
 * the result to the sprite.
 */
export const FEEL_SQUASH = {
	/** The knight squashes as a roll takes off and as it lands. */
	rollStart: { sx: 1.15, sy: 0.85, lengthSec: 0.09, attack: 0 } as SquashCurve,
	rollEnd: { sx: 1.1, sy: 0.9, lengthSec: 0.08, attack: 0 } as SquashCurve,
	/** An enemy pops when hit. */
	hit: { sx: 1.1, sy: 0.9, lengthSec: 0.07, attack: 0 } as SquashCurve,
	/** An enemy squashes as it falls dead (reaches the peak a little in, so it reads as a slump, not a pop). */
	death: { sx: 1.12, sy: 0.88, lengthSec: 0.1, attack: 0.3 } as SquashCurve,
	/** A runtime spawn grows in with a small overshoot. */
	spawn: { from: 0.6, peak: 1.08, lengthSec: 0.18, peakAt: 0.6 } as SpawnCurve,
	/**
	 * JD4: no axis of a squash (rollStart / rollEnd / hit / death) and no overshoot leaves [1 - maxDeform, 1 + maxDeform],
	 * and no curve runs longer than maxSec. The spawn's start (`from`) is a uniform grow-in, not a deformation.
	 */
	maxDeform: 0.15,
	maxSec: 0.18,
	/** A hit restarts the pop at most this often per actor (a bow stream would otherwise hold it squashed). */
	hitMinSec: 0.12,
	/** Bosses (data.boss) pop on hits too? Off: a 2.5-tile body wobbling under every arrow reads as jitter. */
	bossHits: false,
} as const;

/**
 * The afterimage numbers: how often a rolling knight (or the charging Demon Lord) leaves a ghost (sim ticks), how long
 * each lives and how transparent it starts, how many per source and how many sources, and the client's pool details
 * (depth offset in studs, folder name, transparency write step). Read by afterimage.ts and the client's actor renderer.
 */
export const FEEL_GHOST = {
	/** While rolling (or charging), a ghost every this many sim ticks (the first on the first rolling frame). */
	everyTicks: 4,
	/** Each ghost lives this long, its transparency going from startTransparency to 1. */
	lifeSec: 0.15,
	startTransparency: 0.5,
	/** At most this many alive per source (a player, the Demon Lord); the oldest is reused. */
	perSource: 3,
	/** Sources: one trail per party member, then one for the Demon Lord's brimstone charge. */
	playerTrails: MAX_PARTY_SIZE,
	bossTrails: 1,
	/**
	 * A ghost's billboard sits this much further from the camera than its source's did (studs), so the one recorded on
	 * the current frame never fights the live sprite for depth. Less than SPRITE_VIEW.floorClearanceMarginStuds, so its
	 * lowest row stays above the floor.
	 */
	behindStuds: 0.03,
	/** Folder under the actor folder (KV_Actors) holding the ghost pool. */
	folderName: "Ghosts",
	/** Ghost transparency is written in steps of this size (fewer property writes). */
	transparencyQuantum: 1 / 32,
} as const;

/** Ghosts preallocated by the client: every trail's ring. */
export const GHOST_POOL_SIZE = FEEL_GHOST.perSource * (FEEL_GHOST.playerTrails + FEEL_GHOST.bossTrails);

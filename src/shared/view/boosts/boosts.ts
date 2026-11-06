/**
 * Boost drops on screen (docs/BOOSTS.md B6 / B7): the pure half of the client's BoostDropRenderController,
 * BoostAuraController and the HUD's BoostRow. Plain numbers only, tested headlessly; presentation only (nothing here
 * reaches `step()`). Tunables: BOOST_VIEW (config.ts).
 *
 *   kinds        a sim Boost index -> its theme kind (BOOST_KINDS, the same order: boosts.spec.ts cross-checks them),
 *                its colour role and string keys
 *   DropSlotTracker  diffs the sim's ground slots against the last frame: which slots got a new drop, which lost one
 *   drop look    age / seconds left from state, the bob (its phase, x motionScale), the landing pop, the fade blink
 *                (the art layers on top of it: art.ts)
 *   aura         the concentric discs' radii and lifts, capped under BOOST_VIEW.auraMaxHeightTiles, and their pulse;
 *                the aura art's frame, size (each rank's ring on its disc's radius) and transparency (BAD3)
 *   HUD          the snapshot's boost entries (secondsLeft in tenths, fraction), their equality, the row's blink, the
 *                tutorial's highlight id
 */
import { STUDS_PER_TILE } from "shared/config";
import { NO_BOOST, SIM_HZ, activeBoosts, type ActiveBoost, type GroundDrop, type SimState } from "shared/sim";
import { BOOST_KINDS, boostId, boostStringKey, type BoostKind, type ColorRole } from "shared/theme";
import { BOOST_VIEW } from "./config";

const TAU = 2 * math.pi;
const HALF = 0.5;

// ---------------------------------------------------------------------------------------------
// Kinds

/** A sim Boost index -> its theme kind (BOOST_KINDS[kind]), or undefined for an unknown index (NO_BOOST). */
export function boostKindName(kind: number): BoostKind | undefined {
	return BOOST_KINDS[kind];
}

/** The identity colour role of a sim Boost index (`boost.<kind>`); the first kind's for an unknown index. */
export function boostColorRole(kind: number): ColorRole {
	return boostId(boostKindName(kind) ?? BOOST_KINDS[0]);
}

/** The HUD icon label key of a sim Boost index (`boost.<kind>.icon`). */
export function boostIconKey(kind: number): string {
	return boostStringKey(boostKindName(kind) ?? BOOST_KINDS[0], "icon");
}

// ---------------------------------------------------------------------------------------------
// Ground slots

/**
 * The view's copy of the ground slots it last drew, diffed once per rendered frame. A slot's drop is identified by its
 * kind and landing tick, so a slot freed and refilled between two frames (a pickup and a new drop) reads as both.
 * After `reset()` (run start, floor change, run end) or when the sim's tick went back (a restart), every occupied slot
 * is `landed` and every slot the view had is `cleared`: the owner rebuilds. Lists are in slot order and cleared by
 * every update.
 */
export class DropSlotTracker {
	private readonly kinds = new Array<number>();
	private readonly spawnTicks = new Array<number>();
	private primed = false;
	private lastTick = 0;
	/** Slots whose drop is new this frame (the owner gives them a view). */
	readonly landed = new Array<number>();
	/** Slots whose drop of last frame is gone (taken, faded, freed, replaced: the owner releases its view). */
	readonly cleared = new Array<number>();

	/** Forget the last frame: every slot is cleared and every occupied one landed on the next update. */
	reset(): void {
		this.primed = false;
	}

	/** The kind (Boost index) a slot held at the last update (NO_BOOST: free). */
	kindAt(slot: number): number {
		return this.kinds[slot] ?? NO_BOOST;
	}

	/** Diffs `ground` (shared/sim dropsGround) at sim tick `tick`. */
	update(ground: ReadonlyArray<Readonly<GroundDrop>>, tick: number): void {
		this.landed.clear();
		this.cleared.clear();
		const fresh = !this.primed || tick < this.lastTick;
		this.primed = true;
		this.lastTick = tick;
		const n = math.max(ground.size(), this.kinds.size());
		for (let slot = 0; slot < n; slot++) {
			const g = ground[slot];
			const kind = g !== undefined ? g.kind : NO_BOOST;
			const spawnTick = g !== undefined && kind !== NO_BOOST ? g.spawnTick : 0;
			const had = this.kinds[slot] ?? NO_BOOST;
			const same = !fresh && had === kind && this.spawnTicks[slot] === spawnTick;
			if (had !== NO_BOOST && (fresh || !same)) this.cleared.push(slot);
			if (kind !== NO_BOOST && (fresh || !same)) this.landed.push(slot);
			this.kinds[slot] = kind;
			this.spawnTicks[slot] = spawnTick;
		}
		// Slots past the ground's size (a run with fewer slots) were cleared above; forget them.
		while (this.kinds.size() > ground.size()) {
			this.kinds.pop();
			this.spawnTicks.pop();
		}
	}
}

// ---------------------------------------------------------------------------------------------
// The drop's look

/** Sim seconds since a drop landed (`spawnTick`), at sim tick `tick` + interpolation `alpha`; never negative. */
export function dropAgeSec(tick: number, alpha: number, spawnTick: number): number {
	return math.max(0, (tick + alpha - spawnTick) / SIM_HZ);
}

/** Seconds of ground life a drop has left (its `ticksLeft`; frozen in drafts like the sim's countdown). */
export function dropSecondsLeft(ticksLeft: number): number {
	return math.max(0, ticksLeft) / SIM_HZ;
}

/**
 * The bob's phase `ageSec` after landing: motionScale x (1 - cos(2 pi bobHz t)) / 2, 0 on the floor, 1 at the top
 * (the halo's pulse follows it); 0 under reduced motion (motionScale 0).
 */
export function dropBobPhase(ageSec: number, motion: number): number {
	if (!(motion > 0) || !(ageSec > 0)) return 0;
	return motion * (1 - math.cos(TAU * BOOST_VIEW.bobHz * ageSec)) * HALF;
}

/**
 * The bob, studs above the rest height: bobStuds x dropBobPhase, so it starts on the floor and never dips below it;
 * 0 under reduced motion (motionScale 0).
 */
export function dropBobStuds(ageSec: number, motion: number): number {
	return BOOST_VIEW.bobStuds * dropBobPhase(ageSec, motion);
}

/**
 * The landing pop: the body's scale `ageSec` after it landed, from popFromScale to 1 over popSeconds (ease-out),
 * never above 1 (the height cap holds); 1 under reduced motion and after the pop.
 */
export function dropPopScale(ageSec: number, motion: number): number {
	const v = BOOST_VIEW;
	if (!(motion > 0) || !(ageSec < v.popSeconds) || !(ageSec >= 0)) return 1;
	const t = ageSec / v.popSeconds;
	const ease = 1 - (1 - t) * (1 - t);
	return v.popFromScale + (1 - v.popFromScale) * ease;
}

/**
 * The fade blink, a transparency (0 = opaque) for `secondsLeft` of a drop's ground life or a boost's timer: 0 above
 * BOOST_VIEW.blinkSeconds (and at 0: gone); below it, blinkTransparency in every other blinkPeriodSec (counted from the
 * end, so the last period before it ends is opaque); under reduced motion (motionScale 0) a steady
 * reducedBlinkTransparency instead of the flashing.
 */
export function boostBlinkTransparency(secondsLeft: number, motion: number): number {
	const v = BOOST_VIEW;
	if (!(secondsLeft > 0) || secondsLeft >= v.blinkSeconds) return 0;
	if (!(motion > 0)) return v.reducedBlinkTransparency;
	return math.floor(secondsLeft / v.blinkPeriodSec) % 2 === 1 ? v.blinkTransparency : 0;
}

// ---------------------------------------------------------------------------------------------
// The aura

/** One disc of a player's aura: radius (tiles) and the lift of its centre above the floor (studs). */
export interface AuraDisc {
	readonly radiusTiles: number;
	readonly liftStuds: number;
}

/**
 * Disc `rank` of `count` running boosts (rank 0 = the first running kind in Boost order): innermost and highest, each
 * further one auraRingStepTiles wider and auraStackStuds lower, so every disc shows as a ring round the one above it.
 * The stack is squeezed so its top never passes auraMaxHeightTiles (auraTopStuds).
 */
export function auraDisc(rank: number, count: number): AuraDisc {
	const v = BOOST_VIEW;
	const levels = math.max(count, 1) - 1;
	const room = v.auraMaxHeightTiles * STUDS_PER_TILE - v.auraLiftStuds - v.auraThicknessStuds;
	const step = levels > 0 ? math.min(v.auraStackStuds, math.max(0, room) / levels) : 0;
	const level = math.max(0, levels - rank);
	return {
		radiusTiles: v.auraRadiusTiles + rank * v.auraRingStepTiles,
		liftStuds: v.auraLiftStuds + level * step + v.auraThicknessStuds * HALF,
	};
}

/** The top of a `count`-disc aura above the floor, studs (the highest disc's lift + half its thickness). */
export function auraTopStuds(count: number): number {
	let top = 0;
	for (let rank = 0; rank < count; rank++) {
		top = math.max(top, auraDisc(rank, count).liftStuds + BOOST_VIEW.auraThicknessStuds * HALF);
	}
	return top;
}

/** The pulse shared by the discs and the art: auraPulseAmplitude x motion x sin(TAU x auraPulseHz x simSec). */
function auraPulse(simSec: number, motion: number): number {
	const v = BOOST_VIEW;
	return v.auraPulseAmplitude * motion * math.sin(TAU * v.auraPulseHz * simSec);
}

/** The discs' transparency at sim second `simSec`: auraTransparency, pulsing by auraPulseAmplitude x motionScale. */
export function auraTransparency(simSec: number, motion: number): number {
	const v = BOOST_VIEW;
	if (!(motion > 0)) return v.auraTransparency;
	return v.auraTransparency + auraPulse(simSec, motion);
}

/**
 * Aura art's transparency at sim second `simSec` (docs/BOOST_ART.md BAD3): auraArtTransparency plus the discs' pulse
 * (none under reduced motion), held to [0, 1].
 */
export function auraArtTransparency(simSec: number, motion: number): number {
	const base = BOOST_VIEW.auraArtTransparency;
	if (!(motion > 0)) return base;
	return math.clamp(base + auraPulse(simSec, motion), 0, 1);
}

/**
 * The frame of an aura rank's loop (`frames` at `fps`) at sim second `simSec`: floor(simSec x fps) mod frames, on the
 * pulse's clock (every co-op client draws the same frame); auraArtStillFrame (wrapped) under reduced motion (motion 0).
 */
export function auraArtFrame(simSec: number, fps: number, frames: number, motion: number): number {
	const n = math.max(1, frames);
	if (!(motion > 0)) return BOOST_VIEW.auraArtStillFrame % n;
	return math.floor(math.max(0, simSec) * fps) % n;
}

/**
 * Studs per art pixel of an aura rank whose ring is `ringPx` art px: its ring drawn exactly on the disc's radius
 * (`radiusTiles`, auraDisc), so every rank of the stack keeps the discs' spacing and no art is scaled to fit it.
 */
export function auraArtStudsPerPixel(radiusTiles: number, ringPx: number): number {
	return (radiusTiles * STUDS_PER_TILE) / ringPx;
}

/** An aura rank's flat sprite: the cell's size on the floor and its centre's offset from the ring's centre (studs). */
export interface AuraArtPlacement {
	readonly widthStuds: number;
	readonly depthStuds: number;
	/** The cell's centre from the pivot (the ring's centre), screen right and screen down, studs on the floor. */
	readonly rightStuds: number;
	readonly downStuds: number;
}

/**
 * The flat sprite of a `frameW` x `frameH` cell whose ring centre is (`pivotX`, `pivotY`), at `studsPerPixel`. The art
 * is a circle seen from straight above, so it lies flat unstretched (the camera foreshortens it like the disc).
 */
export function auraArtPlacement(
	frameW: number,
	frameH: number,
	pivotX: number,
	pivotY: number,
	studsPerPixel: number,
): AuraArtPlacement {
	return {
		widthStuds: frameW * studsPerPixel,
		depthStuds: frameH * studsPerPixel,
		rightStuds: (frameW * HALF - pivotX) * studsPerPixel,
		downStuds: (frameH * HALF - pivotY) * studsPerPixel,
	};
}

// ---------------------------------------------------------------------------------------------
// HUD

/** One running boost in the HUD snapshot. */
export interface BoostHudEntry {
	/** Boost index. */
	readonly kind: number;
	/** Seconds left, rounded UP to 1 / BOOST_VIEW.secondsQuantum (tenths): 0.1 until the last tick. */
	readonly secondsLeft: number;
	/** secondsLeft / the boost's full seconds (same quantum, so the bar moves in the same steps), 0..1. */
	readonly fraction: number;
}

/** Ticks -> whole quanta (tenths of a second), rounded up. */
function quanta(ticks: number): number {
	return math.ceil((math.max(0, ticks) * BOOST_VIEW.secondsQuantum) / SIM_HZ);
}

/** A running boost as the HUD shows it (quantised). */
export function boostHudEntry(b: Readonly<ActiveBoost>): BoostHudEntry {
	const left = quanta(b.ticksLeft);
	const total = math.max(quanta(b.totalTicks), 1);
	return {
		kind: b.kind,
		secondsLeft: left / BOOST_VIEW.secondsQuantum,
		fraction: math.min(1, left / total),
	};
}

const NO_ENTRIES: ReadonlyArray<BoostHudEntry> = table.freeze([]);
/** Scratch for activeBoosts (the entries are fresh; this list is not kept). */
const scratch = new Array<ActiveBoost>();

/** Player `playerIndex`'s running boosts in Boost order, quantised for the HUD (empty without drops). */
export function boostHudEntries(state: Readonly<SimState>, playerIndex: number): ReadonlyArray<BoostHudEntry> {
	if (state.drops === undefined) return NO_ENTRIES;
	activeBoosts(state, playerIndex, scratch);
	if (scratch.size() === 0) return NO_ENTRIES;
	const out = new Array<BoostHudEntry>();
	for (const b of scratch) out.push(boostHudEntry(b));
	scratch.clear();
	return out;
}

/** Element-wise equality of two entry lists (the snapshot's change check). */
export function boostEntriesEqual(a: ReadonlyArray<BoostHudEntry>, b: ReadonlyArray<BoostHudEntry>): boolean {
	if (a.size() !== b.size()) return false;
	for (let i = 0; i < a.size(); i++) {
		const x = a[i];
		const y = b[i];
		if (x.kind !== y.kind || x.secondsLeft !== y.secondsLeft || x.fraction !== y.fraction) return false;
	}
	return true;
}

/**
 * True when the tutorial's active highlight is the boost row (BOOST_VIEW.hudHighlight, `"boosts"`). Takes a plain
 * string, so it compiles whether or not shared/tutorial's TutorialHighlight lists the id yet.
 */
export function isBoostsHighlight(highlight: string | undefined): boolean {
	return highlight === BOOST_VIEW.hudHighlight;
}

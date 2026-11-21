/**
 * The vault's look, frame by frame (docs/TREASURE.md TR7): TreasureViewTracker remembers when this vault armed,
 * cracked, unlocked and opened (from the frame's TreasureFrameSource, sim seconds) and turns the live state plus those
 * times into one TreasureLook through the pure timelines (timeline.ts). The client's TreasureRenderController draws the
 * look and acts on its edges (the pop's freeze / shake / burst). Pure, tested headlessly (vault.spec.ts).
 *
 * A vault the view meets mid-way (a spectator's first frame, a restart, the first frame of a floor) or whose events it
 * missed shows its state settled: an unseen crack is already the lower tier, an unseen unlock has no bars, an unseen
 * open is an open chest, with no flash, shards, lines, column or edges. A new vault (another room / slot / centre, or
 * the sim's tick going backwards) forgets every time; events of another vault in the same frame (a floor change) are
 * ignored.
 *
 * @module
 */
import { SIM_HZ, VaultStatus, type SimState } from "shared/sim";
import type { TreasureFrameSource, TreasureOpenedEvent } from "./events";
import {
	NEVER_AGE,
	cageAt,
	chestPopped,
	columnAt,
	crackFlashMix,
	crackLineAt,
	crackShardProgress,
	crackShownTier,
	keptLineAt,
	lidJoltStuds,
	plateAlpha,
	popCrossed,
	sparkleEverySec,
	sparkleSizeScale,
	unlockShown,
	wobbleDegAt,
	type CageLook,
	type ColumnLook,
	type FloorLineLook,
} from "./timeline";
import { TREASURE_VIEW } from "./config";

/** An event time the view never saw: every age from it is NEVER_AGE. */
const UNSEEN = -math.huge;

/** Which floor line shows (the crack's tier name or the unlock's kept line). */
export type TreasureLineKind = "none" | "tier" | "kept";

/** The vault's look this frame. Mutable: the tracker refills one object. */
export interface TreasureLook {
	/** The floor has a vault (status not NONE). Nothing else is meaningful while false. */
	present: boolean;
	status: number;
	/** The chest's centre and facing (sim world units). */
	x: number;
	z: number;
	fx: number;
	fz: number;
	lock: number;
	/** The tier now (after any crack). */
	tier: number;
	// --- the chest
	/** The open art shows (from the pop on). */
	open: boolean;
	/** The lid's jolt, studs up (before the pop). */
	liftStuds: number;
	/** The unlocked chest's wobble, degrees. */
	wobbleDeg: number;
	readonly cage: CageLook;
	// --- the sparkle
	sparkleShown: boolean;
	/** The tier whose floor colour it shows (the lost one for a moment after the crack). */
	sparkleTier: number;
	/** Mix toward white (the crack's flash), 0..1. */
	whiteMix: number;
	sparkleEverySec: number;
	sparkleSize: number;
	/** Reduced motion or Particles off: a still star. */
	sparkleStill: boolean;
	// --- the plate
	plateShown: boolean;
	/** The plate's own opacity 0..1 (before the cap and the duck). */
	plateAlpha: number;
	/** The shards' flight progress 0..1, -1 when none fly. */
	shardU: number;
	/** The lost tier (the shards' colour). */
	shardTier: number;
	// --- the floor line
	lineKind: TreasureLineKind;
	readonly line: FloorLineLook;
	// --- the open
	readonly column: ColumnLook;
	/** The open this view saw (undefined: none, or unseen): the cards and line read it. */
	opened: TreasureOpenedEvent | undefined;
	/** Sim seconds since the open (NEVER_AGE when unseen). */
	openAge: number;
	// --- edges of this update (true on one frame)
	/** A new vault: the controller rebuilds its views. */
	fresh: boolean;
	/** The lid popped this frame: the solo freeze, the shake, the ring burst. */
	popEdge: boolean;
	/** The lock cracked this frame (TR8's snap). */
	crackEdge: boolean;
	/** The bars started to go this frame (TR8's rattle). */
	unlockEdge: boolean;
}

/** A fresh, empty look (no vault). */
export function newTreasureLook(): TreasureLook {
	return {
		present: false,
		status: VaultStatus.NONE,
		x: 0,
		z: 0,
		fx: 0,
		fz: 0,
		lock: 0,
		tier: 0,
		open: false,
		liftStuds: 0,
		wobbleDeg: 0,
		cage: { shown: false, sink: 0, transparency: 0 },
		sparkleShown: false,
		sparkleTier: 0,
		whiteMix: 0,
		sparkleEverySec: 0,
		sparkleSize: 1,
		sparkleStill: false,
		plateShown: false,
		plateAlpha: 0,
		shardU: -1,
		shardTier: 0,
		lineKind: "none",
		line: { alpha: 0, riseTiles: 0 },
		column: { shown: false, height: 0, opacity: 0 },
		opened: undefined,
		openAge: NEVER_AGE,
		fresh: false,
		popEdge: false,
		crackEdge: false,
		unlockEdge: false,
	};
}

/** The presentation settings the look depends on. */
export interface TreasureLookSettings {
	readonly reducedMotion: boolean;
	/** Particles are on (not "off"): the column, the burst, a moving sparkle. */
	readonly particles: boolean;
}

/** See the file comment. */
export class TreasureViewTracker {
	readonly look: TreasureLook = newTreasureLook();
	private primed = false;
	private room = -1;
	private slot = -1;
	private cx = 0;
	private cz = 0;
	private lastTick = 0;
	private lastSimSec = UNSEEN;
	private armSec = UNSEEN;
	private crackSec = UNSEEN;
	private fromTier = 0;
	private unlockSec = UNSEEN;
	private unlockKept = false;
	private openSec = UNSEEN;
	private opened: TreasureOpenedEvent | undefined;

	/** Forget everything: the next update is a new vault (run start, floor change, run end). */
	reset(): void {
		this.primed = false;
	}

	private forget(): void {
		this.armSec = UNSEEN;
		this.crackSec = UNSEEN;
		this.fromTier = 0;
		this.unlockSec = UNSEEN;
		this.unlockKept = false;
		this.openSec = UNSEEN;
		this.opened = undefined;
		this.lastSimSec = UNSEEN;
	}

	/**
	 * One rendered frame: `state` after the frame's ticks, `frame` its vault events, `simSec` the views' sim clock
	 * ((tick + alpha) / SIM_HZ). Returns the look (also `this.look`).
	 */
	update(
		state: Readonly<SimState>,
		frame: TreasureFrameSource,
		simSec: number,
		settings: TreasureLookSettings,
	): TreasureLook {
		const L = this.look;
		L.fresh = false;
		L.popEdge = false;
		L.crackEdge = false;
		L.unlockEdge = false;
		const t = state.treasure;
		if (t === undefined || t.status === VaultStatus.NONE) {
			if (L.present || !this.primed) L.fresh = true;
			L.present = false;
			L.opened = undefined;
			this.primed = true;
			this.room = -1;
			this.slot = -1;
			this.lastTick = state.tick;
			this.forget();
			return L;
		}
		const same =
			this.primed &&
			state.tick >= this.lastTick &&
			t.room === this.room &&
			t.slot === this.slot &&
			t.x === this.cx &&
			t.z === this.cz;
		if (!same) {
			this.forget();
			this.room = t.room;
			this.slot = t.slot;
			this.cx = t.x;
			this.cz = t.z;
			L.fresh = true;
		}
		this.primed = true;
		this.lastTick = state.tick;
		this.applyEvents(frame);

		const reduced = settings.reducedMotion;
		const unlocked = t.status === VaultStatus.UNLOCKED || t.status === VaultStatus.OPENED;
		const isOpened = t.status === VaultStatus.OPENED;
		const armAge = simSec - this.armSec;
		const crackAge = simSec - this.crackSec;
		const unlockAge = simSec - this.unlockSec;
		const openAge = isOpened ? simSec - this.openSec : NEVER_AGE;
		const prevOpenAge = this.lastSimSec - this.openSec;
		const prevUnlockAge = this.lastSimSec - this.unlockSec;

		L.present = true;
		L.status = t.status;
		L.x = t.x;
		L.z = t.z;
		L.fx = t.fx;
		L.fz = t.fz;
		L.lock = t.lock;
		L.tier = t.tier;

		L.open = isOpened && chestPopped(openAge);
		L.liftStuds = isOpened && !L.open ? lidJoltStuds(openAge, reduced) : 0;
		if (unlocked) cageAt(unlockAge, reduced, L.cage);
		else {
			L.cage.shown = true;
			L.cage.sink = 0;
			L.cage.transparency = 0;
		}
		// An unseen unlock still wobbles (anticipation), on any phase: the sim clock past the bars' sink.
		const U = TREASURE_VIEW.unlock;
		const wobbleAge = unlockAge === math.huge ? simSec + U.delaySec + U.sinkSec : unlockAge;
		L.wobbleDeg = t.status === VaultStatus.UNLOCKED ? wobbleDegAt(wobbleAge, reduced) : 0;

		L.sparkleShown = !L.open;
		L.sparkleTier = crackShownTier(crackAge, this.fromTier, t.tier);
		L.whiteMix = crackFlashMix(crackAge);
		L.sparkleEverySec = sparkleEverySec(L.sparkleTier, unlocked);
		L.sparkleSize = sparkleSizeScale(L.sparkleTier);
		L.sparkleStill = reduced || !settings.particles;

		L.shardU = crackShardProgress(crackAge);
		L.shardTier = this.fromTier;
		if (t.status === VaultStatus.ARMED) {
			L.plateAlpha = plateAlpha(armAge, undefined);
		} else if (unlocked && this.unlockKept) {
			L.plateAlpha = plateAlpha(armAge, unlockAge);
		} else {
			L.plateAlpha = 0;
		}
		L.plateShown = L.plateAlpha > 0 || L.shardU >= 0;

		L.lineKind = "none";
		crackLineAt(crackAge, reduced, L.line);
		if (L.line.alpha > 0) L.lineKind = "tier";
		else if (unlocked && this.unlockKept) {
			keptLineAt(unlockAge, reduced, L.line);
			if (L.line.alpha > 0) L.lineKind = "kept";
		}

		columnAt(openAge, settings.particles, reduced, L.column);
		L.opened = isOpened ? this.opened : undefined;
		L.openAge = openAge;

		L.popEdge = isOpened && popCrossed(prevOpenAge, openAge);
		L.unlockEdge = unlocked && !unlockShown(prevUnlockAge) && unlockShown(unlockAge) && unlockAge !== math.huge;
		this.lastSimSec = simSec;
		return L;
	}

	private applyEvents(frame: TreasureFrameSource): void {
		const mine = (e: { room: number; slot: number; x: number; z: number }) =>
			e.room === this.room && e.slot === this.slot && e.x === this.cx && e.z === this.cz;
		for (const e of frame.armed) if (mine(e)) this.armSec = e.tick / SIM_HZ;
		for (const e of frame.cracked) {
			if (!mine(e)) continue;
			this.crackSec = e.tick / SIM_HZ;
			this.fromTier = e.fromTier;
			this.look.crackEdge = true;
		}
		for (const e of frame.unlocked) {
			if (!mine(e)) continue;
			this.unlockSec = e.tick / SIM_HZ;
			this.unlockKept = e.kept !== 0;
		}
		for (const e of frame.opened) {
			if (!mine(e)) continue;
			this.openSec = e.tick / SIM_HZ;
			this.opened = e;
			// An open that is also the unlock's frame: the open says whether it was kept.
			if (this.unlockSec !== UNSEEN) this.unlockKept = e.kept !== 0;
		}
	}
}

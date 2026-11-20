/**
 * Ballista and Siege Bolt on screen, the drawing rules (docs/BUILDS_V2.md BV11c, the bow's client part; Studio
 * checklist 5, 6, 11, 12). BowFx (siegeFx.ts) decides what shows; these place it, so the client controller
 * (SiegeFxController) only turns numbers into parts:
 *
 *   - waveOneSegmentAngle / waveOneChordTiles: a WaveOneRingView (a Ballista ring or back fan, the slam's shock ring)
 *     as `segments` flat chords: a full ring's spread round the whole turn (BuildFxController.drawRing's angles), a
 *     fan's over facing +- halfAngleRad (facing = atan2(dirZ, dirX), sim x / z; studs keep the axes' signs).
 *   - PinHoldMask: per actor slot, true while a Siege Bolt carries that actor (BowFx's pins). The actor renderer holds
 *     a true slot's sprite (frame, facing and clock stay, the hit hold's SpriteView.setHold) on top of the hit
 *     reaction's own hold. Not gated by reduced motion (unlike the hit hold, JD9): the pin is the sim's state (its AI is
 *     masked), and a walk cycle playing while an arrow drags the body would be wrong, not calmer.
 *   - slamNudge: the camera nudge for the frame's slams: SIEGE_DRAW.slamNudge (`stamp`, the Goldling catch's and the
 *     room clear stamp's 1-texel kick down) when the view player slammed, else `none` (a teammate's slam never kicks
 *     your camera; FreezeFrameController.requestNudge applies the Screen shake gate).
 *
 * Pure; no Roblox API; no allocation in steady state. Presentation only.
 *
 * @module
 */
import { MAX_ACTORS } from "shared/sim";
import type { EffectRecord } from "./buildFxEvents";
import { FULL_RING_HALF_ANGLE, type WaveOneRingView } from "./buildsV2Fx";
import type { NudgeKind } from "./freezeRules";
import type { SiegePinView } from "./siegeFx";

/** The bow's drawing tunables (the effect sizes and colours are BUILDS_V2_FX.ballista / .pin / .slam). */
export const SIEGE_DRAW = {
	/** The view player's slam kicks the camera with this nudge (freezeRules NudgeKind; the heavy rank). */
	slamNudge: "stamp" as NudgeKind,
	/** The parts' folder under Workspace. */
	folderName: "KV_SiegeFx",
} as const;

const FULL_TURN = 2 * math.pi;

/** The ring is a full ring (not a fan). */
function fullRing(r: Readonly<WaveOneRingView>): boolean {
	return r.halfAngleRad >= FULL_RING_HALF_ANGLE;
}

/**
 * The centre angle (radians, sim x = cos, z = sin) of chord `i` of `r.segments`: a full ring's (i + 0.5) / n of a turn;
 * a fan's spread evenly over facing - halfAngleRad .. facing + halfAngleRad.
 */
export function waveOneSegmentAngle(r: Readonly<WaveOneRingView>, i: number): number {
	const n = r.segments;
	if (n <= 0) return 0;
	if (fullRing(r)) return (FULL_TURN * (i + 0.5)) / n;
	const facing = math.atan2(r.dirZ, r.dirX);
	const half = math.max(r.halfAngleRad, 0);
	return facing - half + (2 * half * (i + 0.5)) / n;
}

/** One chord's length in tiles at the ring's radius (0 for no segments or no radius). */
export function waveOneChordTiles(r: Readonly<WaveOneRingView>): number {
	const n = r.segments;
	if (n <= 0 || r.radius <= 0) return 0;
	const span = fullRing(r) ? FULL_TURN : 2 * math.max(r.halfAngleRad, 0);
	return 2 * r.radius * math.sin(span / (2 * n));
}

/** Per actor slot: held while a Siege Bolt carries it (see the file comment). One per client. */
export class PinHoldMask {
	/** Slot -> held. Read it (never write it) between updates. */
	readonly held: boolean[];
	private readonly set: number[] = [];

	constructor(private readonly capacity: number = MAX_ACTORS) {
		this.held = [];
		for (let i = 0; i < capacity; i++) this.held.push(false);
	}

	/** This frame's pins (BowFxFrame.pins): exactly their slots are held. */
	update(pins: ReadonlyArray<Pick<SiegePinView, "slot">>): void {
		this.clear();
		for (const p of pins) {
			const s = p.slot;
			if (s < 0 || s >= this.capacity || this.held[s]) continue;
			this.held[s] = true;
			this.set.push(s);
		}
	}

	/** Nothing held (no run, quiet). */
	clear(): void {
		for (const s of this.set) this.held[s] = false;
		this.set.clear();
	}

	/** Slot `slot` is held (false outside the mask). */
	isHeld(slot: number): boolean {
		return slot >= 0 && slot < this.capacity && this.held[slot];
	}
}

/**
 * The camera nudge for the frame's `slams` (BuildFxFrameSource.slams): SIEGE_DRAW.slamNudge when one is the view
 * player's (inside a party of `partySizeNow`), `none` otherwise or while `quiet` (comboQuiet: BowFx's own gate).
 */
export function slamNudge(
	slams: ReadonlyArray<Pick<EffectRecord, "owner">>,
	viewIndex: number,
	partySizeNow: number,
	quiet: boolean,
): NudgeKind {
	if (quiet || viewIndex < 0 || viewIndex >= partySizeNow) return "none";
	for (const r of slams) if (r.owner === viewIndex) return SIEGE_DRAW.slamNudge;
	return "none";
}

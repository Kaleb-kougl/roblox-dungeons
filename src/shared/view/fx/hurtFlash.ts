/**
 * The hurt flash (docs/FEEL.md J2, JD7 / JD11; a Roblox-port feature, no web source): red screen edges (colour role
 * `uiHealth`) when the view player is hit, drawn by the client's HurtFlashController under the HUD. Pure: no clock
 * (callers pass real seconds), no Roblox API; tunables FEEL_HURT (hurtConfig.ts).
 *
 *   look       hurtFlashLook(ageSec, kind, spectating): peak FEEL_HURT.peak[kind], linear fade to clear over fadeSec;
 *              the lethal hit holds its peak for lethalHoldSec, then fades over lethalFadeSec. Spectating (the views
 *              follow a teammate): times spectateScale. NaN / negative ages and "none" are clear.
 *   rate       a flash only starts on a hurt edge (StateWatch.hurtKind), and the sim can not raise another one within
 *              HURT_INVULN_TICKS (45 ticks = 0.75 s), so a player flashes at most SIM_HZ / HURT_INVULN_TICKS = 1.33 Hz
 *              (HURT_FLASH_MAX_HZ), under the 3 Hz photosensitivity guideline. HurtFlash keeps the same spacing in real
 *              time (FEEL_HURT.minIntervalSec) for frames that run several ticks after a hitch.
 *   combine    the low-health pulse (lowHealth.ts) shares the edges: the larger opacity of the two shows, never the sum
 *              (edgeTransparency), so the lethal hold is never dimmed or doubled by the pulse.
 *
 * @module
 */
import { HURT_INVULN_TICKS, SIM_HZ } from "shared/sim";
import { HURT_KINDS, type HurtKind } from "../watch";
import { FEEL_HURT } from "./hurtConfig";

/** Fully clear (GuiObject transparency). */
const CLEAR = 1;

/** The most hurt flashes per second one player can get (the sim's post-hit invulnerability spacing). */
export const HURT_FLASH_MAX_HZ = SIM_HZ / HURT_INVULN_TICKS;

/** Strength order of hurt kinds ("none" 0, then harmless, armor, heart, lethal). */
export function hurtKindRank(kind: HurtKind): number {
	return HURT_KINDS.indexOf(kind);
}

/**
 * The kind to show for a hurt edge, given the frame's summed `playerHits` (LiveRun frameEvents; undefined when the
 * caller has none): a death without any landed hit in the frame (the solo "Leave run" forfeit) is not a lethal hit.
 */
export function hurtKindLanded(kind: HurtKind, framePlayerHits: number | undefined): HurtKind {
	if (kind === "lethal" && framePlayerHits !== undefined && framePlayerHits <= 0) return "none";
	return kind;
}

/** Opacity (0..1) of a flash of `kind` `ageSec` after it started, before the spectate scale. */
function flashOpacity(ageSec: number, kind: HurtKind): number {
	const peak = FEEL_HURT.peak[kind];
	if (!(peak > 0) || !(ageSec >= 0)) return 0;
	let fadeAge = ageSec;
	let fadeSec: number = FEEL_HURT.fadeSec;
	if (kind === "lethal") {
		if (ageSec < FEEL_HURT.lethalHoldSec) return peak;
		fadeAge = ageSec - FEEL_HURT.lethalHoldSec;
		fadeSec = FEEL_HURT.lethalFadeSec;
	}
	if (!(fadeSec > 0) || fadeAge >= fadeSec) return 0;
	return peak * (1 - fadeAge / fadeSec);
}

/** The edge transparency (1 = clear) of a flash of `kind` `ageSec` after it started (see the header). */
export function hurtFlashLook(ageSec: number, kind: HurtKind, spectating: boolean): number {
	const opacity = flashOpacity(ageSec, kind) * (spectating ? FEEL_HURT.spectateScale : 1);
	return opacity > 0 ? CLEAR - opacity : CLEAR;
}

/** The edges' transparency from the flash's and the pulse's: the larger opacity wins (never added). */
export function edgeTransparency(flash: number, pulse: number): number {
	return math.min(flash, pulse, CLEAR);
}

/** Each edge Frame's depth in px for a `viewW` x `viewH` screen: FEEL_HURT.edgeFraction of the short side, >= 1. */
export function hurtEdgeDepthPx(viewW: number, viewH: number): number {
	const short = math.min(viewW, viewH);
	return short > 0 ? math.max(1, math.floor(short * FEEL_HURT.edgeFraction)) : 1;
}

/** A transparency rounded to FEEL_HURT.writeQuantum steps (what the controller writes; 1 stays 1). */
export function quantizeEdgeTransparency(t: number): number {
	if (!(t < CLEAR)) return CLEAR;
	const q = FEEL_HURT.writeQuantum;
	const v = math.round(t / q) * q;
	return v < 0 ? 0 : v;
}

/**
 * One view player's running flash (the client keeps one; clear it when the views switch players or a run starts).
 * start() on each hurt edge; transparency() every frame.
 */
export class HurtFlash {
	/** The running flash's kind ("none": nothing showing). */
	kind: HurtKind = "none";
	/** Real seconds when it started. */
	startSec = 0;
	/** Flashes started (debug, specs). */
	starts = 0;

	/**
	 * A hurt edge of `kind` at `nowSec`. Starts a new flash, unless the running one started less than
	 * FEEL_HURT.minIntervalSec ago: then it only takes the stronger kind (a lethal hit always shows as lethal) and
	 * keeps its start. Returns true when a new flash started.
	 */
	start(kind: HurtKind, nowSec: number): boolean {
		if (kind === "none" || !(nowSec === nowSec)) return false;
		const running = this.kind !== "none";
		if (running && nowSec - this.startSec >= 0 && nowSec - this.startSec < FEEL_HURT.minIntervalSec) {
			if (hurtKindRank(kind) > hurtKindRank(this.kind)) this.kind = kind;
			return false;
		}
		this.kind = kind;
		this.startSec = nowSec;
		this.starts++;
		return true;
	}

	clear(): void {
		this.kind = "none";
	}

	/** The flash's edge transparency at `nowSec` (1 when nothing shows; a finished flash clears itself). */
	transparency(nowSec: number, spectating: boolean): number {
		if (this.kind === "none") return CLEAR;
		const t = hurtFlashLook(nowSec - this.startSec, this.kind, spectating);
		if (t >= CLEAR && nowSec - this.startSec > 0) this.kind = "none";
		return t;
	}
}

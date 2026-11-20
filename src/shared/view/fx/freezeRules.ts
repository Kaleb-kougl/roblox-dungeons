/**
 * Freeze-frame rules (port of project-kaleb-vale src/fx/freeze/rules.ts @ 42897e2): which tracker event asks for how
 * much hitstop / slow motion, and the 1-render-pixel camera nudge (the web build's only "screen shake"). The client's
 * FreezeFrameController applies them to the SimController's hitstop clock; tests apply them to their own.
 *
 * Port change (docs/FEEL.md J3, JD12): a heavy landed hit (FxEvent.heavy, not capped) freezes HEAVY_HIT_FREEZE_MS and
 * kicks the camera 1 texel ("heavy" nudge); the view player getting hurt jolts the camera 2 texels ("hurt" nudge) and,
 * on a heart or lethal hit, freezes FEEL_HURT.freezeMs (applyHurtFreeze); nudge priority death > hurt > phase > heavy
 * (nudgeReplaces); screenShakeOn reads the port's screenShake setting too. Port (docs/ROOM_CLEAR.md RC5): the room clear stamp's
 * 'stamp' nudge (1 texel down, STAMP_NUDGE_MS, the heavy rank).
 *
 * Port change (docs/COMBO.md CB7): a combo break during a fight kicks the camera 1 texel down ("comboBreak" nudge, the
 * heavy nudge's strength and length), ranked above heavy / stamp and below phase / hurt / death; the client's
 * ComboController requests it on the ComboDisplay's `kick` edge (already off under reduced motion or without Screen
 * shake).
 *
 * @module
 */
import type { JuiceSettings } from "shared/settings";
import type { HurtKind } from "../watch";
import type { FxEvent } from "./events";
import { BOSS_DEATH_HITSTOP_MS, type FramePacer, type HitstopClock } from "./hitstop";
import { FEEL_HURT } from "./hurtConfig";
import { screenShakeOn } from "./juiceRules";

/** A regular kill (swarmer, sniper). */
export const KILL_FREEZE_MS = 50;
/** An elite (spawned in an elite room) or a heavy enemy (hpMax >= HEAVY_KILL_HP: bruiser 10, turrets 12). */
export const HEAVY_KILL_FREEZE_MS = 80;
export const HEAVY_KILL_HP = 8;
/** A boss phase change (phase 2, 3; not the fight start 0 -> 1, which already has the intro roar). */
export const BOSS_PHASE_FREEZE_MS = 120;
/** The boss death: the one freeze allowed past MAX_HITSTOP_MS and the rate cap, then slow motion. */
export const BOSS_DEATH_FREEZE_MS = BOSS_DEATH_HITSTOP_MS;
export const BOSS_DEATH_SLOWMO_MS = 500;
export const BOSS_DEATH_SLOWMO_SCALE = 0.3;
/** Port: a heavy landed hit (sword finisher, heavy arrow: FxEvent.heavy) that the damage cap did not absorb. */
export const HEAVY_HIT_FREEZE_MS = 40;

/** The event fields the rules read (FxEvent satisfies it; tests pass plain objects). */
export type FreezeEvent = Pick<FxEvent, "type" | "boss" | "elite" | "hpMax" | "phase" | "heavy" | "capped">;

/** A heavy hit that landed in full (capped hits only flash: no freeze, no kick). */
function heavyHit(e: FreezeEvent): boolean {
	return e.type === "hit" && e.heavy && !e.capped;
}

/** Freeze ms an event asks for (0: none). A boss's own 'killed' is 0: its 'bossDefeated' carries the sequence. */
export function freezeMsFor(e: FreezeEvent): number {
	switch (e.type) {
		case "killed":
			if (e.boss) return 0;
			return e.elite || e.hpMax >= HEAVY_KILL_HP ? HEAVY_KILL_FREEZE_MS : KILL_FREEZE_MS;
		case "bossPhase":
			return e.phase >= 2 ? BOSS_PHASE_FREEZE_MS : 0;
		case "bossDefeated":
			return BOSS_DEATH_FREEZE_MS;
		case "hit":
			return heavyHit(e) ? HEAVY_HIT_FREEZE_MS : 0;
		default:
			return 0;
	}
}

/**
 * Applies one tracker event to `clock`: 'reset' clears it; kills, boss phases and the boss death request their
 * freeze (longest wins and the rate cap are the clock's rules); the boss death also starts the slow-motion ramp.
 * Settings off (freezeFrameOn false) -> the clock ignores the requests. Returns the freeze ms asked for (0 if none).
 */
export function applyFreezeEvent(e: FreezeEvent, clock: HitstopClock, settings: Readonly<JuiceSettings>): number {
	if (e.type === "reset") {
		clock.clear();
		return 0;
	}
	const ms = freezeMsFor(e);
	if (ms <= 0) return 0;
	if (e.type === "bossDefeated") {
		clock.request(ms, settings, { exceedCap: true });
		clock.requestSlowMo(BOSS_DEATH_SLOWMO_MS, BOSS_DEATH_SLOWMO_SCALE, settings);
	} else {
		clock.request(ms, settings);
	}
	return ms;
}

/** Port: freeze ms a hurt edge of the view player asks for (heart / lethal: FEEL_HURT.freezeMs; armor, harmless: 0). */
export function hurtFreezeMsFor(kind: HurtKind): number {
	return kind === "heart" || kind === "lethal" ? FEEL_HURT.freezeMs : 0;
}

/**
 * Port: applies a hurt edge of the view player to `clock` (longest wins, the clamp and the rate cap are the clock's
 * rules; settings off -> ignored). Solo only: the caller skips it in co-op, where the clock never paces the sim
 * (simPacerFor). Returns the freeze ms asked for (0 if none).
 */
export function applyHurtFreeze(kind: HurtKind, clock: HitstopClock, settings: Readonly<JuiceSettings>): number {
	const ms = hurtFreezeMsFor(kind);
	if (ms > 0) clock.request(ms, settings);
	return ms;
}

// ---------------------------------------------------------------------------------------------
// Camera nudge (render-only, whole render pixels; off under reducedMotion or the screenShake setting: screenShakeOn)

export type NudgeKind = "none" | "heavy" | "stamp" | "comboBreak" | "phase" | "hurt" | "death";

/** The heavy-hit kick's length, ms (the combo break's kick reuses it). */
const HEAVY_NUDGE_MS = 50;

/** Port (docs/ROOM_CLEAR.md RC5): the room clear stamp's 1-texel kick down. */
export const STAMP_NUDGE_MS = 60;

/** Nudge length per kind, ms of real time. */
export const NUDGE_MS: Readonly<Record<NudgeKind, number>> = {
	none: 0,
	heavy: HEAVY_NUDGE_MS,
	stamp: STAMP_NUDGE_MS,
	/** docs/COMBO.md CB7: the heavy nudge's length (and strength: nudgeOffset). */
	comboBreak: HEAVY_NUDGE_MS,
	phase: 80,
	hurt: FEEL_HURT.nudgeSteps * FEEL_HURT.nudgeStepMs,
	death: 240,
};
/**
 * Priority: a running nudge is only replaced by one of the same or a higher rank (death > hurt > phase > comboBreak >
 * heavy = stamp).
 */
const NUDGE_RANK: Readonly<Record<NudgeKind, number>> = {
	none: 0,
	heavy: 1,
	stamp: 1,
	comboBreak: 2,
	phase: 3,
	hurt: 4,
	death: 5,
};
/** The death nudge alternates right / left every this many ms. */
const DEATH_NUDGE_STEP_MS = 60;

/** Which nudge an event starts ('none' for most). */
export function nudgeFor(e: FreezeEvent, settings: Readonly<JuiceSettings>): NudgeKind {
	if (!screenShakeOn(settings)) return "none";
	if (e.type === "bossDefeated") return "death";
	if (e.type === "bossPhase" && e.phase >= 2) return "phase";
	if (heavyHit(e)) return "heavy";
	return "none";
}

/** Port: the nudge a hurt edge of the view player starts (every kind jolts, the tutorial's harmless hits too: JD8). */
export function hurtNudgeFor(kind: HurtKind, settings: Readonly<JuiceSettings>): NudgeKind {
	return kind !== "none" && screenShakeOn(settings) ? "hurt" : "none";
}

/**
 * Port: does a new nudge `incoming` replace the running `current` (restarting it)? Never "none"; otherwise when it
 * ranks at least as high, so a weaker nudge never cuts a stronger one short.
 */
export function nudgeReplaces(current: NudgeKind, incoming: NudgeKind): boolean {
	return incoming !== "none" && NUDGE_RANK[incoming] >= NUDGE_RANK[current];
}

export interface NudgeOffset {
	x: number;
	y: number;
}

/**
 * The nudge's offset `elapsedMs` in, in whole render pixels along the camera's right / up axes, written to `out`.
 * phase: one pixel down for the first half. death: right, left, right, left... every 60 ms, then still. Port: heavy
 * and comboBreak: one pixel down throughout; hurt: FEEL_HURT.nudgeTexels right, left, right (one step each of
 * nudgeStepMs).
 */
export function nudgeOffset(kind: NudgeKind, elapsedMs: number, out: NudgeOffset): NudgeOffset {
	out.x = 0;
	out.y = 0;
	if (kind === "none" || !(elapsedMs >= 0) || elapsedMs >= NUDGE_MS[kind]) return out;
	if (kind === "phase") {
		if (elapsedMs < NUDGE_MS.phase / 2) out.y = -1;
	} else if (kind === "heavy" || kind === "stamp" || kind === "comboBreak") {
		out.y = -1;
	} else if (kind === "hurt") {
		const step = math.floor(elapsedMs / FEEL_HURT.nudgeStepMs);
		out.x = step % 2 === 0 ? FEEL_HURT.nudgeTexels : -FEEL_HURT.nudgeTexels;
	} else {
		out.x = math.floor(elapsedMs / DEATH_NUDGE_STEP_MS) % 2 === 0 ? 1 : -1;
	}
	return out;
}

/**
 * The pacer a run's sim loop may use (M4): the hitstop clock for a solo run (hitstop / slow motion pace the sim, as
 * before), NONE for a co-op party (partySize > 1): a lockstep sim is paced by the server's merged frames alone, so
 * hitstop there is view-only (freeze sprites / the camera; never the sim).
 */
export function simPacerFor(partySize: number, clock: HitstopClock): FramePacer | undefined {
	return partySize > 1 ? undefined : clock;
}

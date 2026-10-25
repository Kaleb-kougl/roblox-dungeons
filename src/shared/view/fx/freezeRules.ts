/**
 * Freeze-frame rules (port of project-kaleb-vale src/fx/freeze/rules.ts @ 42897e2): which tracker event asks for how
 * much hitstop / slow motion, and the 1-render-pixel camera nudge (the web build's only "screen shake"). The client's
 * FreezeFrameController applies them to the SimController's hitstop clock; tests apply them to their own.
 */
import type { JuiceSettings } from "shared/settings";
import type { FxEvent } from "./events";
import { BOSS_DEATH_HITSTOP_MS, type FramePacer, type HitstopClock } from "./hitstop";
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

/** The event fields the rules read (FxEvent satisfies it; tests pass plain objects). */
export type FreezeEvent = Pick<FxEvent, "type" | "boss" | "elite" | "hpMax" | "phase">;

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

// ---------------------------------------------------------------------------------------------
// Camera nudge (render-only, 1 render pixel; off under reducedMotion via screenShakeOn)

export type NudgeKind = "none" | "phase" | "death";

/** Nudge length per kind, ms of real time. */
export const NUDGE_MS: Readonly<Record<NudgeKind, number>> = { none: 0, phase: 80, death: 240 };
/** The death nudge alternates right / left every this many ms. */
const DEATH_NUDGE_STEP_MS = 60;

/** Which nudge an event starts ('none' for most). */
export function nudgeFor(e: FreezeEvent, settings: Readonly<JuiceSettings>): NudgeKind {
	if (!screenShakeOn(settings)) return "none";
	if (e.type === "bossDefeated") return "death";
	if (e.type === "bossPhase" && e.phase >= 2) return "phase";
	return "none";
}

export interface NudgeOffset {
	x: number;
	y: number;
}

/**
 * The nudge's offset `elapsedMs` in, in whole render pixels along the camera's right / up axes, written to `out`.
 * phase: one pixel down for the first half. death: right, left, right, left... every 60 ms, then still.
 */
export function nudgeOffset(kind: NudgeKind, elapsedMs: number, out: NudgeOffset): NudgeOffset {
	out.x = 0;
	out.y = 0;
	if (kind === "none" || !(elapsedMs >= 0) || elapsedMs >= NUDGE_MS[kind]) return out;
	if (kind === "phase") {
		if (elapsedMs < NUDGE_MS.phase / 2) out.y = -1;
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

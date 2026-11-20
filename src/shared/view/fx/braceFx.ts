/**
 * Bastion's brace feedback, the pure rules (docs/LEGENDARIES.md LG6). The sim's BuildEvents carry one brace per guard
 * or roll that stopped BASTION_BRACE_BULLETS (bracePlayer / braceKind, collected into BuildFxEvents.braces; the
 * director lists the frame's into BuildFxFrame.braces). What each kind shows:
 *
 *   PIP   (a pip came back): the cracking stone ring (the director), BRACED on the floor, the armor row's pulse, the
 *         `hud.toast.brace` toast and sfx.build.brace.
 *   HEAL  (Stone Heart, no pip missing: half a heart): the stone ring and the heal pulse (the director), BRACED,
 *         `hud.toast.braceHeal` and sfx.build.brace; no armor pulse (no pip changed).
 *   SPENT (nothing to restore): only a faint ring (the director); no text, toast, pulse or sound. Unreachable since
 *         the owner's tuning (the sim no longer pushes SPENT: a brace with nothing to restore is not spent); kept,
 *         harmless, as BraceKind is append only.
 *
 * The floor shout and the armor pulse are the view player's (what the screen follows), the toast the local player's
 * (a personal line, like the progression toasts); the client's BraceFxController applies that. Presentation only.
 *
 * @module
 */
import { BraceKind } from "shared/sim";
import { BRACE_VIEW } from "./braceFxConfig";

/** What one brace shows beyond its ring (braceFeedbackOf). */
export interface BraceFeedback {
	/** BRACED in the floor shout slot. */
	readonly shout: boolean;
	/** The armor row's pulse (a pip came back). */
	readonly pulse: boolean;
	/** sfx.build.brace. */
	readonly sound: boolean;
	/** The toast's string key, or undefined: none. */
	readonly toastKey: string | undefined;
}

const PIP_FEEDBACK: BraceFeedback = table.freeze({
	shout: true,
	pulse: true,
	sound: true,
	toastKey: BRACE_VIEW.strings.toastPip,
});
const HEAL_FEEDBACK: BraceFeedback = table.freeze({
	shout: true,
	pulse: false,
	sound: true,
	toastKey: BRACE_VIEW.strings.toastHeal,
});
const NO_FEEDBACK: BraceFeedback = table.freeze({ shout: false, pulse: false, sound: false, toastKey: undefined });

/** The feedback of a brace of `kind` (BraceKind; SPENT or anything unknown: none). */
export function braceFeedbackOf(kind: number): BraceFeedback {
	if (kind === BraceKind.PIP) return PIP_FEEDBACK;
	if (kind === BraceKind.HEAL) return HEAL_FEEDBACK;
	return NO_FEEDBACK;
}

/** The armor row pulse's stroke at one moment. */
export interface BracePulseLook {
	/** False once the pulse is over (draw nothing). */
	readonly active: boolean;
	readonly thicknessPx: number;
	/** 0 (opaque) -> 1 (gone). */
	readonly transparency: number;
}

const PULSE_OFF: BracePulseLook = table.freeze({ active: false, thicknessPx: 0, transparency: 1 });

/**
 * The armor row's pulse `ageSec` after the brace (negative or past BRACE_VIEW.pulse.sec: off): thickness t0Px -> t1Px
 * eased out (t1Px throughout under reduced motion), transparency 0 -> 1 linearly.
 */
export function bracePulseLook(ageSec: number, reducedMotion: boolean): BracePulseLook {
	const p = BRACE_VIEW.pulse;
	if (ageSec < 0 || ageSec >= p.sec) return PULSE_OFF;
	const u = ageSec / p.sec;
	const eased = 1 - (1 - u) * (1 - u);
	const thicknessPx = reducedMotion ? p.t1Px : p.t0Px + (p.t1Px - p.t0Px) * eased;
	return { active: true, thicknessPx, transparency: u };
}

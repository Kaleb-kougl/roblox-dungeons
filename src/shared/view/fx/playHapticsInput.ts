/**
 * In-run haptics' input builder (docs/HAPTICS.md HP4, Design 2; decisions HPD1, HPD6, HPD7, HPD11): the rules that
 * turn one rendered frame's facts into PlayHapticsDirector's input (playHaptics.ts), so the client's
 * HapticsController only gathers facts. Pure: no Roblox API, no clock; allocation-free per frame (one reused input, one
 * reused parry slot).
 *
 *   device      "pad" while the last-used device is the gamepad and Options > Controls > Gamepad > Vibration is On
 *               (shared/view/menu menuHapticsOn, the menu haptics' gate), "touch" while it is touch and Options >
 *               Controls > Touch > Vibration is On (shared/settings touchHapticsOn); else none (keyboard / mouse, or
 *               the setting Off). A pad on a phone is "pad" (the motor backend finds no motor there: silent, HPD11).
 *   quiet       no run, a menu shown (pause, Options, the party overlay, run over: client selectMenuShown), the run
 *               paused, the local player's boon draft open, the stage cover up (or a held run start), the run over.
 *   spectating  the views follow a teammate (view index != local index): silent (HPD7).
 *   kills       the view player's kills this frame, from the feed that names the killer (HPD1, no sim field):
 *               scored runs: the score pops credited to the view player (ScoreEvents.popPlayer, summed per frame by the
 *               run view's RecapTally, docs/RUN_CONTRIBUTION.md CT2), solo and co-op alike; an unscored solo run (M1
 *               without KV_Scoring): every non-boss tracker `killed` of the frame is the player's; an unscored co-op
 *               run: no feed names the killer, no kill tick (HP4's answer). Heavy: a tracker kill of the frame froze
 *               as a heavy / elite kill (freezeRules freezeMsFor's HEAVY_KILL_FREEZE_MS), counted for the view player
 *               only while every credited kill of the frame is theirs (the tracker does not name killers).
 *   parry       the view player's own guard that started this frame (NearMissFrame.parryCues `local`; a teammate's
 *               never), with its first frame's erases (the guard's flash count).
 *   hurt        the view player's hurt edge (StateWatch.hurtKind, through hurtKindLanded as the flash and freeze read it).
 *   boss        the frame's tracker events, by the freeze rules' own edges: a `bossPhase` whose freeze is asked
 *               (phase >= 2: the phase break, HPD4) and a `bossDefeated` (the death freeze and slow-mo, HPD5).
 */
import type { InputDeviceKind } from "shared/play";
// By file: the shared/settings barrel reaches shared/play, whose run views import this barrel (a require cycle).
import { touchHapticsOn } from "shared/settings/vibration";
// By file, like touchHapticsOn: only the pure gate, not the menu barrel.
import { menuHapticsOn } from "../menu/padFeedback";
import type { HurtKind } from "../watch";
import type { FxEventBuffer } from "./events";
import { HEAVY_KILL_FREEZE_MS, freezeMsFor, type FreezeEvent } from "./freezeRules";
import { HAPTIC_DEBUG, type HapticDevice, type PlayHaptic } from "./hapticsConfig";
import type { NearMissFrame } from "./nearMissRules";
import type { PlayHapticsInput } from "./playHaptics";

/** The play cues' device for the last-used input device and the two vibration settings (undefined: none). */
export function hapticDeviceOf(
	inputDevice: InputDeviceKind,
	padVibration: boolean,
	touchVibration: boolean,
): HapticDevice | undefined {
	if (menuHapticsOn(inputDevice, padVibration)) return "pad";
	if (touchHapticsOn(inputDevice, touchVibration)) return "touch";
	return undefined;
}

/** A tracker `killed` event froze as a heavy / elite kill (the freeze rules' own threshold; never a boss). */
export function isHeavyKill(e: FreezeEvent): boolean {
	return e.type === "killed" && freezeMsFor(e) === HEAVY_KILL_FREEZE_MS;
}

/** What one frame's tracker events hold for haptics (HapticEventScan fills it). */
export interface HapticEventScan {
	/** Non-boss `killed` events. */
	kills: number;
	/** One of them froze as a heavy / elite kill. */
	heavyKill: boolean;
	/** A boss phase break (a `bossPhase` the freeze rules freeze for). */
	bossPhaseBreak: boolean;
	/** A `bossDefeated`. */
	bossDeath: boolean;
}

/** A blank scan (one per controller). */
export function newHapticEventScan(): HapticEventScan {
	return { kills: 0, heavyKill: false, bossPhaseBreak: false, bossDeath: false };
}

/** Reads one frame's tracker events into `out` (reset first). */
export function scanHapticEvents(events: FxEventBuffer, out: HapticEventScan): HapticEventScan {
	out.kills = 0;
	out.heavyKill = false;
	out.bossPhaseBreak = false;
	out.bossDeath = false;
	const n = events.count();
	for (let i = 0; i < n; i++) {
		const e = events.at(i);
		if (e.type === "killed") {
			if (e.boss) continue;
			out.kills += 1;
			if (isHeavyKill(e)) out.heavyKill = true;
		} else if (e.type === "bossPhase") {
			if (freezeMsFor(e) > 0) out.bossPhaseBreak = true;
		} else if (e.type === "bossDefeated") {
			out.bossDeath = true;
		}
	}
	return out;
}

/**
 * The view player's guard that started this frame (`local` parry cue) and its first frame's erases: the guard's new
 * flash's count; without a flash (it died this frame) the cue's pitch says whether it was big (`bigFrom`), else 1.
 * Undefined: no local guard started (a teammate's never counts).
 */
export function localParryCount(frame: Readonly<NearMissFrame>, bigFrom: number): number | undefined {
	for (const cue of frame.parryCues) {
		if (!cue.local) continue;
		for (const f of frame.flashes) {
			if (f.player === cue.player && f.isNew) return math.max(1, f.count);
		}
		return cue.speed !== 1 ? bigFrom : 1;
	}
	return undefined;
}

/** One rendered frame's facts (the client fills one reused object). */
export interface PlayHapticsFacts {
	/** The last-used input device and the two vibration settings. */
	inputDevice: InputDeviceKind;
	padVibration: boolean;
	touchVibration: boolean;
	/** A run exists. */
	inRun: boolean;
	/** A menu is shown (client selectMenuShown: menu screens, panels, the party overlay, a paused or finished run). */
	menuShown: boolean;
	/** The run is paused. */
	paused: boolean;
	/** The local player's boon draft is open. */
	draftOpen: boolean;
	/** The stage cover is up, or a solo run start is held under it. */
	stageCovered: boolean;
	/** The run is over (or the finished tutorial is frozen). */
	runOver: boolean;
	/** The player index the views follow, and this client's own. */
	viewIndex: number;
	localIndex: number;
	/** The run is scored (ScoreEvents and the RecapTally's per-killer kills exist). */
	scored: boolean;
	/** Players in the run. */
	partySize: number;
	/** The frame's tracker events (scanHapticEvents). */
	readonly events: HapticEventScan;
	/** Scored runs: score pops this frame credited to the view player, and to anyone. */
	viewPops: number;
	teamPops: number;
	/** The view player's guard that started this frame (localParryCount; undefined: none). */
	parryCount: number | undefined;
	/** The view player's landed hurt edge this frame ("none": none). */
	hurt: HurtKind;
}

/** Fresh facts: no run, nothing happened. */
export function newPlayHapticsFacts(): PlayHapticsFacts {
	return {
		inputDevice: "keyboard",
		padVibration: false,
		touchVibration: false,
		inRun: false,
		menuShown: false,
		paused: false,
		draftOpen: false,
		stageCovered: false,
		runOver: false,
		viewIndex: 0,
		localIndex: 0,
		scored: false,
		partySize: 1,
		events: newHapticEventScan(),
		viewPops: 0,
		teamPops: 0,
		parryCount: undefined,
		hurt: "none",
	};
}

/** Play cues are quiet for these facts (docs/HAPTICS.md "Quiet"). */
export function playHapticsQuiet(f: Readonly<PlayHapticsFacts>): boolean {
	return !f.inRun || f.menuShown || f.paused || f.draftOpen || f.stageCovered || f.runOver;
}

/** The view player's kills this frame and whether the merged tick is heavy (see the module header's `kills`). */
export function viewKillsOf(f: Readonly<PlayHapticsFacts>): { readonly kills: number; readonly heavy: boolean } {
	return viewKillSlot(f, { kills: 0, heavy: false });
}

function viewKillSlot(f: Readonly<PlayHapticsFacts>, out: { kills: number; heavy: boolean }): typeof out {
	out.kills = 0;
	out.heavy = false;
	if (f.scored) {
		const mine = math.max(0, f.viewPops);
		out.kills = mine;
		out.heavy = mine > 0 && f.events.heavyKill && mine >= f.teamPops;
	} else if (f.partySize <= 1) {
		out.kills = f.events.kills;
		out.heavy = f.events.kills > 0 && f.events.heavyKill;
	}
	return out;
}

interface InputSlot {
	device: HapticDevice | undefined;
	quiet: boolean;
	spectating: boolean;
	viewKills: number;
	viewHeavyKill: boolean;
	parry: { count: number } | undefined;
	hurt: HurtKind | undefined;
	bossPhaseBreak: boolean;
	bossDeath: boolean;
}

/** Builds PlayHapticsDirector's input from a frame's facts into one reused object (read it before the next build). */
export class PlayHapticsInputBuilder {
	private readonly slot: InputSlot = {
		device: undefined,
		quiet: true,
		spectating: false,
		viewKills: 0,
		viewHeavyKill: false,
		parry: undefined,
		hurt: undefined,
		bossPhaseBreak: false,
		bossDeath: false,
	};
	private readonly parrySlot = { count: 0 };
	private readonly kills = { kills: 0, heavy: false };

	/** The director's input for `f`. */
	build(f: Readonly<PlayHapticsFacts>): PlayHapticsInput {
		const s = this.slot;
		s.device = hapticDeviceOf(f.inputDevice, f.padVibration, f.touchVibration);
		s.quiet = playHapticsQuiet(f);
		s.spectating = f.viewIndex !== f.localIndex;
		viewKillSlot(f, this.kills);
		s.viewKills = this.kills.kills;
		s.viewHeavyKill = this.kills.heavy;
		if (f.parryCount !== undefined) {
			this.parrySlot.count = f.parryCount;
			s.parry = this.parrySlot;
		} else {
			s.parry = undefined;
		}
		s.hurt = f.hurt === "none" ? undefined : f.hurt;
		s.bossPhaseBreak = f.events.bossPhaseBreak;
		s.bossDeath = f.events.bossDeath;
		return s;
	}
}

/** What a KV_HapticDebug value asks for. */
export interface HapticDebugMode {
	/** Print every cue played and every drop. */
	readonly print: boolean;
	/** The test cue to fire once (undefined: none). */
	readonly testCue: PlayHaptic | undefined;
}

/**
 * Reads a KV_HapticDebug value: absent, false, 0 or "" is off; any other value prints; an integer 1 ..
 * HAPTIC_DEBUG.testCues.size() also names a test cue.
 */
export function hapticDebugOf(value: unknown): HapticDebugMode {
	if (value === undefined || value === false || value === 0 || value === "") {
		return { print: false, testCue: undefined };
	}
	let testCue: PlayHaptic | undefined;
	if (typeIs(value, "number") && value === math.floor(value)) {
		if (value >= 1 && value <= HAPTIC_DEBUG.testCues.size()) testCue = HAPTIC_DEBUG.testCues[value - 1];
	}
	return { print: true, testCue };
}

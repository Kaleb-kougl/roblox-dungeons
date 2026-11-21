/**
 * In-run haptics' director (docs/HAPTICS.md HP1, Design 1; decisions HPD3, HPD7, HPD9, HPD10): which play cue
 * (hapticsConfig.ts PLAY_HAPTICS) the view player's frame vibrates, if any. Pure: no Roblox API, no clock (callers pass
 * real seconds, never the hitstop clock, so a freeze never stretches a buzz); allocation-free per frame like
 * NearMissDirector (one reused output, pooled drop records). The client's haptics controller builds the input once a
 * frame from the view player's own events (a teammate's kill, parry or hit never reaches it) and plays `out.cue`.
 *
 *   gate       no device (no vibrating device, or its setting Off), quiet (stage cover, run over, pause, a menu on the
 *              pad, a boon draft) or spectating: nothing plays, every candidate drops as "quiet", and the first such
 *              frame after an open one (or a device change) sets `stopAll` once: motors to 0, pending pulses dropped.
 *   ending     the run-over gate is the exception (`ending`: quiet only because the run just ended): on its edge frame
 *              (the frame before was open on the same device) the run-ending cue still plays (the lethal hit, the boss
 *              death that ends an M1 run; any other candidate drops "quiet"), and nothing stops: the cue rings out.
 *              Later run-over frames stay quiet without a stopAll; the run's exit or restart stops the motors.
 *   one cue    at most one cue a frame: the highest PLAY_HAPTICS_PRIORITY candidate; the others drop ("priority").
 *              Kills in one frame merge into one tick (a heavy kill makes it killHeavy); a parry of
 *              PLAY_HAPTICS_RULES.parryBigFrom erases or more is parryBig; hurt harmless / armor -> hurtArmor, heart ->
 *              hurtHeart, lethal -> hurtLethal.
 *   priority   a cue weaker than a played cue still running drops ("priority"); an equal or stronger one replaces it
 *              (the replaced cue's on-time ends there). A hurt within hurtUpgradeWindowSec of the last played hurt plays
 *              only as an upgrade (a stronger kind), like HurtFlash.
 *   kills      only kill ticks drop for the rules: killGapSec since the last played tick ("gap"), killCapPerSec in a
 *              rolling killCapWindowSec ("cap"), and the duty cap ("duty"): the device's on-time (played cue lengths,
 *              gaps included) in the dutyWindowSec that ends with the tick's end stays <= dutyMax of it. Hurt, parry,
 *              stagger and death always play past the gap, cap and duty.
 *
 * touchWaveform turns a phone cue's pulses into FloatCurveKey-ready points (HapticEffect:SetWaveformKeys, ms).
 *
 * @module
 */
import type { HurtKind } from "../watch";
import { pulseEndSec, pulseStartSec, type TouchPulse } from "./haptics";
import {
	PLAY_HAPTICS_PRIORITY,
	PLAY_HAPTICS_RULES,
	playCueSeconds,
	type HapticDevice,
	type PlayHaptic,
} from "./hapticsConfig";

/** One frame of the view player's haptic moments (built by the client; teammates' events never reach it). */
export interface PlayHapticsInput {
	/** The vibrating device ("pad" / "touch"); undefined: none, or its vibration setting is Off. */
	readonly device: HapticDevice | undefined;
	/** Play cues are quiet (stage cover, run over, pause, a menu owning the pad, a boon draft). */
	readonly quiet: boolean;
	/**
	 * Quiet only because the run has ended (run over, the finished tutorial frozen; no pause, draft or cover): the edge
	 * frame's run-ending cue (hurtLethal, bossDeath) still plays and the running cue rings out (see the header).
	 */
	readonly ending: boolean;
	/** The views follow a teammate (HPD7: silent). */
	readonly spectating: boolean;
	/** The view player's kills this frame (they merge into one tick). */
	readonly viewKills: number;
	/** One of those kills was heavy / elite (the merged tick is killHeavy). */
	readonly viewHeavyKill: boolean;
	/** The view player's guard that started this frame (NearMissFrame.parryCues' grouping), with its first erases. */
	readonly parry: { readonly count: number } | undefined;
	/** The view player's hurt edge this frame (StateWatch.hurtKind; "none" / undefined: none). */
	readonly hurt: HurtKind | undefined;
	/** A boss phase break started this frame (its freeze frame; everyone in the fight). */
	readonly bossPhaseBreak: boolean;
	/** The boss died this frame (everyone in the fight). */
	readonly bossDeath: boolean;
}

/** Why a candidate cue did not play (KV_HapticDebug). */
export type PlayHapticDropReason = "gap" | "cap" | "duty" | "priority" | "quiet";

/** One dropped candidate. */
export interface PlayHapticDrop {
	readonly kind: PlayHaptic;
	readonly reason: PlayHapticDropReason;
}

/** A frame's result (one reused object: read it before the next frame). */
export interface PlayHapticsFrame {
	/** The cue to play now (undefined: none). */
	readonly cue: PlayHaptic | undefined;
	/** Zero every motor / stop the phone effect and drop pending pulses (once, on the edge into silence). */
	readonly stopAll: boolean;
	/** Every candidate that did not play this frame. */
	readonly drops: ReadonlyArray<PlayHapticDrop>;
}

interface FrameSlot {
	cue: PlayHaptic | undefined;
	stopAll: boolean;
	drops: PlayHapticDrop[];
}

interface DropSlot {
	kind: PlayHaptic;
	reason: PlayHapticDropReason;
}

/** Float slack for the duty sum (a cap met exactly still plays). */
const DUTY_SLACK_SEC = 1e-9;

/** The hurt cue for a hurt edge (undefined: no hurt). */
export function hurtHapticOf(kind: HurtKind | undefined): PlayHaptic | undefined {
	if (kind === "harmless" || kind === "armor") return "hurtArmor";
	if (kind === "heart") return "hurtHeart";
	if (kind === "lethal") return "hurtLethal";
	return undefined;
}

function isKill(kind: PlayHaptic): boolean {
	return kind === "kill" || kind === "killHeavy";
}

/** A cue that can end the run on its own frame (the lethal hit; the boss death, which ends an M1 run). */
function isRunEnding(kind: PlayHaptic): boolean {
	return kind === "hurtLethal" || kind === "bossDeath";
}

function isHurt(kind: PlayHaptic): boolean {
	return kind === "hurtArmor" || kind === "hurtHeart" || kind === "hurtLethal";
}

/** The ONE in-run haptics director (the client keeps one; reset() on a new run). */
export class PlayHapticsDirector {
	/** The last frame's output (also returned by frame()). */
	readonly out: PlayHapticsFrame;

	private readonly slot: FrameSlot = { cue: undefined, stopAll: false, drops: [] };
	private readonly dropPool: DropSlot[] = [];
	private readonly candidates: PlayHaptic[] = [];
	/** The device the last open frame played on (undefined: the gate was shut). */
	private openDevice: HapticDevice | undefined;
	/** The last played cue while it runs: its priority and real end second (undefined: none running). */
	private runningPriority = 0;
	private runningEndSec: number | undefined;
	/** The last played kill tick's start, and the starts inside the cap window (oldest first). */
	private lastKillSec: number | undefined;
	private readonly killStarts: number[] = [];
	/** The last played hurt. */
	private lastHurtSec: number | undefined;
	private lastHurtPriority = 0;
	/** Every played cue's on interval, oldest first (starts and ends both rise: a replaced cue ends where the next starts). */
	private readonly onStarts: number[] = [];
	private readonly onEnds: number[] = [];

	constructor() {
		this.out = this.slot;
	}

	/** Forgets every running cue and history (a new run; the client stops the motors itself). */
	reset(): void {
		this.openDevice = undefined;
		this.runningEndSec = undefined;
		this.lastKillSec = undefined;
		this.lastHurtSec = undefined;
		this.killStarts.clear();
		this.onStarts.clear();
		this.onEnds.clear();
	}

	/** One rendered frame at real `nowSec` (a clock that only moves forward). Returns `out`. */
	frame(input: PlayHapticsInput, nowSec: number): PlayHapticsFrame {
		const out = this.slot;
		out.cue = undefined;
		out.stopAll = false;
		out.drops.clear();
		this.collect(input);

		const device = input.device;
		if (device === undefined || input.quiet || input.spectating) {
			// The run ended this frame (it was open on this device the frame before): its own last cue still plays.
			const endingEdge = input.ending && !input.spectating && device !== undefined && this.openDevice === device;
			if (this.openDevice !== undefined && !endingEdge) {
				out.stopAll = true;
				this.stopRunning(nowSec);
			}
			this.openDevice = undefined;
			let best: PlayHaptic | undefined;
			for (const kind of this.candidates) {
				if (endingEdge && isRunEnding(kind)) {
					if (best === undefined || PLAY_HAPTICS_PRIORITY[kind] > PLAY_HAPTICS_PRIORITY[best]) best = kind;
				} else {
					this.drop(kind, "quiet");
				}
			}
			if (best === undefined || device === undefined) return out;
			for (const kind of this.candidates) if (kind !== best && isRunEnding(kind)) this.drop(kind, "priority");
			this.tryPlay(best, device, nowSec);
			return out;
		}
		if (this.openDevice !== undefined && this.openDevice !== device) {
			// Another actuator: the old one stops, and its history is not this one's.
			out.stopAll = true;
			this.stopRunning(nowSec);
			this.forgetHistory();
		}
		this.openDevice = device;

		let best: PlayHaptic | undefined;
		for (const kind of this.candidates) {
			if (best === undefined || PLAY_HAPTICS_PRIORITY[kind] > PLAY_HAPTICS_PRIORITY[best]) best = kind;
		}
		if (best === undefined) return out;
		for (const kind of this.candidates) if (kind !== best) this.drop(kind, "priority");
		this.tryPlay(best, device, nowSec);
		return out;
	}

	/** This frame's candidate cues (at most one per moment) into `candidates`. */
	private collect(input: PlayHapticsInput): void {
		const c = this.candidates;
		c.clear();
		if (input.viewKills > 0) c.push(input.viewHeavyKill ? "killHeavy" : "kill");
		if (input.parry !== undefined) {
			c.push(input.parry.count >= PLAY_HAPTICS_RULES.parryBigFrom ? "parryBig" : "parry");
		}
		const hurt = hurtHapticOf(input.hurt);
		if (hurt !== undefined) c.push(hurt);
		if (input.bossPhaseBreak) c.push("stagger");
		if (input.bossDeath) c.push("bossDeath");
	}

	private tryPlay(kind: PlayHaptic, device: HapticDevice, nowSec: number): void {
		const R = PLAY_HAPTICS_RULES;
		const priority = PLAY_HAPTICS_PRIORITY[kind];
		const runningEnd = this.runningEndSec;
		if (runningEnd !== undefined && nowSec < runningEnd && priority < this.runningPriority) {
			this.drop(kind, "priority");
			return;
		}
		if (isHurt(kind) && this.lastHurtSec !== undefined) {
			const since = nowSec - this.lastHurtSec;
			if (since >= 0 && since < R.hurtUpgradeWindowSec && priority <= this.lastHurtPriority) {
				this.drop(kind, "priority");
				return;
			}
		}
		const seconds = playCueSeconds(kind, device);
		if (isKill(kind)) {
			if (this.lastKillSec !== undefined && nowSec - this.lastKillSec < R.killGapSec) {
				this.drop(kind, "gap");
				return;
			}
			const starts = this.killStarts;
			while (starts.size() > 0 && starts[0] <= nowSec - R.killCapWindowSec) starts.remove(0);
			if (starts.size() >= R.killCapPerSec) {
				this.drop(kind, "cap");
				return;
			}
			if (
				this.onTimeBefore(nowSec, nowSec + seconds - R.dutyWindowSec) + seconds >
				R.dutyMax * R.dutyWindowSec + DUTY_SLACK_SEC
			) {
				this.drop(kind, "duty");
				return;
			}
		}
		// Plays: a running cue ends here (replaced).
		this.stopRunning(nowSec);
		this.pruneOnTime(nowSec);
		this.onStarts.push(nowSec);
		this.onEnds.push(nowSec + seconds);
		this.runningPriority = priority;
		this.runningEndSec = nowSec + seconds;
		if (isKill(kind)) {
			this.lastKillSec = nowSec;
			this.killStarts.push(nowSec);
		}
		if (isHurt(kind)) {
			this.lastHurtSec = nowSec;
			this.lastHurtPriority = priority;
		}
		this.slot.cue = kind;
	}

	/** The played on-time between `fromSec` and `nowSec` (later parts of a running cue would be cut by a new cue). */
	private onTimeBefore(nowSec: number, fromSec: number): number {
		let total = 0;
		for (let i = 0; i < this.onStarts.size(); i++) {
			const lo = math.max(this.onStarts[i], fromSec);
			const hi = math.min(this.onEnds[i], nowSec);
			if (hi > lo) total += hi - lo;
		}
		return total;
	}

	/** Drops on intervals no later duty window can reach (ended a whole window ago). */
	private pruneOnTime(nowSec: number): void {
		const limit = nowSec - PLAY_HAPTICS_RULES.dutyWindowSec;
		while (this.onEnds.size() > 0 && this.onEnds[0] <= limit) {
			this.onStarts.remove(0);
			this.onEnds.remove(0);
		}
	}

	/** The running cue (if any) ends at `nowSec`: its on-time is cut there. */
	private stopRunning(nowSec: number): void {
		const endSec = this.runningEndSec;
		this.runningEndSec = undefined;
		if (endSec === undefined || !(endSec > nowSec)) return;
		const last = this.onEnds.size() - 1;
		if (last >= 0 && this.onEnds[last] > nowSec) this.onEnds[last] = math.max(nowSec, this.onStarts[last]);
	}

	private forgetHistory(): void {
		this.lastKillSec = undefined;
		this.lastHurtSec = undefined;
		this.killStarts.clear();
		this.onStarts.clear();
		this.onEnds.clear();
	}

	private drop(kind: PlayHaptic, reason: PlayHapticDropReason): void {
		const drops = this.slot.drops;
		const i = drops.size();
		let d = this.dropPool[i];
		if (d === undefined) {
			d = { kind, reason };
			this.dropPool.push(d);
		} else {
			d.kind = kind;
			d.reason = reason;
		}
		drops.push(d);
	}
}

/** FloatCurveKey interpolation of a waveform point (Enum.KeyInterpolationMode names). */
export type HapticWaveInterp = "Constant" | "Linear";

/** One waveform point: from `tMs` the actuator runs at `value` (Constant: held to the next point; Linear: toward it). */
export interface HapticWavePoint {
	readonly tMs: number;
	readonly value: number;
	readonly interp: HapticWaveInterp;
}

/** Milliseconds per second (waveform times). */
const MS_PER_SEC = 1000;

/**
 * A phone cue's pulses (PLAY_HAPTICS[kind].touch) as FloatCurveKey-ready points for HapticEffect:SetWaveformKeys:
 * integer ms in rising order, step edges Constant, ramps Linear, ending at 0 (a leading 0 when the first pulse starts
 * late; a pulse that starts where the previous one ends replaces that end point). Pulses must not overlap (one
 * actuator). Called once per cue when the effects are built (allocates).
 */
export function touchWaveform(pulses: ReadonlyArray<TouchPulse>): ReadonlyArray<HapticWavePoint> {
	const sorted = new Array<TouchPulse>();
	for (const p of pulses) sorted.push(p);
	sorted.sort((a, b) => pulseStartSec(a) < pulseStartSec(b));
	const out = new Array<HapticWavePoint>();
	for (const p of sorted) {
		const a = math.round(pulseStartSec(p) * MS_PER_SEC);
		const b = math.round(pulseEndSec(p) * MS_PER_SEC);
		if (b <= a) continue;
		const strength = math.clamp(p.strength, 0, 1);
		const n = out.size();
		if (n === 0 && a > 0) out.push({ tMs: 0, value: 0, interp: "Constant" });
		else if (n > 0 && out[n - 1].tMs === a && out[n - 1].value === 0) out.pop();
		if (p.toStrength === undefined) {
			out.push({ tMs: a, value: strength, interp: "Constant" });
		} else {
			const to = math.clamp(p.toStrength, 0, 1);
			out.push({ tMs: a, value: strength, interp: "Linear" });
			// A ramp that ends above 0 lands on its value 1 ms before the end, then drops.
			if (to > 0 && b - 1 > a) out.push({ tMs: b - 1, value: to, interp: "Constant" });
		}
		out.push({ tMs: b, value: 0, interp: "Constant" });
	}
	return out;
}

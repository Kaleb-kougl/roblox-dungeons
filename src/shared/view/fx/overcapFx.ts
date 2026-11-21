/**
 * Happy Hour's toast and pop tint, and the overcap pops, the pure rules (docs/BUILDS_V2.md Architecture 6, BV11; Studio
 * checklist 10, 12).
 *
 * HappyHourFx (once per rendered frame after the ticks):
 *   - `toast`: the local player's drink started (or restarted) Happy Hour this frame (a `happyHours` record of theirs):
 *     the client shows `hud.toast.happyHour` (BUILDS_V2_FX.happyHour.toast). A teammate's drink shows nothing (a
 *     personal line, like the brace's toast).
 *   - The window: per player, from their latest drink's tick for the sim's HAPPY_HOUR_TICKS (ticks t with start <= t <
 *     start + HAPPY_HOUR_TICKS: the drink tick's kills and the next 299 ticks', as the sim pays them; BV7). Derived from
 *     the events only, never from the hashed `happyHourTicks`. Known limit: a draft that freezes the sim's timer
 *     (Greed's, or the floor's boon draft) while state.tick runs ends the view's window early by the frozen ticks.
 *   - happyPopTone: a KILL pop of a frame inside the VIEW player's window is ScorePopTone.HAPPY (tinted
 *     happyHour.popRole); Gold Rush and Horde pops keep their own tone. Score pops carry no killer (the sim's popX
 *     feed has no player), so in co-op a teammate's kill pops are tinted too while your Happy Hour runs: the tint says
 *     "your Happy Hour is on". Solo it is exact.
 *
 * OvercapPops (once per rendered frame after the ticks): the frame's `overcaps` (one per paying hit on a capped boss)
 * merged into "+N" pops: a payout within OVERCAP_POP_MERGE_SEC (sim time, by its tick) of a live pop's first payout and
 * within overcap.mergeTiles of it adds its points to that pop (the newest such pop); else it starts a new pop where it
 * landed, at most overcap.maxAlive (the oldest goes first). A pop lives SCORE_POP_LIFE of sim time from its first
 * payout (the score pops' life, alpha and rise: scorePopAlpha, overcapPopRise), `version` grows when its points do (the
 * client rebuilds the label only then), `mine` when the view player paid any of it. Shape rule (BUILDS_V2_FX.overcap):
 * a bare "+N" number at the kill pops' glyph scale over the boss, never the parry gold's PARRY! word on the floor.
 *
 * Gates: `quiet` (comboQuiet) puts nothing out and forgets the pops (the windows are kept: a drink is never under the
 * cover, and a run over ends the run); a new run (another state object, or the tick going back) forgets everything.
 * Records of a player outside the party are ignored. No allocation in steady state. Presentation only.
 *
 * @module
 */
import { HAPPY_HOUR_TICKS, SIM_HZ, partySize, type SimState } from "shared/sim";
import type { BuildFxFrameSource } from "./buildFxEvents";
import { BUILDS_V2_FX, OVERCAP_POP_MERGE_SEC } from "./buildsV2FxConfig";
import { waveOneAgeSec } from "./buildsV2Fx";
import { SCORE_POP_LIFE, ScorePopTone, scorePopRise } from "./scorePops";

/** OVERCAP_POP_MERGE_SEC in sim ticks (15). */
export const OVERCAP_POP_MERGE_TICKS = math.round(OVERCAP_POP_MERGE_SEC * SIM_HZ);

/** Player is in a Happy Hour window started on `startTick` at tick `tick` (start <= tick < start + HAPPY_HOUR_TICKS). */
export function happyHourOn(startTick: number | undefined, tick: number): boolean {
	return startTick !== undefined && tick >= startTick && tick < startTick + HAPPY_HOUR_TICKS;
}

/** A kill pop's tone while `happy`: KILL -> HAPPY; Gold Rush and Horde keep theirs. */
export function happyPopTone(tone: ScorePopTone, happy: boolean): ScorePopTone {
	return happy && tone === ScorePopTone.KILL ? ScorePopTone.HAPPY : tone;
}

/** Happy Hour's toast and window (see the file comment). One per client. */
export class HappyHourFx {
	/** The local player's drink started Happy Hour this frame (show the toast). */
	toast = false;
	/** Per player: the latest drink's tick (undefined: none this run). */
	private readonly startTick = new Map<number, number>();
	private lastState: Readonly<SimState> | undefined;
	private lastTick = 0;

	/** Forgets every window. */
	resetAll(): void {
		this.startTick.clear();
		this.toast = false;
	}

	/**
	 * One rendered frame, after its ticks: `localIndex` the local player (the toast's), `quiet` comboQuiet(covered,
	 * runOver). Returns whether to show the toast this frame.
	 */
	frame(source: BuildFxFrameSource, state: Readonly<SimState>, localIndex: number, quiet: boolean): boolean {
		this.toast = false;
		if (state !== this.lastState || state.tick < this.lastTick) this.resetAll();
		this.lastState = state;
		this.lastTick = state.tick;
		const n = partySize(state);
		for (const r of source.happyHours) {
			if (r.player < 0 || r.player >= n) continue;
			this.startTick.set(r.player, r.tick);
			if (r.player === localIndex && !quiet) this.toast = true;
		}
		return this.toast;
	}

	/** Player `player`'s Happy Hour runs at tick `tick`. */
	isOn(player: number, tick: number): boolean {
		return happyHourOn(this.startTick.get(player), tick);
	}

	/** Ticks of player `player`'s Happy Hour left at tick `tick` (0: off). */
	ticksLeft(player: number, tick: number): number {
		const s = this.startTick.get(player);
		return s !== undefined && happyHourOn(s, tick) ? s + HAPPY_HOUR_TICKS - tick : 0;
	}
}

/** One live overcap pop. */
export interface OvercapPopView {
	/** Where its first payout landed (the boss; sim units). */
	readonly x: number;
	readonly z: number;
	/** "+N": every merged payout's points. */
	readonly points: number;
	readonly firstTick: number;
	readonly lastTick: number;
	/** Sim seconds since its first payout. */
	readonly ageSec: number;
	/** Grows whenever `points` does (rebuild the label then). */
	readonly version: number;
	/** The view player paid some of it (else a teammate's pop: teammateOpacity). */
	readonly mine: boolean;
}

interface PopSlot {
	x: number;
	z: number;
	points: number;
	firstTick: number;
	lastTick: number;
	ageSec: number;
	version: number;
	mine: boolean;
}

/** The overcap pop's rise, whole render px at `ageSec`: the score pops' rise x overcap.riseShare (0: reduced motion). */
export function overcapPopRise(ageSec: number, motion: number): number {
	return math.round(scorePopRise(ageSec, motion) * BUILDS_V2_FX.overcap.riseShare);
}

/** The overcap pops' merger (see the file comment). One per client. */
export class OvercapPops {
	readonly pops: ReadonlyArray<OvercapPopView>;
	private readonly live: PopSlot[] = [];
	private readonly free: PopSlot[] = [];
	private lastState: Readonly<SimState> | undefined;
	private lastTick = 0;

	constructor() {
		this.pops = this.live;
	}

	/** Forgets every pop. */
	resetAll(): void {
		for (const p of this.live) this.free.push(p);
		this.live.clear();
	}

	/** One rendered frame, after its ticks (the arguments as CounterWaveFx.frame's, no settings). Returns the pops. */
	frame(
		source: BuildFxFrameSource,
		state: Readonly<SimState>,
		viewIndex: number,
		quiet: boolean,
		alpha: number,
	): ReadonlyArray<OvercapPopView> {
		if (state !== this.lastState || state.tick < this.lastTick) this.resetAll();
		this.lastState = state;
		this.lastTick = state.tick;
		if (quiet) {
			this.resetAll();
			return this.pops;
		}
		const n = partySize(state);
		const o = BUILDS_V2_FX.overcap;
		const r2 = o.mergeTiles * o.mergeTiles;
		for (const r of source.overcaps) {
			if (r.owner < 0 || r.owner >= n) continue;
			let into: PopSlot | undefined;
			for (let k = this.live.size() - 1; k >= 0; k--) {
				const p = this.live[k];
				const dx = r.x - p.x;
				const dz = r.z - p.z;
				if (
					r.tick - p.firstTick < OVERCAP_POP_MERGE_TICKS &&
					r.tick >= p.firstTick &&
					dx * dx + dz * dz <= r2
				) {
					into = p;
					break;
				}
			}
			if (into === undefined) {
				if (this.live.size() >= o.maxAlive) this.free.push(this.live.remove(0)!);
				const p = this.free.pop() ?? {
					x: 0,
					z: 0,
					points: 0,
					firstTick: 0,
					lastTick: 0,
					ageSec: 0,
					version: 0,
					mine: false,
				};
				p.x = r.x;
				p.z = r.z;
				p.points = 0;
				p.firstTick = r.tick;
				p.version = 0;
				p.mine = false;
				this.live.push(p);
				into = p;
			}
			into.points += r.amount;
			into.lastTick = r.tick;
			into.version += 1;
			if (r.owner === viewIndex) into.mine = true;
		}
		let w = 0;
		const total = this.live.size();
		for (let k = 0; k < total; k++) {
			const p = this.live[k];
			const age = waveOneAgeSec(p.firstTick, state.tick, alpha);
			if (age >= SCORE_POP_LIFE) {
				this.free.push(p);
				continue;
			}
			p.ageSec = age;
			this.live[w] = p;
			w++;
		}
		while (this.live.size() > w) this.live.pop();
		return this.pops;
	}
}

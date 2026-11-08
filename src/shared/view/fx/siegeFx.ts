/**
 * Ballista and Siege Bolt, the pure rules (docs/BUILDS_V2.md Architecture 6, BV11; Studio checklist 5, 6, 11, 12).
 * BowFx turns the frame's `ballistas`, `pinStarts`, `pinEnds` and `slams` (BuildFxFrameSource) into what the client
 * draws, once per rendered frame after the ticks:
 *
 *   - Ballista bursts: one flash per record (WaveOneRings): the last pierce's ring (kind 0, ballista.ring, round the
 *     struck enemy) or a wall's back fan (kind 1, ballista.fan, a fan of fanHalfAngleRad about the record's facing guess
 *     toward the archer; a full ring when the guess is 0 / 0). Full and Reduced (Reduced: buildFxCount's segments).
 *   - Pins (`pins`): one SiegePinView per actor slot a Siege Bolt carries: the actor slot, its archer, since which tick,
 *     where it was pinned. Built from the frame's pinStart / pinEnd records in tick order (a start before an end of
 *     the same tick), then held to the sim's carrying records (state.builds.pins, slot >= 0: the current state, read
 *     once a frame), so a pin the sim dropped without an event (a departed archer, the floor change) ends too. The
 *     client holds that actor's animation (the sprite hold) and draws the drag streak (pinStreak: from the pin's start
 *     toward the body, at most pin.streakTiles; Reduced thinner).
 *   - Slams: a shock ring out to the sim's SIEGE_SHOCK_RADIUS (Full only: Reduced drops it, Architecture 6), and for
 *     the view player's slam the solo freeze (slamFreezeMs: slam.freezeMs, the Goldling catch's, solo with
 *     freezeFrameOn; the hitstop clock applies its own gates again).
 *   - Floor text (`shout`): PINNED for a pin the view player started this frame, SLAM for their slam; one request a
 *     frame, the latest tick's (SLAM over PINNED on a tie), at FLOOR_SHOUT_PRIORITY.pinned / .slam.
 *
 * Gates: `quiet` (comboQuiet) puts nothing out and forgets everything; a new run (another state object, or the tick
 * going back) too. Records of a player outside the party are ignored. No allocation in steady state. Presentation only.
 */
import { SIEGE_SHOCK_RADIUS, partySize, type SimState } from "shared/sim";
import type { BuildFxLevel, JuiceSettings } from "shared/settings";
import { FLOOR_SHOUT_PRIORITY } from "../hud/dailyRankConfig";
import type { BuildFxSettings } from "./buildFxRules";
import type { BuildFxFrameSource, PinEndRecord, PinStartRecord } from "./buildFxEvents";
import { BUILDS_V2_FX } from "./buildsV2FxConfig";
import { WaveOneRings, waveOneAgeSec, type FloorShoutRequest, type WaveOneRingView } from "./buildsV2Fx";
import { freezeFrameOn } from "./juiceRules";

const SOLO = 1;

/** One actor slot a Siege Bolt carries. */
export interface SiegePinView {
	/** The pinned actor's slot (hold its animation; draw its streak). */
	readonly slot: number;
	readonly owner: number;
	readonly mine: boolean;
	/** The tick the pin started (its record's) and sim seconds since. */
	readonly sinceTick: number;
	readonly ageSec: number;
	/** Where the actor was pinned (sim units): the streak's far end. */
	readonly x0: number;
	readonly z0: number;
}

/** The drag streak's segment (pinStreak's out). */
export interface PinStreak {
	/** False: draw none (the body has not moved streakMinTiles yet). */
	visible: boolean;
	/** From (x1, z1), behind the body, to the body at (x2, z2) (sim units). */
	x1: number;
	z1: number;
	x2: number;
	z2: number;
	widthStuds: number;
}

/** What BowFx.frame fills (reused: valid until the next frame call). */
export interface BowFxFrame {
	/** Ballista flashes and the slams' shock rings. */
	readonly rings: ReadonlyArray<WaveOneRingView>;
	/** Every actor slot a Siege Bolt carries now. */
	readonly pins: ReadonlyArray<SiegePinView>;
	/** PINNED / SLAM for the view player this frame, or undefined. */
	readonly shout: FloorShoutRequest | undefined;
	/** Solo freeze to ask the hitstop clock for this frame (0: none). */
	readonly freezeMs: number;
}

/**
 * The drag streak of a pin started at (x0, z0) whose body is at (x, z) now: from the start toward the body, at most
 * pin.streakTiles long (its far end slides along behind the body), invisible until the body moved streakMinTiles;
 * width by level. Writes `out` and returns it.
 */
export function pinStreak(
	x0: number,
	z0: number,
	x: number,
	z: number,
	level: BuildFxLevel,
	out: PinStreak,
): PinStreak {
	const p = BUILDS_V2_FX.pin;
	const dx = x - x0;
	const dz = z - z0;
	const d = math.sqrt(dx * dx + dz * dz);
	out.x2 = x;
	out.z2 = z;
	out.widthStuds = level === "full" ? p.streakWidthStuds : p.reducedStreakWidthStuds;
	out.visible = d >= p.streakMinTiles;
	const len = math.min(d, p.streakTiles);
	out.x1 = d > 0 ? x - (dx / d) * len : x;
	out.z1 = d > 0 ? z - (dz / d) * len : z;
	return out;
}

/** The slam's solo freeze for a slam by `owner`: slam.freezeMs for the view player's, solo, freezeFrameOn; else 0. */
export function slamFreezeMs(
	owner: number,
	viewIndex: number,
	partySizeNow: number,
	juice: Readonly<JuiceSettings>,
): number {
	return owner === viewIndex && partySizeNow === SOLO && freezeFrameOn(juice) ? BUILDS_V2_FX.slam.freezeMs : 0;
}

function shoutOf(kind: "pinned" | "slam", player: number): FloorShoutRequest {
	const s = kind === "pinned" ? BUILDS_V2_FX.pin.shout : BUILDS_V2_FX.slam.shout;
	return {
		key: s.key,
		vars: undefined,
		role: s.role,
		lifeSec: s.lifeSec,
		priority: kind === "pinned" ? FLOOR_SHOUT_PRIORITY.pinned : FLOOR_SHOUT_PRIORITY.slam,
		player,
	};
}

interface PinSlot {
	slot: number;
	owner: number;
	mine: boolean;
	sinceTick: number;
	ageSec: number;
	x0: number;
	z0: number;
}

interface FrameSlot {
	readonly rings: WaveOneRingView[];
	readonly pins: PinSlot[];
	shout: FloorShoutRequest | undefined;
	freezeMs: number;
}

/** Ballista's and Siege Bolt's per-frame planner (see the file comment). One per client. */
export class BowFx {
	readonly out: BowFxFrame;
	private readonly ringPlanner = new WaveOneRings();
	private readonly slot: FrameSlot;
	private readonly freePins: PinSlot[] = [];
	private lastState: Readonly<SimState> | undefined;
	private lastTick = 0;

	constructor() {
		this.slot = { rings: this.ringPlanner.rings, pins: [], shout: undefined, freezeMs: 0 };
		this.out = this.slot;
	}

	/** Forgets everything (a new run; quiet does this too). */
	resetAll(): void {
		this.ringPlanner.clear();
		for (const p of this.slot.pins) this.freePins.push(p);
		this.slot.pins.clear();
		this.slot.shout = undefined;
		this.slot.freezeMs = 0;
	}

	/**
	 * One rendered frame, after its ticks: `source` the frame's build effects (RunView.builds), `viewIndex` the view
	 * player, `quiet` comboQuiet(covered, runOver), `alpha` the run view's interpolation. Returns `out`.
	 */
	frame(
		source: BuildFxFrameSource,
		state: Readonly<SimState>,
		viewIndex: number,
		quiet: boolean,
		settings: Readonly<BuildFxSettings>,
		alpha: number,
	): BowFxFrame {
		const out = this.slot;
		out.shout = undefined;
		out.freezeMs = 0;
		if (state !== this.lastState || state.tick < this.lastTick) this.resetAll();
		this.lastState = state;
		this.lastTick = state.tick;
		if (quiet) {
			this.resetAll();
			return this.out;
		}
		const n = partySize(state);
		const level = settings.buildFx;
		const b = BUILDS_V2_FX.ballista;
		for (const r of source.ballistas) {
			if (r.owner < 0 || r.owner >= n) continue;
			const fan = r.kind !== 0 && (r.dirX !== 0 || r.dirZ !== 0);
			if (fan) {
				this.ringPlanner.add(
					b.fan,
					r.x,
					r.z,
					r.owner,
					viewIndex,
					r.tick,
					level,
					undefined,
					r.dirX,
					r.dirZ,
					b.fanHalfAngleRad,
				);
			} else this.ringPlanner.add(r.kind !== 0 ? b.fan : b.ring, r.x, r.z, r.owner, viewIndex, r.tick, level);
		}
		let shoutTick = -1;
		for (const r of source.pinStarts) {
			if (r.owner < 0 || r.owner >= n || r.owner !== viewIndex || r.tick < shoutTick) continue;
			shoutTick = r.tick;
			out.shout = shoutOf("pinned", r.owner);
		}
		for (const r of source.slams) {
			if (r.owner < 0 || r.owner >= n) continue;
			if (level === "full") {
				const ring = BUILDS_V2_FX.slam.ring;
				this.ringPlanner.add(ring, r.x, r.z, r.owner, viewIndex, r.tick, level, SIEGE_SHOCK_RADIUS);
			}
			out.freezeMs = math.max(out.freezeMs, slamFreezeMs(r.owner, viewIndex, n, settings.juice));
			if (r.owner === viewIndex && r.tick >= shoutTick) {
				shoutTick = r.tick;
				out.shout = shoutOf("slam", r.owner);
			}
		}
		this.stepPins(source.pinStarts, source.pinEnds, state, n, viewIndex);
		this.ringPlanner.age(state.tick, alpha, settings.juice.reducedMotion);
		for (const p of out.pins) p.ageSec = waveOneAgeSec(p.sinceTick, state.tick, alpha);
		return this.out;
	}

	/** The frame's starts and ends in tick order (a start first on a tie), then the sim's carrying records. */
	private stepPins(
		starts: ReadonlyArray<PinStartRecord>,
		ends: ReadonlyArray<PinEndRecord>,
		state: Readonly<SimState>,
		n: number,
		viewIndex: number,
	): void {
		let i = 0;
		let j = 0;
		while (i < starts.size() || j < ends.size()) {
			const startNext = i < starts.size() && (j >= ends.size() || starts[i].tick <= ends[j].tick);
			if (startNext) {
				const s = starts[i];
				i++;
				if (s.owner < 0 || s.owner >= n) continue;
				this.endPin(s.slot, s.owner); // a stale view of the same slot and archer
				const p = this.freePins.pop() ?? {
					slot: 0,
					owner: 0,
					mine: true,
					sinceTick: 0,
					ageSec: 0,
					x0: 0,
					z0: 0,
				};
				p.slot = s.slot;
				p.owner = s.owner;
				p.mine = s.owner === viewIndex;
				p.sinceTick = s.tick;
				p.ageSec = 0;
				p.x0 = s.x;
				p.z0 = s.z;
				this.slot.pins.push(p);
			} else {
				const e = ends[j];
				j++;
				this.endPin(e.slot, e.owner);
			}
		}
		// Held to the sim's carrying records (a spent record has slot -1).
		const records = state.builds?.pins;
		const pins = this.slot.pins;
		let w = 0;
		const total = pins.size();
		for (let k = 0; k < total; k++) {
			const p = pins[k];
			let carried = false;
			if (records !== undefined)
				for (const r of records) if (r.slot === p.slot && r.owner === p.owner && r.slot >= 0) carried = true;
			if (!carried) {
				this.freePins.push(p);
				continue;
			}
			pins[w] = p;
			w++;
		}
		while (pins.size() > w) pins.pop();
	}

	private endPin(slot: number, owner: number): void {
		const pins = this.slot.pins;
		for (let k = pins.size() - 1; k >= 0; k--) {
			const p = pins[k];
			if (p.slot !== slot || p.owner !== owner) continue;
			this.freePins.push(p);
			pins.remove(k);
		}
	}
}

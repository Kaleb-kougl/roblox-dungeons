/**
 * Full Heart's beam, the pure rules (docs/BUILDS_V2.md Architecture 6, BV11; Studio checklist 11, 12). HeartBeamFx turns
 * the frame's `heartBeams` (BuildFxFrameSource: one per finisher swing or heavy arrow release at full hearts, struck or
 * not) into straight segments, once per rendered frame after the ticks: from the player to the line's end, alive
 * heartBeam.sec of sim time from its record's tick, opaque for `hold` of it, then fading (heartBeamFade); Full
 * widthStuds with a white core, Reduced reducedWidthStuds and no core; a teammate's at teammateOpacity. At most
 * heartBeam.maxAlive (the oldest goes first).
 *
 * Gates: `quiet` (comboQuiet) puts nothing out and forgets every beam; a new run too. Records of a player outside the
 * party are ignored. No allocation in steady state. Presentation only.
 *
 * @module
 */
import { partySize, type SimState } from "shared/sim";
import type { ColorRole } from "shared/theme";
import type { BuildFxSettings } from "./buildFxRules";
import type { BuildFxFrameSource } from "./buildFxEvents";
import { BUILDS_V2_FX } from "./buildsV2FxConfig";
import { waveOneAgeSec } from "./buildsV2Fx";

/** One live Full Heart beam. */
export interface HeartBeamView {
	readonly x1: number;
	readonly z1: number;
	readonly x2: number;
	readonly z2: number;
	readonly owner: number;
	readonly mine: boolean;
	/** Enemies it struck (0: it still shows). */
	readonly struck: number;
	readonly widthStuds: number;
	/** Draw the white core (Full only). */
	readonly core: boolean;
	/** Opacity factor: heartBeamFade x the owner's opacity. */
	readonly fade: number;
	readonly role: ColorRole;
	readonly ageSec: number;
}

/** The beam's opacity at `ageSec` (sim seconds): 1 for `hold` of heartBeam.sec, then linearly to 0. */
export function heartBeamFade(ageSec: number): number {
	const b = BUILDS_V2_FX.heartBeam;
	const holdSec = b.sec * b.hold;
	if (ageSec <= holdSec) return 1;
	if (ageSec >= b.sec) return 0;
	return 1 - (ageSec - holdSec) / (b.sec - holdSec);
}

/** The beam's width at a level, studs. */
export function heartBeamWidth(level: BuildFxSettings["buildFx"]): number {
	const b = BUILDS_V2_FX.heartBeam;
	return level === "full" ? b.widthStuds : b.reducedWidthStuds;
}

interface BeamSlot {
	x1: number;
	z1: number;
	x2: number;
	z2: number;
	owner: number;
	mine: boolean;
	struck: number;
	widthStuds: number;
	core: boolean;
	fade: number;
	role: ColorRole;
	ageSec: number;
	bornTick: number;
}

/** Full Heart's per-frame planner (see the file comment). One per client. */
export class HeartBeamFx {
	readonly beams: ReadonlyArray<HeartBeamView>;
	private readonly live: BeamSlot[] = [];
	private readonly free: BeamSlot[] = [];
	private lastState: Readonly<SimState> | undefined;
	private lastTick = 0;

	constructor() {
		this.beams = this.live;
	}

	/** Forgets every beam (a new run; quiet does this too). */
	resetAll(): void {
		for (const b of this.live) this.free.push(b);
		this.live.clear();
	}

	/** One rendered frame, after its ticks (the arguments as CounterWaveFx.frame's). Returns the live beams. */
	frame(
		source: BuildFxFrameSource,
		state: Readonly<SimState>,
		viewIndex: number,
		quiet: boolean,
		settings: Readonly<BuildFxSettings>,
		alpha: number,
	): ReadonlyArray<HeartBeamView> {
		if (state !== this.lastState || state.tick < this.lastTick) this.resetAll();
		this.lastState = state;
		this.lastTick = state.tick;
		if (quiet) {
			this.resetAll();
			return this.beams;
		}
		const n = partySize(state);
		const cfg = BUILDS_V2_FX.heartBeam;
		for (const r of source.heartBeams) {
			if (r.owner < 0 || r.owner >= n) continue;
			if (this.live.size() >= cfg.maxAlive) this.free.push(this.live.remove(0)!);
			const b =
				this.free.pop() ??
				({
					x1: 0,
					z1: 0,
					x2: 0,
					z2: 0,
					owner: 0,
					mine: true,
					struck: 0,
					widthStuds: 0,
					core: true,
					fade: 1,
					role: cfg.role,
					ageSec: 0,
					bornTick: 0,
				} as BeamSlot);
			b.x1 = r.x1;
			b.z1 = r.z1;
			b.x2 = r.x2;
			b.z2 = r.z2;
			b.owner = r.owner;
			b.mine = r.owner === viewIndex;
			b.struck = r.struck;
			b.bornTick = r.tick;
			this.live.push(b);
		}
		const level = settings.buildFx;
		let w = 0;
		const total = this.live.size();
		for (let k = 0; k < total; k++) {
			const b = this.live[k];
			const age = waveOneAgeSec(b.bornTick, state.tick, alpha);
			if (age >= cfg.sec) {
				this.free.push(b);
				continue;
			}
			this.live[w] = b;
			w++;
			b.ageSec = age;
			b.fade = heartBeamFade(age) * (b.mine ? 1 : BUILDS_V2_FX.teammateOpacity);
			b.widthStuds = heartBeamWidth(level);
			b.core = level === "full";
			b.role = cfg.role;
		}
		while (this.live.size() > w) this.live.pop();
		return this.beams;
	}
}

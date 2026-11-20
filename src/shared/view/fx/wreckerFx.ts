/**
 * Wrecker and Demolition, the pure rules (docs/BUILDS_V2.md Architecture 6, BV11; Studio checklist 7, 11, 12). WreckerFx
 * turns the frame's `smashes` and `demolitions` (BuildFxFrameSource) into what the client draws, once per rendered
 * frame after the ticks:
 *
 *   - A smash pop per smash record (a piece its owner broke: Wrecker's splinters, Powder Keg): smash.ring at the
 *     piece's cell centre (WaveOneRings) and, Full with particles on, a chip burst there (`chips`, at most
 *     smash.chipsPerFrame a frame, the view player's first; Reduced drops the pops' particles, Architecture 6).
 *   - A blast ring per Demolition record: demolition.ring out to the sim's DEMOLITION_RADIUS (Full and Reduced: it is
 *     the chain's reach, the information). A chain goes off one piece a tick, so its rings start a tick apart.
 *   - The smash's sound climbs along a chain: smashSpeed(gen) = buildGenSpeed(the smash's generation), the build
 *     voice's ladder (+2 semitones a generation, capped), applied by the cue mapper (shared/view/audio cues.ts).
 *
 * Gates: `quiet` (comboQuiet) puts nothing out and forgets every ring; a new run too. Records of a player outside the
 * party are ignored. No allocation in steady state. Presentation only.
 *
 * @module
 */
import { DEMOLITION_RADIUS, partySize, type SimState } from "shared/sim";
import type { BuildFxLevel } from "shared/settings";
import { buildGenSemitones, buildGenSpeed, type BuildFxSettings, type SparkBurstView } from "./buildFxRules";
import type { BuildFxFrameSource, EffectRecord } from "./buildFxEvents";
import { BUILDS_V2_FX } from "./buildsV2FxConfig";
import { WaveOneRings, type WaveOneRingView } from "./buildsV2Fx";
import { effectiveParticles } from "./juiceRules";
import type { ChipBurst } from "./particles";
import { burstSeed } from "./rng";

/** What WreckerFx.frame fills (reused: valid until the next frame call). */
export interface WreckerFxFrame {
	/** Smash pops and Demolition blasts. */
	readonly rings: ReadonlyArray<WaveOneRingView>;
	/** This frame's new smash chip bursts (Full, particles on) and their shape. */
	readonly chips: ReadonlyArray<SparkBurstView>;
	readonly chipShape: Readonly<ChipBurst>;
}

/** The smash cue's shift for a smash of generation `gen`, semitones (the build voice's: buildGenSemitones). */
export function smashSemitones(gen: number): number {
	return buildGenSemitones(gen);
}

/** The smash cue's PlaybackSpeed for generation `gen` (buildGenSpeed). */
export function smashSpeed(gen: number): number {
	return buildGenSpeed(gen);
}

/** The smash chips' shape at `level`: Full the smash.chips counts; Reduced none (it drops the pops' particles). */
export function smashChipShape(level: BuildFxLevel): ChipBurst {
	const c = BUILDS_V2_FX.smash.chips;
	const on = level === "full";
	return {
		chunks: on ? c.chunks : 0,
		bits: on ? c.bits : 0,
		sparks: on ? c.sparks : 0,
		startPx: c.startPx,
		radius: c.radius,
		speed: c.speed,
	};
}

const FULL_CHIPS = smashChipShape("full");
const NO_CHIPS = smashChipShape("reduced");

/** The longest chain of `smashes` (the frame's records): its highest generation + 1, 0 without smashes. */
export function smashChainLength(smashes: ReadonlyArray<EffectRecord>): number {
	let n = 0;
	for (const r of smashes) n = math.max(n, r.gen + 1);
	return n;
}

interface ChipSlot {
	x: number;
	z: number;
	owner: number;
	seed: number;
}

interface FrameSlot {
	readonly rings: WaveOneRingView[];
	readonly chips: ChipSlot[];
	chipShape: ChipBurst;
}

/** Wrecker's and Demolition's per-frame planner (see the file comment). One per client. */
export class WreckerFx {
	readonly out: WreckerFxFrame;
	private readonly ringPlanner = new WaveOneRings();
	private readonly slot: FrameSlot;
	private readonly chipPool: ChipSlot[] = [];
	private lastState: Readonly<SimState> | undefined;
	private lastTick = 0;

	constructor() {
		this.slot = { rings: this.ringPlanner.rings, chips: [], chipShape: FULL_CHIPS };
		this.out = this.slot;
	}

	/** Forgets everything (a new run; quiet does this too). */
	resetAll(): void {
		this.ringPlanner.clear();
		this.slot.chips.clear();
	}

	/** One rendered frame, after its ticks (the arguments as CounterWaveFx.frame's). Returns `out`. */
	frame(
		source: BuildFxFrameSource,
		state: Readonly<SimState>,
		viewIndex: number,
		quiet: boolean,
		settings: Readonly<BuildFxSettings>,
		alpha: number,
	): WreckerFxFrame {
		const out = this.slot;
		out.chips.clear();
		if (state !== this.lastState || state.tick < this.lastTick) this.resetAll();
		this.lastState = state;
		this.lastTick = state.tick;
		const level = settings.buildFx;
		out.chipShape = level === "full" ? FULL_CHIPS : NO_CHIPS;
		if (quiet) {
			this.resetAll();
			return this.out;
		}
		const n = partySize(state);
		const sm = BUILDS_V2_FX.smash;
		for (const r of source.smashes) {
			if (r.owner < 0 || r.owner >= n) continue;
			this.ringPlanner.add(sm.ring, r.x, r.z, r.owner, viewIndex, r.tick, level);
		}
		const dm = BUILDS_V2_FX.demolition;
		for (const r of source.demolitions) {
			if (r.owner < 0 || r.owner >= n) continue;
			this.ringPlanner.add(dm.ring, r.x, r.z, r.owner, viewIndex, r.tick, level, DEMOLITION_RADIUS);
		}
		if (level === "full" && effectiveParticles(settings.juice) !== "off") {
			this.addChips(source.smashes, n, viewIndex, true);
			this.addChips(source.smashes, n, viewIndex, false);
		}
		this.ringPlanner.age(state.tick, alpha, settings.juice.reducedMotion);
		return this.out;
	}

	/** One pass of chips: the view player's (`viewPass`) or everyone else's, up to smash.chipsPerFrame. */
	private addChips(records: ReadonlyArray<EffectRecord>, n: number, viewIndex: number, viewPass: boolean): void {
		const out = this.slot.chips;
		const sm = BUILDS_V2_FX.smash;
		for (let i = 0; i < records.size(); i++) {
			if (out.size() >= sm.chipsPerFrame) return;
			const r = records[i];
			if (r.owner < 0 || r.owner >= n || (r.owner === viewIndex) !== viewPass) continue;
			const k = out.size();
			let c = this.chipPool[k];
			if (c === undefined) {
				c = { x: 0, z: 0, owner: 0, seed: 0 };
				this.chipPool.push(c);
			}
			c.x = r.x;
			c.z = r.z;
			c.owner = r.owner;
			c.seed = burstSeed(i, r.tick, sm.seedSalt);
			out.push(c);
		}
	}
}

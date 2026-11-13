/**
 * The Goldling on screen (docs/FORTUNE.md "Player experience -> The Goldling", FO8): the pure rules its views draw from.
 * Every input is hashed sim state or the frame's collected events (events.ts); nothing here writes the sim.
 *
 *   kind          goldenKind / isGoldenKind: its archetype index (the minimap blip, the body flicker, the touch pick).
 *   appear        GoldenAppearQueue: the frame's appearances held GOLDEN_VIEW.appear.afterBreakSec of sim time after
 *                 their release tick, so its piece's break shows first and the coins and GOLDLING! follow
 *                 (docs/GOLDLING_RUMOURS.md GR4).
 *   timer ring    goldenRingLook: how much of the ring is left (ticks left / the config's escapeTicks, whole pieces),
 *                 its pulse and warning colour in the last GOLDEN_VIEW.warn.warnSec (reduced motion: colour only);
 *                 goldenRingSegments lays it clockwise on screen from screen-up into a SegmentSink.
 *   flicker       goldenFlickerTransparency: the body's flicker in the last seconds (none under reduced motion).
 *   hits          goldenHitSpeed: the hit sound's ladder (pelletEatSpeed's approach: one scale step per hit).
 *   caught        goldenCatchFreezeMs (solo, the view player's catch, freezeFrameOn), goldenCatchNudges, the jackpot's
 *                 own pop (jackpotPopMask takes its kill pop out of the kill layer), goldenBoostHopped (the boosts it
 *                 landed hop in like a broken piece's).
 *   text          goldenShoutText / goldenEscapedText (theme strings), goldenDebugText (KV_GoldenLabel, English).
 *   minimap       goldenBlipSlot: the running Goldling's actor slot, or -1.
 *
 * Time: `simSec` is sim time ((tick + alpha) / SIM_HZ), so the pulse and the flicker hold still in a pause or a freeze.
 */
import { CAMERA_YAW_DEG } from "shared/config";
import {
	ENDLESS_GOLDEN_CONFIG,
	GOLDEN_KIND,
	GOLDEN_TICKS_LEFT,
	GoldenStatus,
	SIM_HZ,
	archetypeIndex,
	goldenRunningSlot,
	type SimState,
} from "shared/sim";
import type { JuiceSettings } from "shared/settings";
import { freezeFrameOn } from "../fx/juiceRules";
import type { SegmentSink } from "../markings";
import { GOLDEN_VIEW } from "./config";
import type { GoldenAppear, GoldenCatch, GoldenFrameSource } from "./events";
import { GOLDEN_RUMOUR_PHASE_NAMES, goldenRumourPhase } from "./rumour";

const TAU = 2 * math.pi;
const SOLO = 1;
/** Semitones in an octave (goldenHitSpeed's pitch to playback speed). */
const SEMITONES_PER_OCTAVE = 12;

/** The Goldling's theme strings (shared/theme FORTUNE_STRING_KEYS). */
export const GOLDEN_STRINGS = {
	/** The floor shout on its appearance ("GOLDLING!"). */
	shout: "fx.golden.shout",
	/** The floor line on its escape ("It got away!  +{points} banked"). */
	escaped: "fx.golden.escaped",
} as const;

/** GoldenStatus names by value (KV_GoldenLabel's developer text). */
export const GOLDEN_STATUS_NAMES: ReadonlyArray<string> = [
	"NONE",
	"WAITING",
	"RUNNING",
	"CAUGHT",
	"ESCAPED",
	"SKIPPED",
];

let cachedKind: number | undefined;

/**
 * The appearances' beat after its piece's break (docs/GOLDLING_RUMOURS.md GR4): `push` the frame's appearances, `due`
 * hands back (in order, once each) those whose release tick is at least GOLDEN_VIEW.appear.afterBreakSec of sim time
 * behind `simSec`. Sim time, so a pause, a draft or a freeze holds the beat with the world. `clear` on a new run, a floor
 * change or a run exit. Plain data; the client's GoldenRenderController owns one.
 */
export class GoldenAppearQueue {
	private readonly waiting = new Array<GoldenAppear>();
	private readonly ready = new Array<GoldenAppear>();

	/** Queues the frame's appearances (GoldenFrameSource.appeared). */
	push(appeared: ReadonlyArray<GoldenAppear>): void {
		for (const a of appeared) this.waiting.push(a);
	}

	/**
	 * The queued appearances due at sim second `simSec` (their tick / SIM_HZ + afterBreakSec <= simSec), oldest first,
	 * removed from the queue. The returned array is reused: read it before the next call.
	 */
	due(simSec: number): ReadonlyArray<GoldenAppear> {
		const out = this.ready;
		out.clear();
		const wait = GOLDEN_VIEW.appear.afterBreakSec;
		let i = 0;
		while (i < this.waiting.size()) {
			const a = this.waiting[i];
			if (a.tick / SIM_HZ + wait <= simSec + 1e-9) {
				out.push(a);
				this.waiting.remove(i);
			} else i++;
		}
		return out;
	}

	/** Appearances still waiting (specs / debug). */
	size(): number {
		return this.waiting.size();
	}

	clear(): void {
		this.waiting.clear();
		this.ready.clear();
	}
}

/** The Goldling's archetype index, or -1 when it is not registered. Cached. */
export function goldenKind(): number {
	if (cachedKind === undefined) {
		const [ok, index] = pcall(() => archetypeIndex(GOLDEN_KIND));
		cachedKind = ok ? (index as number) : -1;
	}
	return cachedKind;
}

/** True for the Goldling's archetype index. */
export function isGoldenKind(kind: number): boolean {
	return kind >= 0 && kind === goldenKind();
}

/** The run's escape time in ticks (its GoldenConfig; the game's ENDLESS_GOLDEN_CONFIG without state.golden). */
export function goldenEscapeTicks(state: Readonly<SimState>): number {
	return (state.golden?.config ?? ENDLESS_GOLDEN_CONFIG).escapeTicks;
}

/** Share of its time left, 0..1: ticksLeft / escapeTicks (0 for a bad escapeTicks). */
export function goldenTimeFill(ticksLeft: number, escapeTicks: number): number {
	if (!(escapeTicks > 0)) return 0;
	return math.clamp(ticksLeft / escapeTicks, 0, 1);
}

/** In its last GOLDEN_VIEW.warn.warnSec (and not yet gone). */
export function goldenWarning(ticksLeft: number): boolean {
	return ticksLeft > 0 && ticksLeft <= GOLDEN_VIEW.warn.warnSec * SIM_HZ;
}

/** The timer ring's look this frame. Mutable, reused. */
export interface GoldenRingLook {
	/** Pieces of GOLDEN_VIEW.ring.pieces to draw (0: no ring). */
	pieces: number;
	/** Radius multiplier (the pulse; 1 when calm or under reduced motion). */
	radiusScale: number;
	/** The warning colour's step, 0..GOLDEN_VIEW.warn.colourSteps (0: golden.coin; goldenRingColourMix turns it into a mix). */
	colourStep: number;
}

export function newGoldenRingLook(): GoldenRingLook {
	return { pieces: 0, radiusScale: 1, colourStep: 0 };
}

/** The 0..1 pulse wave at sim time `simSec` (0 at each cycle's start, 1 half way). */
function pulseWave(simSec: number): number {
	const p = GOLDEN_VIEW.warn.pulseSec;
	if (!(p > 0)) return 0;
	return 0.5 - 0.5 * math.cos((TAU * simSec) / p);
}

/**
 * The ring for `ticksLeft` of `escapeTicks` at sim time `simSec`: ceil(fill x pieces) pieces (a whole piece at a
 * time; none once its time is out). In the last warnSec: the radius pulses (1 + pulseAmp x the wave) and the colour
 * blinks toward warnRole with the wave (rounded to colourSteps); under reduced motion neither moves: radius 1, the
 * colour held at the full warning step.
 */
export function goldenRingLook(
	ticksLeft: number,
	escapeTicks: number,
	simSec: number,
	reducedMotion: boolean,
	out: GoldenRingLook,
): GoldenRingLook {
	const total = GOLDEN_VIEW.ring.pieces;
	const fill = goldenTimeFill(ticksLeft, escapeTicks);
	out.pieces = fill > 0 ? math.clamp(math.ceil(fill * total - 1e-9), 1, total) : 0;
	out.radiusScale = 1;
	out.colourStep = 0;
	if (out.pieces === 0 || !goldenWarning(ticksLeft)) return out;
	const W = GOLDEN_VIEW.warn;
	if (reducedMotion) {
		out.colourStep = W.colourSteps;
		return out;
	}
	const wave = pulseWave(simSec);
	out.radiusScale = 1 + W.pulseAmp * wave;
	out.colourStep = math.round(wave * W.colourSteps);
	return out;
}

/** A colour step's mix toward warnRole, 0..warnMix (the client lerps golden.coin by it; one Color3 per step). */
export function goldenRingColourMix(step: number): number {
	const W = GOLDEN_VIEW.warn;
	if (!(W.colourSteps > 0)) return 0;
	return (math.clamp(step, 0, W.colourSteps) / W.colourSteps) * W.warnMix;
}

/** The body's extra transparency this frame: the flicker's dim half in the last warnSec, else 0 (and under reduced motion). */
export function goldenFlickerTransparency(ticksLeft: number, simSec: number, reducedMotion: boolean): number {
	if (reducedMotion || !goldenWarning(ticksLeft)) return 0;
	const W = GOLDEN_VIEW.warn;
	if (!(W.flickerSec > 0)) return 0;
	const phase = simSec % W.flickerSec;
	return phase >= W.flickerSec / 2 ? W.flickerTransparency : 0;
}

/**
 * The heading (direction (sin h, cos h) on the floor) of screen-up for camera yaw `yawDeg`: up = (-sin y, -cos y), so
 * h = y + pi. Screen-clockwise is decreasing h (screen-right is h - pi / 2).
 */
export function screenUpHeading(yawDeg: number = CAMERA_YAW_DEG): number {
	return math.rad(yawDeg) + math.pi;
}

/**
 * The ring around (x, z) at `radius`: `pieces` of `total` equal straight pieces, the first starting at heading
 * `startHeading` and each next one clockwise on screen (decreasing heading), so the ring left is the arc clockwise from
 * screen-up and it shrinks back toward screen-up as time runs out.
 */
export function goldenRingSegments(
	sink: SegmentSink,
	x: number,
	z: number,
	radius: number,
	pieces: number,
	total: number = GOLDEN_VIEW.ring.pieces,
	startHeading: number = screenUpHeading(),
): void {
	if (!(radius > 0) || !(total > 0)) return;
	const n = math.min(pieces, total);
	const step = TAU / total;
	let px = x + math.sin(startHeading) * radius;
	let pz = z + math.cos(startHeading) * radius;
	for (let i = 1; i <= n; i++) {
		const h = startHeading - i * step;
		const nx = x + math.sin(h) * radius;
		const nz = z + math.cos(h) * radius;
		sink.seg(px, pz, nx, nz);
		px = nx;
		pz = nz;
	}
}

/** The ring's radius around an actor of body `radius` (sim units): radius + GOLDEN_VIEW.ring.marginTiles. */
export function goldenRingRadius(radius: number): number {
	return radius + GOLDEN_VIEW.ring.marginTiles;
}

/**
 * sfx.golden.hit's playback speed for the `hits`-th damaging hit on one Goldling (1-based; GOLDEN_VIEW.audio
 * ladderSemitones, pelletEatSpeed's major scale): the root for the first, one step up per hit, the octave (2x) from the
 * ladder's last step on. Out-of-range input clamps.
 */
export function goldenHitSpeed(hits: number): number {
	const ladder = GOLDEN_VIEW.audio.ladderSemitones;
	const last = ladder.size() - 1;
	const step = math.clamp(math.floor(hits) - 1, 0, last);
	return math.pow(2, ladder[step] / SEMITONES_PER_OCTAVE);
}

/** The frame's highest hit count (the hit sound's ladder step; 0 without hits). */
export function goldenFrameHitCount(golden: GoldenFrameSource): number {
	let n = 0;
	for (const h of golden.hits) if (h.hits > n) n = h.hits;
	return n;
}

/**
 * The catch's solo freeze (docs/GRAZE_PARRY.md GPD7's rule, like the power pellet's): GOLDEN_VIEW.catchFreezeMs when
 * `catcher` is the view player, in a solo run, with freezeFrameOn; else 0. The hitstop clock applies freezeFrameOn,
 * its clamp and its rate cap again (the kill's own freeze is longest-wins with it).
 */
export function goldenCatchFreezeMs(
	catcher: number,
	viewIndex: number,
	partySize: number,
	settings: Readonly<JuiceSettings>,
): number {
	return catcher === viewIndex && partySize === SOLO && freezeFrameOn(settings) ? GOLDEN_VIEW.catchFreezeMs : 0;
}

/** The catch kicks the camera (the `stamp` nudge, under the Screen shake gate) only on the view player's own catch. */
export function goldenCatchNudges(catcher: number, viewIndex: number): boolean {
	return catcher === viewIndex;
}

/** A kill's score pop (the run views' scorePops). */
export interface GoldenPopPoint {
	readonly x: number;
	readonly z: number;
	readonly points: number;
}

const jackpotTaken: boolean[] = [];

/**
 * Fills `out` (cleared) with one flag per kill pop: true for the pop that IS a catch's jackpot (the sim pushes the
 * catch's kill pop with the jackpot's exact x, z and points, scoreKill), each catch marking one pop, the first unmarked
 * match in order. The score pops draw a marked pop in the jackpot's own big layer instead. Returns `out`.
 */
export function jackpotPopMask(
	pops: ReadonlyArray<GoldenPopPoint>,
	caught: ReadonlyArray<GoldenCatch>,
	out: boolean[],
): boolean[] {
	out.clear();
	const taken = jackpotTaken;
	taken.clear();
	for (let k = 0; k < caught.size(); k++) taken.push(false);
	for (const p of pops) {
		let mark = false;
		for (let k = 0; k < caught.size(); k++) {
			const c = caught[k];
			if (taken[k] || c.x !== p.x || c.z !== p.z || c.points !== p.points) continue;
			taken[k] = true;
			mark = true;
			break;
		}
		out.push(mark);
	}
	return out;
}

/**
 * True when ground slot `slot`, whose drop landed on `spawnTick`, holds a boost a catch of this frame landed: it hops
 * in like a broken piece's (BREAKABLE_LOOT_VIEW's hop) instead of popping. Tick-matched like pieceLandingAt.
 */
export function goldenBoostHopped(golden: GoldenFrameSource, slot: number, spawnTick: number): boolean {
	for (const c of golden.caught) {
		for (const b of c.boosts) if (b.slot === slot && b.spawnTick === spawnTick) return true;
	}
	return false;
}

/** The running Goldling's actor slot (alive, its id still in the slot), or -1: the minimap blip, the ring, the label. */
export function goldenBlipSlot(state: Readonly<SimState>): number {
	const slot = goldenRunningSlot(state);
	if (slot < 0) return -1;
	return state.combat.actors[slot].alive !== 0 ? slot : -1;
}

/** Ticks left before the running Goldling in `slot` escapes (its v slot GOLDEN_TICKS_LEFT). */
export function goldenTicksLeft(state: Readonly<SimState>, slot: number): number {
	const a = state.combat.actors[slot];
	return a !== undefined ? a.v[GOLDEN_TICKS_LEFT] : 0;
}

/** A theme string lookup (the client's `pack.str`). */
export type GoldenStr = (key: string, vars?: Readonly<Record<string, string | number>>) => string;

/** The appearance's floor shout ("GOLDLING!"). */
export function goldenShoutText(str: GoldenStr): string {
	return str(GOLDEN_STRINGS.shout);
}

/** The escape's floor line with the coins the floor's Goldling paid ("It got away!  +350 banked"). */
export function goldenEscapedText(str: GoldenStr, coins: number): string {
	return str(GOLDEN_STRINGS.escaped, { points: coins });
}

/**
 * KV_GoldenLabel's text (developer text, English): the status, and while it runs its ticks left / escapeTicks and hp /
 * hpMax; while it hides (docs/GOLDLING_RUMOURS.md GR7) its room, its piece's breakables slot, the rumour phase
 * (goldenRumourPhase: FLOOR / ROOM) and the release tick (-1: not broken yet); after it, the floor's coins and the release
 * tick. Undefined without state.golden.
 */
export function goldenDebugText(state: Readonly<SimState>): string | undefined {
	const g = state.golden;
	if (g === undefined) return undefined;
	const name = GOLDEN_STATUS_NAMES[g.status] ?? tostring(g.status);
	if (g.status === GoldenStatus.RUNNING) {
		const a = state.combat.actors[g.actorSlot];
		if (a === undefined || a.id !== g.actorId) return name;
		return `${name} t ${a.v[GOLDEN_TICKS_LEFT]}/${g.config.escapeTicks} hp ${a.hp}/${a.hpMax} hits ${g.hits}`;
	}
	if (g.status === GoldenStatus.WAITING) {
		const phase = GOLDEN_RUMOUR_PHASE_NAMES[goldenRumourPhase(state)];
		return `${name} room ${g.room} piece ${g.piece} rumour ${phase} release ${g.releaseTick}`;
	}
	return `${name} coins ${g.coins} release ${g.releaseTick}`;
}

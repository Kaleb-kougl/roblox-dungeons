/**
 * Build effects, the pure rules (docs/BUILDS.md BU8 and its follow-up). BuildFxDirector turns a frame's build effects
 * (BuildFxFrameSource, collected per tick by the run views) into what the client's BuildFxController and the particle
 * system draw, once per rendered frame after the ticks. It owns every rule that spans frames:
 *
 *   - Spark beams: one per segment, alive for the sim's SPARK_BEAM_TICKS in seconds (0.12 s), opaque for
 *     BUILD_FX_VIEW.beam.hold of it, then fading. A jagged line of beam.segments segments; the inner joints sit off the
 *     straight line by a seeded amount (render RNG; at most jagTiles, at most jagShare of the hop) and re-roll every
 *     rejagSec (a crackle), never under reduced motion. A Storm Crown fork is flagged (drawn thinner). At most
 *     beam.maxAlive: a new beam past the cap replaces the oldest.
 *   - Spark bursts: one per segment at its target, the frame's new ones only, at most sparkBurst.perFrame (the view
 *     player's first); none with particles off. Reduced halves every count of the burst's shape (`burstShape`).
 *   - Phantom Step erase sparks: the same rule with phantom.perFrame and the phantom shape (`phantomShape`).
 *   - Floor rings (`rings`, each with its drawing block `look`), radius r0 -> r1 eased out, fading over the last
 *     fadeShare; segments halve under Reduced; under reduced motion a ring sits at r1 and only fades:
 *       nova  (BU5) radius 0 -> the nova's, in nova.looks[kind]'s role, at most nova.maxAlive;
 *       pop   (BU5) a small flare where a Momentum volley / Thrill Seeker ring / Flurry release / Ricochet split left,
 *             in the colour of what it fired (Momentum grows by tier), and (BU6) where a Storm Blade / Conductor /
 *             Chain Reaction / Close Call fired, in pop.duoRole; at most pop.maxAlive;
 *       flare the evolve / duo ring around the taking player in the card's role;
 *       heal  Lionheart's pulse around the healed player in heal.role;
 *       glint (BU6) Unshaken's shield glint closing in on the player whose armor hit it kept off the combo.
 *     Flares, heal pulses and glints follow their player's CURRENT position; a player's newer one of the same look
 *     replaces theirs, and a dead player's ends.
 *   - Executes (BU5): a flat flash popping out (no pop under reduced motion) and fading over execute.sec.
 *   - Trails: `trails` is true only with buildFx Full and not reduced motion (BulletRenderController's burst / shard
 *     trails).
 *   - Overkill streaks (docs/LEGENDARIES.md LG6): one straight streak per strike (no jag), alive overkill.sec, opaque
 *     for its hold, then fading; thickness by the carry (streakThickness), a white core (Full only), thicker for a
 *     Skewer line (a SKEWER duoProc of the same tick, owner and corpse), which is also drawn on to the line's end
 *     (skewerLineEnd: through the target to OVERKILL_RANGE from the corpse, the sim's line since the owner's tuning);
 *     at most overkill.maxAlive. An impact flash at each target (Full only; no pop under reduced motion), at most
 *     overkill.impact.maxAlive.
 *   - Bastion braces (LG6): a `brace` ring following the bracing player (PIP / HEAL full, SPENT faint), its segments
 *     shrinking after brace.crackAt (braceChordShare: the crack); HEAL also starts the `heal` pulse. `braces` lists the
 *     frame's braces (player, kind) for the client's BraceFxController (floor shout, armor row pulse, toast).
 *   - The Jackpot pop and Gold Rush's tinted kill pop are the score pops' (the client's ScorePopController reads
 *     RunView.builds.jackpots / goldRush; scorePops.ts scorePopTones); nothing here.
 *
 * Gates: `quiet` (the stage cover or run over: comboQuiet) puts nothing out and forgets everything alive. A new run
 * (another state object, or the tick going back) forgets everything too. Records of a player outside the party are
 * ignored.
 *
 * No allocation in steady state: the output and its records are reused frame to frame. Presentation only.
 */
import { drawnOrMerged, type DrawnPlayerOf } from "shared/view/predict";
import {
	BraceKind,
	Duo,
	MOMENTUM_TIER_FIRST,
	OVERKILL_RANGE,
	SIM_DT,
	SPARK_BEAM_TICKS,
	partySize,
	playerAt,
	type SimState,
} from "shared/sim";
import type { BuildFxLevel, JuiceSettings } from "shared/settings";
import type { ColorRole } from "shared/theme";
// Not the shared/view/hud barrel (hud imports this barrel): comboConfig only imports shared/sim.
import { semitonesToSpeed } from "../hud/comboConfig";
import { BUILD_FX_VIEW, type BuildRingLook } from "./buildFxConfig";
import type { BuildFxFrameSource, EffectRecord, SparkRecord, StreakRecord } from "./buildFxEvents";
import { effectiveParticles } from "./juiceRules";
import type { ChipBurst } from "./particles";
import { RenderRng, burstSeed } from "./rng";

/** A spark beam's whole life, real seconds (the sim's presentation constant SPARK_BEAM_TICKS). */
export const BEAM_SEC = SPARK_BEAM_TICKS * SIM_DT;

/** A point of a beam's polyline (sim units). */
export interface BeamPoint {
	x: number;
	z: number;
}

/** One live spark beam. `points` has beam.segments + 1 entries: the start, the jag joints, the target. */
export interface BeamView {
	readonly points: ReadonlyArray<Readonly<BeamPoint>>;
	readonly owner: number;
	readonly gen: number;
	/** A Storm Crown fork (drawn thinner). */
	readonly fork: boolean;
	/** Opacity factor (1, then -> 0). */
	readonly fade: number;
	readonly ageSec: number;
}

/** One new chip burst (a spark target or a Phantom Step erase; sim units). */
export interface SparkBurstView {
	readonly x: number;
	readonly z: number;
	readonly owner: number;
	readonly seed: number;
}

/** One live floor ring (a nova, an origin flare, an evolve / duo flare or a heal pulse). */
export interface RingView {
	readonly x: number;
	readonly z: number;
	/** Current radius, sim units. */
	readonly radius: number;
	readonly fade: number;
	readonly role: ColorRole;
	/** Segments to draw (Reduced halves them). */
	readonly segments: number;
	/** Its BUILD_FX_VIEW drawing block (thickness, width, lift). */
	readonly look: BuildRingLook;
	/** Each segment's share of its chord (1: a closed ring; a cracking brace ring's gaps open below 1). */
	readonly chordShare: number;
}

/** One live Overkill streak (LG6): a straight line from the corpse to the target (sim units). */
export interface StreakView {
	readonly x1: number;
	readonly z1: number;
	readonly x2: number;
	readonly z2: number;
	readonly owner: number;
	readonly gen: number;
	/** Thickness, studs (streakThickness). */
	readonly thicknessStuds: number;
	/** Draw the white core (Full only). */
	readonly core: boolean;
	/** Opacity factor (1, then -> 0). */
	readonly fade: number;
}

/** One brace this frame (LG6): the bracing player and what it did (BraceKind). */
export interface BraceView {
	readonly player: number;
	readonly kind: number;
}

/** One live execute flash. */
export interface FlashView {
	readonly x: number;
	readonly z: number;
	/** Diameter factor (popScale -> 1). */
	readonly scale: number;
	readonly fade: number;
}

/** What BuildFxDirector.frame fills (reused: valid until the next frame call). */
export interface BuildFxFrame {
	readonly beams: ReadonlyArray<BeamView>;
	readonly sparkBursts: ReadonlyArray<SparkBurstView>;
	/** The spark burst's shape this frame (Full, or Reduced's halved counts). */
	readonly burstShape: Readonly<ChipBurst>;
	/** This frame's new Phantom Step erase sparks and their shape. */
	readonly phantomBursts: ReadonlyArray<SparkBurstView>;
	readonly phantomShape: Readonly<ChipBurst>;
	readonly rings: ReadonlyArray<RingView>;
	readonly flashes: ReadonlyArray<FlashView>;
	/** LG6: live Overkill streaks and their impact flashes (in build.overkill). */
	readonly streaks: ReadonlyArray<StreakView>;
	readonly impacts: ReadonlyArray<FlashView>;
	/** LG6: this frame's braces in the party. */
	readonly braces: ReadonlyArray<BraceView>;
	/** Draw the burst / shard bullet trails (Full and not reduced motion). */
	readonly trails: boolean;
}

/** What every ring look's BUILD_FX_VIEW block has: its life and fade, and its segments' sizes (studs). */
export interface BuildRingBlock {
	readonly sec: number;
	readonly fadeShare: number;
	readonly thicknessStuds: number;
	readonly widthStuds: number;
	readonly liftStuds: number;
}

/** The settings the director reads: the juice settings plus the Display tab's buildFx. */
export interface BuildFxSettings {
	readonly juice: Readonly<JuiceSettings>;
	readonly buildFx: BuildFxLevel;
}

/** `n` under the level: Full as is; Reduced times BUILD_FX_VIEW.reducedShare, rounded, at least 1 when n > 0. */
export function buildFxCount(n: number, level: BuildFxLevel): number {
	if (level === "full" || n <= 0) return n;
	return math.max(1, math.round(n * BUILD_FX_VIEW.reducedShare));
}

/** The burst / shard trails are drawn: Full and not reduced motion. */
export function buildTrailsOn(level: BuildFxLevel, reducedMotion: boolean): boolean {
	return level === "full" && !reducedMotion;
}

/** A spark beam's opacity at `ageSec`: 1 for beam.hold of BEAM_SEC, then linearly to 0 at BEAM_SEC. */
export function beamFade(ageSec: number): number {
	const holdSec = BEAM_SEC * BUILD_FX_VIEW.beam.hold;
	if (ageSec <= holdSec) return 1;
	if (ageSec >= BEAM_SEC) return 0;
	return 1 - (ageSec - holdSec) / (BEAM_SEC - holdSec);
}

/** The jag epoch of a beam at `ageSec`: re-rolls every rejagSec; always 0 under reduced motion. */
export function beamJagEpoch(ageSec: number, reducedMotion: boolean): number {
	if (reducedMotion) return 0;
	return math.floor(math.max(ageSec, 0) / BUILD_FX_VIEW.beam.rejagSec);
}

/**
 * Fills `out` (beam.segments + 1 points, grown once) with the jagged polyline from (x1, z1) to (x2, z2): the ends
 * exact, every inner joint on the straight line at an even step, pushed off it perpendicularly by a seeded amount in
 * [-jag, jag], jag = min(jagTiles, jagShare x the hop's length). A zero-length hop is straight.
 */
export function beamJag(
	x1: number,
	z1: number,
	x2: number,
	z2: number,
	seed: number,
	out: BeamPoint[],
	rng: RenderRng = new RenderRng(),
): BeamPoint[] {
	const b = BUILD_FX_VIEW.beam;
	const n = b.segments;
	while (out.size() <= n) out.push({ x: 0, z: 0 });
	const dx = x2 - x1;
	const dz = z2 - z1;
	const len = math.sqrt(dx * dx + dz * dz);
	const jag = math.min(b.jagTiles, b.jagShare * len);
	const px = len > 0 ? -dz / len : 0;
	const pz = len > 0 ? dx / len : 0;
	rng.seed(seed);
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		const o = i === 0 || i === n ? 0 : rng.range(-jag, jag);
		out[i].x = x1 + dx * t + px * o;
		out[i].z = z1 + dz * t + pz * o;
	}
	return out;
}

/** A ring's radius at `ageSec` of `sec`: r0 -> r1 eased out (1 - (1 - u)^2); r1 throughout under reduced motion. */
export function ringRadius(ageSec: number, sec: number, r0: number, r1: number, reducedMotion: boolean): number {
	if (reducedMotion || sec <= 0) return r1;
	const u = math.clamp(ageSec / sec, 0, 1);
	const eased = 1 - (1 - u) * (1 - u);
	return r0 + (r1 - r0) * eased;
}

/** Opacity at `ageSec` of `sec`: 1, then linearly to 0 over the last `fadeShare` of it. */
export function lifeFade(ageSec: number, sec: number, fadeShare: number): number {
	const fadeSec = sec * fadeShare;
	const left = sec - ageSec;
	if (left <= 0) return 0;
	if (fadeSec <= 0 || left >= fadeSec) return 1;
	return left / fadeSec;
}

/** The execute flash's diameter factor at `ageSec`: popScale -> 1 over popSec (eased out); 1 under reduced motion. */
export function executePop(ageSec: number, reducedMotion: boolean): number {
	const f = BUILD_FX_VIEW.execute;
	if (reducedMotion || ageSec >= f.popSec) return 1;
	const u = ageSec <= 0 ? 0 : ageSec / f.popSec;
	const eased = 1 - (1 - u) * (1 - u);
	return f.popScale + (1 - f.popScale) * eased;
}

/** An Overkill streak's opacity at `ageSec`: 1 for overkill.hold of overkill.sec, then linearly to 0. */
export function streakFade(ageSec: number): number {
	const o = BUILD_FX_VIEW.overkill;
	const holdSec = o.sec * o.hold;
	if (ageSec <= holdSec) return 1;
	if (ageSec >= o.sec) return 0;
	return 1 - (ageSec - holdSec) / (o.sec - holdSec);
}

/**
 * An Overkill streak's thickness, studs: Full thicknessStuds + carryStuds per point of carry above 1 (at most
 * maxCarrySteps); Reduced reducedThicknessStuds; a Skewer line times skewerThicknessShare.
 */
export function streakThickness(carry: number, level: BuildFxLevel, skewer: boolean): number {
	const o = BUILD_FX_VIEW.overkill;
	const steps = math.clamp(math.floor(carry) - 1, 0, o.maxCarrySteps);
	const base = level === "full" ? o.thicknessStuds + o.carryStuds * steps : o.reducedThicknessStuds;
	return skewer ? base * o.skewerThicknessShare : base;
}

/** The impact flash's diameter factor at `ageSec`: popScale -> 1 over popSec (eased out); 1 under reduced motion. */
export function impactPop(ageSec: number, reducedMotion: boolean): number {
	const f = BUILD_FX_VIEW.overkill.impact;
	if (reducedMotion || ageSec >= f.popSec) return 1;
	const u = ageSec <= 0 ? 0 : ageSec / f.popSec;
	const eased = 1 - (1 - u) * (1 - u);
	return f.popScale + (1 - f.popScale) * eased;
}

/**
 * The brace ring's segment share of its chord at `ageSec` (the crack): 1 until brace.crackAt of its life, then
 * linearly down to brace.minChordShare at its end.
 */
export function braceChordShare(ageSec: number): number {
	const b = BUILD_FX_VIEW.brace;
	const crackSec = b.sec * b.crackAt;
	if (ageSec <= crackSec) return 1;
	if (ageSec >= b.sec) return b.minChordShare;
	return 1 - ((1 - b.minChordShare) * (ageSec - crackSec)) / (b.sec - crackSec);
}

/**
 * Skewer's line end (docs/LEGENDARIES.md "Owner tuning"): from the corpse (x1, z1) through the target (x2, z2) out to
 * OVERKILL_RANGE from the corpse, written into `out`; a target on the corpse (zero length): the target itself. The
 * sim's onKill.ts `overkill` builds the same segment (the event still ends at the target).
 */
export function skewerLineEnd(x1: number, z1: number, x2: number, z2: number, out: BeamPoint): BeamPoint {
	const dx = x2 - x1;
	const dz = z2 - z1;
	const d = math.sqrt(dx * dx + dz * dz);
	out.x = d > 0 ? x1 + (dx / d) * OVERKILL_RANGE : x2;
	out.z = d > 0 ? z1 + (dz / d) * OVERKILL_RANGE : z2;
	return out;
}

/**
 * A brace's ring strength (opacity factor): SPENT faint (brace.spentStrength), PIP / HEAL full. Since the owner's
 * tuning the sim never pushes SPENT (a brace with nothing to restore is not spent), so its branch is unreachable but
 * kept harmless (BraceKind is append only).
 */
export function braceRingStrength(kind: number): number {
	return kind === BraceKind.SPENT ? BUILD_FX_VIEW.brace.spentStrength : 1;
}

/** A build cue's shift for proc generation `gen` (0 = the player's own kill), semitones, capped. */
export function buildGenSemitones(gen: number): number {
	const a = BUILD_FX_VIEW.audio;
	return math.min(math.max(gen, 0) * a.semitoneStep, a.maxSemitones);
}

/** A build cue's PlaybackSpeed for proc generation `gen`. */
export function buildGenSpeed(gen: number): number {
	return semitonesToSpeed(buildGenSemitones(gen));
}

/** The spark burst shape at a level (Reduced halves every count). */
export function sparkBurstShape(level: BuildFxLevel): ChipBurst {
	return chipShape(BUILD_FX_VIEW.sparkBurst, level);
}

/** The Phantom Step erase sparks' shape at a level (Reduced halves every count). */
export function phantomBurstShape(level: BuildFxLevel): ChipBurst {
	return chipShape(BUILD_FX_VIEW.phantom, level);
}

function chipShape(s: Readonly<ChipBurst>, level: BuildFxLevel): ChipBurst {
	return {
		chunks: buildFxCount(s.chunks, level),
		bits: buildFxCount(s.bits, level),
		sparks: buildFxCount(s.sparks, level),
		startPx: s.startPx,
		radius: s.radius,
		speed: s.speed,
	};
}

/** The role of nova kind `kind` (nova.looks, else its fallback). */
export function novaRole(kind: number): ColorRole {
	const n = BUILD_FX_VIEW.nova;
	return (n.looks[kind] ?? n.fallback).role;
}

/** A Momentum flare's end radius, tiles: pop.r1Tiles + tierTiles per tier above the first (MOMENTUM_TIER_FIRST). */
export function momentumPopTiles(tier: number): number {
	const p = BUILD_FX_VIEW.pop;
	return p.r1Tiles + p.tierTiles * math.max(tier - MOMENTUM_TIER_FIRST, 0);
}

interface BeamSlot {
	x1: number;
	z1: number;
	x2: number;
	z2: number;
	owner: number;
	gen: number;
	fork: boolean;
	seed: number;
	startSec: number;
	ageSec: number;
	fade: number;
	readonly points: BeamPoint[];
}

interface BurstSlot {
	x: number;
	z: number;
	owner: number;
	seed: number;
}

interface RingSlot {
	x: number;
	z: number;
	/** Radius at the start and the end, sim units (tiles). */
	r0: number;
	r1: number;
	radius: number;
	fade: number;
	role: ColorRole;
	segments: number;
	look: BuildRingLook;
	chordShare: number;
	/** Opacity factor over the life fade (a SPENT brace's faint ring). */
	strength: number;
	/** Flares and heal pulses follow this player (-1: it stays where it began). */
	player: number;
	startSec: number;
	sec: number;
	fadeShare: number;
}

interface FlashSlot {
	x: number;
	z: number;
	scale: number;
	fade: number;
	startSec: number;
}

interface StreakSlot {
	x1: number;
	z1: number;
	x2: number;
	z2: number;
	owner: number;
	gen: number;
	thicknessStuds: number;
	core: boolean;
	fade: number;
	startSec: number;
}

interface BraceSlot {
	player: number;
	kind: number;
}

interface FrameSlot {
	readonly beams: BeamSlot[];
	readonly sparkBursts: BurstSlot[];
	burstShape: ChipBurst;
	readonly phantomBursts: BurstSlot[];
	phantomShape: ChipBurst;
	readonly rings: RingSlot[];
	readonly flashes: FlashSlot[];
	readonly streaks: StreakSlot[];
	readonly impacts: FlashSlot[];
	readonly braces: BraceSlot[];
	trails: boolean;
}

/** Keeps the live entries of `list` (stable order), moving dead ones to `free`. */
function sweep<T extends defined>(list: T[], free: T[], alive: (t: T) => boolean): void {
	let w = 0;
	const n = list.size();
	for (let r = 0; r < n; r++) {
		const t = list[r];
		if (alive(t)) {
			list[w] = t;
			w++;
		} else free.push(t);
	}
	while (list.size() > w) list.pop();
}

/** Takes a slot from `free` (or makes one) and appends it to `list`, first dropping the oldest past `cap`. */
function claim<T extends defined>(list: T[], free: T[], cap: number, make: () => T): T {
	if (list.size() >= cap) free.push(list.remove(0)!);
	const t = free.pop() ?? make();
	list.push(t);
	return t;
}

const FULL_SHAPE = sparkBurstShape("full");
const REDUCED_SHAPE = sparkBurstShape("reduced");
const FULL_PHANTOM = phantomBurstShape("full");
const REDUCED_PHANTOM = phantomBurstShape("reduced");

/** The record lists that make an origin flare, and each one's role. */
type PopSource = "momentum" | "thrills" | "flurries" | "ricochets" | "duoProcs";
const POP_SOURCES: ReadonlyArray<[PopSource, ColorRole]> = [
	["momentum", BUILD_FX_VIEW.pop.momentumRole],
	["thrills", BUILD_FX_VIEW.pop.thrillRole],
	["flurries", BUILD_FX_VIEW.pop.flurryRole],
	["ricochets", BUILD_FX_VIEW.pop.ricochetRole],
	["duoProcs", BUILD_FX_VIEW.pop.duoRole],
];

/** The ring looks that follow a player (at most one each per player). */
type FollowLook = "flare" | "heal" | "glint" | "brace";
const FOLLOW_LOOKS: ReadonlyArray<FollowLook> = ["flare", "heal", "glint", "brace"];

/** A following look's block (its radii as well as its drawing sizes). */
function followBlock(look: FollowLook) {
	if (look === "flare") return BUILD_FX_VIEW.flare;
	if (look === "heal") return BUILD_FX_VIEW.heal;
	if (look === "brace") return BUILD_FX_VIEW.brace;
	return BUILD_FX_VIEW.glint;
}

/** True when a SKEWER duoProc of the same tick and owner fired at the streak's corpse (Skewer's line). */
function isSkewer(r: StreakRecord, duoProcs: ReadonlyArray<EffectRecord>): boolean {
	for (const d of duoProcs) {
		if (d.kind === Duo.SKEWER && d.tick === r.tick && d.owner === r.owner && d.x === r.x1 && d.z === r.z1)
			return true;
	}
	return false;
}

/** The build effects' per-frame director (see the file comment). One per client (BuildFxController). */
export class BuildFxDirector {
	/** This frame's drawn players (frame's `drawn`). */
	private drawn: DrawnPlayerOf | undefined;
	readonly out: BuildFxFrame;

	private readonly slot: FrameSlot = {
		beams: [],
		sparkBursts: [],
		burstShape: FULL_SHAPE,
		phantomBursts: [],
		phantomShape: FULL_PHANTOM,
		rings: [],
		flashes: [],
		streaks: [],
		impacts: [],
		braces: [],
		trails: true,
	};
	private readonly freeBeams: BeamSlot[] = [];
	private readonly burstPool: BurstSlot[] = [];
	private readonly phantomPool: BurstSlot[] = [];
	/** Live rings by kind (the output `rings` is rebuilt from them every frame): novas, origin flares, followers. */
	private readonly novaRings: RingSlot[] = [];
	private readonly popRings: RingSlot[] = [];
	private readonly followRings: RingSlot[] = [];
	private readonly ringLists: ReadonlyArray<RingSlot[]> = [this.novaRings, this.popRings, this.followRings];
	private readonly freeRings: RingSlot[] = [];
	private readonly freeFlashes: FlashSlot[] = [];
	private readonly freeStreaks: StreakSlot[] = [];
	private readonly bracePool: BraceSlot[] = [];
	private readonly lineEnd: BeamPoint = { x: 0, z: 0 };
	private readonly rng = new RenderRng();
	private lastState: Readonly<SimState> | undefined;
	private lastTick = 0;

	constructor() {
		this.out = this.slot;
	}

	/** Forgets everything alive (a new run; quiet does this too). */
	resetAll(): void {
		const s = this.slot;
		for (const b of s.beams) this.freeBeams.push(b);
		s.beams.clear();
		for (const list of this.ringLists) {
			for (const r of list) this.freeRings.push(r);
			list.clear();
		}
		s.rings.clear();
		for (const f of s.flashes) this.freeFlashes.push(f);
		s.flashes.clear();
		for (const t of s.streaks) this.freeStreaks.push(t);
		s.streaks.clear();
		for (const f of s.impacts) this.freeFlashes.push(f);
		s.impacts.clear();
		s.braces.clear();
		s.sparkBursts.clear();
		s.phantomBursts.clear();
	}

	/**
	 * One rendered frame, after its ticks. `source`: the frame's build effects (RunView.builds). `viewIndex`: the view
	 * player. `quiet`: comboQuiet(covered, runOver). `clockSec`: a forward-only real-time clock. Returns `out`.
	 */
	frame(
		source: BuildFxFrameSource,
		state: Readonly<SimState>,
		viewIndex: number,
		quiet: boolean,
		settings: Readonly<BuildFxSettings>,
		clockSec: number,
		drawn?: DrawnPlayerOf,
	): BuildFxFrame {
		this.drawn = drawn;
		const out = this.slot;
		out.sparkBursts.clear();
		out.phantomBursts.clear();
		out.braces.clear();
		if (state !== this.lastState || state.tick < this.lastTick) this.resetAll();
		this.lastState = state;
		this.lastTick = state.tick;
		const juice = settings.juice;
		const level = settings.buildFx;
		out.trails = buildTrailsOn(level, juice.reducedMotion);
		out.burstShape = level === "full" ? FULL_SHAPE : REDUCED_SHAPE;
		out.phantomShape = level === "full" ? FULL_PHANTOM : REDUCED_PHANTOM;
		if (quiet) {
			this.resetAll();
			return this.out;
		}
		const n = partySize(state);
		const reduced = juice.reducedMotion;
		this.addBeams(source.sparks, n, clockSec);
		if (effectiveParticles(juice) !== "off") {
			const ph = BUILD_FX_VIEW.phantom;
			this.addSparkBursts(source.sparks, n, viewIndex, true);
			this.addSparkBursts(source.sparks, n, viewIndex, false);
			this.addChips(
				source.phantoms,
				n,
				viewIndex,
				true,
				out.phantomBursts,
				this.phantomPool,
				ph.perFrame,
				ph.seedSalt,
			);
			this.addChips(
				source.phantoms,
				n,
				viewIndex,
				false,
				out.phantomBursts,
				this.phantomPool,
				ph.perFrame,
				ph.seedSalt,
			);
		}
		this.addNovas(source.novas, n, level, clockSec);
		this.addPops(source, n, level, clockSec);
		this.addFlashes(source.executes, n, clockSec);
		this.addFollowers(source, n, level, clockSec);
		this.addStreaks(source, n, level, clockSec);
		this.addBraces(source.braces, n);
		this.ageBeams(clockSec, reduced);
		this.ageRings(state, n, clockSec, reduced);
		this.ageFlashes(clockSec, reduced);
		this.ageStreaks(clockSec, reduced);
		return this.out;
	}

	/** LG6: a streak per Overkill strike, and (Full only) an impact flash at its target. */
	private addStreaks(source: BuildFxFrameSource, n: number, level: BuildFxLevel, clockSec: number): void {
		const o = BUILD_FX_VIEW.overkill;
		const s = this.slot;
		const full = level === "full";
		for (const r of source.overkills) {
			if (r.owner < 0 || r.owner >= n) continue;
			const t = claim(s.streaks, this.freeStreaks, o.maxAlive, () => ({
				x1: 0,
				z1: 0,
				x2: 0,
				z2: 0,
				owner: 0,
				gen: 0,
				thicknessStuds: 0,
				core: false,
				fade: 1,
				startSec: 0,
			}));
			const skewer = isSkewer(r, source.duoProcs);
			t.x1 = r.x1;
			t.z1 = r.z1;
			t.x2 = r.x2;
			t.z2 = r.z2;
			if (skewer) {
				// Skewer's streak runs the whole line it struck along: through the target to OVERKILL_RANGE.
				const far = skewerLineEnd(r.x1, r.z1, r.x2, r.z2, this.lineEnd);
				t.x2 = far.x;
				t.z2 = far.z;
			}
			t.owner = r.owner;
			t.gen = r.gen;
			t.thicknessStuds = streakThickness(r.carry, level, skewer);
			t.core = full;
			t.fade = 1;
			t.startSec = clockSec;
			if (!full) continue;
			const f = claim(s.impacts, this.freeFlashes, o.impact.maxAlive, () => ({
				x: 0,
				z: 0,
				scale: 1,
				fade: 1,
				startSec: 0,
			}));
			f.x = r.x2;
			f.z = r.z2;
			f.startSec = clockSec;
		}
	}

	/** LG6: the frame's braces of party members (the client's floor shout, armor row pulse and toast read them). */
	private addBraces(braces: ReadonlyArray<EffectRecord>, n: number): void {
		const out = this.slot.braces;
		for (const r of braces) {
			if (r.owner < 0 || r.owner >= n) continue;
			const k = out.size();
			let b = this.bracePool[k];
			if (b === undefined) {
				b = { player: 0, kind: 0 };
				this.bracePool.push(b);
			}
			b.player = r.owner;
			b.kind = r.kind;
			out.push(b);
		}
	}

	private ageStreaks(clockSec: number, reducedMotion: boolean): void {
		const s = this.slot;
		const o = BUILD_FX_VIEW.overkill;
		sweep(s.streaks, this.freeStreaks, (t) => clockSec - t.startSec < o.sec);
		for (const t of s.streaks) t.fade = streakFade(math.max(clockSec - t.startSec, 0));
		sweep(s.impacts, this.freeFlashes, (f) => clockSec - f.startSec < o.impact.sec);
		for (const f of s.impacts) {
			const age = math.max(clockSec - f.startSec, 0);
			f.scale = impactPop(age, reducedMotion);
			f.fade = lifeFade(age, o.impact.sec, 1);
		}
	}

	private addBeams(sparks: ReadonlyArray<SparkRecord>, n: number, clockSec: number): void {
		const s = this.slot;
		for (let i = 0; i < sparks.size(); i++) {
			const r = sparks[i];
			if (r.owner < 0 || r.owner >= n) continue;
			const b = claim(s.beams, this.freeBeams, BUILD_FX_VIEW.beam.maxAlive, () => ({
				x1: 0,
				z1: 0,
				x2: 0,
				z2: 0,
				owner: 0,
				gen: 0,
				fork: false,
				seed: 0,
				startSec: 0,
				ageSec: 0,
				fade: 1,
				points: [] as BeamPoint[],
			}));
			b.x1 = r.x1;
			b.z1 = r.z1;
			b.x2 = r.x2;
			b.z2 = r.z2;
			b.owner = r.owner;
			b.gen = r.gen;
			b.fork = r.fork;
			b.seed = burstSeed(i, r.tick, BUILD_FX_VIEW.beam.seedSalt);
			b.startSec = clockSec;
		}
	}

	/** One pass of spark bursts (at each segment's target): the view player's (`viewPass`) or everyone else's. */
	private addSparkBursts(sparks: ReadonlyArray<SparkRecord>, n: number, viewIndex: number, viewPass: boolean): void {
		const out = this.slot.sparkBursts;
		const sb = BUILD_FX_VIEW.sparkBurst;
		for (let i = 0; i < sparks.size(); i++) {
			if (out.size() >= sb.perFrame) return;
			const r = sparks[i];
			if (r.owner < 0 || r.owner >= n || (r.owner === viewIndex) !== viewPass) continue;
			pushBurst(out, this.burstPool, r.x2, r.z2, r.owner, burstSeed(i, r.tick, sb.seedSalt));
		}
	}

	/** One pass of chip bursts at each record: the view player's (`viewPass`) or everyone else's, up to `cap`. */
	private addChips(
		records: ReadonlyArray<EffectRecord>,
		n: number,
		viewIndex: number,
		viewPass: boolean,
		out: BurstSlot[],
		pool: BurstSlot[],
		cap: number,
		salt: number,
	): void {
		for (let i = 0; i < records.size(); i++) {
			if (out.size() >= cap) return;
			const r = records[i];
			if (r.owner < 0 || r.owner >= n || (r.owner === viewIndex) !== viewPass) continue;
			pushBurst(out, pool, r.x, r.z, r.owner, burstSeed(i, r.tick, salt));
		}
	}

	private newRing(): RingSlot {
		return {
			x: 0,
			z: 0,
			r0: 0,
			r1: 0,
			radius: 0,
			fade: 1,
			role: BUILD_FX_VIEW.nova.fallback.role,
			segments: 0,
			look: "nova",
			chordShare: 1,
			strength: 1,
			player: -1,
			startSec: 0,
			sec: 0,
			fadeShare: 1,
		};
	}

	/** Claims a ring in `list` (capped) and sets everything but its position. */
	private ring(
		list: RingSlot[],
		cap: number,
		look: BuildRingLook,
		role: ColorRole,
		r0: number,
		r1: number,
		segments: number,
		player: number,
		clockSec: number,
	): RingSlot {
		const g = claim(list, this.freeRings, cap, () => this.newRing());
		setRing(g, look, role, r0, r1, segments, player, clockSec);
		return g;
	}

	private addNovas(novas: ReadonlyArray<EffectRecord>, n: number, level: BuildFxLevel, clockSec: number): void {
		const nv = BUILD_FX_VIEW.nova;
		const segments = buildFxCount(nv.segments, level);
		for (const r of novas) {
			if (r.owner < 0 || r.owner >= n) continue;
			const g = this.ring(
				this.novaRings,
				nv.maxAlive,
				"nova",
				novaRole(r.kind),
				0,
				r.amount,
				segments,
				-1,
				clockSec,
			);
			g.x = r.x;
			g.z = r.z;
		}
	}

	/** Origin flares (POP_SOURCES order): Momentum's grows with its tier (the record's kind). */
	private addPops(source: BuildFxFrameSource, n: number, level: BuildFxLevel, clockSec: number): void {
		const p = BUILD_FX_VIEW.pop;
		const segments = buildFxCount(p.segments, level);
		for (const [key, role] of POP_SOURCES) {
			const records = source[key];
			const tiered = key === "momentum";
			for (const r of records) {
				if (r.owner < 0 || r.owner >= n) continue;
				const r1 = tiered ? momentumPopTiles(r.kind) : p.r1Tiles;
				const g = this.ring(this.popRings, p.maxAlive, "pop", role, p.r0Tiles, r1, segments, -1, clockSec);
				g.x = r.x;
				g.z = r.z;
			}
		}
	}

	/** Evolve / duo flares, Lionheart pulses and Unshaken glints: one per player and look (a newer one replaces it). */
	private addFollowers(source: BuildFxFrameSource, n: number, level: BuildFxLevel, clockSec: number): void {
		const f = BUILD_FX_VIEW.flare;
		const h = BUILD_FX_VIEW.heal;
		const gl = BUILD_FX_VIEW.glint;
		const flareSegments = buildFxCount(f.segments, level);
		for (const t of source.evolved) this.follow(t.player, "flare", f.evolvedRole, flareSegments, n, clockSec);
		for (const t of source.duos) this.follow(t.player, "flare", f.duoRole, flareSegments, n, clockSec);
		const healSegments = buildFxCount(h.segments, level);
		for (const r of source.heals) this.follow(r.owner, "heal", h.role, healSegments, n, clockSec);
		const glintSegments = buildFxCount(gl.segments, level);
		for (const r of source.unshaken) this.follow(r.owner, "glint", gl.role, glintSegments, n, clockSec);
		// LG6: a brace cracks its stone ring (SPENT: faint); Stone Heart's heal also pulses like Lionheart's.
		const br = BUILD_FX_VIEW.brace;
		const braceSegments = buildFxCount(br.segments, level);
		for (const r of source.braces) {
			const g = this.follow(r.owner, "brace", br.role, braceSegments, n, clockSec);
			if (g !== undefined) g.strength = braceRingStrength(r.kind);
			if (r.kind === BraceKind.HEAL) this.follow(r.owner, "heal", h.role, healSegments, n, clockSec);
		}
	}

	private follow(
		player: number,
		look: FollowLook,
		role: ColorRole,
		segments: number,
		n: number,
		clockSec: number,
	): RingSlot | undefined {
		if (player < 0 || player >= n) return undefined;
		const block = followBlock(look);
		const rings = this.followRings;
		let g: RingSlot | undefined;
		for (const r of rings) if (r.look === look && r.player === player) g = r;
		if (g === undefined) g = claim(rings, this.freeRings, FOLLOW_LOOKS.size() * n, () => this.newRing());
		setRing(g, look, role, block.r0Tiles, block.r1Tiles, segments, player, clockSec);
		return g;
	}

	private addFlashes(executes: ReadonlyArray<EffectRecord>, n: number, clockSec: number): void {
		for (const r of executes) {
			if (r.owner < 0 || r.owner >= n) continue;
			const f = claim(this.slot.flashes, this.freeFlashes, BUILD_FX_VIEW.execute.maxAlive, () => ({
				x: 0,
				z: 0,
				scale: 1,
				fade: 1,
				startSec: 0,
			}));
			f.x = r.x;
			f.z = r.z;
			f.startSec = clockSec;
		}
	}

	private ageBeams(clockSec: number, reducedMotion: boolean): void {
		const beams = this.slot.beams;
		sweep(beams, this.freeBeams, (b) => clockSec - b.startSec < BEAM_SEC);
		for (const b of beams) {
			const age = math.max(clockSec - b.startSec, 0);
			b.ageSec = age;
			b.fade = beamFade(age);
			const epoch = beamJagEpoch(age, reducedMotion);
			beamJag(b.x1, b.z1, b.x2, b.z2, burstSeed(epoch, b.seed), b.points, this.rng);
		}
	}

	/** Ages every ring list and rebuilds the output `rings` (novas, origin flares, then followers). */
	private ageRings(state: Readonly<SimState>, n: number, clockSec: number, reducedMotion: boolean): void {
		const out = this.slot.rings;
		out.clear();
		for (const list of this.ringLists) {
			sweep(list, this.freeRings, (g) => {
				if (clockSec - g.startSec >= g.sec) return false;
				return g.player < 0 || (g.player < n && playerAt(state, g.player).dead === 0);
			});
			for (const g of list) {
				const age = math.max(clockSec - g.startSec, 0);
				if (g.player >= 0) {
					// Rings follow their player as drawn (docs/LOCAL_PREDICTION.md LP5).
					const p = drawnOrMerged(state, g.player, this.drawn);
					g.x = p.x;
					g.z = p.z;
				}
				g.radius = ringRadius(age, g.sec, g.r0, g.r1, reducedMotion);
				g.fade = lifeFade(age, g.sec, g.fadeShare) * g.strength;
				g.chordShare = g.look === "brace" ? braceChordShare(age) : 1;
				out.push(g);
			}
		}
	}

	private ageFlashes(clockSec: number, reducedMotion: boolean): void {
		const e = BUILD_FX_VIEW.execute;
		const flashes = this.slot.flashes;
		sweep(flashes, this.freeFlashes, (f) => clockSec - f.startSec < e.sec);
		for (const f of flashes) {
			const age = math.max(clockSec - f.startSec, 0);
			f.scale = executePop(age, reducedMotion);
			f.fade = lifeFade(age, e.sec, 1);
		}
	}
}

/** Appends a burst at (x, z) to `out`, reusing `pool`'s slot of the same index. */
function pushBurst(out: BurstSlot[], pool: BurstSlot[], x: number, z: number, owner: number, seed: number): void {
	const k = out.size();
	let b = pool[k];
	if (b === undefined) {
		b = { x: 0, z: 0, owner: 0, seed: 0 };
		pool.push(b);
	}
	b.x = x;
	b.z = z;
	b.owner = owner;
	b.seed = seed;
	out.push(b);
}

/** A ring look's BUILD_FX_VIEW block (its life, fade share and drawing sizes). */
export function buildRingBlock(look: BuildRingLook): BuildRingBlock {
	if (look === "nova") return BUILD_FX_VIEW.nova;
	if (look === "pop") return BUILD_FX_VIEW.pop;
	if (look === "heal") return BUILD_FX_VIEW.heal;
	if (look === "glint") return BUILD_FX_VIEW.glint;
	if (look === "brace") return BUILD_FX_VIEW.brace;
	return BUILD_FX_VIEW.flare;
}

function setRing(
	g: RingSlot,
	look: BuildRingLook,
	role: ColorRole,
	r0: number,
	r1: number,
	segments: number,
	player: number,
	clockSec: number,
): void {
	const b = buildRingBlock(look);
	g.look = look;
	g.role = role;
	g.chordShare = 1;
	g.strength = 1;
	g.r0 = r0;
	g.r1 = r1;
	g.segments = segments;
	g.player = player;
	g.startSec = clockSec;
	g.sec = b.sec;
	g.fadeShare = b.fadeShare;
}

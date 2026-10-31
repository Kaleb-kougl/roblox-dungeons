/**
 * Build effects, the pure rules (docs/BUILDS.md BU8). BuildFxDirector turns a frame's build effects
 * (BuildFxFrameSource, collected per tick by the run views) into what the client's BuildFxController and the particle
 * system draw, once per rendered frame after the ticks. It owns every rule that spans frames:
 *
 *   - Spark beams: one per hop, alive for the sim's SPARK_BEAM_TICKS in seconds (0.12 s), opaque for BUILD_FX_VIEW.beam
 *     .hold of it, then fading. A jagged line of beam.segments segments; the inner joints sit off the straight line by
 *     a seeded amount (render RNG; at most jagTiles, at most jagShare of the hop) and re-roll every rejagSec (a
 *     crackle), never under reduced motion. At most beam.maxAlive: a new beam past the cap replaces the oldest.
 *   - Spark bursts: one per hop at its target, the frame's new ones only, at most sparkBurst.perFrame (the view player's
 *     first); none with particles off. Reduced halves every count of the burst's shape (`burstShape`).
 *   - Novas (BU5's feed): an expanding floor ring, radius 0 -> the nova's, fading over the last fadeShare of nova.sec;
 *     ring segments halve under Reduced; under reduced motion the ring sits at its full radius and only fades.
 *   - Executes (BU5's feed): a flat flash popping out (no pop under reduced motion) and fading over execute.sec.
 *   - Evolve / duo flares: a ring around the taking player (its CURRENT position) in the card's role over flare.sec;
 *     a player's newer take replaces their flare. A dead player's flare ends.
 *   - Jackpot pops: a data slot (the sim feed has no field yet), aged and faded like the rest.
 *   - Trails: `trails` is true only with buildFx Full and not reduced motion (BulletRenderController's burst / shard
 *     trails).
 *
 * Gates: `quiet` (the stage cover or run over: comboQuiet) puts nothing out and forgets everything alive. A new run
 * (another state object, or the tick going back) forgets everything too. Records of a player outside the party are
 * ignored.
 *
 * No allocation in steady state: the output and its records are reused frame to frame. Presentation only.
 */
import { SIM_DT, SPARK_BEAM_TICKS, partySize, playerAt, type SimState } from "shared/sim";
import type { BuildFxLevel, JuiceSettings } from "shared/settings";
import type { ColorRole } from "shared/theme";
// Not the shared/view/hud barrel (hud imports this barrel): comboConfig only imports shared/sim.
import { semitonesToSpeed } from "../hud/comboConfig";
import { BUILD_FX_VIEW } from "./buildFxConfig";
import type { BuildFxFrameSource, EffectRecord, SparkRecord } from "./buildFxEvents";
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
	/** Opacity factor (1, then -> 0). */
	readonly fade: number;
	readonly ageSec: number;
}

/** One new spark burst at a target (sim units). */
export interface SparkBurstView {
	readonly x: number;
	readonly z: number;
	readonly owner: number;
	readonly seed: number;
}

/** One live floor ring (a nova or an evolve / duo flare). */
export interface RingView {
	readonly x: number;
	readonly z: number;
	/** Current radius, sim units. */
	readonly radius: number;
	readonly fade: number;
	readonly role: ColorRole;
	/** Segments to draw (Reduced halves them). */
	readonly segments: number;
	/** BUILD_FX_VIEW.nova or .flare drawing block. */
	readonly flare: boolean;
}

/** One live execute flash. */
export interface FlashView {
	readonly x: number;
	readonly z: number;
	/** Diameter factor (popScale -> 1). */
	readonly scale: number;
	readonly fade: number;
}

/** One live Jackpot pop (slot: the sim feed has no field yet). */
export interface JackpotView {
	readonly x: number;
	readonly z: number;
	readonly owner: number;
	readonly amount: number;
	readonly ageSec: number;
	readonly fade: number;
}

/** What BuildFxDirector.frame fills (reused: valid until the next frame call). */
export interface BuildFxFrame {
	readonly beams: ReadonlyArray<BeamView>;
	readonly sparkBursts: ReadonlyArray<SparkBurstView>;
	/** The spark burst's shape this frame (Full, or Reduced's halved counts). */
	readonly burstShape: Readonly<ChipBurst>;
	readonly rings: ReadonlyArray<RingView>;
	readonly flashes: ReadonlyArray<FlashView>;
	readonly jackpots: ReadonlyArray<JackpotView>;
	/** Draw the burst / shard bullet trails (Full and not reduced motion). */
	readonly trails: boolean;
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
	const s = BUILD_FX_VIEW.sparkBurst;
	return {
		chunks: buildFxCount(s.chunks, level),
		bits: buildFxCount(s.bits, level),
		sparks: buildFxCount(s.sparks, level),
		startPx: s.startPx,
		radius: s.radius,
		speed: s.speed,
	};
}

/** The look of nova kind `kind`. */
function novaRole(kind: number): ColorRole {
	const n = BUILD_FX_VIEW.nova;
	return (n.looks[kind] ?? n.fallback).role;
}

interface BeamSlot {
	x1: number;
	z1: number;
	x2: number;
	z2: number;
	owner: number;
	gen: number;
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
	/** Nova: its radius; flare: unused (flare r0 / r1). */
	maxRadius: number;
	radius: number;
	fade: number;
	role: ColorRole;
	segments: number;
	flare: boolean;
	/** Flares follow this player (-1: a nova). */
	player: number;
	startSec: number;
}

interface FlashSlot {
	x: number;
	z: number;
	scale: number;
	fade: number;
	startSec: number;
}

interface JackpotSlot {
	x: number;
	z: number;
	owner: number;
	amount: number;
	ageSec: number;
	fade: number;
	startSec: number;
}

interface FrameSlot {
	readonly beams: BeamSlot[];
	readonly sparkBursts: BurstSlot[];
	burstShape: ChipBurst;
	readonly rings: RingSlot[];
	readonly flashes: FlashSlot[];
	readonly jackpots: JackpotSlot[];
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

/** The build effects' per-frame director (see the file comment). One per client (BuildFxController). */
export class BuildFxDirector {
	readonly out: BuildFxFrame;

	private readonly slot: FrameSlot = {
		beams: [],
		sparkBursts: [],
		burstShape: FULL_SHAPE,
		rings: [],
		flashes: [],
		jackpots: [],
		trails: true,
	};
	private readonly freeBeams: BeamSlot[] = [];
	private readonly burstPool: BurstSlot[] = [];
	private readonly freeRings: RingSlot[] = [];
	private readonly freeFlashes: FlashSlot[] = [];
	private readonly freeJackpots: JackpotSlot[] = [];
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
		for (const r of s.rings) this.freeRings.push(r);
		s.rings.clear();
		for (const f of s.flashes) this.freeFlashes.push(f);
		s.flashes.clear();
		for (const j of s.jackpots) this.freeJackpots.push(j);
		s.jackpots.clear();
		s.sparkBursts.clear();
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
	): BuildFxFrame {
		const out = this.slot;
		out.sparkBursts.clear();
		if (state !== this.lastState || state.tick < this.lastTick) this.resetAll();
		this.lastState = state;
		this.lastTick = state.tick;
		const juice = settings.juice;
		const level = settings.buildFx;
		out.trails = buildTrailsOn(level, juice.reducedMotion);
		out.burstShape = level === "full" ? FULL_SHAPE : REDUCED_SHAPE;
		if (quiet) {
			this.resetAll();
			return this.out;
		}
		const n = partySize(state);
		const reduced = juice.reducedMotion;
		this.addBeams(source.sparks, n, clockSec);
		if (effectiveParticles(juice) !== "off") {
			this.addBursts(source.sparks, n, viewIndex, true);
			this.addBursts(source.sparks, n, viewIndex, false);
		}
		this.addNovas(source.novas, n, level, clockSec);
		this.addFlashes(source, clockSec);
		this.addJackpots(source.jackpots, n, clockSec);
		this.addFlares(source, n, level, clockSec);
		this.ageBeams(clockSec, reduced);
		this.ageRings(state, n, clockSec, reduced);
		this.ageFlashes(clockSec, reduced);
		this.ageJackpots(clockSec);
		return this.out;
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
			b.seed = burstSeed(i, r.tick, BUILD_FX_VIEW.beam.seedSalt);
			b.startSec = clockSec;
		}
	}

	/** One pass of spark bursts: the view player's (`viewPass`) or everyone else's, up to the frame's cap. */
	private addBursts(sparks: ReadonlyArray<SparkRecord>, n: number, viewIndex: number, viewPass: boolean): void {
		const out = this.slot.sparkBursts;
		const sb = BUILD_FX_VIEW.sparkBurst;
		for (let i = 0; i < sparks.size(); i++) {
			if (out.size() >= sb.perFrame) return;
			const r = sparks[i];
			if (r.owner < 0 || r.owner >= n || (r.owner === viewIndex) !== viewPass) continue;
			const k = out.size();
			let b = this.burstPool[k];
			if (b === undefined) {
				b = { x: 0, z: 0, owner: 0, seed: 0 };
				this.burstPool.push(b);
			}
			b.x = r.x2;
			b.z = r.z2;
			b.owner = r.owner;
			b.seed = burstSeed(i, r.tick, sb.seedSalt);
			out.push(b);
		}
	}

	private newRing(): RingSlot {
		return {
			x: 0,
			z: 0,
			maxRadius: 0,
			radius: 0,
			fade: 1,
			role: BUILD_FX_VIEW.nova.fallback.role,
			segments: 0,
			flare: false,
			player: -1,
			startSec: 0,
		};
	}

	private addNovas(novas: ReadonlyArray<EffectRecord>, n: number, level: BuildFxLevel, clockSec: number): void {
		const nv = BUILD_FX_VIEW.nova;
		for (const r of novas) {
			if (r.owner < 0 || r.owner >= n) continue;
			const g = claim(this.slot.rings, this.freeRings, nv.maxAlive + n, () => this.newRing());
			g.x = r.x;
			g.z = r.z;
			g.maxRadius = r.amount;
			g.role = novaRole(r.kind);
			g.segments = buildFxCount(nv.segments, level);
			g.flare = false;
			g.player = -1;
			g.startSec = clockSec;
		}
	}

	private addFlares(source: BuildFxFrameSource, n: number, level: BuildFxLevel, clockSec: number): void {
		const f = BUILD_FX_VIEW.flare;
		for (const t of source.evolved) this.flare(t.player, f.evolvedRole, n, level, clockSec);
		for (const t of source.duos) this.flare(t.player, f.duoRole, n, level, clockSec);
	}

	private flare(player: number, role: ColorRole, n: number, level: BuildFxLevel, clockSec: number): void {
		if (player < 0 || player >= n) return;
		const rings = this.slot.rings;
		let g: RingSlot | undefined;
		for (const r of rings) if (r.flare && r.player === player) g = r;
		if (g === undefined) g = claim(rings, this.freeRings, BUILD_FX_VIEW.nova.maxAlive + n, () => this.newRing());
		g.role = role;
		g.segments = buildFxCount(BUILD_FX_VIEW.flare.segments, level);
		g.flare = true;
		g.player = player;
		g.startSec = clockSec;
	}

	private addFlashes(source: BuildFxFrameSource, clockSec: number): void {
		for (const r of source.executes) {
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

	private addJackpots(jackpots: ReadonlyArray<EffectRecord>, n: number, clockSec: number): void {
		for (const r of jackpots) {
			if (r.owner < 0 || r.owner >= n) continue;
			const j = claim(this.slot.jackpots, this.freeJackpots, BUILD_FX_VIEW.jackpot.maxAlive, () => ({
				x: 0,
				z: 0,
				owner: 0,
				amount: 0,
				ageSec: 0,
				fade: 1,
				startSec: 0,
			}));
			j.x = r.x;
			j.z = r.z;
			j.owner = r.owner;
			j.amount = r.amount;
			j.startSec = clockSec;
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

	private ageRings(state: Readonly<SimState>, n: number, clockSec: number, reducedMotion: boolean): void {
		const rings = this.slot.rings;
		const nv = BUILD_FX_VIEW.nova;
		const f = BUILD_FX_VIEW.flare;
		sweep(rings, this.freeRings, (g) => {
			const age = clockSec - g.startSec;
			if (!g.flare) return age < nv.sec;
			return age < f.sec && g.player < n && playerAt(state, g.player).dead === 0;
		});
		for (const g of rings) {
			const age = math.max(clockSec - g.startSec, 0);
			if (g.flare) {
				const p = playerAt(state, g.player);
				g.x = p.x;
				g.z = p.z;
				g.radius = ringRadius(age, f.sec, f.r0Tiles, f.r1Tiles, reducedMotion);
				g.fade = lifeFade(age, f.sec, f.fadeShare);
			} else {
				g.radius = ringRadius(age, nv.sec, 0, g.maxRadius, reducedMotion);
				g.fade = lifeFade(age, nv.sec, nv.fadeShare);
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

	private ageJackpots(clockSec: number): void {
		const sec = BUILD_FX_VIEW.jackpot.sec;
		const list = this.slot.jackpots;
		sweep(list, this.freeJackpots, (j) => clockSec - j.startSec < sec);
		for (const j of list) {
			j.ageSec = math.max(clockSec - j.startSec, 0);
			j.fade = lifeFade(j.ageSec, sec, 1);
		}
	}
}

/**
 * docs/LOCAL_PREDICTION.md LP1 / LP2: the motion mirror (predictMotion.ts) against the real sim, bit for bit.
 *
 * Every tick of a random walk (walks with held and changing sticks, quantized and full keyboard axes, ROLL / FLASK /
 * ATTACK / ALT / SWAP taps and holds, aim on and off; Quickstep and Frenzy timers running out; boons granted along the
 * way: Swift Strikes, Bastion, Ballista II) the mirror replays the tick from the merged state and must equal what
 * step / stepParty gives: the body, the sword's and the bow's motion counters, the active set, the boost timers. Every
 * HORIZON_STRIDE ticks it also replays HORIZON ticks ahead from that one base (as the predictor does: the same merged
 * state for every replayed tick) and must equal the real state HORIZON ticks later.
 *
 * Worlds: endless floors (the dev world: god mode, so hits never touch the body; breakables as solid cells, the slide
 * mover) on seeds 1..ENDLESS_SEEDS, start floors cycling through the non-boss FLOORS, the Knight (sword), the Archer
 * (bow, 140 % dash) and both weapons (swaps); a co-op party of two (both players predicted); M1 without enemies
 * (dungeonNoEncounter) with the slide and with the web mover, under the port's and the web build's sword timings.
 *
 * Ticks the census marks corrected are excused, never compared, and counted: a floor change, a boost picked up, a piece
 * broken during the tick (a Charger, a swing), a draft (the predictor stops; the spec dismisses it), a Chainhook's drag.
 * The merged state's hash is checked unchanged by every replay.
 *
 * Sword spacing (docs/SWORD_SPACING.md Design 5, SP5): every live world carries SimConfig.spacing, so every replay
 * brakes against its own list (buildMotionSpacing) from the merged state it starts from, as the predictor does. The
 * brawls walk a Knight (and "both") at the nearest contact enemy holding FIRE, solo and in co-op, on endless floors,
 * with the enemies held in place (positions and hp put back after every tick: the horizons must match exactly while
 * braking) and live. Coverage `brake` / `lungeBrake`: the tick's mirror braked (it differs from the same tick replayed
 * without the brake, or with the walk's brake only) and equals the sim bit for bit. A horizon is excused only when, on
 * one of its ticks, the brake engaged (in the real tick or in the horizon's replay) while the tick-start spacing list
 * differed from the horizon's merged one (an entry moved, appeared or went: the predictor cannot know); the excused
 * share stays under MAX_EXCUSED_SHARE.
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AXIS_MAX,
	BOW_V_CHARGE,
	Boon,
	Boost,
	Button,
	SWORD_DATA,
	SWORD_STEP_WINDUP,
	SWORD_V_BUSY,
	SWORD_V_GUARD,
	SWORD_V_STEP,
	SWORD_V_WINDOW,
	WALK_STEP,
	WEB_SWORD_TIMINGS,
	createSimState,
	grantCard,
	hashState,
	isDraftOpen,
	partySize,
	playerAt,
	playerTraits,
	quantizeAxis,
	archetypeAt,
	archetypeIndex,
	chainhookHolderOf,
	NO_KIND,
	setSwordTimings,
	simWorldConfig,
	step,
	stepParty,
	weaponMoveMultiplier,
	weaponsAt,
	Rng,
	SWORD_WEAPON_ID,
	weaponIndex,
	type InputFrame,
	type SimConfig,
	type SimState,
	type SpacingConfig,
	type SpacingList,
	type SpacingTick,
} from "shared/sim";
import { PlayerMover, buildDevRunConfig, buildEndlessRunConfig, buildRunConfig, setPlayerMover } from "shared/run";
import type { CharacterId } from "shared/characters";
import { dismissDraft, placeParty, skipPartyToFloor } from "shared/run/testing";
import {
	buildMotionSpacing,
	copyMotionBase,
	copyMotionScratch,
	newMotionScratch,
	newMotionSpacing,
	predictMotionTick,
	type MotionScratch,
	type MotionSpacing,
} from "./predictMotion";

const ENDLESS_SEEDS = 20;
const ENDLESS_TICKS = 500;
const FLOORS = [1, 2, 3, 4, 6, 7, 8, 9];
const PARTY_SEEDS = 4;
const PARTY_TICKS = 500;
const M1_SEEDS = [1337, 7, 4242, 90210];
const M1_TICKS = 1250;
const HORIZON = 10;
const HORIZON_STRIDE = 25;
/** Mutations (boosts, hearts, boons) happen on this phase of the stride, when no horizon window is open. */
const MUTATE_PHASE = 15;
/** At most this share of ticks may be excused (the census's corrected cases are rare in a random walk). */
const MAX_EXCUSED_SHARE = 0.1;
/**
 * A live brawl's cap on horizons excused by the brake (docs/SWORD_SPACING.md SP5): its contact enemies chase, so the
 * merged list the predictor freezes is often stale (0.098 measured). Looser than MAX_EXCUSED_SHARE because the informed
 * twin replays every excused horizon against each tick's own list and compares it exactly.
 */
const MAX_BRAKE_EXCUSED_LIVE = 0.2;
/** The brawls (docs/SWORD_SPACING.md SP5): seeds, ticks, start floors (non-boss), the held enemies' hp. */
const BRAWL_SEEDS = 8;
const BRAWL_TICKS = 400;
const BRAWL_FLOORS = [1, 2, 3, 4, 6, 7, 8, 9];
const BRAWL_PARTY_SEEDS = 4;
const HELD_HP = 1e6;
/** sin(22.5 degrees): a direction component past it presses that axis's key (the nearest of the 8 key directions). */
const KEY_AXIS_SIN = 0.3826834323650898;

/** Where a walker's next frame comes from; `state` is the merged state HORIZON ticks before the frame's tick. */
interface InputSource {
	next(state: Readonly<SimState>, i: number): InputFrame;
}

/** A random walker: state-independent, so its next inputs can be generated ahead (the horizon replay). */
class Walker implements InputSource {
	private readonly rng: Rng;
	private moveX = 0;
	private moveZ = 0;
	private moveLeft = 0;
	private aimX = 0;
	private aimZ = 0;
	private aimLeft = 0;
	private held = 0;
	private readonly holdLeft = new Map<number, number>();

	constructor(seed: number, private readonly swaps: boolean) {
		this.rng = new Rng(seed);
	}

	private chance(p: number): boolean {
		return this.rng.next() < p;
	}

	private int(lo: number, hi: number): number {
		return lo + math.floor(this.rng.next() * (hi - lo + 1));
	}

	private button(bit: number, startChance: number, minHold: number, maxHold: number): void {
		const left = this.holdLeft.get(bit) ?? 0;
		if (left > 0) {
			this.holdLeft.set(bit, left - 1);
			if (left - 1 === 0) this.held = bit32.band(this.held, bit32.bnot(bit));
			return;
		}
		if (this.chance(startChance)) {
			this.held = bit32.bor(this.held, bit);
			this.holdLeft.set(bit, this.int(minHold, maxHold));
		}
	}

	next(): InputFrame {
		return this.frame();
	}

	frame(): InputFrame {
		if (this.moveLeft <= 0) {
			this.moveLeft = this.int(5, 60);
			const r = this.rng.next();
			if (r < 0.15) {
				this.moveX = 0;
				this.moveZ = 0;
			} else if (r < 0.55) {
				// Keyboard: full axes, diagonals over unit length (stepPlayer clamps them).
				this.moveX = this.int(-1, 1) * AXIS_MAX;
				this.moveZ = this.int(-1, 1) * AXIS_MAX;
			} else {
				this.moveX = quantizeAxis(this.rng.next() * 2 - 1);
				this.moveZ = quantizeAxis(this.rng.next() * 2 - 1);
			}
		}
		this.moveLeft--;
		if (this.aimLeft <= 0) {
			this.aimLeft = this.int(10, 80);
			if (this.chance(0.4)) {
				this.aimX = 0;
				this.aimZ = 0;
			} else {
				this.aimX = quantizeAxis(this.rng.next() * 2 - 1);
				this.aimZ = quantizeAxis(this.rng.next() * 2 - 1);
			}
		}
		this.aimLeft--;
		this.button(Button.ROLL, 0.02, 1, 30);
		this.button(Button.FLASK, 0.01, 1, 5);
		this.button(Button.FIRE, 0.03, 5, 90);
		this.button(Button.ALT, 0.02, 1, 50);
		if (this.swaps) this.button(Button.SWAP, 0.01, 1, 4);
		return { moveX: this.moveX, moveZ: this.moveZ, aimX: this.aimX, aimZ: this.aimZ, buttons: this.held };
	}
}

/** The nearest live contact enemy (contactDamage > 0) to player i, or undefined. */
function nearestContact(state: Readonly<SimState>, i: number): { x: number; z: number } | undefined {
	const p = playerAt(state, i);
	let best = math.huge;
	let out: { x: number; z: number } | undefined;
	for (const a of state.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0 || archetypeAt(a.kind).data.contactDamage <= 0) continue;
		const d2 = (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z);
		if (d2 < best) {
			best = d2;
			out = { x: a.x, z: a.z };
		}
	}
	return out;
}

/**
 * A brawler (docs/SWORD_SPACING.md SP5): walks at the nearest contact enemy (keys: the nearest of the 8 full-axis
 * directions, the owner's case; a quantized stick; now and then sideways round it) holding FIRE most of the time (a
 * release now and then: the combo window), aims at it, taps ALT / ROLL / SWAP rarely. Without a contact enemy in reach
 * it walks like a Walker. Reads the state HORIZON ticks before its frame (generated ahead, like every walker's).
 */
class Brawler implements InputSource {
	private readonly rng: Rng;
	private readonly walker: Walker;
	private mode = 0;
	private modeLeft = 0;
	private fireLeft = 0;
	private firing = true;
	private extra = 0;
	private extraLeft = 0;

	constructor(seed: number, private readonly swaps: boolean) {
		this.rng = new Rng(seed);
		this.walker = new Walker(seed + 1, swaps);
	}

	private int(lo: number, hi: number): number {
		return lo + math.floor(this.rng.next() * (hi - lo + 1));
	}

	next(state: Readonly<SimState>, i: number): InputFrame {
		const fallback = this.walker.frame();
		const target = nearestContact(state, i);
		if (target === undefined) return fallback;
		const p = playerAt(state, i);
		let dx = target.x - p.x;
		let dz = target.z - p.z;
		const len = math.sqrt(dx * dx + dz * dz);
		if (len === 0) return fallback;
		dx /= len;
		dz /= len;
		if (this.modeLeft <= 0) {
			this.modeLeft = this.int(10, 40);
			const r = this.rng.next();
			this.mode = r < 0.55 ? 0 : r < 0.85 ? 1 : 2;
		}
		this.modeLeft--;
		let moveX: number;
		let moveZ: number;
		if (this.mode === 0) {
			// Keys: the nearest of the 8 full-axis directions.
			moveX = math.abs(dx) > KEY_AXIS_SIN ? (dx > 0 ? AXIS_MAX : -AXIS_MAX) : 0;
			moveZ = math.abs(dz) > KEY_AXIS_SIN ? (dz > 0 ? AXIS_MAX : -AXIS_MAX) : 0;
		} else if (this.mode === 1) {
			moveX = quantizeAxis(dx);
			moveZ = quantizeAxis(dz);
		} else {
			// Sideways and a little in: round the enemy (the brake keeps the tangent outside the stop cone).
			moveX = quantizeAxis(-dz * 0.8 + dx * 0.6);
			moveZ = quantizeAxis(dx * 0.8 + dz * 0.6);
		}
		if (this.fireLeft <= 0) {
			this.firing = this.rng.next() < 0.8;
			this.fireLeft = this.firing ? this.int(20, 120) : this.int(3, 40);
		}
		this.fireLeft--;
		if (this.extraLeft <= 0) {
			this.extra = 0;
			const r = this.rng.next();
			if (r < 0.02) this.extra = Button.ALT;
			else if (r < 0.03) this.extra = Button.ROLL;
			else if (this.swaps && r < 0.035) this.extra = Button.SWAP;
			this.extraLeft = this.extra !== 0 ? this.int(1, 6) : 1;
		}
		this.extraLeft--;
		const aim = this.rng.next() < 0.9;
		return {
			moveX,
			moveZ,
			aimX: aim ? quantizeAxis(dx) : 0,
			aimZ: aim ? quantizeAxis(dz) : 0,
			buttons: bit32.bor(this.firing ? Button.FIRE : 0, this.extra),
		};
	}
}

/** True when two spacing lists hold the same entries in the same order, bit for bit. */
function sameList(a: Readonly<SpacingList>, b: Readonly<SpacingList>): boolean {
	if (a.count !== b.count) return false;
	for (let k = 0; k < a.count; k++) {
		if (a.x[k] !== b.x[k] || a.z[k] !== b.z[k] || a.keep[k] !== b.keep[k]) return false;
	}
	return true;
}

/** True when two scratches' bodies stand in different places. */
function moved(a: Readonly<MotionScratch>, b: Readonly<MotionScratch>): boolean {
	return a.player.x !== b.player.x || a.player.z !== b.player.z;
}

/** Where the mirror and the sim disagree (empty: they match). */
function difference(s: Readonly<MotionScratch>, state: Readonly<SimState>, i: number): string | undefined {
	const p = playerAt(state, i);
	const q = s.player;
	const fields = [
		["x", q.x, p.x],
		["z", q.z, p.z],
		["prevX", q.prevX, p.prevX],
		["prevZ", q.prevZ, p.prevZ],
		["faceX", q.faceX, p.faceX],
		["faceZ", q.faceZ, p.faceZ],
		["rollTicks", q.rollTicks, p.rollTicks],
		["rollDirX", q.rollDirX, p.rollDirX],
		["rollDirZ", q.rollDirZ, p.rollDirZ],
		["flaskTicks", q.flaskTicks, p.flaskTicks],
		["prevButtons", q.prevButtons, p.prevButtons],
	] as const;
	for (const [name, a, b] of fields) if (a !== b) return `${name} ${a} vs ${b}`;
	const w = weaponsAt(state, i);
	if (s.weapons.activeSet !== w.activeSet) return `activeSet ${s.weapons.activeSet} vs ${w.activeSet}`;
	if (s.weapons.prevButtons !== w.prevButtons) return `weapons.prevButtons`;
	for (let k = 0; k < w.sets.size(); k++) {
		const a = s.weapons.sets[k];
		const b = w.sets[k];
		const def = b.weapon;
		const sword = playerSwordIndex();
		if (def === sword) {
			if (a.cooldown !== b.cooldown) return `set ${k} sword cooldown ${a.cooldown} vs ${b.cooldown}`;
			for (const v of [SWORD_V_STEP, SWORD_V_BUSY, SWORD_V_WINDOW, SWORD_V_GUARD]) {
				if (a.v[v] !== b.v[v]) return `set ${k} sword v[${v}] ${a.v[v]} vs ${b.v[v]}`;
			}
		} else if (a.v[BOW_V_CHARGE] !== b.v[BOW_V_CHARGE]) {
			return `set ${k} bow charge ${a.v[BOW_V_CHARGE]} vs ${b.v[BOW_V_CHARGE]}`;
		}
	}
	const bp = state.drops?.players[i];
	const qs = bp !== undefined ? bp.ticks[Boost.QUICKSTEP] : 0;
	const fr = bp !== undefined ? bp.ticks[Boost.FRENZY] : 0;
	if (s.quickstepTicks !== qs) return `quickstep ${s.quickstepTicks} vs ${qs}`;
	if (s.frenzyTicks !== fr) return `frenzy ${s.frenzyTicks} vs ${fr}`;
	return undefined;
}

let swordIdx: number | undefined;
function playerSwordIndex(): number {
	if (swordIdx === undefined) swordIdx = weaponIndex(SWORD_WEAPON_ID);
	return swordIdx;
}

interface Tally {
	compared: number;
	excused: number;
	horizons: number;
	horizonsExcused: number;
	/** Horizons excused because the brake engaged while the spacing list differed from the merged one (SP5). */
	horizonsBrakeExcused: number;
	/** Horizons where that happened, whether or not the replay then differed. */
	horizonsBrakeFlagged: number;
	failures: string[];
	/** What the compared ticks exercised (kind -> ticks), so a walk that never guards or charges cannot pass. */
	coverage: Map<string, number>;
}

function newTally(): Tally {
	return {
		compared: 0,
		excused: 0,
		horizons: 0,
		horizonsExcused: 0,
		horizonsBrakeExcused: 0,
		horizonsBrakeFlagged: 0,
		failures: [],
		coverage: new Map(),
	};
}

/** Intact pieces (a tick that breaks one is excused: pieces are read from the merged state). */
function intact(state: Readonly<SimState>): number {
	return state.breakables?.intact ?? 0;
}

/** Test-only nudges between windows: boosts that run out, a wound for the flask, a boon now and then. */
function mutate(state: SimState, rng: Rng, players: number): void {
	for (let i = 0; i < players; i++) {
		const bp = state.drops?.players[i];
		if (bp !== undefined) {
			if (rng.next() < 0.3) bp.ticks[Boost.QUICKSTEP] = 1 + math.floor(rng.next() * 40);
			if (rng.next() < 0.3) bp.ticks[Boost.FRENZY] = 1 + math.floor(rng.next() * 40);
		}
		const p = playerAt(state, i);
		if (p.dead === 0 && rng.next() < 0.3) {
			p.hearts = math.max(1, p.hearts - 2);
			if (p.flask === 0) p.flask = 1;
		}
		if (state.builds !== undefined && rng.next() < 0.05) {
			const pick = rng.next();
			if (pick < 0.4) grantCard(state, i, Boon.SWIFT_STRIKES);
			else if (pick < 0.7) grantCard(state, i, Boon.BASTION);
			else grantCard(state, i, Boon.BALLISTA);
		}
	}
}

const COVERAGE_KINDS = [
	"walk",
	"blocked",
	"roll",
	"flask",
	"guard",
	"bastionGuard",
	"windup",
	"charge",
	"swap",
	"quickstep",
	"frenzy",
	"aim",
	"brake",
	"lungeBrake",
] as const;

function bump(tally: Tally, kind: string): void {
	tally.coverage.set(kind, (tally.coverage.get(kind) ?? 0) + 1);
}

/** Counts what the tick just stepped exercised (read from the real state). */
function cover(
	tally: Tally,
	state: Readonly<SimState>,
	i: number,
	s: Readonly<MotionScratch>,
	input: Readonly<InputFrame>,
): void {
	const p = playerAt(state, i);
	const w = weaponsAt(state, i);
	const dx = p.x - p.prevX;
	const dz = p.z - p.prevZ;
	if (dx !== 0 || dz !== 0) bump(tally, "walk");
	if (p.rollTicks > 0) bump(tally, "roll");
	if (p.flaskTicks > 0) bump(tally, "flask");
	if (bit32.band(p.prevButtons, Button.SWAP) !== 0) bump(tally, "swap");
	const slot = w.sets[w.activeSet];
	if (slot.weapon === playerSwordIndex()) {
		if (slot.v[SWORD_V_GUARD] > 0) bump(tally, "guard");
		if (slot.v[SWORD_V_GUARD] > SWORD_DATA.guardTicks) bump(tally, "bastionGuard");
		if (slot.v[SWORD_V_STEP] === SWORD_STEP_WINDUP) bump(tally, "windup");
	} else if (slot.v[BOW_V_CHARGE] > 0) bump(tally, "charge");
	if (s.quickstepTicks > 0) bump(tally, "quickstep");
	if (s.frenzyTicks > 0) bump(tally, "frenzy");
	// A full-speed walk tick that moved under half its step: a wall, a pillar or a piece (the resolver's paths).
	const mx = input.moveX / AXIS_MAX;
	const mz = input.moveZ / AXIS_MAX;
	const full = mx * mx + mz * mz >= 1 && p.rollTicks === 0 && p.flaskTicks === 0 && weaponMoveMultiplier(w) === 1;
	if (full && s.quickstepTicks === 0 && dx * dx + dz * dz < WALK_STEP * WALK_STEP * 0.25) bump(tally, "blocked");
	if (input.aimX !== 0 || input.aimZ !== 0) bump(tally, "aim");
}

interface Window {
	readonly start: number;
	readonly player: number;
	readonly scratch: MotionScratch;
	/** The horizon's own brake, from the merged state it starts from (as the predictor's per pass). */
	readonly spacing: MotionSpacing;
	/** Per replayed tick: whether the horizon's replay braked on it. */
	readonly brakedAt: boolean[];
	/**
	 * The same horizon replayed tick by tick as the real ticks come, each against that tick's own spacing list (what
	 * the predictor would give if it knew where the enemies go): always compared, never excused by the brake.
	 */
	readonly informed: MotionScratch;
	excused: boolean;
	brakeExcused: boolean;
}

/** Test-only: contact enemies put back where they first stood after every tick, every enemy's hp kept high. */
class Holder {
	private readonly ids: number[] = [];
	private readonly xs: number[] = [];
	private readonly zs: number[] = [];

	apply(state: SimState): void {
		const actors = state.combat.actors;
		for (let k = 0; k < actors.size(); k++) {
			const a = actors[k];
			if (a.kind === NO_KIND || a.alive === 0) continue;
			while (this.ids.size() <= k) {
				this.ids.push(0);
				this.xs.push(0);
				this.zs.push(0);
			}
			if (this.ids[k] !== a.id) {
				this.ids[k] = a.id;
				this.xs[k] = a.x;
				this.zs[k] = a.z;
			}
			a.hp = HELD_HP;
			if (archetypeAt(a.kind).data.contactDamage <= 0) continue;
			a.x = this.xs[k];
			a.z = this.zs[k];
		}
	}
}

/** The tick's brake with the lunge's half off (the walk's brake alone), for the coverage split. */
function walkOnlyOf(spacing: SpacingTick | undefined): SpacingTick | undefined {
	if (spacing === undefined) return undefined;
	const config: SpacingConfig = { ...spacing.config, lunge: false };
	return { list: spacing.list, config };
}

/**
 * Walks `ticks` ticks of `config` on `state`, the players driven by `sources` (solo: step), comparing the mirror every
 * tick and every HORIZON_STRIDE ticks over HORIZON ticks (see the file comment). `hold`: enemies held in place.
 */
function walk(
	config: Readonly<SimConfig>,
	state: SimState,
	seed: number,
	ticks: number,
	sources: ReadonlyArray<InputSource>,
	tally: Tally,
	hold?: Holder,
): void {
	const n = partySize(state);
	const rng = new Rng(seed * 7 + 1);
	// Inputs generated ahead: queue[k] = the frames of tick (state.tick + k).
	const queue: InputFrame[][] = [];
	const fill = () => {
		while (queue.size() < HORIZON + 1) {
			const frames: InputFrame[] = [];
			for (let i = 0; i < n; i++) frames.push(sources[i].next(state, i));
			queue.push(frames);
		}
	};
	const windows: Window[] = [];
	const tickSpacingScratch = newMotionSpacing();
	const plain = newMotionScratch();
	const walkOnly = newMotionScratch();
	const unbraked = newMotionScratch();
	hold?.apply(state);
	for (let t = 0; t < ticks; t++) {
		if (isDraftOpen(state)) dismissDraft(state);
		if (t % HORIZON_STRIDE === MUTATE_PHASE) mutate(state, rng, n);
		fill();
		const frames = queue.remove(0)!;
		const world = simWorldConfig(state, config);
		const before = hashState(state);
		// This tick's brake, from the merged (tick-start) state: what the sim builds in tickSpacing.
		const spacing = buildMotionSpacing(tickSpacingScratch, state, config.spacing);
		const walkSpacing = walkOnlyOf(spacing);
		// Horizon windows: HORIZON ticks replayed from this one merged state (with its own list, built once).
		if (t % HORIZON_STRIDE === 0) {
			for (let i = 0; i < n; i++) {
				if (playerAt(state, i).dead !== 0) continue;
				const w: Window = {
					start: state.tick,
					player: i,
					scratch: newMotionScratch(),
					spacing: newMotionSpacing(),
					brakedAt: [],
					informed: newMotionScratch(),
					excused: false,
					brakeExcused: false,
				};
				const own = buildMotionSpacing(w.spacing, state, config.spacing);
				copyMotionBase(w.scratch, state, i);
				copyMotionBase(w.informed, state, i);
				for (let k = 0; k < HORIZON; k++) {
					const frame = k === 0 ? frames[i] : queue[k - 1][i];
					if (own !== undefined) {
						copyMotionScratch(unbraked, w.scratch);
						predictMotionTick(unbraked, state, frame, world, i, playerTraits(config, i));
					}
					predictMotionTick(w.scratch, state, frame, world, i, playerTraits(config, i), own);
					w.brakedAt.push(own !== undefined && moved(unbraked, w.scratch));
				}
				windows.push(w);
			}
		}
		// One tick per player from this merged state (and, for the coverage, without the brake and with the walk's only).
		const singles: MotionScratch[] = [];
		const braked: boolean[] = [];
		const lungeBraked: boolean[] = [];
		for (let i = 0; i < n; i++) {
			const s = newMotionScratch();
			copyMotionBase(s, state, i);
			predictMotionTick(s, state, frames[i], world, i, playerTraits(config, i), spacing);
			singles.push(s);
			if (spacing !== undefined) {
				copyMotionBase(plain, state, i);
				predictMotionTick(plain, state, frames[i], world, i, playerTraits(config, i));
				copyMotionBase(walkOnly, state, i);
				predictMotionTick(walkOnly, state, frames[i], world, i, playerTraits(config, i), walkSpacing);
				braked.push(moved(plain, s));
				lungeBraked.push(moved(walkOnly, s));
			} else {
				braked.push(false);
				lungeBraked.push(false);
			}
		}
		expect(hashState(state)).toBe(before);
		// SP5: a horizon whose brake engages on a tick whose list is not the horizon's own cannot be predicted; its
		// informed twin steps this tick against this tick's list.
		for (const w of windows) {
			const k = state.tick - w.start;
			if (k < 0 || k >= HORIZON) continue;
			const i = w.player;
			predictMotionTick(w.informed, state, frames[i], world, i, playerTraits(config, i), spacing);
			if (spacing === undefined) continue;
			if (!(braked[i] || w.brakedAt[k])) continue;
			if (!sameList(w.spacing.list, spacing.list)) w.brakeExcused = true;
		}
		const pieces = intact(state);
		const deadBefore: boolean[] = [];
		const hookedBefore: boolean[] = [];
		for (let i = 0; i < n; i++) {
			deadBefore.push(playerAt(state, i).dead !== 0);
			hookedBefore.push(chainhookHolderOf(state, i) >= 0);
		}
		if (n === 1) step(state, frames[0], config);
		else stepParty(state, frames, config);
		hold?.apply(state);
		let hooked = false;
		for (let i = 0; i < n; i++) if (hookedBefore[i] || chainhookHolderOf(state, i) >= 0) hooked = true;
		const excused =
			state.events.floorChanged !== 0 ||
			intact(state) !== pieces ||
			isDraftOpen(state) ||
			hooked ||
			(state.drops?.events.collected.size() ?? 0) > 0;
		for (let i = 0; i < n; i++) {
			if (deadBefore[i] || playerAt(state, i).dead !== 0) continue;
			if (excused) {
				tally.excused++;
				continue;
			}
			tally.compared++;
			cover(tally, state, i, singles[i], frames[i]);
			if (braked[i]) bump(tally, "brake");
			if (lungeBraked[i]) bump(tally, "lungeBrake");
			const d = difference(singles[i], state, i);
			if (d !== undefined && tally.failures.size() < 5) tally.failures.push(`seed ${seed} tick ${t} p${i}: ${d}`);
		}
		for (const w of windows) if (excused) w.excused = true;
		let k = 0;
		while (k < windows.size()) {
			const w = windows[k];
			if (state.tick < w.start + HORIZON) {
				k++;
				continue;
			}
			windows.remove(k);
			if (w.excused || playerAt(state, w.player).dead !== 0) {
				tally.horizonsExcused++;
				continue;
			}
			const informed = difference(w.informed, state, w.player);
			if (informed !== undefined && tally.failures.size() < 5) {
				tally.failures.push(`seed ${seed} informed horizon from ${w.start} p${w.player}: ${informed}`);
			}
			if (w.brakeExcused) tally.horizonsBrakeFlagged++;
			const d = difference(w.scratch, state, w.player);
			if (d === undefined) {
				tally.horizons++;
			} else if (w.brakeExcused) {
				tally.horizonsBrakeExcused++;
			} else if (tally.failures.size() < 5) {
				tally.failures.push(`seed ${seed} horizon from ${w.start} p${w.player}: ${d}`);
			}
		}
	}
}

/** Walkers for a fresh state of `config` from `spawn` (the random walk of LP1 / LP2). */
function walkFrom(
	config: Readonly<SimConfig>,
	spawn: { x: number; z: number },
	seed: number,
	ticks: number,
	swaps: boolean,
	tally: Tally,
): void {
	const state = createSimState(seed, spawn.x, spawn.z, config);
	const sources: InputSource[] = [];
	for (let i = 0; i < partySize(state); i++) sources.push(new Walker(seed * 31 + i, swaps));
	walk(config, state, seed, ticks, sources, tally);
}

/** The floor's room with the most contact-enemy spawns (docs/SWORD_SPACING.md SP5's brawls), or -1. */
function contactRoom(roomSpawns: ReadonlyArray<ReadonlyArray<{ readonly kind: string }>>): number {
	let best = -1;
	let bestCount = 0;
	for (let id = 0; id < roomSpawns.size(); id++) {
		let count = 0;
		for (const sp of roomSpawns[id]) {
			const data = archetypeAt(archetypeIndex(sp.kind)).data;
			if (data.contactDamage > 0 && data.boss !== true) count++;
		}
		if (count > bestCount) {
			best = id;
			bestCount = count;
		}
	}
	return best;
}

/**
 * A brawl (docs/SWORD_SPACING.md SP5): an endless run of `players` (characters cycling through `characters`) skipped to
 * `floor` (god mode), the party put on the first spawn of the floor's busiest contact room, then brawlers.
 */
function brawl(
	seed: number,
	floor: number,
	characters: CharacterId[],
	both: boolean,
	held: boolean,
	tally: Tally,
): void {
	const setup = buildEndlessRunConfig(seed, characters.size(), { characters, bothWeapons: both });
	const config: SimConfig = { ...setup.config, dev: { invulnerable: true } };
	expect(config.spacing).toBeDefined();
	const state = createSimState(seed, setup.spawn!.x, setup.spawn!.z, config);
	skipPartyToFloor(state, config, floor);
	const w = setup.endlessFloor(floor);
	const room = contactRoom(w.roomSpawns);
	if (room < 0) return;
	const first = w.roomSpawns[room][0];
	placeParty(state, first.x, first.z);
	const sources: InputSource[] = [];
	for (let i = 0; i < characters.size(); i++) sources.push(new Brawler(seed * 53 + i, both));
	walk(config, state, seed, BRAWL_TICKS, sources, tally, held ? new Holder() : undefined);
}

function report(name: string, tally: Tally, brakeCap: number = MAX_EXCUSED_SHARE): void {
	const brakeShare = tally.horizonsBrakeExcused / math.max(1, tally.horizons + tally.horizonsBrakeExcused);
	print(
		`[predictMotion] ${name}: ${tally.compared} ticks compared, ${tally.excused} excused; ` +
			`${tally.horizons} horizons of ${HORIZON}, ${tally.horizonsExcused} excused, ` +
			`${tally.horizonsBrakeExcused} excused by the brake (${string.format("%.3f", brakeShare)}; ` +
			`${tally.horizonsBrakeFlagged} flagged)`,
	);
	expect(tally.failures).toEqual([]);
	expect(tally.compared).toBeGreaterThan(0);
	expect(tally.horizons).toBeGreaterThan(0);
	expect(tally.excused / (tally.compared + tally.excused)).toBeLessThan(MAX_EXCUSED_SHARE);
	expect(brakeShare).toBeLessThan(brakeCap);
	const parts: string[] = [];
	for (const kind of COVERAGE_KINDS) parts.push(`${kind} ${tally.coverage.get(kind) ?? 0}`);
	print(`[predictMotion] ${name} coverage: ${parts.join(", ")}`);
}

function expectCovered(tally: Tally, kinds: ReadonlyArray<string>): void {
	for (const kind of kinds) expect(`${kind} ${(tally.coverage.get(kind) ?? 0) > 0}`).toBe(`${kind} true`);
}

const CHARACTERS: ReadonlyArray<[CharacterId, boolean]> = [
	["knight", false],
	["archer", false],
	["knight", true],
];

describe("predictMotion (docs/LOCAL_PREDICTION.md LP1 / LP2)", () => {
	it("mirrors the body and the weapons' motion on endless floors (dev world, solo)", () => {
		const tally = newTally();
		for (let seed = 1; seed <= ENDLESS_SEEDS; seed++) {
			const [character, both] = CHARACTERS[(seed - 1) % CHARACTERS.size()];
			const startFloor = FLOORS[(seed - 1) % FLOORS.size()];
			const setup = buildDevRunConfig(seed, { startFloor, invulnerable: true, bothWeapons: both }, 1, [
				character,
			]);
			walkFrom(setup.config, setup.spawn!, seed, ENDLESS_TICKS, both, tally);
		}
		report("endless solo", tally);
		expectCovered(tally, [
			"walk",
			"blocked",
			"roll",
			"flask",
			"guard",
			"bastionGuard",
			"windup",
			"charge",
			"swap",
			"quickstep",
			"frenzy",
		]);
	});

	it("mirrors both players of a co-op party (endless, god mode)", () => {
		const tally = newTally();
		for (let seed = 1; seed <= PARTY_SEEDS; seed++) {
			const setup = buildEndlessRunConfig(seed, 2, {
				characters: ["knight", "archer"],
				bothWeapons: seed % 2 === 0,
			});
			const config: SimConfig = { ...setup.config, dev: { invulnerable: true } };
			walkFrom(config, setup.spawn!, seed, PARTY_TICKS, seed % 2 === 0, tally);
		}
		report("endless party", tally);
	});

	it("mirrors M1 (no enemies) with the slide and the web mover, port and web sword timings", () => {
		const tally = newTally();
		for (const kind of [PlayerMover.SLIDE, PlayerMover.WEB]) {
			const previousMover = setPlayerMover(kind);
			for (let k = 0; k < M1_SEEDS.size(); k++) {
				const seed = M1_SEEDS[k];
				const web = k % 2 === 1;
				const previousSword = web ? setSwordTimings(WEB_SWORD_TIMINGS) : undefined;
				const setup = buildRunConfig(seed, { world: "dungeonNoEncounter" });
				walkFrom(setup.config, setup.spawn!, seed, M1_TICKS, true, tally);
				if (previousSword !== undefined) setSwordTimings(previousSword);
			}
			setPlayerMover(previousMover);
		}
		report("M1", tally);
		expectCovered(tally, ["walk", "blocked", "roll", "flask", "guard", "windup", "charge", "swap"]);
	});
	it("brakes like the sim while a Knight attacks into held contact enemies (endless, solo; docs/SWORD_SPACING.md SP5)", () => {
		const tally = newTally();
		for (let seed = 1; seed <= BRAWL_SEEDS; seed++) {
			const floor = BRAWL_FLOORS[(seed - 1) % BRAWL_FLOORS.size()];
			brawl(seed, floor, ["knight"], seed % 2 === 0, true, tally);
		}
		report("brawl held solo", tally);
		expectCovered(tally, ["walk", "brake", "lungeBrake", "windup", "aim"]);
	});

	it("brakes like the sim while Knights attack into contact enemies (endless, live enemies, solo and co-op)", () => {
		const tally = newTally();
		for (let seed = 1; seed <= BRAWL_SEEDS; seed++) {
			const floor = BRAWL_FLOORS[(seed - 1) % BRAWL_FLOORS.size()];
			brawl(seed, floor, ["knight"], seed % 2 === 0, false, tally);
		}
		for (let seed = 1; seed <= BRAWL_PARTY_SEEDS; seed++) {
			const floor = BRAWL_FLOORS[(seed + 2) % BRAWL_FLOORS.size()];
			brawl(seed, floor, ["knight", "knight"], seed % 2 === 0, seed % 2 === 1, tally);
		}
		report("brawl live / co-op", tally, MAX_BRAKE_EXCUSED_LIVE);
		expectCovered(tally, ["walk", "brake", "lungeBrake", "windup"]);
	});
});

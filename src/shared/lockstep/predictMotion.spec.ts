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
 * broken during the tick (a Charger, a swing), a draft (the predictor stops; the spec dismisses it). The merged state's
 * hash is checked unchanged by every replay.
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
} from "shared/sim";
import { PlayerMover, buildDevRunConfig, buildEndlessRunConfig, buildRunConfig, setPlayerMover } from "shared/run";
import type { CharacterId } from "shared/characters";
import { dismissDraft } from "shared/run/testing";
import { copyMotionBase, newMotionScratch, predictMotionTick, type MotionScratch } from "./predictMotion";

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

/** A random walker: state-independent, so its next inputs can be generated ahead (the horizon replay). */
class Walker {
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
	failures: string[];
	/** What the compared ticks exercised (kind -> ticks), so a walk that never guards or charges cannot pass. */
	coverage: Map<string, number>;
}

function newTally(): Tally {
	return { compared: 0, excused: 0, horizons: 0, horizonsExcused: 0, failures: [], coverage: new Map() };
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
	excused: boolean;
}

/**
 * Walks `ticks` ticks of `config` from `spawn`, `players` players (solo: step), comparing the mirror every tick and
 * every HORIZON_STRIDE ticks over HORIZON ticks (see the file comment).
 */
function walk(
	config: Readonly<SimConfig>,
	spawn: { x: number; z: number },
	seed: number,
	ticks: number,
	swaps: boolean,
	tally: Tally,
): void {
	const state = createSimState(seed, spawn.x, spawn.z, config);
	const n = partySize(state);
	const walkers: Walker[] = [];
	for (let i = 0; i < n; i++) walkers.push(new Walker(seed * 31 + i, swaps));
	const rng = new Rng(seed * 7 + 1);
	// Inputs generated ahead: queue[k] = the frames of tick (state.tick + k).
	const queue: InputFrame[][] = [];
	const fill = () => {
		while (queue.size() < HORIZON + 1) {
			const frames: InputFrame[] = [];
			for (let i = 0; i < n; i++) frames.push(walkers[i].next());
			queue.push(frames);
		}
	};
	const scratch = newMotionScratch();
	const windows: Window[] = [];
	for (let t = 0; t < ticks; t++) {
		if (isDraftOpen(state)) dismissDraft(state);
		if (t % HORIZON_STRIDE === MUTATE_PHASE) mutate(state, rng, n);
		fill();
		const frames = queue.remove(0)!;
		const world = simWorldConfig(state, config);
		const before = hashState(state);
		// Horizon windows: HORIZON ticks replayed from this one merged state.
		if (t % HORIZON_STRIDE === 0) {
			for (let i = 0; i < n; i++) {
				if (playerAt(state, i).dead !== 0) continue;
				const w: Window = { start: state.tick, player: i, scratch: newMotionScratch(), excused: false };
				copyMotionBase(w.scratch, state, i);
				predictMotionTick(w.scratch, state, frames[i], world, i, playerTraits(config, i));
				for (let k = 0; k < HORIZON - 1; k++) {
					predictMotionTick(w.scratch, state, queue[k][i], world, i, playerTraits(config, i));
				}
				windows.push(w);
			}
		}
		// One tick per player from this merged state.
		const singles: MotionScratch[] = [];
		for (let i = 0; i < n; i++) {
			const s = newMotionScratch();
			copyMotionBase(s, state, i);
			predictMotionTick(s, state, frames[i], world, i, playerTraits(config, i));
			singles.push(s);
		}
		expect(hashState(state)).toBe(before);
		const pieces = intact(state);
		const deadBefore: boolean[] = [];
		for (let i = 0; i < n; i++) deadBefore.push(playerAt(state, i).dead !== 0);
		if (n === 1) step(state, frames[0], config);
		else stepParty(state, frames, config);
		const excused =
			state.events.floorChanged !== 0 ||
			intact(state) !== pieces ||
			isDraftOpen(state) ||
			(state.drops?.events.collected.size() ?? 0) > 0;
		for (let i = 0; i < n; i++) {
			if (deadBefore[i] || playerAt(state, i).dead !== 0) continue;
			if (excused) {
				tally.excused++;
				continue;
			}
			tally.compared++;
			cover(tally, state, i, singles[i], frames[i]);
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
			tally.horizons++;
			const d = difference(w.scratch, state, w.player);
			if (d !== undefined && tally.failures.size() < 5) {
				tally.failures.push(`seed ${seed} horizon from ${w.start} p${w.player}: ${d}`);
			}
		}
	}
}

function report(name: string, tally: Tally): void {
	print(
		`[predictMotion] ${name}: ${tally.compared} ticks compared, ${tally.excused} excused; ` +
			`${tally.horizons} horizons of ${HORIZON}, ${tally.horizonsExcused} excused`,
	);
	expect(tally.failures).toEqual([]);
	expect(tally.compared).toBeGreaterThan(0);
	expect(tally.horizons).toBeGreaterThan(0);
	expect(tally.excused / (tally.compared + tally.excused)).toBeLessThan(MAX_EXCUSED_SHARE);
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
			walk(setup.config, setup.spawn!, seed, ENDLESS_TICKS, both, tally);
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
			walk(config, setup.spawn!, seed, PARTY_TICKS, seed % 2 === 0, tally);
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
				walk(setup.config, setup.spawn!, seed, M1_TICKS, true, tally);
				if (previousSword !== undefined) setSwordTimings(previousSword);
			}
			setPlayerMover(previousMover);
		}
		report("M1", tally);
		expectCovered(tally, ["walk", "blocked", "roll", "flask", "guard", "windup", "charge", "swap"]);
	});
});

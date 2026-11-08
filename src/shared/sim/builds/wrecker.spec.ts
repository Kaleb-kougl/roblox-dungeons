// Builds v2 BV5 / BV6 (docs/BUILDS_V2.md "Wrecker", Powder Keg): the roll smash (before the move, so the roll goes
// through; nothing without Wrecker), owners on damageBreakable (swing, arrow, effect bolt; a teammate's break is not
// yours), smash procs (splinters at the nearest enemies, the combo timer refill), Demolition (the blast, the chain one
// piece a tick stopping at GEN_MAX, one combo step per exploding piece), the chest never breaking, ROLL / BUILD scoring,
// Powder Keg's on-kill boons from the piece, leavers, and determinism.
import { describe, expect, it } from "@rbxts/jest-globals";
import "shared/sim/testing";
import { TileType, gridToWorld, tileAt, type BreakablePieceKindName, type BreakablePlacement } from "shared/dungeon";
import {
	AXIS_MAX,
	BREAKABLES_CONFIG,
	BUILDS_CONFIG,
	Boon,
	BreakableSource,
	BuildEffect,
	BulletKind,
	BulletPayload,
	Button,
	COMBO_MIN,
	COMBO_WINDOW_TICKS,
	DEMOLITION_DAMAGE,
	Duo,
	EMPTY_INPUT,
	NOT_BROKEN,
	PARTY_LEFT_BUTTON,
	ProcKind,
	ScoreSource,
	SimCtx,
	VOLATILE_BURSTS,
	WRECKER_SPLINTERS,
	buildSource,
	createSimState,
	damageBreakable,
	fireEffect,
	hashState,
	step,
	stepParty,
	type ActorState,
	type BurstSpec,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { endlessRunFloor, type EndlessRunFloor } from "shared/run";

// ---------------------------------------------------------------------------------------------
// A real endless floor's world (movers, blocker) with an open patch, run WITHOUT endless mode so the pieces are exactly
// config.breakables.pieces (breakables.spec's harness), with builds and scoring.

function openPatch(): { fl: EndlessRunFloor; gx: number; gy: number } {
	for (let run = 1; run <= 40; run++) {
		const fl = endlessRunFloor(run, 1);
		const d = fl.dungeon;
		for (let gy = 8; gy < d.H - 8; gy++)
			for (let gx = 8; gx < d.W - 8; gx++) {
				let open = true;
				for (let oy = -8; oy <= 8 && open; oy++)
					for (let ox = -8; ox <= 8 && open; ox++)
						if (tileAt(d, gx + ox, gy + oy) !== TileType.FLOOR) open = false;
				if (open) return { fl, gx, gy };
			}
	}
	error("no open patch");
}

const PATCH = openPatch();
const CX = gridToWorld(PATCH.gx);
const CZ = gridToWorld(PATCH.gy);

function piece(ox: number, oy: number, kind: BreakablePieceKindName = "crate"): BreakablePlacement {
	return { x: PATCH.gx + ox, y: PATCH.gy + oy, kind };
}

function world(
	pieces: ReadonlyArray<BreakablePlacement> | undefined,
	extra: Partial<SimConfig> = {},
	builds = true,
): SimConfig {
	const c = PATCH.fl.config;
	return {
		...c,
		encounter: { ...c.encounter!, spawns: [] },
		breakables: pieces !== undefined ? { ...BREAKABLES_CONFIG, pieces } : undefined,
		scoring: { partySize: 1 },
		builds: builds ? BUILDS_CONFIG : undefined,
		...extra,
	};
}

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, aimZ: AXIS_MAX, ...over });
const IDLE = frame();
const FIRE = frame({ buttons: Button.FIRE });
/** A roll toward +Z (screen direction of the pieces below), held the whole time (a press edge on the first tick). */
const ROLL = frame({ buttons: Button.ROLL, moveZ: AXIS_MAX });
const NOT_TRIED = -2;

function run(s: SimState, config: SimConfig, input: InputFrame, ticks: number): void {
	for (let t = 0; t < ticks; t++) step(s, input, config);
}

function ctxOf(s: SimState, config: SimConfig): SimCtx {
	return new SimCtx().bind(s, config, EMPTY_INPUT);
}

/** A stationary 'test.dummy' with `hp`, a target from now on. */
function dummy(s: SimState, config: SimConfig, x: number, z: number, hp = 50): ActorState {
	const a = ctxOf(s, config).spawnActor("test.dummy", x, z)!;
	a.hp = hp;
	a.hpMax = hp;
	a.spawnTick = -1;
	return a;
}

/** Sets `boon` to `level` for `player` (these worlds are not endless runs: grantCard needs a run's player). */
function setLevel(s: SimState, boon: number, level: number, player = 0): void {
	s.builds!.players[player].levels[boon] = level;
}

function wrecker(s: SimState, level = 1, player = 0): void {
	setLevel(s, Boon.WRECKER, level, player);
}

function brokenTicks(s: SimState): number[] {
	return s.breakables!.pieces.map((p) => p.brokenTick);
}

/** Live player bullets with source `source` (and, given, of BulletKind `kind`). */
function bulletsOf(s: SimState, source: number, kind?: number): number {
	let n = 0;
	s.combat.playerBullets.forEachActive((_i, _p, payload) => {
		if (BulletPayload.get(payload, "source") !== source) return false;
		if (kind === undefined || BulletPayload.get(payload, "kind") === kind) n++;
		return false;
	});
	return n;
}

/** Steps until the piece in `slot` breaks (at most `max` ticks); returns the step index it broke on, or NOT_TRIED. */
function stepUntilBroken(s: SimState, config: SimConfig, input: InputFrame, slot: number, max = 120): number {
	for (let t = 0; t < max; t++) {
		step(s, input, config);
		if (s.breakables!.pieces[slot].brokenTick !== NOT_BROKEN) return t;
	}
	return NOT_TRIED;
}

// ---------------------------------------------------------------------------------------------

describe("Wrecker: the roll smash (BV5)", () => {
	// A row of three crates across the roll's path two tiles ahead (wide: no pillar slip round it).
	const ROW = [piece(-1, 2), piece(0, 2), piece(1, 2)];

	it("without Wrecker the roll stops at the row's face and breaks nothing (today's rule)", () => {
		const config = world(ROW);
		const s = createSimState(1, CX, CZ, config);
		run(s, config, ROLL, 30);
		expect(brokenTicks(s)).toEqual([NOT_BROKEN, NOT_BROKEN, NOT_BROKEN]);
		expect(s.player.z).toBeLessThanOrEqual(CZ + 2 - 0.5 - 0.35 + 1e-9);
		expect(s.builds!.procs.size()).toBe(0);
	});

	it("with Wrecker it breaks the crate it touches before the move and the roll goes through exactly as on open floor", () => {
		const config = world(ROW);
		const s = createSimState(1, CX, CZ, config);
		wrecker(s);
		const free = world(undefined);
		const f = createSimState(1, CX, CZ, free);
		wrecker(f);
		let breakTick = NOT_TRIED;
		for (let t = 0; t < 30; t++) {
			const z0 = s.player.z;
			step(s, ROLL, config);
			step(f, ROLL, free);
			expect(s.player.z).toBe(f.player.z);
			expect(s.player.x).toBe(f.player.x);
			if (breakTick === NOT_TRIED && s.breakables!.pieces[1].brokenTick !== NOT_BROKEN) {
				breakTick = t;
				// Before the move: at the start of this tick the body did not yet overlap the crate's circle.
				expect(CZ + 2 - z0).toBeGreaterThan(0.5 + 0.35 - 1e-9);
			}
		}
		expect(breakTick).toBeGreaterThan(0);
		// Only the middle crate: the side ones (1 tile off the line) are out of the body's reach.
		expect(s.breakables!.pieces[0].brokenTick).toBe(NOT_BROKEN);
		expect(s.breakables!.pieces[2].brokenTick).toBe(NOT_BROKEN);
		// The roll reaches the far side of the crate's cell (2.5 tiles a roll).
		expect(s.player.z).toBeGreaterThan(CZ + 2.5 - 1e-9);
		// BVD12: a rolled piece scores like a swing's.
		expect(s.score!.counts[ScoreSource.BREAKABLES]).toBe(1);
	});

	it("never breaks the chest: the roll stops on it", () => {
		const config = world([piece(-1, 2), piece(0, 2, "chest"), piece(1, 2)]);
		const s = createSimState(1, CX, CZ, config);
		wrecker(s, 3);
		run(s, config, ROLL, 30);
		expect(brokenTicks(s)).toEqual([NOT_BROKEN, NOT_BROKEN, NOT_BROKEN]);
		expect(s.player.z).toBeLessThanOrEqual(CZ + 2 - 0.5 - 0.35 + 1e-9);
	});
});

describe("Wrecker: every piece the owner breaks splinters (BV5, BVD13)", () => {
	it("a sword swing's break: a smash proc at the cell centre, 3 splinters at the nearest enemy, gen 0", () => {
		const config = world([piece(0, 1, "barrel")], { loadout: ["weapon.sword"] });
		const s = createSimState(1, CX, CZ, config);
		wrecker(s);
		dummy(s, config, CX + 4, CZ + 1);
		step(s, FIRE, config);
		expect(s.breakables!.pieces[0].brokenTick).toBe(0);
		const e = s.builds!.events;
		expect(e.smashOwner).toEqual([0]);
		expect(e.smashGen).toEqual([0]);
		expect(e.smashX).toEqual([gridToWorld(PATCH.gx)]);
		expect(e.smashZ).toEqual([gridToWorld(PATCH.gy + 1)]);
		expect(e.smashFired).toEqual([WRECKER_SPLINTERS[0]]);
		expect(bulletsOf(s, buildSource(BuildEffect.WRECKER, 0), BulletKind.SHARD)).toBe(WRECKER_SPLINTERS[0]);
		expect(s.builds!.procs.size()).toBe(0);
	});

	it("an arrow's break (gen 0) and an effect bolt's (gen = its generation + 1) splinter; level II fires 5", () => {
		const config = world([piece(0, 3, "barrel")], { loadout: ["weapon.bow"] });
		const s = createSimState(1, CX, CZ, config);
		wrecker(s, 2);
		dummy(s, config, CX - 4, CZ + 3);
		const t = stepUntilBroken(s, config, FIRE, 0);
		expect(t).toBeGreaterThan(0);
		expect(s.builds!.events.smashGen).toEqual([0]);
		expect(s.builds!.events.smashFired).toEqual([WRECKER_SPLINTERS[1]]);
		// A Volatile bolt of generation 0 (an effect bullet) breaking a barrel: its smash is generation 1.
		const b = createSimState(1, CX, CZ, config);
		wrecker(b);
		dummy(b, config, CX - 4, CZ + 3);
		const bolt: BurstSpec = { ...VOLATILE_BURSTS[0], count: 1, spread: 0, damage: 10 };
		fireEffect(ctxOf(b, config), 0, CX, CZ, 0, 1, bolt, BuildEffect.VOLATILE, 0);
		expect(stepUntilBroken(b, config, IDLE, 0)).toBeGreaterThanOrEqual(0);
		expect(b.builds!.events.smashGen).toEqual([1]);
		expect(bulletsOf(b, buildSource(BuildEffect.WRECKER, 1))).toBe(WRECKER_SPLINTERS[0]);
	});

	it("no enemy in range: the smash resolves with 0 splinters; no owner (an enemy bullet, a slam): no smash", () => {
		const config = world([piece(0, 1, "barrel"), piece(3, 1, "barrel")]);
		const s = createSimState(1, CX, CZ, config);
		wrecker(s);
		damageBreakable(s, 0, 100, BreakableSource.MELEE, 0, 0);
		expect(s.builds!.procs.size()).toBe(1);
		expect(s.builds!.procs[0].kind).toBe(ProcKind.SMASH);
		expect(s.builds!.procs[0].slot).toBe(-1);
		expect(s.builds!.procs[0].id).toBe(-1);
		step(s, IDLE, config);
		expect(s.builds!.events.smashFired).toEqual([0]);
		damageBreakable(s, 1, 100, BreakableSource.ENEMY_BULLET);
		expect(s.builds!.procs.size()).toBe(0);
	});

	it("co-op: a teammate's break splinters nothing for you; your own does, credited to you", () => {
		const config = world([piece(0, 3, "barrel"), piece(3, 3, "barrel")], {
			loadout: ["weapon.bow"],
			scoring: { partySize: 2 },
			party: { size: 2 },
		});
		const s = createSimState(5, CX, CZ, config);
		const p1 = s.party!.players[1];
		p1.x = CX + 3;
		p1.prevX = CX + 3;
		wrecker(s, 1, 0); // player 0 owns Wrecker, player 1 shoots
		dummy(s, config, CX - 4, CZ + 6);
		let smashes = 0;
		for (let t = 0; t < 120 && s.breakables!.pieces[1].brokenTick === NOT_BROKEN; t++) {
			stepParty(s, [IDLE, FIRE], config);
			smashes += s.builds!.events.smashOwner.size();
		}
		expect(s.breakables!.pieces[1].brokenTick).never.toBe(NOT_BROKEN);
		expect(smashes).toBe(0);
		const owners: number[] = [];
		for (let t = 0; t < 120 && s.breakables!.pieces[0].brokenTick === NOT_BROKEN; t++) {
			stepParty(s, [FIRE, IDLE], config);
			for (const o of s.builds!.events.smashOwner) owners.push(o);
		}
		expect(owners).toEqual([0]);
	});

	it("a leaver's queued smash is dropped", () => {
		const config = world([piece(0, 3, "barrel")], { scoring: { partySize: 2 }, party: { size: 2 } });
		const s = createSimState(5, CX, CZ, config);
		wrecker(s, 1, 1);
		damageBreakable(s, 0, 100, BreakableSource.MELEE, 1, 0);
		expect(s.builds!.procs.size()).toBe(1);
		stepParty(s, [IDLE, frame({ buttons: PARTY_LEFT_BUTTON })], config);
		expect(s.builds!.events.smashOwner).toEqual([]);
		expect(s.builds!.procs.size()).toBe(0);
	});
});

describe("Wrecker: the combo (BV5)", () => {
	it("a smash refills a running combo's timer, so a x2 combo outlives its window; never starts one at x1.0", () => {
		const pieces = [piece(0, 3, "barrel"), piece(2, 3, "barrel")];
		const play = (own: boolean): SimState => {
			const config = world(pieces);
			const s = createSimState(1, CX, CZ, config);
			if (own) wrecker(s);
			s.score!.combo = 2 * COMBO_MIN;
			s.score!.comboTimer = COMBO_WINDOW_TICKS;
			run(s, config, IDLE, COMBO_WINDOW_TICKS - 10);
			damageBreakable(s, 0, 100, BreakableSource.MELEE, 0, 0);
			run(s, config, IDLE, 20); // past the first window
			return s;
		};
		const kept = play(true);
		expect(kept.score!.combo).toBe(2 * COMBO_MIN);
		expect(kept.score!.comboTimer).toBe(COMBO_WINDOW_TICKS - 20);
		const lost = play(false);
		expect(lost.score!.combo).toBe(COMBO_MIN);
		// At x1.0 the refill does nothing.
		const config = world(pieces);
		const s = createSimState(1, CX, CZ, config);
		wrecker(s);
		damageBreakable(s, 1, 100, BreakableSource.MELEE, 0, 0);
		step(s, IDLE, config);
		expect(s.score!.combo).toBe(COMBO_MIN);
		expect(s.score!.comboTimer).toBe(0);
	});
});

describe("Demolition (Wrecker III, BV5)", () => {
	it("a line of crates chains one piece a tick and stops at GEN_MAX; each exploding piece steps the combo; the chest stays", () => {
		// Five crates one tile apart (the blast reaches 1.5), a chest beside the second.
		const config = world([piece(0, 2), piece(0, 3), piece(0, 4), piece(0, 5), piece(0, 6), piece(1, 3, "chest")]);
		const s = createSimState(1, CX, CZ, config);
		wrecker(s, 3);
		const t0 = s.tick;
		damageBreakable(s, 0, 100, BreakableSource.MELEE, 0, 0);
		const gens: number[] = [];
		const blasts: number[] = [];
		for (let t = 0; t < 6; t++) {
			step(s, IDLE, config);
			for (const g of s.builds!.events.smashGen) gens.push(g);
			blasts.push(s.builds!.events.demolitionOwner.size());
		}
		// Piece 0 and its blast's piece 1 on tick t0, then one a tick; the gen-3 piece breaks but never explodes.
		expect(brokenTicks(s)).toEqual([t0, t0, t0 + 1, t0 + 2, NOT_BROKEN, NOT_BROKEN]);
		expect(gens).toEqual([0, 1, 2]);
		expect(blasts).toEqual([1, 1, 1, 0, 0, 0]);
		expect(s.score!.combo).toBe(COMBO_MIN + 3);
		// BVD12: every piece the chain broke scores (the melee one too).
		expect(s.score!.counts[ScoreSource.BREAKABLES]).toBe(4);
		expect(s.builds!.procs.size()).toBe(0);
	});

	it("the blast hits every enemy within 1.5 (body reach) once, through playerHitDamage, a generation on", () => {
		const config = world([piece(0, 3), piece(5, 5)]);
		const s = createSimState(1, CX, CZ, config);
		wrecker(s, 3);
		const cx = gridToWorld(PATCH.gx);
		const cz = gridToWorld(PATCH.gy + 3);
		const near = dummy(s, config, cx + 1.5, cz);
		const far = dummy(s, config, cx + 1.5 + near.radius + 0.01, cz + 3);
		const hpNear = near.hp;
		const hpFar = far.hp;
		damageBreakable(s, 0, 100, BreakableSource.MELEE, 0, 0);
		step(s, IDLE, config);
		expect(near.hp).toBe(hpNear - DEMOLITION_DAMAGE);
		expect(far.hp).toBe(hpFar);
		// A blast kill procs one generation on (a 2-hp dummy dies to it).
		const k = createSimState(1, CX, CZ, config);
		setLevel(k, Boon.VOLATILE, 1);
		wrecker(k, 3);
		dummy(k, config, cx + 1, cz, DEMOLITION_DAMAGE);
		damageBreakable(k, 0, 100, BreakableSource.MELEE, 0, 0);
		step(k, IDLE, config);
		const procs = k.builds!.procs;
		expect(procs.size()).toBe(1);
		expect(procs[0].kind).toBe(ProcKind.KILL);
		expect(procs[0].gen).toBe(1);
	});
});

describe("Powder Keg (Wrecker + Volatile, BV6)", () => {
	it("a smash fires the owner's Volatile ring from the piece; without the duo it does not", () => {
		const config = world([piece(0, 3)]);
		const cx = gridToWorld(PATCH.gx);
		const cz = gridToWorld(PATCH.gy + 3);
		const play = (duo: boolean): SimState => {
			const s = createSimState(1, CX, CZ, config);
			wrecker(s);
			setLevel(s, Boon.VOLATILE, 1);
			if (duo) s.builds!.players[0].duos.push(Duo.POWDER_KEG);
			dummy(s, config, cx + 4, cz);
			damageBreakable(s, 0, 100, BreakableSource.MELEE, 0, 0);
			step(s, IDLE, config);
			return s;
		};
		const keg = play(true);
		expect(keg.builds!.players[0].duos).toEqual([Duo.POWDER_KEG]);
		const e = keg.builds!.events;
		expect(e.burstX).toEqual([cx]);
		expect(e.burstZ).toEqual([cz]);
		expect(e.burstGen).toEqual([0]);
		expect(e.burstFired).toEqual([VOLATILE_BURSTS[0].count]);
		expect(e.duoProcDuo).toEqual([Duo.POWDER_KEG]);
		expect(e.smashFired).toEqual([WRECKER_SPLINTERS[0]]);
		expect(bulletsOf(keg, buildSource(BuildEffect.VOLATILE, 0))).toBe(VOLATILE_BURSTS[0].count);
		const plain = play(false);
		expect(plain.builds!.events.burstX).toEqual([]);
		expect(bulletsOf(plain, buildSource(BuildEffect.VOLATILE, 0))).toBe(0);
	});
});

describe("Wrecker: determinism", () => {
	it("a dense room (Demolition, Powder Keg, Volatile, a bow and rolls through clusters) hashes the same every tick", () => {
		const pieces: BreakablePlacement[] = [];
		for (let i = -3; i <= 3; i++) {
			pieces.push(piece(i, 2, i % 2 === 0 ? "barrel" : "crate"));
			pieces.push(piece(i, 4));
		}
		const config = world(pieces, { loadout: ["weapon.bow", "weapon.sword"] });
		const play = (): string[] => {
			const s = createSimState(9, CX, CZ, config);
			wrecker(s, 3);
			setLevel(s, Boon.VOLATILE, 1);
			s.builds!.players[0].duos.push(Duo.POWDER_KEG);
			setLevel(s, Boon.SOUL_SHARDS, 1);
			for (let i = 0; i < 6; i++) dummy(s, config, CX - 5 + 2 * i, CZ + 6, 6);
			const hashes: string[] = [];
			for (let t = 0; t < 180; t++) {
				const input =
					t % 40 < 25 ? FIRE : t % 40 === 25 ? ROLL : frame({ moveX: t % 80 < 40 ? AXIS_MAX : -AXIS_MAX });
				step(s, input, config);
				hashes.push(hashState(s));
			}
			expect(s.breakables!.pieces.filter((p) => p.brokenTick !== NOT_BROKEN).size()).toBeGreaterThan(4);
			return hashes;
		};
		expect(play()).toEqual(play());
	});
});

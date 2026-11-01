// Boosts from breakables in the sim (docs/BREAKABLE_DROPS.md BL2 / BL3, BLD4-BLD7): the config switch (never on
// DROPS_CONFIG, so never in the tutorial), pieceLoot filled per floor and hashed only with the switch (off: the hash is
// exactly as before), clone; the release on every break source (sword, bow arrow, a heavy arrow that breaks and flies
// on, enemy bullets, the slam), once, at the piece's cell centre, takeable on the landing tick, lost when the ground is
// full; no rng (state.rngState, the drop stream and kill pity untouched); a floor change (and dev mode's startFloor)
// brings that floor's loot; co-op picker only; replays. Measured on a real endless floor's open patch run WITHOUT endless
// mode (BreakablesConfig.pieces / .loot), like breakables.spec.ts, plus real endless runs for the floor rules.
import { describe, expect, it } from "@rbxts/jest-globals";
import "shared/sim/testing";
import {
	BREAKABLE_LOOT,
	TileType,
	gridToWorld,
	tileAt,
	type BreakableLoot,
	type BreakablePlacement,
	type Dungeon,
} from "shared/dungeon";
import {
	AXIS_MAX,
	BOOSTS,
	BOW_DATA,
	BREAKABLES_CONFIG,
	BREAKABLE_HP,
	Boost,
	BreakableSource,
	BulletKind,
	Button,
	DEBUG_FLOOR_BUTTON,
	DROPS_CONFIG,
	DROPS_SUBSYSTEM,
	EMPTY_INPUT,
	ENDLESS_DROPS_CONFIG,
	NOT_BROKEN,
	NO_BOOST,
	Recorder,
	boostTicks,
	boostTicksLeft,
	breakableLootAt,
	cloneSimState,
	createSimState,
	damageBreakable,
	dropsOnBreak,
	fireBurstRaw,
	guaranteedDropsConfig,
	hashLayout,
	hashState,
	packPayload,
	runReplay,
	slamBreakables,
	step,
	stepParty,
	type DropsConfig,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildDevRunConfig, buildEndlessRunConfig, endlessRunFloor, type EndlessRunFloor } from "shared/run";

// ---------------------------------------------------------------------------------------------
// The patch: the first endless floor cell whose Chebyshev radius-6 neighbourhood is all FLOOR.

function openPatch(): { fl: EndlessRunFloor; gx: number; gy: number } {
	for (let run = 1; run <= 40; run++) {
		const fl = endlessRunFloor(run, 1);
		const d: Dungeon = fl.dungeon;
		for (let gy = 6; gy < d.H - 6; gy++)
			for (let gx = 6; gx < d.W - 6; gx++) {
				let open = true;
				for (let oy = -6; oy <= 6 && open; oy++)
					for (let ox = -6; ox <= 6 && open; ox++)
						if (tileAt(d, gx + ox, gy + oy) !== TileType.FLOOR) open = false;
				if (open) return { fl, gx, gy };
			}
	}
	error("no open patch");
}

const PATCH = openPatch();
const CX = gridToWorld(PATCH.gx);
const CZ = gridToWorld(PATCH.gy);

function piece(ox: number, oy: number, kind: "barrel" | "crate" = "barrel"): BreakablePlacement {
	return { x: PATCH.gx + ox, y: PATCH.gy + oy, kind };
}

/** Loot drops: no random kill drops, the switch on. */
const LOOT: DropsConfig = { ...ENDLESS_DROPS_CONFIG, chancePercent: 0, chanceByArchetype: new Map(), pityKills: 0 };
/** LOOT with a pickup reach a player standing next to a piece covers (the piece's cell is solid). */
const LOOT_REACH: DropsConfig = { ...LOOT, pickupRadius: 1.5 };

function world(
	pieces: ReadonlyArray<BreakablePlacement>,
	loot: ReadonlyArray<BreakableLoot> | undefined,
	drops: DropsConfig | undefined = LOOT,
	extra: Partial<SimConfig> = {},
): SimConfig {
	const c = PATCH.fl.config;
	return {
		...c,
		encounter: { ...c.encounter!, spawns: [] },
		breakables: { ...BREAKABLES_CONFIG, pieces, loot },
		drops,
		...extra,
	};
}

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, aimZ: AXIS_MAX, ...over });
const IDLE = frame();
const FIRE = frame({ buttons: Button.FIRE });
const ALT = frame({ buttons: Button.ALT });
const SWORD = { loadout: ["weapon.sword"] };
const BOW = { loadout: ["weapon.bow"] };

function run(s: SimState, config: SimConfig, input: InputFrame, ticks: number): void {
	for (let t = 0; t < ticks; t++) step(s, input, config);
}

function enemyShot(s: SimState, emitter: number, x: number, z: number, dirX: number, dirZ: number): void {
	const payload = packPayload(1, BulletKind.ENEMY, 1);
	s.combat.enemySpawned += fireBurstRaw(s.combat.enemyBullets, emitter, x, z, dirX, dirZ, 1, 0, 6, 2, payload);
}

/** The ground slots holding a drop. */
function occupied(s: SimState): number {
	let n = 0;
	for (const g of s.drops!.ground) if (g.kind !== NO_BOOST) n++;
	return n;
}

/** Steps until slot `slot` breaks (at most `limit` ticks); returns the tick's drop events snapshot. */
function untilBroken(
	s: SimState,
	config: SimConfig,
	input: InputFrame,
	slot: number,
	limit: number,
): { dropped: number[]; fromPiece: number[]; lost: number } {
	for (let t = 0; t < limit; t++) {
		step(s, input, config);
		if (s.breakables!.pieces[slot].brokenTick !== NOT_BROKEN) {
			const e = s.drops!.events;
			return { dropped: [...e.dropped], fromPiece: [...e.fromPiece], lost: e.lostLoot.size() };
		}
	}
	error(`slot ${slot} did not break in ${limit} ticks`);
}

/**
 * Piece `pieceSlot`'s release landed in ground slot `slot` at its cell centre on its break tick (spawnTick = the piece's
 * brokenTick) with its full ground life.
 */
function expectReleased(s: SimState, pieceSlot: number, kind: number, slot = 0): void {
	const p = s.breakables!.pieces[pieceSlot];
	const g = s.drops!.ground[slot];
	expect(p.brokenTick).never.toBe(NOT_BROKEN);
	expect([g.kind, g.x, g.z, g.spawnTick, g.ticksLeft]).toEqual([
		kind,
		gridToWorld(p.x),
		gridToWorld(p.y),
		p.brokenTick,
		s.drops!.config.groundTicks,
	]);
}

// ---------------------------------------------------------------------------------------------

describe("breakable loot: the switch and the tunables", () => {
	it("the dungeon's kind weights are the sim's BOOSTS weights (BLD8; the dungeon cannot import the sim)", () => {
		expect([...BREAKABLE_LOOT.kindWeights]).toEqual(BOOSTS.map((b) => b.weight));
	});

	it("ENDLESS_DROPS_CONFIG is DROPS_CONFIG plus the switch; DROPS_CONFIG and the tutorial's config never have it", () => {
		expect(ENDLESS_DROPS_CONFIG.breakableLoot).toBe(true);
		expect({ ...ENDLESS_DROPS_CONFIG, breakableLoot: undefined }).toEqual({ ...DROPS_CONFIG });
		expect(table.isfrozen(ENDLESS_DROPS_CONFIG)).toBe(true);
		expect(DROPS_CONFIG.breakableLoot).toBe(undefined);
		expect(guaranteedDropsConfig([{ floor: 1, room: 0, kind: Boost.FURY }]).breakableLoot).toBe(undefined);
	});
});

describe("breakable loot: state and hash (BL2)", () => {
	const pieces = [piece(0, 1), piece(3, 1, "crate"), piece(-3, 1)];
	const loot: BreakableLoot[] = [
		{ slot: 1, kind: Boost.AEGIS },
		{ slot: 2, kind: Boost.FRENZY },
	];

	it("on: pieceLoot has one entry per piece (NO_BOOST empty), breakableLootAt reads it, hashed after players", () => {
		const s = createSimState(1, CX, CZ - 4, world(pieces, loot));
		expect(s.drops!.pieceLoot).toEqual([NO_BOOST, Boost.AEGIS, Boost.FRENZY]);
		expect([0, 1, 2, 3].map((i) => breakableLootAt(s, i))).toEqual([NO_BOOST, Boost.AEGIS, Boost.FRENZY, NO_BOOST]);
		const layout = hashLayout(s, true);
		const g = layout.groups.find((x) => x.name === DROPS_SUBSYSTEM)!;
		const names = layout.names;
		expect(names[g.finish - 4]).toBe("drops.pieceLoot.length");
		expect([names[g.finish - 3], names[g.finish - 1]]).toEqual(["drops.pieceLoot[0]", "drops.pieceLoot[2]"]);
		expect(names[g.finish - 5]).toBe("drops.players[0].aegisPips");
		const v = layout.values;
		expect([v[g.finish - 4], v[g.finish - 3], v[g.finish - 2], v[g.finish - 1]]).toEqual([
			3,
			NO_BOOST,
			Boost.AEGIS,
			Boost.FRENZY,
		]);
		expect(layout.values).toEqual(hashLayout(s).values);
	});

	it("on without loot: all empty; on without breakables: pieceLoot stays empty and hashes its length 0", () => {
		const s = createSimState(1, CX, CZ - 4, world(pieces, undefined));
		expect(s.drops!.pieceLoot).toEqual([NO_BOOST, NO_BOOST, NO_BOOST]);
		const c = PATCH.fl.config;
		const bare = createSimState(1, CX, CZ, { ...c, encounter: { ...c.encounter!, spawns: [] }, drops: LOOT });
		expect(bare.drops!.pieceLoot).toEqual([]);
		const layout = hashLayout(bare, true);
		const g = layout.groups.find((x) => x.name === DROPS_SUBSYSTEM)!;
		expect([layout.names[g.finish - 1], layout.values[g.finish - 1]]).toEqual(["drops.pieceLoot.length", 0]);
	});

	it("off (DROPS_CONFIG): pieceLoot empty, nothing released, the hash exactly as without any loot (BL2's promise)", () => {
		const play = (withLoot: boolean) => {
			const config = world(pieces, withLoot ? loot : undefined, DROPS_CONFIG, SWORD);
			const s = createSimState(1, CX, CZ, config);
			const hashes: string[] = [];
			for (let t = 0; t < 60; t++) {
				step(s, t < 30 ? FIRE : frame({ moveX: AXIS_MAX, buttons: Button.FIRE }), config);
				hashes.push(hashState(s));
			}
			return { s, hashes, names: hashLayout(s, true).names };
		};
		const a = play(true);
		const b = play(false);
		expect(a.s.drops!.pieceLoot).toEqual([]);
		expect(a.s.breakables!.pieces[0].brokenTick).never.toBe(NOT_BROKEN);
		expect(occupied(a.s)).toBe(0);
		expect(a.hashes).toEqual(b.hashes);
		expect(a.names).toEqual(b.names);
		expect(a.names.some((n) => n.find("pieceLoot")[0] !== undefined)).toBe(false);
	});

	it("clone copies pieceLoot (equal hash, independent array)", () => {
		const s = createSimState(1, CX, CZ - 4, world(pieces, loot));
		const c = cloneSimState(s);
		expect(hashState(c)).toBe(hashState(s));
		c.drops!.pieceLoot[1] = NO_BOOST;
		expect(s.drops!.pieceLoot[1]).toBe(Boost.AEGIS);
		expect(hashState(c)).never.toBe(hashState(s));
	});

	it("a loot slot or kind out of range is refused", () => {
		expect(() => createSimState(1, CX, CZ - 4, world(pieces, [{ slot: 3, kind: Boost.FURY }]))).toThrow();
		expect(() => createSimState(1, CX, CZ - 4, world(pieces, [{ slot: 0, kind: 4 }]))).toThrow();
	});
});

describe("breakable loot: the release (BL3)", () => {
	it("the sword: a loaded barrel releases its boost at its cell centre on the break tick (dropped + fromPiece)", () => {
		const p = piece(0, 1);
		const config = world([p], [{ slot: 0, kind: Boost.QUICKSTEP }], LOOT, SWORD);
		const s = createSimState(1, CX, CZ, config);
		const ev = untilBroken(s, config, FIRE, 0, 5);
		expect(ev).toEqual({ dropped: [0], fromPiece: [0], lost: 0 });
		expectReleased(s, 0, Boost.QUICKSTEP);
		expect(s.drops!.pieceLoot).toEqual([NO_BOOST]);
		// Out of the 0.6 pickup reach (the player stands a tile away): it lies there, ageing like a kill drop.
		run(s, config, IDLE, 10);
		expect(s.drops!.ground[0].ticksLeft).toBe(s.drops!.config.groundTicks - 10);
	});

	it("bow arrows (2 for a barrel) release it", () => {
		const p = piece(0, 3);
		const config = world([p], [{ slot: 0, kind: Boost.FURY }], LOOT, BOW);
		const s = createSimState(1, CX, CZ, config);
		const ev = untilBroken(s, config, FIRE, 0, 600);
		expect(ev).toEqual({ dropped: [0], fromPiece: [0], lost: 0 });
		expectReleased(s, 0, Boost.FURY);
	});

	it("a heavy arrow breaks the loaded barrel and flies on into the dummy behind it; the boost lands", () => {
		const p = piece(0, 2);
		const c = PATCH.fl.config;
		const config = world([p], [{ slot: 0, kind: Boost.AEGIS }], LOOT, {
			loadout: ["weapon.bow"],
			encounter: { ...c.encounter!, spawns: [{ kind: "test.dummy", x: CX, z: CZ + 4 }] },
		});
		const s = createSimState(1, CX, CZ, config);
		const dummy = s.combat.actors.find((o) => o.alive !== 0)!;
		run(s, config, ALT, BOW_DATA.chargeTicks + 1);
		let fromPiece = 0;
		for (let t = 0; t < 40; t++) {
			step(s, IDLE, config);
			fromPiece += s.drops!.events.fromPiece.size();
		}
		expect(s.breakables!.pieces[0].brokenTick).never.toBe(NOT_BROKEN);
		expect(fromPiece).toBe(1);
		expect(s.drops!.ground[0].kind).toBe(Boost.AEGIS);
		expect(dummy.hp).toBe(10 - BOW_DATA.heavyDamage);
	});

	it("enemy bullets (4 for a barrel) release it too (BLD4: any break)", () => {
		const p = piece(2, 0);
		const config = world([p], [{ slot: 0, kind: Boost.FRENZY }]);
		const s = createSimState(1, CX, CZ - 5, config);
		const em = s.combat.enemyBullets.acquireEmitter();
		s.combat.enemyEmitters += 1;
		let fromPiece = 0;
		for (let shot = 1; shot <= 4; shot++) {
			enemyShot(s, em, CX, CZ, 1, 0);
			for (let t = 0; t < 30; t++) {
				step(s, IDLE, config);
				fromPiece += s.drops!.events.fromPiece.size();
				if (s.drops!.events.fromPiece.size() > 0) expectReleased(s, 0, Boost.FRENZY);
			}
		}
		expect(s.breakables!.pieces[0].brokenTick).never.toBe(NOT_BROKEN);
		expect(fromPiece).toBe(1);
	});

	it("the slam releases every loaded piece it breaks, in slot order (lowest free ground slots)", () => {
		const pieces = [piece(0, 0), piece(1, 0, "crate"), piece(0, -2), piece(9, 0)];
		const loot: BreakableLoot[] = [
			{ slot: 1, kind: Boost.FURY },
			{ slot: 2, kind: Boost.AEGIS },
			{ slot: 3, kind: Boost.QUICKSTEP },
		];
		const s = createSimState(1, CX, CZ - 5, world(pieces, loot));
		expect(slamBreakables(s, CX, CZ)).toBe(3);
		expect(s.drops!.events.fromPiece).toEqual([0, 1]);
		expectReleased(s, 1, Boost.FURY, 0);
		expectReleased(s, 2, Boost.AEGIS, 1);
		expect(s.drops!.ground[0].spawnTick).toBe(s.tick); // between ticks: this tick
		expect(s.drops!.pieceLoot).toEqual([NO_BOOST, NO_BOOST, NO_BOOST, Boost.QUICKSTEP]); // out of reach: kept
	});

	it("unloaded pieces release nothing; a loaded piece releases once (later hits and calls do nothing)", () => {
		const pieces = [piece(0, 1), piece(-3, 1)];
		const config = world(pieces, [{ slot: 1, kind: Boost.FURY }], LOOT, SWORD);
		const s = createSimState(1, CX, CZ, config);
		untilBroken(s, config, FIRE, 0, 5);
		expect([occupied(s), s.drops!.events.dropped.size(), s.drops!.events.fromPiece.size()]).toEqual([0, 0, 0]);
		expect(damageBreakable(s, 1, BREAKABLE_HP[0], BreakableSource.MELEE)).toBe(true);
		expect(s.drops!.events.fromPiece).toEqual([0]);
		expect(occupied(s)).toBe(1);
		dropsOnBreak(s, 1);
		expect(damageBreakable(s, 1, BREAKABLE_HP[0], BreakableSource.MELEE)).toBe(false);
		expect(s.drops!.events.fromPiece).toEqual([0]);
		expect(occupied(s)).toBe(1);
	});

	it("a player in reach takes it on the landing tick (events.collected the same tick)", () => {
		const p = piece(0, 1);
		const config = world([p], [{ slot: 0, kind: Boost.FURY }], LOOT_REACH, SWORD);
		const s = createSimState(1, CX, CZ, config);
		untilBroken(s, config, FIRE, 0, 5);
		const e = s.drops!.events;
		expect([e.dropped, e.fromPiece]).toEqual([[0], [0]]);
		expect(e.collected.map((c) => [c.player, c.kind, c.slot])).toEqual([[0, Boost.FURY, 0]]);
		expect(occupied(s)).toBe(0);
		expect(boostTicksLeft(s, 0, Boost.FURY)).toBe(boostTicks(Boost.FURY));
	});

	it("a full ground loses it (events.lostLoot, no slot taken, no dropped / fromPiece) and empties the slot", () => {
		const p = piece(0, 1, "crate");
		const config = world([p], [{ slot: 0, kind: Boost.AEGIS }], LOOT, SWORD);
		const s = createSimState(1, CX, CZ, config);
		const d = s.drops!;
		for (let i = 0; i < d.ground.size(); i++) {
			const g = d.ground[i];
			g.kind = Boost.FURY;
			g.x = CX - 4 - i;
			g.z = CZ;
			g.spawnTick = s.tick;
			g.ticksLeft = d.config.groundTicks * 10;
		}
		const before = d.ground.map((g) => ({ ...g }));
		const ev = untilBroken(s, config, FIRE, 0, 40);
		expect(ev).toEqual({ dropped: [], fromPiece: [], lost: 1 });
		expect(d.events.lostLoot).toEqual([{ kind: Boost.AEGIS, x: gridToWorld(p.x), z: gridToWorld(p.y) }]);
		expect(d.ground.map((g) => [g.kind, g.x, g.z])).toEqual(before.map((g) => [g.kind, g.x, g.z]));
		expect(d.pieceLoot).toEqual([NO_BOOST]);
	});

	it("no rng: state.rngState, the drop stream and kill pity end as in the same run with the piece unloaded", () => {
		const play = (loaded: boolean) => {
			const config = world([piece(0, 1)], loaded ? [{ slot: 0, kind: Boost.FURY }] : [], LOOT, SWORD);
			const s = createSimState(3, CX, CZ, config);
			s.drops!.killsSinceDrop = 7;
			untilBroken(s, config, FIRE, 0, 5);
			run(s, config, IDLE, 20);
			return s;
		};
		const a = play(true);
		const b = play(false);
		expect(occupied(a)).toBe(1);
		expect(occupied(b)).toBe(0);
		expect([a.rngState, a.drops!.rngState, a.drops!.killsSinceDrop]).toEqual([
			b.rngState,
			b.drops!.rngState,
			b.drops!.killsSinceDrop,
		]);
		expect(a.drops!.killsSinceDrop).toBe(7);
	});

	it("co-op: the player who takes it is boosted, the other is not", () => {
		const p = piece(3, 1);
		const config = world([p], [{ slot: 0, kind: Boost.QUICKSTEP }], LOOT_REACH, {
			loadout: ["weapon.sword"],
			party: { size: 2 },
		});
		const s = createSimState(5, CX, CZ, config);
		const p1 = s.party!.players[1];
		p1.x = CX + 3;
		p1.prevX = CX + 3;
		let collected = 0;
		for (let t = 0; t < 5 && s.breakables!.pieces[0].brokenTick === NOT_BROKEN; t++) {
			stepParty(s, [IDLE, FIRE], config);
			collected += s.drops!.events.collected.size();
			if (s.drops!.events.collected.size() > 0) expect(s.drops!.events.collected[0].player).toBe(1);
		}
		expect(collected).toBe(1);
		expect(boostTicksLeft(s, 1, Boost.QUICKSTEP)).toBe(boostTicks(Boost.QUICKSTEP));
		expect(boostTicksLeft(s, 0, Boost.QUICKSTEP)).toBe(0);
	});

	it("a recorded run with releases replays to the same hash", () => {
		const pieces = [piece(0, 1), piece(0, 4, "crate"), piece(2, 2)];
		const loot: BreakableLoot[] = [
			{ slot: 0, kind: Boost.FURY },
			{ slot: 1, kind: Boost.FRENZY },
		];
		const config = world(pieces, loot, LOOT, { loadout: ["weapon.bow", "weapon.sword"] });
		const s = createSimState(9, CX, CZ, config);
		const rec = new Recorder(9, CX, CZ);
		let fromPiece = 0;
		for (let t = 0; t < 300; t++) {
			const input = t < 150 ? FIRE : frame({ moveZ: t < 200 ? AXIS_MAX : 0, buttons: Button.FIRE });
			rec.record(input);
			step(s, input, config);
			fromPiece += s.drops!.events.fromPiece.size();
		}
		expect(fromPiece).toBeGreaterThan(0);
		expect(hashState(runReplay(rec.getRecording(), config))).toBe(hashState(s));
	});
});

describe("breakable loot: endless floors", () => {
	it("each floor brings its own loot: floor 1's at the start, floor 2's after a floor change (old drops freed)", () => {
		const setup = buildEndlessRunConfig(1337);
		expect(setup.config.drops).toBe(ENDLESS_DROPS_CONFIG);
		const spawn = setup.spawn!;
		const s = createSimState(1337, spawn.x, spawn.z, setup.config);
		const expand = (floor: number) => {
			const w = setup.endlessFloor(floor);
			const out: number[] = [];
			for (let i = 0; i < w.breakables!.size(); i++) out.push(NO_BOOST);
			for (const l of w.breakableLoot!) out[l.slot] = l.kind;
			return out;
		};
		expect(s.drops!.pieceLoot).toEqual(expand(1));
		const f1 = setup.endlessFloor(1).breakableLoot!;
		expect(f1.size()).toBeGreaterThan(0);
		expect(damageBreakable(s, f1[0].slot, 100, BreakableSource.MELEE)).toBe(true);
		expect(occupied(s)).toBe(1);
		step(s, frame({ buttons: DEBUG_FLOOR_BUTTON }), setup.config);
		expect(s.endless!.floor).toBe(2);
		expect(s.drops!.pieceLoot).toEqual(expand(2));
		expect(s.drops!.pieceLoot.size()).toBe(s.breakables!.pieces.size());
		expect(occupied(s)).toBe(0);
	});

	it("dev mode's startFloor gets that floor's loot, exactly as a run that walked there", () => {
		const dev = buildDevRunConfig(1337, { startFloor: 6, invulnerable: false });
		const s = createSimState(1337, dev.spawn!.x, dev.spawn!.z, dev.config);
		const w = buildEndlessRunConfig(1337).endlessFloor(6);
		const want: number[] = [];
		for (let i = 0; i < w.breakables!.size(); i++) want.push(NO_BOOST);
		for (const l of w.breakableLoot!) want[l.slot] = l.kind;
		expect(s.endless!.floor).toBe(6);
		expect(s.drops!.pieceLoot).toEqual(want);
	});
});

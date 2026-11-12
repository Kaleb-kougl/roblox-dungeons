// Floor modifiers (docs/FLOOR_MODIFIERS.md FM1 / FM2): the pick draws from its own stream (a hand twin replays it), never
// lands on floor 1, a boss floor or the floor after a chance hit, only picks an eligible kind and its effect is on the
// floor (a Goldling, a vault, a power pellet, a loaded piece in every lootable room, at least minExtra more affixed
// members); a forced placer equals the natural hit where the natural roll hit (same draws); the downstream placers
// re-run (the pact altars after a Hoard chest); with the option off, and on every floor the pick leaves plain, every
// output is the option-off floor's. The rates census is modifiers.census.spec.ts.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AFFIXES,
	BOSS_PICK,
	BREAKABLE,
	BREAKABLE_LOOT,
	EncounterRng,
	FLOOR_MODIFIER_WORLD_ALL,
	FLOOR_SEED_MUL,
	FloorModifier,
	FloorModifierClass,
	GOLDEN_PLACE,
	MODIFIERS,
	NO_POWER_PELLET,
	PACTS,
	PELLETS,
	ROSTER,
	SOLID_DECOR,
	VAULT,
	assignAffixes,
	breakableLootRooms,
	buildEndlessFloor,
	countAffixed,
	eliteAffixCount,
	scaledEliteAffixCount,
	floorModifierByKey,
	floorModifierEligible,
	floorModifierKey,
	floorModifierPickInput,
	floorSeed,
	generateDungeon,
	isAffixExcluded,
	isBossFloor,
	isFloorModifierTwist,
	modifierChanceHit,
	modifierChancePercent,
	modifierSeed,
	pickFloorModifier,
	placeBreakableLoot,
	placeGolden,
	placePactAltars,
	placePellets,
	placeVault,
	vaultChest,
	type BreakableFloorInput,
	type BreakablePlacement,
	type Dungeon,
	type EndlessFloorLayout,
	type EndlessFloorOptions,
	type FloorModifierFloor,
	type ForgeParams,
} from "shared/dungeon";
import { DROPS, GOLDEN_SIM_SALT, TREASURE } from "shared/sim";

const dungeons = new Map<string, Dungeon>();
function dungeonFor(params: ForgeParams): Dungeon {
	const key = `${params.seed}/${params.roomCount}`;
	let d = dungeons.get(key);
	if (d === undefined) {
		d = generateDungeon(params);
		dungeons.set(key, d);
	}
	return d;
}

/** What every endless world passes (shared/run endlessRunFloor): vaults and every sim part on. */
const ON: EndlessFloorOptions = { vaults: true, modifiers: FLOOR_MODIFIER_WORLD_ALL };
const OFF: EndlessFloorOptions = { vaults: true };
const PARTS = { ...FLOOR_MODIFIER_WORLD_ALL, vaults: true };

const RUNS = 5;
const LAST = 11;
interface Pair {
	readonly run: number;
	readonly on: EndlessFloorLayout;
	readonly off: EndlessFloorLayout;
}
const SAMPLE: Pair[] = [];
for (let run = 1; run <= RUNS; run++)
	for (let floor = 1; floor <= LAST; floor++)
		SAMPLE.push({
			run,
			on: buildEndlessFloor(run, floor, dungeonFor, 1, ON),
			off: buildEndlessFloor(run, floor, dungeonFor, 1, OFF),
		});

function inputOf(l: EndlessFloorLayout): BreakableFloorInput {
	return {
		seed: l.seed,
		dungeon: l.dungeon,
		encounter: l.encounter,
		roomSpawns: l.roomSpawns,
		spawn: l.spawn,
		stairwell: l.stairwell,
	};
}

/** The pieces before the vault's chest. */
function piecesOf(l: EndlessFloorLayout): BreakablePlacement[] {
	const all = l.breakables ?? [];
	const n = l.vault !== undefined ? all.size() - 1 : all.size();
	const out: BreakablePlacement[] = [];
	for (let i = 0; i < n; i++) out.push(all[i]);
	return out;
}

/** The option-off floor as the pick reads it. */
function naturalOf(l: EndlessFloorLayout): FloorModifierFloor {
	return {
		...inputOf(l),
		floor: l.floor,
		breakables: piecesOf(l),
		roomAffixes: l.roomAffixes ?? [],
		pellets: l.pellets ?? { tiles: [], room: [], power: NO_POWER_PELLET },
		vault: l.vault,
		golden: l.golden,
	};
}

/** Every output field of a layout but the modifier. */
function outputs(l: EndlessFloorLayout): unknown[] {
	return [
		l.roster,
		l.encounter,
		l.roomSpawns,
		l.roomSpawnTiles,
		l.spawn,
		l.stairwell,
		l.breakables,
		l.roomAffixes,
		l.breakableLoot,
		l.pellets,
		l.vault,
		l.pactAltars,
		l.golden,
	];
}

/** The effect of `kind` is on the built floor `l` (natural twin `n`). */
function expectEffect(kind: number, l: EndlessFloorLayout, n: EndlessFloorLayout): void {
	if (kind === FloorModifier.GILDED) {
		expect(n.golden).toBe(undefined);
		expect(l.golden).never.toBe(undefined);
	} else if (kind === FloorModifier.HOARD) {
		expect(n.vault).toBe(undefined);
		expect(l.vault).never.toBe(undefined);
		expect(l.breakables![l.vault!.slot]).toEqual(vaultChest(l.vault!));
	} else if (kind === FloorModifier.FEAST) {
		expect(n.pellets!.power).toBe(NO_POWER_PELLET);
		expect(l.pellets!.power).never.toBe(NO_POWER_PELLET);
		expect(l.pellets!.tiles).toEqual(n.pellets!.tiles);
	} else if (kind === FloorModifier.PLUNDER) {
		const rooms = breakableLootRooms(piecesOf(l), l.encounter);
		expect(rooms.size() >= MODIFIERS.plunder.minRooms).toBe(true);
		const loadedRooms = new Set<number>();
		const pieces = l.breakables!;
		for (const x of l.breakableLoot!) {
			const p = pieces[x.slot];
			const room = l.encounter.rooms.find((r) => r.id === roomIdOf(l, p));
			if (room !== undefined) loadedRooms.add(room.id);
		}
		for (const r of rooms) expect(loadedRooms.has(r)).toBe(true);
		expect(l.breakableLoot!.size()).toBe(rooms.size());
	} else if (kind === FloorModifier.BLOOD_MOON) {
		const boss = l.dungeon.boss;
		const extra = countAffixed(l.roomAffixes!, boss) - countAffixed(n.roomAffixes!, boss);
		expect(extra >= MODIFIERS.bloodMoon.minExtra).toBe(true);
	}
}

/** The loot's room of a piece (breakableLootRooms' rule: the room under its cell centre). */
function roomIdOf(l: EndlessFloorLayout, p: BreakablePlacement): number {
	const one = breakableLootRooms([p], l.encounter);
	return one.size() > 0 ? one[0] : -1;
}

describe("modifiers: tunables (FMD2 / FMD6)", () => {
	it("ids append only, two classes, the wave 1 table in order with its weights", () => {
		expect(FloorModifier).toEqual({ NONE: 0, GILDED: 1, BLOOD_MOON: 2, HOARD: 3, FEAST: 4, PLUNDER: 5 });
		expect(MODIFIERS.kinds.map((k) => k.key)).toEqual(["gilded", "hoard", "feast", "plunder", "bloodMoon"]);
		expect(MODIFIERS.kinds.map((k) => k.weight)).toEqual([1, 1, 2, 2, 2]);
		for (const k of MODIFIERS.kinds) {
			expect(floorModifierKey(k.id)).toBe(k.key);
			expect(floorModifierByKey(k.key)).toBe(k.id);
			expect(isFloorModifierTwist(k.id)).toBe(k.id === FloorModifier.BLOOD_MOON);
			expect(k.class === FloorModifierClass.TWIST).toBe(k.id === FloorModifier.BLOOD_MOON);
		}
		expect(floorModifierKey(FloorModifier.NONE)).toBe(undefined);
		expect(floorModifierByKey("nope")).toBe(undefined);
		expect(MODIFIERS.fromFloor).toBe(2);
		expect(MODIFIERS.plunder.minRooms).toBe(3);
		expect(MODIFIERS.bloodMoon).toEqual({ minExtra: 2, sharePercent: 200 });
	});

	it("the chance by band: none on floor 1, 20 % floors 2-4, 25 % 5-9, 30 % 10+", () => {
		expect(modifierChancePercent(1)).toBe(0);
		for (const f of [2, 3, 4]) expect(modifierChancePercent(f)).toBe(20);
		for (const f of [5, 9]) expect(modifierChancePercent(f)).toBe(25);
		for (const f of [10, 30, 99]) expect(modifierChancePercent(f)).toBe(30);
	});

	it("its own stream: floor seed ^ salt, a salt no other floor or sim stream uses", () => {
		expect(MODIFIERS.salt).toBe(0x4b56464d);
		expect(modifierSeed(12345)).toBe(bit32.bxor(12345, MODIFIERS.salt));
		const salts = [
			MODIFIERS.salt,
			GOLDEN_PLACE.salt,
			VAULT.salt,
			PELLETS.salt,
			PACTS.salt,
			BREAKABLE.salt,
			BOSS_PICK.salt,
			AFFIXES.salt,
			BREAKABLE_LOOT.salt,
			ROSTER.salt,
			SOLID_DECOR.salt,
			DROPS.salt,
			TREASURE.salt,
			GOLDEN_SIM_SALT,
		];
		for (let i = 0; i < salts.size(); i++) {
			expect(salts[i]).never.toBe(FLOOR_SEED_MUL);
			for (let j = i + 1; j < salts.size(); j++) expect(salts[i]).never.toBe(salts[j]);
		}
	});

	it("the chance draw is ONE rng.int(0, 99) on the stream (a hand twin)", () => {
		for (let s = 1; s <= 200; s++) {
			const seed = floorSeed(s, 3);
			const twin = new EncounterRng(bit32.bxor(seed, MODIFIERS.salt)).int(0, 99) < 20;
			expect(modifierChanceHit(seed, 3)).toBe(twin);
		}
		expect(modifierChanceHit(floorSeed(1, 1), 1)).toBe(false);
	});
});

describe("modifiers: the pick (FM1)", () => {
	it("never on floor 1, a boss floor or the floor after a chance hit; a hand twin of the draws", () => {
		let picked = 0;
		for (const { run, on, off } of SAMPLE) {
			const f = on.floor;
			const input = floorModifierPickInput(run, f);
			const blocked =
				f < 2 ||
				isBossFloor(f) ||
				(f - 1 >= 2 && !isBossFloor(f - 1) && modifierChanceHit(input.prevSeed, f - 1));
			if (blocked) expect(on.modifier).toBe(FloorModifier.NONE);
			// The twin: the chance draw, the weighted start index, the first eligible kind from it.
			let want: number = FloorModifier.NONE;
			if (!blocked) {
				const rng = new EncounterRng(bit32.bxor(on.seed, MODIFIERS.salt));
				if (rng.int(0, 99) < modifierChancePercent(f)) {
					let roll = rng.int(0, 7);
					let start = 0;
					const w = [1, 1, 2, 2, 2];
					while (roll >= w[start]) roll -= w[start++];
					for (let i = 0; i < 5; i++) {
						const k = MODIFIERS.kinds[(start + i) % 5].id;
						if (floorModifierEligible(k, naturalOf(off), PARTS)) {
							want = k;
							break;
						}
					}
				}
			}
			expect(on.modifier).toBe(want);
			if (on.modifier !== FloorModifier.NONE) picked++;
		}
		expect(picked > 0).toBe(true);
	});

	it("a pick is eligible on the option-off floor and its effect is on the floor", () => {
		for (const { on, off } of SAMPLE) {
			if (on.modifier === FloorModifier.NONE) continue;
			expect(floorModifierEligible(on.modifier, naturalOf(off), PARTS)).toBe(true);
			expectEffect(on.modifier, on, off);
		}
	});

	it("a plain floor is the option-off floor exactly (and the option off has no modifier)", () => {
		for (const { on, off } of SAMPLE) {
			expect(off.modifier).toBe(FloorModifier.NONE);
			if (on.modifier === FloorModifier.NONE) expect(outputs(on)).toEqual(outputs(off));
			// The layout, digest, props, spawns and pieces never move, whatever the pick.
			expect(on.dungeon).toBe(off.dungeon);
			expect(on.roomSpawns).toEqual(off.roomSpawns);
			expect(piecesOf(on)).toEqual(piecesOf(off));
		}
		const plain = buildEndlessFloor(3, 4, dungeonFor);
		expect(plain.modifier).toBe(FloorModifier.NONE);
		expect(outputs(buildEndlessFloor(3, 4, dungeonFor, 1, {}))).toEqual(outputs(plain));
	});

	it("eligibility reads the world: a part off makes its kind ineligible", () => {
		for (const { off } of SAMPLE) {
			const n = naturalOf(off);
			expect(floorModifierEligible(FloorModifier.GILDED, n, { ...PARTS, golden: false })).toBe(false);
			expect(floorModifierEligible(FloorModifier.HOARD, n, { ...PARTS, vaults: false })).toBe(false);
			expect(floorModifierEligible(FloorModifier.FEAST, n, { ...PARTS, pellets: false })).toBe(false);
			expect(floorModifierEligible(FloorModifier.PLUNDER, n, { ...PARTS, breakableLoot: false })).toBe(false);
			expect(floorModifierEligible(FloorModifier.BLOOD_MOON, n, { ...PARTS, affixes: false })).toBe(false);
			expect(floorModifierEligible(FloorModifier.NONE, n, PARTS)).toBe(false);
			// FMD7: Gilded / Hoard / Feast only where the natural roll missed.
			if (off.golden !== undefined) expect(floorModifierEligible(FloorModifier.GILDED, n, PARTS)).toBe(false);
			if (off.vault !== undefined) expect(floorModifierEligible(FloorModifier.HOARD, n, PARTS)).toBe(false);
			if (off.pellets!.power !== NO_POWER_PELLET)
				expect(floorModifierEligible(FloorModifier.FEAST, n, PARTS)).toBe(false);
			if (off.floor < AFFIXES.eliteFromFloor)
				expect(floorModifierEligible(FloorModifier.BLOOD_MOON, n, PARTS)).toBe(false);
		}
	});
});

describe("modifiers: each kind forced (the dev override)", () => {
	for (const kind of MODIFIERS.kinds) {
		it(`${kind.key}: on every eligible floor from 2 (boss floors too), its effect present; elsewhere none`, () => {
			let hits = 0;
			for (let run = 1; run <= 3; run++)
				for (let floor = 1; floor <= LAST; floor++) {
					const off = SAMPLE[(run - 1) * LAST + floor - 1].off;
					const l = buildEndlessFloor(run, floor, dungeonFor, 1, {
						...ON,
						modifierOverride: { every: true, kind: kind.id },
					});
					const eligible =
						floor >= MODIFIERS.fromFloor && floorModifierEligible(kind.id, naturalOf(off), PARTS);
					expect(l.modifier).toBe(eligible ? kind.id : FloorModifier.NONE);
					if (eligible) {
						hits++;
						expectEffect(kind.id, l, off);
					} else expect(outputs(l)).toEqual(outputs(off));
				}
			expect(hits > 0).toBe(true);
		});
	}

	it("the override needs the option: without `modifiers` it does nothing", () => {
		const l = buildEndlessFloor(2, 6, dungeonFor, 1, {
			vaults: true,
			modifierOverride: { every: true, kind: FloorModifier.PLUNDER },
		});
		expect(l.modifier).toBe(FloorModifier.NONE);
		expect(outputs(l)).toEqual(outputs(SAMPLE[LAST + 5].off));
	});

	it("Hoard re-runs the downstream: the pact altars see the chest, the Goldling is the natural one", () => {
		for (const { run, off } of SAMPLE) {
			const l = buildEndlessFloor(run, off.floor, dungeonFor, 1, {
				...ON,
				modifierOverride: { every: true, kind: FloorModifier.HOARD },
			});
			if (l.modifier !== FloorModifier.HOARD) continue;
			expect(l.pactAltars).toEqual(placePactAltars(inputOf(l), l.breakables!, l.pellets));
			expect(l.golden).toEqual(off.golden);
			expect(l.roomAffixes).toEqual(off.roomAffixes);
			expect(l.breakableLoot).toEqual(off.breakableLoot);
			expect(l.pellets).toEqual(off.pellets);
			expect(l.vault).toEqual(placeVault(inputOf(l), l.floor, piecesOf(off), off.pellets, { every: true }));
		}
	});
});

describe("modifiers: forced placers (FM2)", () => {
	it("absent / empty flags: byte-identical to the natural call", () => {
		for (const { off } of SAMPLE) {
			const input = inputOf(off);
			const pieces = piecesOf(off);
			expect(placeGolden(input, off.floor, {})).toEqual(off.golden);
			expect(placePellets(input, off.floor, pieces, {})).toEqual(off.pellets);
			expect(placeBreakableLoot(off.seed, off.floor, pieces, off.encounter, {})).toEqual(off.breakableLoot);
			expect(assignAffixes(off.seed, off.floor, off.encounter.rooms, off.roomSpawns, {})).toEqual(
				off.roomAffixes,
			);
			expect(
				assignAffixes(off.seed, off.floor, off.encounter.rooms, off.roomSpawns, { sharePercent: 100 }),
			).toEqual(off.roomAffixes);
		}
	});

	it("forced = the natural hit where the natural roll hit (the same draws)", () => {
		let golden = 0;
		let power = 0;
		let vaults = 0;
		for (const { off } of SAMPLE) {
			const input = inputOf(off);
			const pieces = piecesOf(off);
			const g = placeGolden(input, off.floor, { certain: true });
			if (off.golden !== undefined) {
				golden++;
				expect(g).toEqual(off.golden);
			}
			const p = placePellets(input, off.floor, pieces, { powerCertain: true });
			expect(p.tiles).toEqual(off.pellets!.tiles);
			if (off.pellets!.power !== NO_POWER_PELLET) {
				power++;
				expect(p).toEqual(off.pellets);
			}
			if (off.vault !== undefined) {
				vaults++;
				expect(placeVault(input, off.floor, pieces, off.pellets, { every: true })).toEqual(off.vault);
			}
			// Below fromFloor nothing is forced.
			if (off.floor < GOLDEN_PLACE.fromFloor) expect(g).toBe(undefined);
			if (off.floor < PELLETS.power.fromFloor) expect(p.power).toBe(NO_POWER_PELLET);
		}
		expect(golden > 0 && power > 0 && vaults > 0).toBe(true);
	});

	it("everyRoom: one loaded piece in every room with a weighted piece, at most maxPerRoom, deterministic", () => {
		for (const { off } of SAMPLE) {
			const pieces = piecesOf(off);
			const loot = placeBreakableLoot(off.seed, off.floor, pieces, off.encounter, { everyRoom: true });
			expect(placeBreakableLoot(off.seed, off.floor, pieces, off.encounter, { everyRoom: true })).toEqual(loot);
			const rooms = breakableLootRooms(pieces, off.encounter);
			expect(loot.size()).toBe(rooms.size());
			const per = new Map<number, number>();
			let last = -1;
			for (const x of loot) {
				expect(x.slot > last).toBe(true); // slot order
				last = x.slot;
				expect(pieces[x.slot].kind).never.toBe("chest");
				expect(x.kind >= 0 && x.kind < BREAKABLE_LOOT.kindWeights.size()).toBe(true);
				const r = roomIdOf(off, pieces[x.slot]);
				per.set(r, (per.get(r) ?? 0) + 1);
			}
			for (const r of rooms) expect(per.get(r)).toBe(1);
			expect(1 <= BREAKABLE_LOOT.maxPerRoom).toBe(true);
		}
	});

	it("sharePercent 200: elite shares doubled (capped at the eligible members), combat chance doubled, same exclusions", () => {
		expect(scaledEliteAffixCount(0, 200)).toBe(0);
		expect(scaledEliteAffixCount(1, 200)).toBe(1);
		expect(scaledEliteAffixCount(3, 200)).toBe(3); // ceil(2.1) = 3, capped at 3
		expect(scaledEliteAffixCount(5, 200)).toBe(4); // ceil(3.5)
		expect(scaledEliteAffixCount(10, 200)).toBe(7);
		for (let n = 0; n <= 40; n++) {
			expect(scaledEliteAffixCount(n, 100)).toBe(eliteAffixCount(n));
			expect(scaledEliteAffixCount(n, 200) >= eliteAffixCount(n)).toBe(true);
			expect(scaledEliteAffixCount(n, 200) <= n).toBe(true);
		}
		let natural = 0;
		let doubled = 0;
		for (const { off } of SAMPLE) {
			const twice = assignAffixes(off.seed, off.floor, off.encounter.rooms, off.roomSpawns, {
				sharePercent: 200,
			});
			natural += countAffixed(off.roomAffixes!);
			doubled += countAffixed(twice);
			for (let id = 0; id < twice.size(); id++) {
				const room = off.encounter.rooms[id];
				let eligible = 0;
				let affixed = 0;
				for (let i = 0; i < twice[id].size(); i++) {
					const kind = off.roomSpawns[id][i].kind;
					if (isAffixExcluded(kind)) expect(twice[id][i]).toBe(0);
					else eligible++;
					if (twice[id][i] !== 0) affixed++;
				}
				if (room.type === AFFIXES.eliteRoomType && off.floor >= AFFIXES.eliteFromFloor)
					expect(affixed).toBe(scaledEliteAffixCount(eligible, 200));
				if (off.floor < AFFIXES.eliteFromFloor) expect(affixed).toBe(0);
			}
		}
		print(
			`[modifiers] affixed planned members, sample runs 1-${RUNS} x floors 1-${LAST}: natural ${natural}, doubled ${doubled}`,
		);
		expect(doubled > natural).toBe(true);
	});
});

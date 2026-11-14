// Seeded rosters (docs/DAILY.md DS1, DSD1 / DSD2 / DSD9, DSD18): every endless run picks which room kinds it meets per
// floor from its run seed. Swarmers always; one more seeded kind every ROSTER.floorsPerKind floors (1 since DSD18: one
// a floor), never leaving. Ten seeded kinds since docs/NEW_ENEMIES.md NE7, so a roster is full on floor 10. With unlock
// floors (endlessRoster's default, the DSD9 rule, specs and tools only) floor 1 holds a sniper or a bruiser (the only
// kinds unlocked there) and no kind joins before its unlock floor; every endless world drops them (unlockFloors false:
// the Daily since DSD17, endless and dev since DSD18): each join is the next kind of the shuffle, floor 1's seeded kind
// any of the ten. The roster closes kinds in the spender only, so the layout, its digest, the props, the boss pick, the
// spawn and the stairwell are the floor built without it; room spawns (and the breakables and affixes placed from
// them) change by design. Fourteen seeded kinds since docs/NEW_ENEMIES_2.md NX6 (full on floor 14); the Chainhook's
// minimum floor (NXD4, ROOM_KIND_MIN_FLOOR 2) holds in every world: the join scan passes over it on floor 1.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AFFIXES,
	BOSS_PICK,
	BREAKABLE,
	ENDLESS_FIRST_FLOOR,
	ENDLESS_ROOM_KINDS,
	EncounterRng,
	ROSTER,
	bossKindFor,
	buildEndlessFloor,
	endlessFloorParams,
	endlessRoomSpawns,
	endlessRoster,
	entranceSpawn,
	generateDungeon,
	isBossFloor,
	placeEncounter,
	rosterOrder,
	rosterSeed,
	rosterTargetSize,
	roomKindMinFloor,
	spendEncounterBudget,
	type Dungeon,
	type ForgeParams,
} from "shared/dungeon";
import { DROPS } from "shared/sim";

const generated = new Map<string, Dungeon>();
function dungeonFor(p: ForgeParams): Dungeon {
	const key = `${p.seed}/${p.roomCount}`;
	let d = generated.get(key);
	if (d === undefined) {
		d = generateDungeon(p);
		generated.set(key, d);
	}
	return d;
}

const SEEDED = ENDLESS_ROOM_KINDS.filter((k) => k.kind !== ROSTER.always).map((k) => k.kind);
const SEEDS = 500;
const FLOORS = 24;
/**
 * The first floor every roster is full (14 seeded kinds since docs/NEW_ENEMIES_2.md NX6, one a floor: docs/DAILY.md
 * DSD18; 10 at NE7; was 19, NED11).
 */
const FULL_FLOOR = 14;

/** A kind may join on floor f: its minimum floor (every world) and, with unlock floors, its unlock floor. */
function joinable(kind: string, f: number, unlockFloors: boolean): boolean {
	return roomKindMinFloor(kind) <= f && (!unlockFloors || unlockOf(kind) <= f);
}

function unlockOf(kind: string): number {
	for (const k of ENDLESS_ROOM_KINDS) if (k.kind === kind) return k.fromFloor ?? ENDLESS_FIRST_FLOOR;
	return -1;
}

describe("seeded roster: data and order", () => {
	it("ROSTER: swarmers always, one kind every floor, its own salt (PRIME32_5, apart from every other stream)", () => {
		expect([ROSTER.always, ROSTER.floorsPerKind, ROSTER.salt]).toEqual(["swarmer", 1, 0x165667b1]);
		expect(SEEDED).toEqual([
			"sniper",
			"bruiser",
			"imp",
			"slime",
			"summoner",
			"bomber",
			"charger",
			"stormcaller",
			"warbanner",
			"reaper",
			"bulwark",
			"chainhook",
			"snatcher",
			"pyrekeeper",
		]);
		for (const other of [BOSS_PICK.salt, BREAKABLE.salt, AFFIXES.salt, DROPS.salt])
			expect(ROSTER.salt).never.toBe(other);
		expect(rosterSeed(1337)).toBe(bit32.bxor(1337, 0x165667b1));
		expect(rosterSeed(-1)).toBe(bit32.bxor(4294967295, 0x165667b1));
	});

	it("rosterOrder is one Fisher-Yates shuffle of the seeded kinds (13 draws, j = int(0, i) from the last index)", () => {
		// Failures collect into one list (one expect per check would take most of a minute headless).
		const bad: string[] = [];
		for (let seed = 0; seed < SEEDS; seed++) {
			const rng = new EncounterRng(bit32.bxor(seed, ROSTER.salt));
			const want = [...SEEDED];
			for (let i = want.size() - 1; i >= 1; i--) {
				const j = math.floor(rng.next() * (i + 1));
				const t = want[i];
				want[i] = want[j];
				want[j] = t;
			}
			const got = rosterOrder(seed);
			if (got.join(",") !== want.join(",")) bad.push(`run ${seed}: ${got.join(", ")}`);
		}
		expect(bad).toEqual([]);
		// Pinned, so a change to the stream or the shuffle shows up here first. Re-recorded for docs/NEW_ENEMIES_2.md NX6
		// (14 seeded kinds: every run's order reshuffled; at NE7 run 1 was bruiser, slime, charger, warbanner, sniper,
		// stormcaller, summoner, reaper, bomber, imp; before NE7: sniper, slime, summoner, imp, bruiser).
		expect(rosterOrder(1)).toEqual([
			"slime",
			"pyrekeeper",
			"stormcaller",
			"snatcher",
			"reaper",
			"bulwark",
			"bruiser",
			"bomber",
			"sniper",
			"chainhook",
			"charger",
			"summoner",
			"warbanner",
			"imp",
		]);
		expect(rosterOrder(1337)).toEqual([
			"bruiser",
			"pyrekeeper",
			"bulwark",
			"stormcaller",
			"reaper",
			"warbanner",
			"imp",
			"chainhook",
			"snatcher",
			"sniper",
			"bomber",
			"charger",
			"summoner",
			"slime",
		]);
		// Without unlock floors (every endless world, DSD18) run 1337's floor 1 is its order's first kind, the bruiser.
		expect(endlessRoster(1337, 1, false)).toEqual(["swarmer", "bruiser"]);
		expect(endlessRoster(1337, 3, false)).toEqual(["swarmer", "bruiser", "pyrekeeper", "bulwark"]);
		// With them (DSD9): the bruiser is unlocked on floor 1, so run 1337 reads the same either way.
		expect(endlessRoster(1337, 1)).toEqual(["swarmer", "bruiser"]);
		expect(endlessRoster(1337, 3)).toEqual(["swarmer", "bruiser", "pyrekeeper", "bulwark"]);
		expect(endlessRoster(1337, 5)).toEqual([
			"swarmer",
			"bruiser",
			"pyrekeeper",
			"bulwark",
			"stormcaller",
			"reaper",
		]);
		expect(endlessRoster(1337, FULL_FLOOR)).toEqual(["swarmer", ...rosterOrder(1337)]);
		// Run 1: slime comes first in the order but is locked until floor 4 (and the Pyre-keeper until 2) with unlock
		// floors, so the bruiser is its floor-1 kind, the Pyre-keeper and the Stormcaller join on 2 and 3 and slime on 4.
		expect(endlessRoster(1, 2)).toEqual(["swarmer", "bruiser", "pyrekeeper"]);
		expect(endlessRoster(1, 3)).toEqual(["swarmer", "bruiser", "pyrekeeper", "stormcaller"]);
		expect(endlessRoster(1, 4)).toEqual(["swarmer", "bruiser", "pyrekeeper", "stormcaller", "slime"]);
		expect(endlessRoster(1, 4, false)).toEqual(["swarmer", "slime", "pyrekeeper", "stormcaller", "snatcher"]);
		// NXD4: run 5's order starts with the Chainhook, so floor 1 takes its second kind and the Chainhook joins on 2.
		const five = rosterOrder(5);
		expect(five[0]).toBe("chainhook");
		expect(endlessRoster(5, 1, false)).toEqual(["swarmer", five[1]]);
		expect(endlessRoster(5, 2, false)).toEqual(["swarmer", five[1], "chainhook"]);
	});

	it("target sizes: f seeded kinds on floor f, capped at 14 (full on floor 14, DSD18 with NX6's 14 kinds)", () => {
		const want = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 14, 14, 14];
		for (let f = 1; f <= want.size(); f++)
			expect([f, rosterTargetSize(f, SEEDED.size())]).toEqual([f, want[f - 1]]);
		expect(rosterTargetSize(100, SEEDED.size())).toBe(SEEDED.size());
	});
});

describe("seeded roster: rules (run seeds 0-499, floors 1-24)", () => {
	it("swarmers first, floor 1 = swarmers + 1 kind (a sniper or a bruiser), monotonic, unlock floors, sizes", () => {
		const bad: string[] = [];
		const firstKinds = new Map<string, number>();
		for (let seed = 0; seed < SEEDS; seed++) {
			let before: string[] = [];
			for (let f = 1; f <= FLOORS; f++) {
				const r = endlessRoster(seed, f);
				const at = `run ${seed} floor ${f}`;
				if (r[0] !== ROSTER.always) bad.push(`${at}: starts with ${r[0]}`);
				// Every unlocked kind can always join, so the size is the target or every unlocked kind.
				const unlocked = SEEDED.filter((k) => joinable(k, f, true)).size();
				const want = math.min(rosterTargetSize(f, SEEDED.size()), unlocked);
				if (r.size() - 1 !== want) bad.push(`${at}: ${r.size() - 1} seeded kinds, want ${want}`);
				for (let i = 1; i < r.size(); i++) {
					if (!SEEDED.includes(r[i])) bad.push(`${at}: ${r[i]} is not a seeded kind`);
					if (!joinable(r[i], f, true)) bad.push(`${at}: ${r[i]} before its unlock floor`);
					for (let j = 0; j < i; j++) if (r[j] === r[i]) bad.push(`${at}: ${r[i]} twice`);
				}
				// A kind never leaves: the floor before is a prefix.
				for (let i = 0; i < before.size(); i++) if (r[i] !== before[i]) bad.push(`${at}: ${before[i]} moved`);
				before = r;
			}
			const one = endlessRoster(seed, 1);
			if (one.size() !== 2 || (one[1] !== "sniper" && one[1] !== "bruiser"))
				bad.push(`run ${seed}: floor 1 is ${one.join(", ")}`);
			firstKinds.set(one[1], (firstKinds.get(one[1]) ?? 0) + 1);
			if (endlessRoster(seed, FULL_FLOOR).size() !== ENDLESS_ROOM_KINDS.size())
				bad.push(`run ${seed}: not full on floor ${FULL_FLOOR}`);
			if (endlessRoster(seed, FULL_FLOOR - 1).size() === ENDLESS_ROOM_KINDS.size())
				bad.push(`run ${seed}: full before floor ${FULL_FLOOR}`);
		}
		expect(bad).toEqual([]);
		const sniper = firstKinds.get("sniper") ?? 0;
		const bruiser = firstKinds.get("bruiser") ?? 0;
		print(`[roster] floor 1 kind over ${SEEDS} seeds: sniper ${sniper}, bruiser ${bruiser}`);
		expect(sniper > 0 && bruiser > 0).toBe(true);
	});

	it("joins follow the shuffled order among the kinds unlocked (and at their minimum floor) on the floor", () => {
		const bad: string[] = [];
		for (let seed = 0; seed < SEEDS; seed++) {
			const order = rosterOrder(seed);
			for (let f = 1; f <= FLOORS; f++) {
				const before = f > 1 ? endlessRoster(seed, f - 1) : [ROSTER.always];
				const r = endlessRoster(seed, f);
				for (let i = before.size(); i < r.size(); i++) {
					// The joiner is the first kind of the order not in yet (not among r's first i) and unlocked on f.
					const want = order.filter(
						(k) => joinable(k, f, true) && (r.indexOf(k) < 0 || r.indexOf(k) >= i),
					)[0];
					if (r[i] !== want) bad.push(`run ${seed} floor ${f}: ${r[i]} joined, want ${want}`);
				}
			}
		}
		expect(bad).toEqual([]);
	});

	it("is deterministic: the same run seed and floor give the same roster on every call", () => {
		for (let seed = 0; seed < 50; seed++)
			for (let f = 1; f <= 12; f++) expect(endlessRoster(seed, f)).toEqual(endlessRoster(seed, f));
		expect(endlessRoster(4294967295, 3)).toEqual(endlessRoster(-1, 3));
		expect(endlessRoster(7, 0)).toEqual([ROSTER.always]);
	});

	it("prints how often each kind is in on floors 1-14 (run seeds 0-499)", () => {
		for (let f = 1; f <= FULL_FLOOR; f++) {
			const counts = SEEDED.map(() => 0);
			for (let seed = 0; seed < SEEDS; seed++) {
				const r = endlessRoster(seed, f);
				for (let k = 0; k < SEEDED.size(); k++) if (r.includes(SEEDED[k])) counts[k]++;
			}
			print(`[roster] floor ${f}: ${SEEDED.map((k, i) => `${k} ${counts[i]}`).join(", ")}`);
		}
	});
});

describe("seeded roster in the spender", () => {
	it("a roster of every kind spends draw for draw as no roster; a kind outside it is never bought", () => {
		const all = ENDLESS_ROOM_KINDS.map((k) => k.kind);
		for (let seed = 1; seed <= 40; seed++) {
			for (const floor of [1, 3, 6, 9, 14]) {
				for (const budget of [6, 13.2, 30, 60]) {
					const a = spendEncounterBudget(new EncounterRng(seed), budget, floor);
					const b = spendEncounterBudget(new EncounterRng(seed), budget, floor, undefined, all);
					expect(b).toEqual(a);
					const roster = endlessRoster(seed, floor);
					for (const k of spendEncounterBudget(new EncounterRng(seed), budget, floor, undefined, roster))
						expect([seed, floor, k, roster.includes(k)]).toEqual([seed, floor, k, true]);
				}
			}
		}
	});

	it("floor 1 rooms buy only swarmers and the run's one seeded kind", () => {
		for (let run = 1; run <= 30; run++) {
			const l = buildEndlessFloor(run, 1, dungeonFor);
			expect(l.roster).toEqual(endlessRoster(run, 1));
			for (const room of l.roomSpawns) for (const s of room) expect(l.roster!.includes(s.kind)).toBe(true);
		}
	});
});

describe("every endless world's roster: no unlock floors (docs/DAILY.md DSD17 / DSD18, unlockFloors false)", () => {
	it("every join is the next kind of the shuffle: roster(f) = swarmers + the first target(f) kinds of the order", () => {
		// docs/NEW_ENEMIES_2.md NXD4: when the order starts with the Chainhook, floor 1 takes the second kind and the
		// Chainhook joins on floor 2 (so from floor 2 the roster holds the same kinds, the first two swapped).
		let chainhookFirst = 0;
		for (let run = 0; run < SEEDS; run++) {
			const order = rosterOrder(run);
			const swap = order[0] === "chainhook";
			if (swap) chainhookFirst++;
			for (let f = ENDLESS_FIRST_FLOOR; f <= FLOORS; f++) {
				const want = [ROSTER.always];
				const target = rosterTargetSize(f, order.size());
				for (let i = 0; i < target; i++) want.push(order[i]);
				if (swap) {
					want[1] = order[1];
					if (target >= 2) want[2] = order[0];
				}
				expect([run, f, endlessRoster(run, f, false)]).toEqual([run, f, want]);
			}
		}
		print(`[roster] the Chainhook first in the order on ${chainhookFirst} of ${SEEDS} runs`);
		expect(chainhookFirst > 0).toBe(true);
	});

	it("floor 1's seeded kind can be any of the thirteen but the Chainhook; the default (true) keeps the unlock floors", () => {
		const seen = new Set<string>();
		for (let run = 0; run < SEEDS; run++) {
			const r = endlessRoster(run, 1, false);
			expect(r.size()).toBe(2);
			seen.add(r[1]);
			expect(endlessRoster(run, 1, true)).toEqual(endlessRoster(run, 1));
			expect(unlockOf(endlessRoster(run, 1)[1])).toBe(ENDLESS_FIRST_FLOOR);
		}
		for (const k of SEEDED) expect([k, seen.has(k)]).toEqual([k, k !== "chainhook"]);
	});

	it("no floor-1 room ever buys a Chainhook, in every world (docs/NEW_ENEMIES_2.md NXD4); floor 2 may", () => {
		// The spender closes it below floor 2 whatever the roster says, unlock floors on or off, with no draw: a floor-1
		// roster naming it spends draw for draw as the roster without it.
		for (let seed = 1; seed <= 40; seed++) {
			for (const budget of [6, 13.2, 30]) {
				for (const unlock of [true, false]) {
					const named = spendEncounterBudget(
						new EncounterRng(seed),
						budget,
						1,
						undefined,
						["swarmer", "chainhook", "sniper"],
						unlock,
					);
					const plain = spendEncounterBudget(
						new EncounterRng(seed),
						budget,
						1,
						undefined,
						["swarmer", "sniper"],
						unlock,
					);
					expect([seed, budget, unlock, named]).toEqual([seed, budget, unlock, plain]);
				}
			}
		}
		let floor2 = 0;
		for (let run = 1; run <= 100; run++) {
			for (const [party, unlockFloors] of [
				[1, false],
				[4, false],
				[1, true],
			] as const) {
				{
					const l = buildEndlessFloor(run, 1, dungeonFor, party, { unlockFloors });
					expect([run, l.roster!.includes("chainhook")]).toEqual([run, false]);
					for (const room of l.roomSpawns)
						for (const sp of room) expect([run, party, sp.kind]).never.toEqual([run, party, "chainhook"]);
				}
			}
			if (rosterOrder(run)[0] === "chainhook") {
				expect(endlessRoster(run, 2, false)[2]).toBe("chainhook");
				const l = buildEndlessFloor(run, 2, dungeonFor, 1, { unlockFloors: false });
				for (const room of l.roomSpawns) for (const sp of room) if (sp.kind === "chainhook") floor2++;
			}
		}
		print(`[roster] Chainhooks on floor 2 of the runs whose order starts with it: ${floor2}`);
		expect(floor2 > 0).toBe(true);
	});

	it("the spender opens a roster kind before its unlock floor only without unlock floors", () => {
		for (let seed = 1; seed <= 40; seed++) {
			const locked = spendEncounterBudget(new EncounterRng(seed), 13.2, 1, undefined, ["swarmer", "reaper"]);
			expect(locked.includes("reaper")).toBe(false);
			const free = spendEncounterBudget(new EncounterRng(seed), 13.2, 1, undefined, ["swarmer", "reaper"], false);
			for (const k of free) expect(k === "swarmer" || k === "reaper").toBe(true);
		}
		let reapers = 0;
		for (let seed = 1; seed <= 40; seed++) {
			const free = spendEncounterBudget(new EncounterRng(seed), 13.2, 1, undefined, ["swarmer", "reaper"], false);
			for (const k of free) if (k === "reaper") reapers++;
		}
		expect(reapers > 0).toBe(true);
	});

	it("a floor 1 without unlock floors buys from its roster, a kind past floor 1's unlocks among them on some runs", () => {
		let early = 0;
		for (let run = 1; run <= 30; run++) {
			const l = buildEndlessFloor(run, 1, dungeonFor, 1, { unlockFloors: false });
			expect(l.roster).toEqual(endlessRoster(run, 1, false));
			for (const room of l.roomSpawns) {
				for (const s of room) {
					expect(l.roster!.includes(s.kind)).toBe(true);
					if (unlockOf(s.kind) > ENDLESS_FIRST_FLOOR) early++;
				}
			}
			// The option only touches the roster and the spender: the default floor is exactly as before.
			const plain = buildEndlessFloor(run, 1, dungeonFor);
			const kept = buildEndlessFloor(run, 1, dungeonFor, 1, { unlockFloors: true });
			expect(kept.roster).toEqual(plain.roster);
			expect(kept.roomSpawns).toEqual(plain.roomSpawns);
		}
		expect(early > 0).toBe(true);
	});
});

describe("seeded roster moves nothing upstream", () => {
	it("layout, digest (the same dungeon), encounter, boss pick, spawn and stairwell equal the floor without a roster", () => {
		let moved = 0;
		for (let run = 1; run <= 6; run++) {
			for (const floor of [1, 2, 3, 5, 7, 10]) {
				for (const party of [1, 4]) {
					const l = buildEndlessFloor(run, floor, dungeonFor, party);
					const params = endlessFloorParams(run, floor);
					// The layout comes from the floor params alone (a fresh generation is equal, field for field).
					expect(l.dungeon).toBe(dungeonFor(params));
					if (floor === 1 && party === 1) expect(generateDungeon(params)).toEqual(l.dungeon);
					expect([l.seed, l.roomCount]).toEqual([params.seed, params.roomCount]);
					const bossKind = isBossFloor(floor) ? bossKindFor(params.seed) : undefined;
					expect(l.bossKind).toBe(bossKind);
					const encounter = placeEncounter(l.dungeon, { boss: bossKind });
					expect(l.encounter).toEqual(encounter);
					const spawn = entranceSpawn(l.dungeon);
					expect(l.spawn).toEqual({ x: spawn.x, z: spawn.z });
					const boss = encounter.rooms[l.dungeon.boss];
					expect(l.stairwell).toEqual({ x: boss.cx, z: boss.cz });
					// Only the room spawns change (by design): with every kind open they are the pre-roster spawns.
					const free = endlessRoomSpawns(l.dungeon, floor, party);
					expect(l.roomSpawns).toEqual(endlessRoomSpawns(l.dungeon, floor, party, l.roster));
					if (!deepEqual(free, l.roomSpawns)) moved++;
				}
			}
		}
		expect(moved > 0).toBe(true);
	});
});

function deepEqual(
	a: ReadonlyArray<ReadonlyArray<{ kind: string; x: number; z: number }>>,
	b: ReadonlyArray<ReadonlyArray<{ kind: string; x: number; z: number }>>,
): boolean {
	if (a.size() !== b.size()) return false;
	for (let i = 0; i < a.size(); i++) {
		if (a[i].size() !== b[i].size()) return false;
		for (let j = 0; j < a[i].size(); j++) {
			const p = a[i][j];
			const q = b[i][j];
			if (p.kind !== q.kind || p.x !== q.x || p.z !== q.z) return false;
		}
	}
	return true;
}

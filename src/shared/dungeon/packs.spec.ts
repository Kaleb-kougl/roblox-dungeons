// Packs in the spender (docs/NEW_ENEMIES_3.md NT5): EndlessRoomKind.packOf (absent = 1). Tested with an injected table
// (the real ENDLESS_ROOM_KINDS without its Jackal row, NT6, plus a test pack row): a pack buys exactly packOf entries in one pick, is open only
// with packOf slots left, is priced packOf x its cost for affordability but compares its per-slot cost against
// budget-left / slots-left, counts one pack toward maxPerRoom; placement puts a pack on its own anchor and the free
// tiles nearest it, never touching the swarmers' pack; a closed pack kind leaves every draw and tile as before; the
// testing mirror (traceSpend) agrees draw for draw.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ENDLESS_ROOM_ACTOR_CAP,
	ENDLESS_ROOM_KINDS,
	EncounterRng,
	encounterCost,
	encounterRooms,
	endlessFloorParams,
	generateDungeon,
	nearestFree,
	populateEndlessRoom,
	roomEncounterBudget,
	roomFloorTiles,
	roomSpawnTiles,
	spendEncounterBudget,
	type Dungeon,
	type EncounterRoom,
	type EndlessRoomKind,
	type RoomTools,
	type TileXZ,
} from "shared/dungeon";
import { traceSpend } from "shared/dungeon/testing";

const JACKAL = "jackal";
const PACK: EndlessRoomKind = { kind: JACKAL, weight: 1, maxPerRoom: 1, packOf: 3 };
/** The real table without its Jackal row (NT6): the table before any pack kind. */
const BASE: ReadonlyArray<EndlessRoomKind> = ENDLESS_ROOM_KINDS.filter((k) => k.kind !== JACKAL);
/** The base table plus a Jackal pack appended last (NT6's row without its unlock floor). */
const WITH_PACK: ReadonlyArray<EndlessRoomKind> = [...BASE, PACK];
/** Two maxima so a big room can hold two packs (the run rule, packs counted per pick). */
const TWO_PACKS: ReadonlyArray<EndlessRoomKind> = [...BASE, { ...PACK, maxPerRoom: 2 }];

function count(kinds: ReadonlyArray<string>, kind: string): number {
	let n = 0;
	for (const k of kinds) if (k === kind) n++;
	return n;
}

function costOf(kinds: ReadonlyArray<string>): number {
	let c = 0;
	for (const k of kinds) c += encounterCost(k);
	return c;
}

/** The Jackal entries come in runs of exactly 3 (each run one pick). Returns the runs' start indices. */
function packStarts(kinds: ReadonlyArray<string>): number[] {
	const starts: number[] = [];
	let i = 0;
	while (i < kinds.size()) {
		if (kinds[i] !== JACKAL) {
			i++;
			continue;
		}
		let j = i;
		while (j < kinds.size() && kinds[j] === JACKAL) j++;
		expect((j - i) % 3).toBe(0);
		for (let k = i; k < j; k += 3) starts.push(k);
		i = j;
	}
	return starts;
}

function rngAfter(seed: number, f: (rng: EncounterRng) => void): number {
	const rng = new EncounterRng(seed);
	f(rng);
	return rng.next();
}

describe("packs: the spender", () => {
	it("a pack buys exactly three in one pick, within the budget and the cap; maxPerRoom counts packs", () => {
		let packs = 0;
		let twoPacks = 0;
		for (let seed = 1; seed <= 300; seed++)
			for (const budget of [3, 6, 9.6, 14, 21.6, 36]) {
				const kinds = spendEncounterBudget(
					new EncounterRng(seed),
					budget,
					6,
					undefined,
					undefined,
					true,
					WITH_PACK,
				);
				expect(costOf(kinds) <= budget).toBe(true);
				expect(kinds.size() <= ENDLESS_ROOM_ACTOR_CAP).toBe(true);
				const starts = packStarts(kinds);
				expect(starts.size() <= 1).toBe(true);
				expect(count(kinds, JACKAL)).toBe(3 * starts.size());
				packs += starts.size();
				const two = spendEncounterBudget(
					new EncounterRng(seed),
					budget,
					6,
					undefined,
					undefined,
					true,
					TWO_PACKS,
				);
				const s2 = packStarts(two);
				expect(s2.size() <= 2).toBe(true);
				if (s2.size() === 2) twoPacks++;
			}
		expect(packs > 100).toBe(true);
		expect(twoPacks > 0).toBe(true);
	});

	it("a room with 2 or fewer free slots never buys one (cap 1 / 2, and never a pack started past cap - 3)", () => {
		const only: ReadonlyArray<EndlessRoomKind> = [{ ...PACK, maxPerRoom: undefined }];
		for (let seed = 1; seed <= 50; seed++) {
			expect(spendEncounterBudget(new EncounterRng(seed), 100, 6, 1, undefined, true, only)).toEqual([]);
			expect(spendEncounterBudget(new EncounterRng(seed), 100, 6, 2, undefined, true, only)).toEqual([]);
			// Cap 16, only packs: five packs fill 15 and the last slot stays empty.
			expect(spendEncounterBudget(new EncounterRng(seed), 100, 6, 16, undefined, true, only).size()).toBe(15);
		}
		for (let seed = 1; seed <= 300; seed++)
			for (const budget of [14, 21.6, 30, 48]) {
				const kinds = spendEncounterBudget(
					new EncounterRng(seed),
					budget,
					8,
					undefined,
					undefined,
					true,
					WITH_PACK,
				);
				for (const st of packStarts(kinds)) expect(st <= ENDLESS_ROOM_ACTOR_CAP - 3).toBe(true);
			}
	});

	it("affordability is packOf x the cost: 2.99 buys no pack, 3 buys one", () => {
		const only: ReadonlyArray<EndlessRoomKind> = [PACK];
		for (let seed = 1; seed <= 20; seed++) {
			expect(spendEncounterBudget(new EncounterRng(seed), 2.99, 6, undefined, undefined, true, only)).toEqual([]);
			expect(spendEncounterBudget(new EncounterRng(seed), 3, 6, undefined, undefined, true, only)).toEqual([
				JACKAL,
				JACKAL,
				JACKAL,
			]);
		}
	});

	it("the per-slot cost (1), not the pack's (3), is compared against budget-left / slots-left", () => {
		// Budget 48 over 16 slots: need 3. A bruiser (3) is dear enough, the pack (3 x 1) is not: the first pick is always
		// the bruiser by weight (one draw), never the pack.
		const dear: ReadonlyArray<EndlessRoomKind> = [
			{ kind: "bruiser", weight: 1 },
			{ ...PACK, weight: 100 },
		];
		for (let seed = 1; seed <= 100; seed++) {
			const kinds = spendEncounterBudget(new EncounterRng(seed), 48, 6, undefined, undefined, true, dear);
			expect(kinds[0]).toBe("bruiser");
		}
		// The dearest fallback compares per slot too: with only cheap kinds (need 3) it takes the first dearest per slot,
		// a sniper (2) over the pack (1 each).
		const cheap: ReadonlyArray<EndlessRoomKind> = [
			{ ...PACK, weight: 100 },
			{ kind: "sniper", weight: 1 },
		];
		for (let seed = 1; seed <= 20; seed++) {
			const kinds = spendEncounterBudget(new EncounterRng(seed), 48, 6, undefined, undefined, true, cheap);
			expect(kinds[0]).toBe("sniper");
		}
	});

	it("needsCompany and the roster see a pack like any kind (a closed pack kind moves no total and no draw)", () => {
		const roster = ["swarmer", "sniper", "bruiser", "imp", "bomber", "charger"];
		for (let seed = 1; seed <= 200; seed++)
			for (const budget of [6, 9.6, 21.6, 40])
				for (const floor of [1, 3, 6]) {
					// The roster leaves the Jackal out: every pick and draw as the plain table.
					const plain = spendEncounterBudget(
						new EncounterRng(seed),
						budget,
						floor,
						undefined,
						roster,
						true,
						BASE,
					);
					const packed = spendEncounterBudget(
						new EncounterRng(seed),
						budget,
						floor,
						undefined,
						roster,
						true,
						WITH_PACK,
					);
					expect(packed).toEqual(plain);
					const a = rngAfter(seed, (r) =>
						spendEncounterBudget(r, budget, floor, undefined, roster, true, BASE),
					);
					const b = rngAfter(seed, (r) =>
						spendEncounterBudget(r, budget, floor, undefined, roster, true, WITH_PACK),
					);
					expect(b).toBe(a);
				}
		// needsCompany on a pack: never the room's first buy.
		const company: ReadonlyArray<EndlessRoomKind> = [
			{ kind: "sniper", weight: 1 },
			{ ...PACK, needsCompany: true, weight: 100 },
		];
		for (let seed = 1; seed <= 50; seed++)
			expect(spendEncounterBudget(new EncounterRng(seed), 12, 6, undefined, undefined, true, company)[0]).toBe(
				"sniper",
			);
	});

	it("the testing mirror (traceSpend) agrees with the spender draw for draw, with a pack in the table", () => {
		for (let seed = 1; seed <= 200; seed++)
			for (const budget of [6, 9.6, 21.6, 40, 60])
				for (const floor of [6, 10]) {
					const real = spendEncounterBudget(
						new EncounterRng(seed),
						budget,
						floor,
						undefined,
						undefined,
						true,
						WITH_PACK,
					);
					expect(traceSpend(new EncounterRng(seed), budget, floor, undefined, WITH_PACK).kinds).toEqual(real);
				}
	});
});

// ---------------------------------------------------------------------------------------------
// Placement on real Forge floors (endless params, no roster): each combat / elite room populated with the pack table.

interface Room {
	readonly d: Dungeon;
	readonly room: EncounterRoom;
	readonly floor: number;
	readonly budget: number;
	readonly seed: number;
}

function rooms(): Room[] {
	const out: Room[] = [];
	for (let run = 1; run <= 12; run++)
		for (const floor of [3, 6, 9]) {
			const d = generateDungeon(endlessFloorParams(run, floor));
			for (const room of encounterRooms(d)) {
				const budget = roomEncounterBudget(floor, room.type, 1 + (run % 3));
				if (budget <= 0 || room.id === d.entrance || room.id === d.boss) continue;
				out.push({ d, room, floor, budget, seed: run * 1000 + floor * 37 + room.id });
			}
		}
	return out;
}

function toolsFor(r: Room): RoomTools {
	let tiles: TileXZ[] | undefined;
	return {
		dungeon: r.d,
		rng: new EncounterRng(r.seed),
		floor() {
			if (!tiles) tiles = roomFloorTiles(r.d, r.room.id);
			return tiles;
		},
		center() {
			return { x: r.room.cx, z: r.room.cz };
		},
	};
}

describe("packs: placement", () => {
	const all = rooms();

	it("a closed pack kind places every kind on the same tile, draw for draw (the swarmers' packs included)", () => {
		const roster = ["swarmer", "sniper", "bruiser", "imp", "slime", "bomber"];
		let swarmers = 0;
		for (const r of all) {
			const plainTools = toolsFor(r);
			const plain = populateEndlessRoom(r.room, plainTools, r.budget, r.floor, roster, true, BASE);
			const packTools = toolsFor(r);
			const packed = populateEndlessRoom(r.room, packTools, r.budget, r.floor, roster, true, WITH_PACK);
			expect(packed).toEqual(plain);
			expect(packTools.rng.next()).toBe(plainTools.rng.next());
			swarmers += count(
				plain.map((s) => s.kind),
				"swarmer",
			);
		}
		expect(swarmers > 50).toBe(true);
	});

	it("a bought pack holds three Jackals on neighbouring tiles around its own anchor; swarmer packs keep theirs", () => {
		let packs = 0;
		let adjacent = 0;
		let joinedAcross = 0;
		for (const r of all) {
			const tools = toolsFor(r);
			const spawns = populateEndlessRoom(r.room, tools, r.budget, r.floor, undefined, true, WITH_PACK);
			const kinds = spawns.map((s) => s.kind);
			// The spender's list, placed in order (placement only stops early when a room runs out of tiles).
			const bought = spendEncounterBudget(
				new EncounterRng(r.seed),
				r.budget,
				r.floor,
				undefined,
				undefined,
				true,
				WITH_PACK,
			);
			for (let i = 0; i < spawns.size(); i++) expect(kinds[i]).toBe(bought[i]);
			// Replay the placement's used set to check every pack member and swarmer pack member is the nearest free tile.
			const open = roomSpawnTiles(r.d, r.room, toolsFor(r));
			const byKey = new Map<string, TileXZ>();
			for (const t of open) byKey.set(`${t.x},${t.z}`, t);
			const used = new Set<TileXZ>();
			let swarmAnchor: TileXZ | undefined;
			let swarmLeft = 0;
			let sawPackSinceSwarm = false;
			let i = 0;
			while (i < spawns.size()) {
				const s = spawns[i];
				const tile = byKey.get(`${s.x},${s.z}`)!;
				expect(tile !== undefined).toBe(true);
				if (s.kind === JACKAL) {
					// An anchor (a spread tile) and the two nearest free tiles to it.
					const anchor = tile;
					used.add(anchor);
					const members = [anchor];
					for (let k = 1; k < 3 && i + k < spawns.size(); k++) {
						const m = spawns[i + k];
						expect(m.kind).toBe(JACKAL);
						const want = nearestFree(open, used, anchor, 1)[0];
						expect([m.x, m.z]).toEqual([want.x, want.z]);
						used.add(want);
						members.push(want);
					}
					if (members.size() === 3) {
						packs++;
						let near = true;
						for (const m of members)
							if (math.max(math.abs(m.x - anchor.x), math.abs(m.z - anchor.z)) > 1.0001) near = false;
						if (near) adjacent++;
					}
					sawPackSinceSwarm = true;
					i += members.size();
					continue;
				}
				if (s.kind === "swarmer" && swarmAnchor !== undefined && swarmLeft > 0) {
					const want = nearestFree(open, used, swarmAnchor, 1)[0];
					expect([s.x, s.z]).toEqual([want.x, want.z]);
					swarmLeft--;
					if (sawPackSinceSwarm) joinedAcross++;
				} else if (s.kind === "swarmer") {
					swarmAnchor = tile;
					swarmLeft = 3;
					sawPackSinceSwarm = false;
				}
				used.add(tile);
				i++;
			}
		}
		expect(packs > 20).toBe(true);
		// Neighbouring tiles: the two members on tiles touching the anchor (8-neighbourhood) in nearly every pack.
		expect(adjacent >= packs - 1).toBe(true);
		// A swarmer bought after a Jackal pack still joins the earlier swarmer pack (its state untouched by the pack).
		expect(joinedAcross > 0).toBe(true);
	});
});

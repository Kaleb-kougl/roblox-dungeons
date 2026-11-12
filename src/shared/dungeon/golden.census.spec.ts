// Goldling hiding-place census (docs/GOLDLING_RUMOURS.md GR1): run seeds x floors 2-20, solo and a party of 4, every
// floor built as the endless worlds build it (vaults on). Goldling floors per depth band under today's rule (a room needs
// a cell its piece fits on) against the old rule (the chance draw and an open room: the floors the Goldling had before
// it brought its own piece), the floors lost to rooms with no piece cell, the floors whose room pick moved (the eligible
// list shrank), the barrel / crate split, piece cells per eligible room; printed. The target is equal rates: a room
// with no fitting cell is the only loss. Its own file: the default sample (run seeds 1-6, 228 floor builds) runs in the
// suite; `--census` (shared/run/testing censusRequested) runs the plan's run seeds 1-40 (1520 builds, several minutes).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BREAKABLE,
	EncounterRng,
	GOLDEN_PLACE,
	buildEndlessFloor,
	generateDungeon,
	goldenChancePercent,
	goldenRoomOpen,
	goldenRoomWeight,
	goldenRooms,
	goldenSeed,
	type Dungeon,
	type EncounterRoom,
	type EndlessFloorLayout,
	type ForgeParams,
	type GoldenFloorInput,
} from "shared/dungeon";
import { piecesBeforeGolden } from "shared/dungeon/testing";
import { censusRequested } from "shared/run/testing";

const FULL = censusRequested();
const RUNS = FULL ? 40 : 6;
const FIRST = 2;
const LAST = 20;
const PARTIES: ReadonlyArray<number> = [1, 4];

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

const piecesBefore = piecesBeforeGolden;

function inputOf(l: EndlessFloorLayout): GoldenFloorInput {
	return {
		seed: l.seed,
		dungeon: l.dungeon,
		encounter: l.encounter,
		roomSpawns: l.roomSpawns,
		spawn: l.spawn,
		stairwell: l.stairwell,
		pieces: piecesBefore(l),
		pellets: l.pellets,
		vault: l.vault,
	};
}

/** The room the old rule's room draw picks from `rooms` (the same second draw), after the chance draw hit. */
function weightedPick(rng: EncounterRng, rooms: ReadonlyArray<EncounterRoom>): number {
	let total = 0;
	for (const r of rooms) total += goldenRoomWeight(r.type);
	let roll = rng.int(0, total - 1);
	for (const r of rooms) {
		const w = goldenRoomWeight(r.type);
		if (roll < w) return r.id;
		roll -= w;
	}
	return rooms[rooms.size() - 1].id;
}

const pct = (n: number, of: number) => (of > 0 ? string.format("%.1f", (100 * n) / of) : "-");

describe("golden: hiding-place census (GR1)", () => {
	it(`Goldling floors per band, old rule vs today's, barrel / crate (run seeds 1-${RUNS} x floors ${FIRST}-${LAST}, solo and party of 4)`, () => {
		const lines: string[] = [];
		for (const n of PARTIES) {
			const floors = [0, 0, 0];
			const oldHits = [0, 0, 0];
			const newHits = [0, 0, 0];
			let lost = 0;
			let moved = 0;
			let crates = 0;
			let pieces = 0;
			let cellSum = 0;
			let roomSum = 0;
			let minCells = math.huge;
			for (let run = 1; run <= RUNS; run++)
				for (let floor = FIRST; floor <= LAST; floor++) {
					const l = buildEndlessFloor(run, floor, dungeonFor, n, { vaults: true });
					const band = floor >= 10 ? 2 : floor >= 5 ? 1 : 0;
					floors[band]++;
					const input = inputOf(l);
					const rng = new EncounterRng(goldenSeed(l.seed));
					const hit = rng.int(0, GOLDEN_PLACE.percentRange - 1) < goldenChancePercent(floor);
					const open = l.encounter.rooms.filter((r) => goldenRoomOpen(input, r));
					const oldRoom = hit && open.size() > 0 ? weightedPick(rng, open) : undefined;
					if (oldRoom !== undefined) oldHits[band]++;
					const g = l.golden;
					if (g !== undefined) {
						newHits[band]++;
						pieces++;
						if (g.pieceKind === "crate") crates++;
						if (g.room !== oldRoom) moved++;
					} else if (oldRoom !== undefined) lost++;
					if (hit) {
						for (const r of goldenRooms(input)) {
							roomSum++;
							cellSum += r.cells.size();
							minCells = math.min(minCells, r.cells.size());
						}
					}
					// Today's floors are a subset of the old rule's (the same chance draw, fewer eligible rooms).
					if (g !== undefined) expect(oldRoom !== undefined).toBe(true);
				}
			const band = (b: number) =>
				`${oldHits[b]} -> ${newHits[b]} / ${floors[b]} (${pct(oldHits[b], floors[b])} -> ${pct(
					newHits[b],
					floors[b],
				)} %)`;
			lines.push(
				`party ${n}: floors 2-4 ${band(0)}, 5-9 ${band(1)}, 10-${LAST} ${band(
					2,
				)}; lost ${lost}, room moved ${moved}; ` +
					`crates ${crates}/${pieces} (${pct(crates, pieces)} %, crateShare ${BREAKABLE.crateShare}); ` +
					`${string.format(
						"%.1f",
						roomSum > 0 ? cellSum / roomSum : 0,
					)} piece cells per eligible room (min ${minCells})`,
			);
			expect(pieces).toBeGreaterThan(0);
			// Target: equal rates; a room with no fitting cell is the only loss (rare).
			const all = oldHits[0] + oldHits[1] + oldHits[2];
			expect(lost * 20).toBeLessThanOrEqual(all);
		}
		print(`[golden] hiding-place census (old rule -> today):\n${lines.join("\n")}`);
	});
});

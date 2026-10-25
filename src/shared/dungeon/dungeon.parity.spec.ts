/**
 * Parity with the web build: generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed }) + placeEncounter(d, DEFAULT_ENCOUNTER)
 * + entranceSpawn + bossDoorSpawn must reproduce fixtures/dungeon-<seed>.json exactly (everything the exporter wrote,
 * except its metadata and the collision vectors, which collision.spec checks).
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import dungeon1337 from "shared/fixtures-generated/dungeon-1337";
import dungeon42 from "shared/fixtures-generated/dungeon-42";
import dungeon7 from "shared/fixtures-generated/dungeon-7";
import {
	DEFAULT_ENCOUNTER,
	KALEB_VALE_MVP_PARAMS,
	bossDoorSpawn,
	criticalPathRooms,
	entranceSpawn,
	generateDungeon,
	placeEncounter,
	populatedRooms,
	roomBudget,
	runSpawn,
	type Dungeon,
} from "shared/dungeon";
import { f64Hex, firstDiff, hexF64 } from "./fixtureDiff";

function rows(arr: ReadonlyArray<number>, W: number, H: number): string[] {
	const out: string[] = [];
	for (let y = 0; y < H; y++) {
		const parts: string[] = [];
		for (let x = 0; x < W; x++) parts.push(tostring(arr[y * W + x]));
		out.push(parts.join(""));
	}
	return out;
}

/** The port's output in the exporter's shape (scripts/export-fixtures.ts exportDungeon in the web repo). */
function exportView(d: Dungeon): object {
	const encounter = placeEncounter(d, DEFAULT_ENCOUNTER);
	const s = d.stats;
	return {
		params: d.params,
		seed: d.seed,
		valid: d.valid,
		name: d.name,
		W: d.W,
		H: d.H,
		entrance: d.entrance,
		boss: d.boss,
		maxDepth: d.maxDepth,
		maxBfs: d.maxBfs,
		stats: {
			rooms: s.rooms,
			edges: s.edges,
			loops: s.loops,
			critLen: s.critLen,
			floorTiles: s.floorTiles,
			reach: s.reach,
			attempts: s.attempts,
		},
		grid: rows(d.grid, d.W, d.H),
		corridor: rows(d.corridor, d.W, d.H),
		doorway: rows(d.doorway, d.W, d.H),
		lakeMask: rows(d.lakeMask, d.W, d.H),
		roomId: d.roomId,
		bfs: d.bfs,
		rooms: d.rooms,
		edges: d.edges,
		spawns: d.spawns,
		props: d.props,
		torches: d.torches,
		pools: d.pools,
		lakeCells: d.lakeCells,
		arches: d.arches,
		entranceSpawn: entranceSpawn(d),
		bossDoorSpawn: bossDoorSpawn(d),
		encounter: {
			criticalPathRooms: criticalPathRooms(d),
			populatedRooms: populatedRooms(d),
			roomBudget: roomBudget(d),
			spawns: encounter.spawns,
			rooms: encounter.rooms,
			entranceRoom: encounter.entranceRoom,
			bossRoom: encounter.bossRoom,
		},
	};
}

/** Exporter metadata and the collision vectors (collision.spec.ts). */
const IGNORED = new Set(["format", "fixture", "call", "tileLegend", "collision", "encounter.call"]);

/**
 * The raw scatter positions sx0 / sy0 are cos / sin(angle) * radius + offset. V8's Math.cos / Math.sin are not correctly
 * rounded; the port's deterministic dcos / dsin are (forge/trig.ts), so where V8 is 1 ulp off, sx0 / sy0 can differ by
 * 1 ulp (display-only: the build animation's start point). The comparer tolerates exactly that and lists where it did;
 * for these three fixtures the list is empty (the two misrounded scatter cosines in dungeon-42 / dungeon-7 vanish after
 * `* radius + offset`), so all three match bit for bit.
 */
const SCATTER = new Set(["sx0", "sy0"]);
function isScatterPath(path: string): boolean {
	const [field] = path.match("^rooms%[%d+%]%.(%w+)$");
	return field !== undefined && SCATTER.has(field as string);
}

/** Generator stages in order, so the first reported difference is the earliest one. */
const PIPELINE_ORDER = [
	"params",
	"seed",
	"id",
	"w",
	"h",
	"arch",
	"shape",
	"sx0",
	"sy0",
	"cx",
	"cy",
	"edges",
	"rooms",
	"entrance",
	"boss",
	"maxDepth",
	"W",
	"H",
	"grid",
	"corridor",
	"doorway",
	"pools",
	"lakeMask",
	"lakeCells",
	"arches",
	"roomId",
	"bfs",
	"maxBfs",
	"valid",
	"props",
	"spawns",
	"torches",
	"name",
	"stats",
];

const CASES: ReadonlyArray<[string, number, unknown, ReadonlyArray<string>]> = [
	["dungeon-1337", 1337, dungeon1337, []],
	["dungeon-42", 42, dungeon42, []],
	["dungeon-7", 7, dungeon7, []],
];

describe("Dungeon Forge parity with the web build (fixtures/dungeon-<seed>.json)", () => {
	it("the comparer is not vacuous: it reports the first differing path", () => {
		const view = exportView(generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 1337 })) as {
			rooms: Array<{ cx: number; sx0: number }>;
			grid: string[];
			props: Array<{ scale: number }>;
			encounter: { spawns: Array<{ kind: string }> };
		};
		const opts = { ignore: (path: string) => IGNORED.has(path), keyOrder: PIPELINE_ORDER };
		expect(firstDiff(dungeon1337, view, "", opts)).toBeUndefined();
		const cx = view.rooms[3].cx;
		view.rooms[3].cx = cx + 1;
		expect(firstDiff(dungeon1337, view, "", opts)).toBe(
			`rooms[3].cx: expected ${cx} (${f64Hex(cx)}), got ${cx + 1} (${f64Hex(cx + 1)})`,
		);
		view.rooms[3].cx = cx;
		const sx0 = view.rooms[0].sx0;
		const bits = f64Hex(sx0);
		const last = tonumber(bits.sub(16, 16), 16)!;
		// one ulp away: change only the lowest mantissa nibble by 1
		view.rooms[0].sx0 = hexF64(bits.sub(1, 15) + string.format("%x", last === 15 ? 14 : last + 1));
		expect(firstDiff(dungeon1337, view, "", opts)).toMatch("^rooms%[0%]%.sx0");
		const seen: string[] = [];
		expect(
			firstDiff(dungeon1337, view, "", { ...opts, tolerate1Ulp: isScatterPath, tolerated: seen }),
		).toBeUndefined();
		expect(seen).toEqual(["rooms[0].sx0"]);
		view.rooms[0].sx0 = sx0;
		view.grid[10] = view.grid[10].sub(1, 4) + "3" + view.grid[10].sub(6);
		expect(firstDiff(dungeon1337, view, "", opts)).toMatch("^grid%[10%]");
		view.grid = [...(dungeon1337.grid as unknown as string[])];
		view.encounter.spawns[2] = { ...view.encounter.spawns[2], kind: "sniper2" };
		expect(firstDiff(dungeon1337, view, "", opts)).toMatch("^encounter%.spawns%[2%]%.kind");
	});

	it("runSpawn: the entrance, or the boss door when asked", () => {
		const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 1337 });
		expect(runSpawn(d, false)).toEqual(dungeon1337.entranceSpawn);
		expect(runSpawn(d, true)).toEqual(dungeon1337.bossDoorSpawn);
	});

	for (const [name, seed, fixture, tolerated] of CASES) {
		it(`${name}: every exported field matches`, () => {
			const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
			const seen: string[] = [];
			const diff = firstDiff(fixture, exportView(d), "", {
				ignore: (path) => IGNORED.has(path),
				tolerate1Ulp: isScatterPath,
				tolerated: seen,
				keyOrder: PIPELINE_ORDER,
			});
			expect(diff).toBeUndefined();
			expect(seen).toEqual(tolerated);
		});
	}
});

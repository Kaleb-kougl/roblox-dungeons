// The Goldling's floor roll and flee field (docs/FORTUNE.md GE1, FD10 / FD13). The roll is pure (the same floor always
// gets the same answer), draws from its own stream with fixed draws (a hand twin replays them), lands at the depth
// band's rate (30 / 35 / 40 % from floor 2, never on floor 1), only in an eligible room (combat / elite with planned
// spawns and room to run, never the boss room) and leaves the rest of the floor untouched. The flee field is checked
// against a brute-force twin (exact), and a cornered Goldling slips past the player with the re-relax (factor 1.2)
// where a plain negated distance field (factor 1) pins it. Census: rooms per floor, eligible rooms, room sizes.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AFFIXES,
	BOSS_PICK,
	BREAKABLE,
	BREAKABLE_LOOT,
	EncounterRng,
	GOLDEN_FLEE,
	GOLDEN_PLACE,
	PELLETS,
	ROSTER,
	SOLID_DECOR,
	TileType,
	buildEndlessFloor,
	fleeField,
	fleeStep,
	floorSeed,
	generateDungeon,
	goldenChancePercent,
	goldenEligibleRooms,
	goldenRoomMask,
	goldenRoomWeight,
	goldenSeed,
	newFleeScratch,
	placeGolden,
	placePellets,
	roomGridRect,
	tileAt,
	type Dungeon,
	type EndlessFloorLayout,
	type FloorGolden,
	type ForgeParams,
	type GoldenFloorInput,
} from "shared/dungeon";
import { DROPS } from "shared/sim";

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

const CENSUS_RUNS = 8;
const FIRST = 2;
const LAST = 13;
const CENSUS: EndlessFloorLayout[] = [];
/** The run seed of each CENSUS entry. */
const RUN_OF: number[] = [];
for (let run = 1; run <= CENSUS_RUNS; run++)
	for (let floor = FIRST; floor <= LAST; floor++) {
		CENSUS.push(buildEndlessFloor(run, floor, dungeonFor));
		RUN_OF.push(run);
	}

function inputOf(l: EndlessFloorLayout): GoldenFloorInput {
	return { seed: l.seed, dungeon: l.dungeon, encounter: l.encounter, roomSpawns: l.roomSpawns };
}

/** A hand twin of placeGolden from its file comment. Returns the room (or undefined) and the draws taken. */
function twin(l: EndlessFloorLayout): { room: number | undefined; draws: number } {
	if (l.floor < GOLDEN_PLACE.fromFloor) return { room: undefined, draws: 0 };
	const rng = new EncounterRng(bit32.bxor(l.seed, GOLDEN_PLACE.salt));
	const percent = l.floor >= 10 ? 40 : l.floor >= 5 ? 35 : 30;
	if (rng.int(0, 99) >= percent) return { room: undefined, draws: 1 };
	const eligible = l.encounter.rooms.filter(
		(r) =>
			r.id !== l.dungeon.boss &&
			(r.type === "combat" || r.type === "elite") &&
			r.floorTiles >= GOLDEN_PLACE.minRoomTiles &&
			(l.roomSpawns[r.id] ?? []).size() > 0,
	);
	if (eligible.size() === 0) return { room: undefined, draws: 1 };
	return { room: eligible[rng.int(0, eligible.size() - 1)].id, draws: 2 };
}

describe("golden roll: tunables, stream and determinism", () => {
	it("tunables (FD13): from floor 2 at 30 / 35 / 40 % by band, combat and elite rooms, its own salt", () => {
		expect(GOLDEN_PLACE.salt).toBe(0x3d2f8b4d);
		expect(GOLDEN_PLACE.fromFloor).toBe(2);
		const chances: number[] = [];
		for (let f = 1; f <= 12; f++) chances.push(goldenChancePercent(f));
		expect(chances).toEqual([0, 30, 30, 30, 35, 35, 35, 35, 35, 40, 40, 40]);
		expect(goldenChancePercent(40)).toBe(40);
		expect([goldenRoomWeight("combat"), goldenRoomWeight("elite")]).toEqual([1, 1]);
		for (const t of ["entrance", "treasure", "shrine", "boss"]) expect([t, goldenRoomWeight(t)]).toEqual([t, 0]);
		expect(GOLDEN_FLEE.factor).toBe(1.2);
		// No other floor or sim stream uses the salt (docs/FORTUNE.md: the plan's list plus the solid decor and drops).
		const others = [
			BREAKABLE.salt,
			BOSS_PICK.salt,
			AFFIXES.salt,
			BREAKABLE_LOOT.salt,
			PELLETS.salt,
			ROSTER.salt,
			SOLID_DECOR.salt,
			DROPS.salt,
		];
		for (const s of others) expect(s).never.toBe(GOLDEN_PLACE.salt);
		expect(goldenSeed(12345)).toBe(bit32.bxor(12345, GOLDEN_PLACE.salt));
	});

	it("is a pure function of the floor: the same floor (fresh dungeon too) gets the same Goldling", () => {
		for (let i = 0; i < CENSUS.size(); i += 7) {
			const l = CENSUS[i];
			expect(placeGolden(inputOf(l), l.floor)).toEqual(l.golden);
			const fresh = generateDungeon(l.dungeon.params);
			expect(buildEndlessFloor(RUN_OF[i], l.floor, () => fresh).golden).toEqual(l.golden);
		}
	});

	it("fixed draws: a hand twin of the file comment picks the same room; 0 / 1 / 2 draws", () => {
		let hits = 0;
		for (const l of CENSUS) {
			const t = twin(l);
			expect([l.floor, l.seed, l.golden?.room]).toEqual([l.floor, l.seed, t.room]);
			expect(t.draws === 1 || t.draws === 2).toBe(true);
			if (t.room !== undefined) hits++;
		}
		expect(hits).toBeGreaterThan(0);
		// Floor 1 never draws.
		const f1 = buildEndlessFloor(7, 1, dungeonFor);
		expect(f1.golden).toBe(undefined);
		expect(twin(f1).draws).toBe(0);
	});

	it("nothing in the input is mutated, and the rest of the floor is what it was (pellets placed before it)", () => {
		for (const l of CENSUS.filter((_l, i) => i % 11 === 0)) {
			const before = [l.roomSpawns.size(), l.encounter.rooms.size(), l.dungeon.roomId.size()];
			const spawnsCopy = l.roomSpawns.map((r) => r.map((s) => `${s.kind}@${s.x},${s.z}`).join(";"));
			placeGolden(inputOf(l), l.floor);
			expect([l.roomSpawns.size(), l.encounter.rooms.size(), l.dungeon.roomId.size()]).toEqual(before);
			expect(l.roomSpawns.map((r) => r.map((s) => `${s.kind}@${s.x},${s.z}`).join(";"))).toEqual(spawnsCopy);
			expect(
				placePellets({ ...inputOf(l), spawn: l.spawn, stairwell: l.stairwell }, l.floor, l.breakables ?? []),
			).toEqual(l.pellets);
		}
	});
});

describe("golden roll: where and how often", () => {
	it("the chance draw lands at its band's rate (2000 run seeds per floor, floors 2-12)", () => {
		const RUNS = 2000;
		const lines: string[] = [];
		for (let floor = 2; floor <= 12; floor++) {
			let hit = 0;
			for (let run = 1; run <= RUNS; run++) {
				const rng = new EncounterRng(goldenSeed(floorSeed(run, floor)));
				if (rng.int(0, GOLDEN_PLACE.percentRange - 1) < goldenChancePercent(floor)) hit++;
			}
			const rate = (100 * hit) / RUNS;
			lines.push(`f${floor} ${string.format("%.1f", rate)} %`);
			expect(math.abs(rate - goldenChancePercent(floor))).toBeLessThan(3.5);
		}
		print(`[golden] chance draw hit rate: ${lines.join(", ")}`);
	});

	it("only in an eligible room: combat / elite, planned spawns, room to run, never the boss room", () => {
		for (const l of CENSUS) {
			const g = l.golden;
			if (g === undefined) continue;
			const room = l.encounter.rooms[g.room];
			expect(room.id).toBe(g.room);
			expect(g.room).never.toBe(l.dungeon.boss);
			expect(room.type === "combat" || room.type === "elite").toBe(true);
			expect((l.roomSpawns[g.room] ?? []).size()).toBeGreaterThan(0);
			expect(room.floorTiles).toBeGreaterThanOrEqual(GOLDEN_PLACE.minRoomTiles);
			expect(
				goldenEligibleRooms(inputOf(l))
					.map((r) => r.id)
					.includes(g.room),
			).toBe(true);
		}
	});

	it("the walk mask is exactly the room's own FLOOR cells over its floor rectangle", () => {
		for (const l of CENSUS) {
			const g: FloorGolden | undefined = l.golden;
			if (g === undefined) continue;
			const d = l.dungeon;
			const room = l.encounter.rooms[g.room];
			const [x0, y0, x1, y1] = roomGridRect(room);
			expect([g.x0, g.y0, g.w, g.h]).toEqual([x0, y0, x1 - x0 + 1, y1 - y0 + 1]);
			expect(g.walk.size()).toBe(g.w * g.h);
			let ones = 0;
			for (let ly = 0; ly < g.h; ly++)
				for (let lx = 0; lx < g.w; lx++) {
					const gx = x0 + lx;
					const gy = y0 + ly;
					const own = tileAt(d, gx, gy) === TileType.FLOOR && d.roomId[gy * d.W + gx] === g.room ? 1 : 0;
					expect(g.walk[ly * g.w + lx]).toBe(own);
					ones += own;
				}
			expect(ones).toBe(room.floorTiles);
			// Every planned spawn of the room stands on the mask.
			for (const s of l.roomSpawns[g.room]) expect(g.walk[(s.z - y0) * g.w + (s.x - x0)]).toBe(1);
		}
	});

	it("census (runs 1-8 x floors 2-13): Goldling floors, eligible rooms, room sizes", () => {
		let floors = 0;
		let withGolden = 0;
		let eligibleSum = 0;
		let minTiles = math.huge;
		let noEligible = 0;
		const bandHits = [0, 0, 0];
		const bandFloors = [0, 0, 0];
		for (const l of CENSUS) {
			floors++;
			const band = l.floor >= 10 ? 2 : l.floor >= 5 ? 1 : 0;
			bandFloors[band]++;
			const eligible = goldenEligibleRooms(inputOf(l));
			eligibleSum += eligible.size();
			if (eligible.size() === 0) noEligible++;
			// Every combat / elite room with spawns, before the size rule.
			for (const r of l.encounter.rooms)
				if (
					r.id !== l.dungeon.boss &&
					(r.type === "combat" || r.type === "elite") &&
					(l.roomSpawns[r.id] ?? []).size() > 0
				)
					minTiles = math.min(minTiles, r.floorTiles);
			if (l.golden !== undefined) {
				withGolden++;
				bandHits[band]++;
			}
		}
		print(
			`[golden] ${withGolden}/${floors} floors with a Goldling (bands 2-4 / 5-9 / 10-13: ${bandHits[0]}/${bandFloors[0]}, ` +
				`${bandHits[1]}/${bandFloors[1]}, ${bandHits[2]}/${bandFloors[2]}); ${string.format(
					"%.1f",
					eligibleSum / floors,
				)} eligible rooms per floor, ${noEligible} floors with none; smallest combat / elite room with spawns ${minTiles} cells`,
		);
		expect(noEligible).toBe(0);
		expect(minTiles).toBeGreaterThanOrEqual(GOLDEN_PLACE.minRoomTiles);
		expect(withGolden).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------------------------
// The flee field

/** An open box (every cell 1) of w x h with the cells in `walls` (lx, ly) closed. */
function box(w: number, h: number, walls: ReadonlyArray<readonly [number, number]> = []): number[] {
	const open: number[] = [];
	for (let i = 0; i < w * h; i++) open.push(1);
	for (const [x, y] of walls) open[y * w + x] = 0;
	return open;
}

/** Brute force: out[c] = min over reached s of (-factor D[s] + steps(s, c)) with plain BFS per seed. */
function bruteField(open: number[], w: number, h: number, sources: number[], factor: number): number[] {
	const n = w * h;
	const bfsFrom = (seeds: number[]): number[] => {
		const d: number[] = [];
		for (let i = 0; i < n; i++) d.push(math.huge);
		const q: number[] = [];
		for (const s of seeds)
			if (open[s] === 1 && d[s] !== 0) {
				d[s] = 0;
				q.push(s);
			}
		let head = 0;
		while (head < q.size()) {
			const c = q[head++];
			const cx = c % w;
			const cy = (c - cx) / w;
			for (const [ox, oy] of [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1],
			]) {
				const nx = cx + ox;
				const ny = cy + oy;
				if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
				const j = ny * w + nx;
				if (open[j] !== 1 || d[j] <= d[c] + 1) continue;
				d[j] = d[c] + 1;
				q.push(j);
			}
		}
		return d;
	};
	const D = bfsFrom(sources);
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(math.huge);
	for (let s = 0; s < n; s++) {
		if (D[s] === math.huge) continue;
		const steps = bfsFrom([s]);
		for (let c = 0; c < n; c++) if (steps[c] !== math.huge) out[c] = math.min(out[c], -factor * D[s] + steps[c]);
	}
	return out;
}

function runField(open: number[], w: number, h: number, sources: number[], factor = GOLDEN_FLEE.factor): number[] {
	const out: number[] = [];
	for (let i = 0; i < w * h; i++) out.push(0);
	fleeField(open, w, h, sources, sources.size(), out, newFleeScratch(w * h), factor);
	return out;
}

describe("golden flee field", () => {
	it("equals a brute-force twin exactly (random boxes with walls, one to three sources)", () => {
		const rng = new EncounterRng(777);
		for (let trial = 0; trial < 30; trial++) {
			const w = rng.int(3, 11);
			const h = rng.int(3, 9);
			const walls: Array<[number, number]> = [];
			const wallCount = rng.int(0, math.floor((w * h) / 4));
			for (let k = 0; k < wallCount; k++) walls.push([rng.int(0, w - 1), rng.int(0, h - 1)]);
			const open = box(w, h, walls);
			const sources: number[] = [];
			const nSources = rng.int(1, 3);
			for (let k = 0; k < nSources; k++) sources.push(rng.int(0, w * h - 1));
			expect(runField(open, w, h, sources)).toEqual(bruteField(open, w, h, sources, GOLDEN_FLEE.factor));
		}
	});

	it("walks away from the player down an open corridor; no source (or nothing reached) stands still", () => {
		const w = 12;
		const open = box(w, 1);
		const f = runField(open, w, 1, [0]);
		// From cell 5 the step is always away (x + 1) until the far end.
		let at = 5;
		for (let k = 0; k < 6; k++) {
			const step1 = fleeStep(open, w, 1, f, at, 0);
			expect(step1).toBe(at + 1);
			at = step1;
		}
		expect(fleeStep(open, w, 1, f, w - 1, 0)).toBe(-1);
		const none = runField(open, w, 1, []);
		for (const v of none) expect(v).toBe(math.huge);
		expect(fleeStep(open, w, 1, none, 3, 0)).toBe(-1);
		// A source on a closed cell or out of the box is ignored.
		const walled = box(w, 1, [[0, 0]]);
		expect(runField(walled, w, 1, [0, -4, 99])).toEqual(runField(walled, w, 1, []));
	});

	it("a cornered Goldling slips past the player with the re-relax (factor 1.2); a plain field (factor 1) pins it", () => {
		// A dead end: the Goldling at x = 0, the player at x = 2, the long room beyond (x up to 39).
		const w = 40;
		const open = box(w, 1);
		const slip = runField(open, w, 1, [2]);
		expect(fleeStep(open, w, 1, slip, 0, 0)).toBe(1); // toward the player, to get past
		const pinned = runField(open, w, 1, [2], 1);
		expect(fleeStep(open, w, 1, pinned, 0, 0)).toBe(-1); // the corner is a local minimum
		// In 2D: a 3-wide hall, the Goldling in the closed end's corner, the player one cell in front.
		const hw = 30;
		const hh = 3;
		const hall = box(hw, hh);
		const player = 1 * hw + 2;
		const f = runField(hall, hw, hh, [player]);
		let cell = 0; // (0, 0): the corner behind the player
		const visited: number[] = [];
		for (let k = 0; k < 40; k++) {
			const step1 = fleeStep(hall, hw, hh, f, cell % hw, (cell - (cell % hw)) / hw);
			if (step1 < 0) break;
			visited.push(step1);
			cell = step1;
		}
		expect(cell % hw).toBe(hw - 1); // it reached the far end
		expect(visited.includes(player)).toBe(false); // around the player, never through its cell
	});

	it("fleeStep: diagonals only past open corners; ties to the first neighbour", () => {
		// 3 x 3, the centre's right and down neighbours closed: the down-right diagonal is not allowed.
		const open = box(3, 3, [
			[2, 1],
			[1, 2],
		]);
		const field = [9, 9, 9, 9, 5, 0, 9, 0, -10];
		expect(fleeStep(open, 3, 3, field, 1, 1)).toBe(-1); // (2, 2) is lowest but cut off; others are higher
		const flat = [1, 1, 1, 1, 1, 0, 1, 0, 0];
		const o2 = box(3, 3);
		expect(fleeStep(o2, 3, 3, flat, 1, 1)).toBe(5); // (2, 1) before (1, 2): straight neighbours in DX8 order
		expect(fleeStep(o2, 3, 3, flat, -1, 0)).toBe(-1);
	});

	it("goldenRoomMask of a hand room is its FLOOR cells of that room only", () => {
		const l = CENSUS.find((x) => x.golden !== undefined)!;
		const g = l.golden!;
		const again = goldenRoomMask(l.dungeon, l.encounter.rooms[g.room]);
		expect(again).toEqual(g);
	});
});

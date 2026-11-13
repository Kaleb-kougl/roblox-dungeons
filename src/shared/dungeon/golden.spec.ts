// The Goldling's floor roll and flee field (docs/FORTUNE.md GE1, FD10 / FD13) and its hiding place (docs/GOLDLING_RUMOURS.md
// GR1, RD10 / RD11 / RD15). The roll is pure (the same floor always gets the same answer), draws from its own stream with
// fixed draws (a hand twin replays them: 0 / 1 / 4), lands at the depth band's rate (30 / 35 / 40 % from floor 2, never
// on floor 1), only in an eligible room (combat / elite with planned spawns, room to run and a cell its piece fits on,
// never the boss room). Its barrel or crate stands in its room on a clutter candidate cell (off doorways, spawns,
// pools, the entrance and the stairwell), off pellets and the vault chest's front box, passing the gap and reachability
// rules against every earlier piece (the full BFS too: nothing reached before is cut off, the chest's front stays
// reached), and is appended LAST: every earlier piece, slot, loot slot, the chest's slot, the pellets and the altars are
// what the floor builds without it, and roomSpawnTiles loses only its cell. Parties of 1-4. The flee field is checked
// against a brute-force twin (exact), and a cornered Goldling slips past the player with the re-relax (factor 1.2)
// where a plain negated distance field (factor 1) pins it. The census (old rule vs new, barrel / crate) is
// golden.census.spec.ts.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AFFIXES,
	BOSS_PICK,
	BREAKABLE,
	BREAKABLE_KINDS,
	BREAKABLE_LOOT,
	EncounterRng,
	GOLDEN_FLEE,
	GOLDEN_PLACE,
	PELLETS,
	ROSTER,
	SOLID_DECOR,
	TileType,
	VAULT,
	breakableCandidates,
	buildEndlessFloor,
	cellKey,
	endlessRoomSpawnTiles,
	fleeField,
	fleeStep,
	floorSeed,
	generateDungeon,
	goldenChancePercent,
	goldenEligibleRooms,
	goldenPiece,
	goldenPieceCells,
	goldenRoomMask,
	goldenRoomOpen,
	goldenRoomWeight,
	goldenRooms,
	goldenSeed,
	gridToWorld,
	newFleeScratch,
	pieceFitsAt,
	placeBreakableLoot,
	placeBreakables,
	placeGolden,
	placePactAltars,
	placePellets,
	placeVault,
	roomGridRect,
	tileAt,
	vaultChest,
	withoutBreakableCells,
	worldToGrid,
	type Dungeon,
	type EndlessFloorLayout,
	type FloorGolden,
	type ForgeParams,
	type GoldenFloorInput,
	type VaultPlan,
} from "shared/dungeon";
import { piecesBeforeGolden } from "shared/dungeon/testing";
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
/** Every endless world builds its floors with vaults (shared/run buildEndlessRunConfig), so the chest is in play. */
const CENSUS: EndlessFloorLayout[] = [];
/** The run seed of each CENSUS entry. */
const RUN_OF: number[] = [];
for (let run = 1; run <= CENSUS_RUNS; run++)
	for (let floor = FIRST; floor <= LAST; floor++) {
		CENSUS.push(buildEndlessFloor(run, floor, dungeonFor, 1, { vaults: true }));
		RUN_OF.push(run);
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

/** The vault chest's front box (the cells the vault kept FLOOR and free of pieces), by hand: cellKeys. */
function chestFrontBox(v: VaultPlan | undefined): Set<number> {
	const out = new Set<number>();
	if (v === undefined) return out;
	const px = v.fz !== 0 ? 1 : 0;
	const pz = v.fx !== 0 ? 1 : 0;
	for (let a = 0; a <= VAULT.wallClearTiles; a++)
		for (let b = -VAULT.sideClearTiles; b <= VAULT.sideClearTiles; b++)
			out.add(cellKey(v.x + v.fx * a + px * b, v.y + v.fz * a + pz * b));
	return out;
}

/** The pellets' cells (cellKey). */
function pelletCells(l: EndlessFloorLayout): Set<number> {
	const out = new Set<number>();
	for (const t of l.pellets?.tiles ?? []) out.add(cellKey(worldToGrid(t.x), worldToGrid(t.z)));
	return out;
}

/** The old room rule (before the hiding place): a weighted type, planned spawns, room to run, not the boss room. */
function oldOpen(l: EndlessFloorLayout, r: EndlessFloorLayout["encounter"]["rooms"][number]): boolean {
	return (
		r.id !== l.dungeon.boss &&
		(r.type === "combat" || r.type === "elite") &&
		r.floorTiles >= GOLDEN_PLACE.minRoomTiles &&
		(l.roomSpawns[r.id] ?? []).size() > 0
	);
}

/** A hand twin's piece cells of room `r`: the file comment's "cell" rule, composed by hand. */
function twinCells(
	l: EndlessFloorLayout,
	r: EndlessFloorLayout["encounter"]["rooms"][number],
): Array<[number, number]> {
	const pieces = piecesBefore(l);
	const taken = new Set<number>();
	for (const b of pieces) taken.add(cellKey(b.x, b.y));
	const pellets = pelletCells(l);
	const front = chestFrontBox(l.vault);
	const out: Array<[number, number]> = [];
	for (const c of breakableCandidates(inputOf(l), r)) {
		const k = cellKey(c.x, c.z);
		if (taken.has(k) || pellets.has(k) || front.has(k)) continue;
		if (!pieceFitsAt(l.dungeon, pieces, c.x, c.z)) continue;
		out.push([c.x, c.z]);
	}
	return out;
}

interface Twin {
	readonly golden: FloorGolden | undefined;
	readonly draws: number;
}

/** A hand twin of placeGolden from its file comment. Returns the Goldling (or undefined) and the draws taken. */
function twin(l: EndlessFloorLayout): Twin {
	if (l.floor < GOLDEN_PLACE.fromFloor) return { golden: undefined, draws: 0 };
	const rng = new EncounterRng(bit32.bxor(l.seed, GOLDEN_PLACE.salt));
	const percent = l.floor >= 10 ? 40 : l.floor >= 5 ? 35 : 30;
	if (rng.int(0, 99) >= percent) return { golden: undefined, draws: 1 };
	const eligible: Array<{ id: number; cells: Array<[number, number]> }> = [];
	for (const r of l.encounter.rooms) {
		if (!oldOpen(l, r)) continue;
		const cells = twinCells(l, r);
		if (cells.size() > 0) eligible.push({ id: r.id, cells });
	}
	if (eligible.size() === 0) return { golden: undefined, draws: 1 };
	const pick = eligible[rng.int(0, eligible.size() - 1)]; // weights 1 / 1
	const [x, y] = pick.cells[rng.int(0, pick.cells.size() - 1)];
	const kind = rng.next() < BREAKABLE.crateShare ? "crate" : "barrel";
	const mask = goldenRoomMask(l.dungeon, l.encounter.rooms[pick.id]);
	return {
		golden: { ...mask, piece: piecesBefore(l).size(), pieceX: x, pieceY: y, pieceKind: kind },
		draws: 4,
	};
}

/** 4-neighbour BFS from the entrance centre over FLOOR minus `blocked` (cellKey): reached cells (cellKey). */
function reach(d: Dungeon, blocked: ReadonlySet<number>): Set<number> {
	const e = d.rooms[d.entrance];
	const seen = new Set<number>([cellKey(e.cx, e.cy)]);
	const qx: number[] = [e.cx];
	const qy: number[] = [e.cy];
	let h = 0;
	while (h < qx.size()) {
		const x = qx[h];
		const y = qy[h];
		h++;
		for (const [ox, oy] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		]) {
			const nx = x + ox;
			const ny = y + oy;
			const k = cellKey(nx, ny);
			if (tileAt(d, nx, ny) !== TileType.FLOOR || seen.has(k) || blocked.has(k)) continue;
			seen.add(k);
			qx.push(nx);
			qy.push(ny);
		}
	}
	return seen;
}

/** Checks every hiding-place rule of `l`'s Goldling (none: nothing to check). */
function checkPiece(l: EndlessFloorLayout): void {
	const g = l.golden;
	if (g === undefined) return;
	const d = l.dungeon;
	const all = l.breakables!;
	const before = piecesBefore(l);
	const tag = `${l.seed}/${l.floor}`;
	// Appended last, as goldenPiece(g), a barrel or a crate.
	expect([tag, g.piece, all.size()]).toEqual([tag, before.size(), before.size() + 1]);
	expect(all[g.piece]).toEqual(goldenPiece(g));
	expect(all[g.piece]).toEqual({ x: g.pieceX, y: g.pieceY, kind: g.pieceKind });
	expect((BREAKABLE_KINDS as ReadonlyArray<string>).includes(g.pieceKind)).toBe(true);
	// In its room: on the walk mask (a FLOOR cell of the room), a clutter candidate (doorways, spawns, entrance,
	// stairwell, pools), off every pellet and the chest's front box, the gap and ring rules against the earlier pieces.
	const lx = g.pieceX - g.x0;
	const ly = g.pieceY - g.y0;
	expect([tag, g.walk[ly * g.w + lx]]).toEqual([tag, 1]);
	expect(d.roomId[g.pieceY * d.W + g.pieceX]).toBe(g.room);
	const cand = breakableCandidates(inputOf(l), l.encounter.rooms[g.room]);
	expect(cand.some((c) => c.x === g.pieceX && c.z === g.pieceY)).toBe(true);
	const k = cellKey(g.pieceX, g.pieceY);
	expect([tag, pelletCells(l).has(k)]).toEqual([tag, false]);
	expect([tag, chestFrontBox(l.vault).has(k)]).toEqual([tag, false]);
	for (const b of before) expect(b.x === g.pieceX && b.y === g.pieceY).toBe(false);
	expect([tag, pieceFitsAt(d, before, g.pieceX, g.pieceY)]).toEqual([tag, true]);
	expect(
		goldenPieceCells(inputOf(l), l.encounter.rooms[g.room]).some((c) => c.x === g.pieceX && c.z === g.pieceY),
	).toBe(true);
	// Never the boss room; never a planned spawn's cell.
	expect(g.room).never.toBe(d.boss);
	for (const sp of l.roomSpawns[g.room])
		expect(worldToGrid(sp.x) === g.pieceX && worldToGrid(sp.z) === g.pieceY).toBe(false);
	// Full BFS: every cell reached with the earlier pieces is still reached with it (but its own); every pellet and the
	// chest's front cells too.
	const blocked0 = new Set<number>();
	for (const b of before) blocked0.add(cellKey(b.x, b.y));
	const blocked1 = new Set<number>();
	for (const b of all) blocked1.add(cellKey(b.x, b.y));
	const r0 = reach(d, blocked0);
	const r1 = reach(d, blocked1);
	let lost = 0;
	for (const c of r0) if (c !== k && !r1.has(c)) lost++;
	expect([tag, lost]).toEqual([tag, 0]);
	for (const c of pelletCells(l)) if (r0.has(c)) expect(r1.has(c)).toBe(true);
	const v = l.vault;
	if (v !== undefined)
		expect([tag, r1.has(cellKey(v.x + v.fx, v.y + v.fz))]).toEqual([tag, r0.has(cellKey(v.x + v.fx, v.y + v.fz))]);
}

/** The floor's other outputs rebuilt without the Goldling (the pieces before it) equal the layout's. */
function checkRestOfFloor(l: EndlessFloorLayout, partySize: number): void {
	const input = {
		seed: l.seed,
		dungeon: l.dungeon,
		encounter: l.encounter,
		roomSpawns: l.roomSpawns,
		spawn: l.spawn,
		stairwell: l.stairwell,
	};
	const clutter = placeBreakables(input, l.floor);
	const pellets = placePellets(input, l.floor, clutter);
	const vault = placeVault(input, l.floor, clutter, pellets);
	const pieces = vault !== undefined ? [...clutter, vaultChest(vault)] : clutter;
	const tag = `${l.seed}/${l.floor}/${partySize}`;
	expect([tag, piecesBefore(l)]).toEqual([tag, pieces]);
	expect(l.pellets).toEqual(pellets);
	expect(l.vault).toEqual(vault);
	expect(l.breakableLoot).toEqual(placeBreakableLoot(l.seed, l.floor, clutter, l.encounter));
	expect(l.pactAltars).toEqual(placePactAltars(input, pieces, pellets));
	for (const loot of l.breakableLoot ?? []) expect(loot.slot < clutter.size()).toBe(true);
	if (vault !== undefined) expect(vault.slot).toBe(clutter.size());
	// roomSpawnTiles: the list without the Goldling minus its cell (order kept), nothing else.
	const without = withoutBreakableCells(endlessRoomSpawnTiles(l.dungeon, l.roomSpawns), pieces);
	expect(l.roomSpawnTiles.size()).toBe(without.size());
	const g = l.golden;
	for (let id = 0; id < without.size(); id++) {
		const want =
			g === undefined
				? without[id]
				: without[id].filter((t) => !(t.x === gridToWorld(g.pieceX) && t.z === gridToWorld(g.pieceY)));
		expect([tag, id, l.roomSpawnTiles[id]]).toEqual([tag, id, want]);
	}
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
		// The piece's kind rule is the clutter's (RD11): a crate at crateShare.
		expect(BREAKABLE.crateShare).toBe(0.5);
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
			VAULT.salt,
		];
		for (const s of others) expect(s).never.toBe(GOLDEN_PLACE.salt);
		expect(goldenSeed(12345)).toBe(bit32.bxor(12345, GOLDEN_PLACE.salt));
	});

	it("is a pure function of the floor: the same floor (fresh dungeon too) gets the same Goldling and piece", () => {
		for (let i = 0; i < CENSUS.size(); i += 7) {
			const l = CENSUS[i];
			expect(placeGolden(inputOf(l), l.floor)).toEqual(l.golden);
			const fresh = generateDungeon(l.dungeon.params);
			const again = buildEndlessFloor(RUN_OF[i], l.floor, () => fresh, 1, { vaults: true });
			expect(again.golden).toEqual(l.golden);
			expect(again.breakables).toEqual(l.breakables);
		}
	});

	it("fixed draws: a hand twin of the file comment picks the same room, cell and kind; 0 / 1 / 4 draws", () => {
		let hits = 0;
		let crates = 0;
		for (const l of CENSUS) {
			const t = twin(l);
			expect([l.floor, l.seed, l.golden]).toEqual([l.floor, l.seed, t.golden]);
			expect(t.draws === 1 || t.draws === 4).toBe(true);
			if (t.golden !== undefined) {
				hits++;
				if (t.golden.pieceKind === "crate") crates++;
			}
		}
		expect(hits).toBeGreaterThan(0);
		expect(crates).toBeGreaterThan(0);
		expect(crates).toBeLessThan(hits);
		// Floor 1 never draws.
		const f1 = buildEndlessFloor(7, 1, dungeonFor, 1, { vaults: true });
		expect(f1.golden).toBe(undefined);
		expect(twin(f1).draws).toBe(0);
	});

	it("nothing in the input is mutated", () => {
		for (const l of CENSUS.filter((_l, i) => i % 11 === 0)) {
			const before = [l.roomSpawns.size(), l.encounter.rooms.size(), l.dungeon.roomId.size()];
			const spawnsCopy = l.roomSpawns.map((r) => r.map((s) => `${s.kind}@${s.x},${s.z}`).join(";"));
			const input = inputOf(l);
			const piecesCopy = input.pieces.map((b) => `${b.kind}@${b.x},${b.y}`).join(";");
			placeGolden(input, l.floor);
			expect([l.roomSpawns.size(), l.encounter.rooms.size(), l.dungeon.roomId.size()]).toEqual(before);
			expect(l.roomSpawns.map((r) => r.map((s) => `${s.kind}@${s.x},${s.z}`).join(";"))).toEqual(spawnsCopy);
			expect(input.pieces.map((b) => `${b.kind}@${b.x},${b.y}`).join(";")).toEqual(piecesCopy);
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

	it("only in an eligible room: combat / elite, planned spawns, room to run, a piece cell, never the boss room", () => {
		for (const l of CENSUS) {
			const g = l.golden;
			if (g === undefined) continue;
			const room = l.encounter.rooms[g.room];
			expect(room.id).toBe(g.room);
			expect(g.room).never.toBe(l.dungeon.boss);
			expect(room.type === "combat" || room.type === "elite").toBe(true);
			expect((l.roomSpawns[g.room] ?? []).size()).toBeGreaterThan(0);
			expect(room.floorTiles).toBeGreaterThanOrEqual(GOLDEN_PLACE.minRoomTiles);
			expect(goldenRoomOpen(inputOf(l), room)).toBe(true);
			expect(
				goldenEligibleRooms(inputOf(l))
					.map((r) => r.id)
					.includes(g.room),
			).toBe(true);
		}
		// goldenRooms: open rooms with at least one cell, its cells = goldenPieceCells (row order).
		for (const l of CENSUS.filter((_l, i) => i % 5 === 0)) {
			const input = inputOf(l);
			const rooms = goldenRooms(input);
			for (const r of rooms) {
				expect(r.cells.size()).toBeGreaterThan(0);
				expect(r.cells).toEqual(goldenPieceCells(input, r.room));
				for (let i = 1; i < r.cells.size(); i++) {
					const a = r.cells[i - 1];
					const b = r.cells[i];
					expect(a.z < b.z || (a.z === b.z && a.x < b.x)).toBe(true);
				}
			}
			for (const r of l.encounter.rooms)
				if (!rooms.some((x) => x.room.id === r.id)) {
					const open = goldenRoomOpen(input, r);
					expect(!open || goldenPieceCells(input, r).size() === 0).toBe(true);
				}
		}
	});

	it("the hiding place: in its room, a candidate cell off pellets and the chest's front, the gap and reachability rules, appended last", () => {
		let checked = 0;
		for (const l of CENSUS) {
			if (l.golden === undefined) continue;
			checkPiece(l);
			checked++;
		}
		expect(checked).toBeGreaterThan(10);
	});

	it("every earlier output is the floor's without it: pieces and slots, loot, pellets, the vault, the altars; roomSpawnTiles loses only its cell", () => {
		for (const l of CENSUS) checkRestOfFloor(l, 1);
	});

	it("parties of 1-4 (pieces depend on the party's spawns): every rule holds", () => {
		let golden = 0;
		for (let run = 1; run <= 3; run++)
			for (let floor = 2; floor <= 9; floor++)
				for (let n = 1; n <= 4; n++) {
					const l = buildEndlessFloor(run, floor, dungeonFor, n, { vaults: true });
					expect(l.golden).toEqual(twin(l).golden);
					checkPiece(l);
					checkRestOfFloor(l, n);
					if (l.golden !== undefined) golden++;
				}
		expect(golden).toBeGreaterThan(0);
	});

	it("a vault floor whose Goldling room is the vault room keeps the chest's front open", () => {
		let found = 0;
		for (let run = 1; run <= 60 && found < 3; run++)
			for (let floor = 2; floor <= 9 && found < 3; floor++) {
				const l = buildEndlessFloor(run, floor, dungeonFor, 1, { vaults: true });
				if (l.golden === undefined || l.vault === undefined || l.vault.room !== l.golden.room) continue;
				checkPiece(l);
				expect(l.golden.piece).toBe(l.vault.slot + 1);
				found++;
			}
		expect(found).toBeGreaterThan(0);
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

	it("goldenRoomMask of a hand room is its FLOOR cells of that room only (the floor's FloorGolden without its piece)", () => {
		const l = CENSUS.find((x) => x.golden !== undefined)!;
		const g = l.golden!;
		const again = goldenRoomMask(l.dungeon, l.encounter.rooms[g.room]);
		expect(again).toEqual({ room: g.room, x0: g.x0, y0: g.y0, w: g.w, h: g.h, walk: g.walk });
	});
});

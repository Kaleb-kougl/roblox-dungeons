// Pact altars (docs/FORTUNE.md PS1, FD1 / FD3): where an endless floor's two altars stand in its shrine room. Pure (the
// same floor always gets the same altars), no draw, only open FLOOR cells of the shrine room off every piece and pellet
// with their whole zone on floor, reachable from the entrance, on the crystal's screen-horizontal line (Greed left,
// Horde right), zones apart from each other and from the crystal; the rest of the floor (layout, spawns, pieces, loot,
// affixes, pellets, boss pick) untouched. The curse pick (pactCurseIndex): pure, in range, its own stream. Census (PS1):
// runs 1-20 x floors 1-20 at roomScale 2, the floors with a shrine room and how many keep the classic shrine (the
// fallback; target 0).
import { describe, expect, it } from "@rbxts/jest-globals";
import { imul } from "shared/jsmath";
import {
	EncounterRng,
	PACTS,
	PACT_KIND_COUNT,
	PactKind,
	TileType,
	buildEndlessFloor,
	cellKey,
	generateDungeon,
	pactCurseIndex,
	pactSeed,
	pactShrineRoom,
	placePactAltars,
	reachableFloor,
	tileAt,
	worldToGrid,
	type BreakableFloorInput,
	type Dungeon,
	type EndlessFloorLayout,
	type ForgeParams,
} from "shared/dungeon";

/** Generated per call: the census keeps no dungeon (400 floors' grids held at once ran the headless runner out of memory). */
function dungeonFor(params: ForgeParams): Dungeon {
	return generateDungeon(params);
}

const CENSUS_RUNS = 20;
const CENSUS_FLOORS = 20;
/** Every SAMPLE_EVERY-th census floor is kept for the purity checks. */
const SAMPLE_EVERY = 23;

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

/**
 * An altar's place relative to the crystal in steps: [along PACTS.screenRight, along PACTS.screenDown]. Both steps are
 * diagonal grid steps, so a cell offset (ex, ey) = k x right + m x down; NaN off that lattice.
 */
function lineOf(cx: number, cz: number, x: number, z: number): [number, number] {
	const [rx, ry] = PACTS.screenRight;
	const [dx, dy] = PACTS.screenDown;
	const ex = x - cx;
	const ey = z - cz;
	const k = (ex * rx + ey * ry) / 2;
	const m = (ex * dx + ey * dy) / 2;
	if (k * rx + m * dx !== ex || k * ry + m * dy !== ey) return [0 / 0, 0 / 0];
	return [k, m];
}

interface Census {
	floors: number;
	shrines: number;
	placed: number;
	mirrored: number;
	shifted: number;
	offsets: Map<number, number>;
	/** Rule breaks found ("run r floor f: what"), the first few. */
	problems: string[];
	problemCount: number;
	samples: Array<{ run: number; layout: EndlessFloorLayout }>;
}

let census: Census | undefined;

/** Builds every census floor once and checks each as it goes (see the file comment); keeps only a few samples. */
function getCensus(): Census {
	if (census !== undefined) return census;
	const c: Census = {
		floors: 0,
		shrines: 0,
		placed: 0,
		mirrored: 0,
		shifted: 0,
		offsets: new Map(),
		problems: [],
		problemCount: 0,
		samples: [],
	};
	const zone = PACTS.clearCells; // the sim's SHRINE_RADIUS in tiles (a sim spec checks it)
	const apart = (ax: number, az: number, bx: number, bz: number) =>
		(ax - bx) * (ax - bx) + (az - bz) * (az - bz) > 4 * zone * zone;
	for (let run = 1; run <= CENSUS_RUNS; run++)
		for (let floor = 1; floor <= CENSUS_FLOORS; floor++) {
			const l = buildEndlessFloor(run, floor, dungeonFor);
			const bad = (what: string) => {
				c.problemCount++;
				if (c.problems.size() < 10) c.problems.push(`run ${run} floor ${floor}: ${what}`);
			};
			if (c.floors % SAMPLE_EVERY === 0) c.samples.push({ run, layout: l });
			c.floors++;
			const room = pactShrineRoom(l.encounter.rooms);
			const p = l.pactAltars;
			if (room === undefined) {
				if (p !== undefined) bad("altars without a shrine room");
				continue;
			}
			c.shrines++;
			if (p === undefined) continue;
			c.placed++;
			if (p.room !== room.id || p.seed !== l.seed || p.altars.size() !== PACT_KIND_COUNT)
				bad("room / seed / count");
			// each altar: its zone on open FLOOR of the shrine room, no piece or pellet in it, reachable
			const d = l.dungeon;
			const pieces = new Set<number>();
			for (const b of l.breakables ?? []) pieces.add(cellKey(b.x, b.y));
			const pellets = new Set<number>();
			for (const t of l.pellets?.tiles ?? []) pellets.add(cellKey(worldToGrid(t.x), worldToGrid(t.z)));
			const reach = reachableFloor(d, l.spawn.x, l.spawn.z, pieces);
			for (const a of p.altars) {
				const gx = worldToGrid(a.x);
				const gy = worldToGrid(a.z);
				if (a.x !== gx || a.z !== gy) bad("not a cell centre");
				if (!reach[gy * d.W + gx]) bad("unreachable");
				const k = PACTS.clearCells;
				for (let y = gy - k; y <= gy + k; y++)
					for (let x = gx - k; x <= gx + k; x++) {
						// never solid decor, a pillar or a wall; never another room's floor
						if (tileAt(d, x, y) !== TileType.FLOOR || d.roomId[y * d.W + x] !== room.id)
							bad("zone off floor");
						if (pieces.has(cellKey(x, y))) bad("a piece in the zone");
						if (pellets.has(cellKey(x, y))) bad("a pellet in the zone");
					}
			}
			// one screen-horizontal line through (or shifted from) the crystal, Greed left, Horde right; zones apart
			const g = p.altars[PactKind.GREED];
			const h = p.altars[PactKind.HORDE];
			const [gk, gm] = lineOf(room.cx, room.cz, g.x, g.z);
			const [hk, hm] = lineOf(room.cx, room.cz, h.x, h.z);
			if (!(gk < 0) || !(hk > 0)) bad("sides");
			if (gm !== hm || !PACTS.shiftSteps.includes(gm)) bad("shift");
			if (!PACTS.offsetSteps.includes(-gk) || !PACTS.offsetSteps.includes(hk)) bad("offsets");
			if (!apart(g.x, g.z, h.x, h.z) || !apart(g.x, g.z, room.cx, room.cz) || !apart(h.x, h.z, room.cx, room.cz))
				bad("zones overlap");
			if (-gk === hk) c.mirrored++;
			if (gm !== 0) c.shifted++;
			c.offsets.set(-gk, (c.offsets.get(-gk) ?? 0) + 1);
			c.offsets.set(hk, (c.offsets.get(hk) ?? 0) + 1);
		}
	census = c;
	return c;
}

describe("pact altars (PS1)", () => {
	it("census: every floor with a shrine room gets both altars (fallback rate 0); none without one", () => {
		const c = getCensus();
		const parts: string[] = [];
		for (const k of PACTS.offsetSteps) parts.push(`${k}: ${c.offsets.get(k) ?? 0}`);
		print(
			`[PS1 census] ${c.floors} floors (runs 1-${CENSUS_RUNS} x floors 1-${CENSUS_FLOORS}): ${c.shrines} with a ` +
				`shrine room, ${c.placed} with both altars (${c.shrines - c.placed} keep the classic shrine), ${
					c.mirrored
				} ` +
				`mirrored pairs, ${c.shifted} shifted off the crystal's line; altar offsets (steps): ${parts.join(
					", ",
				)}`,
		);
		expect(c.floors).toBe(CENSUS_RUNS * CENSUS_FLOORS);
		expect(c.shrines > 0).toBe(true);
		expect(c.placed).toBe(c.shrines);
	});

	it("each altar: its zone on open FLOOR of the shrine room, no piece or pellet in it, reachable; one line, Greed left, Horde right, zones apart", () => {
		const c = getCensus();
		expect(c.problems).toEqual([]);
		expect(c.problemCount).toBe(0);
	});

	it("pure and draws nothing: the same floor gets the same altars, and the rest of the floor is the same", () => {
		for (const { run, layout: l } of getCensus().samples) {
			const again = placePactAltars(inputOf(l), l.breakables ?? [], l.pellets);
			expect(again).toEqual(l.pactAltars);
			const rebuilt = buildEndlessFloor(run, l.floor, dungeonFor);
			expect(rebuilt.seed).toBe(l.seed);
			expect(rebuilt.pactAltars).toEqual(l.pactAltars);
			expect(rebuilt.roomSpawns).toEqual(l.roomSpawns);
			expect(rebuilt.breakables).toEqual(l.breakables);
			expect(rebuilt.roomAffixes).toEqual(l.roomAffixes);
			expect(rebuilt.breakableLoot).toEqual(l.breakableLoot);
			expect(rebuilt.pellets).toEqual(l.pellets);
			expect(rebuilt.bossKind).toEqual(l.bossKind);
		}
	});

	it("no shrine room or no fit: undefined (the classic shrine stays)", () => {
		let l: EndlessFloorLayout | undefined;
		for (const smp of getCensus().samples)
			if (l === undefined && smp.layout.pactAltars !== undefined) l = smp.layout;
		expect(l).never.toBe(undefined);
		if (l === undefined) return;
		const noShrine = l.encounter.rooms.map((r) => (r.type === "shrine" ? { ...r, type: "combat" as const } : r));
		expect(placePactAltars({ ...inputOf(l), encounter: { ...l.encounter, rooms: noShrine } }, [], undefined)).toBe(
			undefined,
		);
		// Every cell of the shrine room covered by a pellet: nothing fits.
		const room = pactShrineRoom(l.encounter.rooms)!;
		const tiles: Array<{ x: number; z: number }> = [];
		const rooms: number[] = [];
		const d = l.dungeon;
		for (let gy = 0; gy < d.H; gy++)
			for (let gx = 0; gx < d.W; gx++)
				if (d.roomId[gy * d.W + gx] === room.id && tileAt(d, gx, gy) === TileType.FLOOR) {
					tiles.push({ x: gx, z: gy });
					rooms.push(room.id);
				}
		expect(placePactAltars(inputOf(l), l.breakables ?? [], { tiles, room: rooms, power: -1 })).toBe(undefined);
	});
});

describe("pactCurseIndex (FD3)", () => {
	it("is one draw of the pacts' own stream, per floor seed and player, in range", () => {
		for (let seed = 1; seed <= 50; seed++)
			for (let player = 0; player < 4; player++)
				for (let n = 1; n <= 4; n++) {
					const k = pactCurseIndex(seed * 7919, player, n);
					const want = new EncounterRng(
						bit32.bxor(pactSeed(seed * 7919), imul(player + 1, PACTS.playerMul)),
					).int(0, n - 1);
					expect(k).toBe(want);
					expect(k >= 0 && k < n).toBe(true);
					expect(pactCurseIndex(seed * 7919, player, n)).toBe(k);
				}
		expect(pactCurseIndex(1, 0, 0)).toBe(-1);
	});

	it("spreads over the curses (every index of 4 comes up for some floor), and players differ", () => {
		const seen = [0, 0, 0, 0];
		let differ = 0;
		for (let seed = 1; seed <= 200; seed++) {
			seen[pactCurseIndex(seed, 0, 4)]++;
			if (pactCurseIndex(seed, 0, 4) !== pactCurseIndex(seed, 1, 4)) differ++;
		}
		for (const n of seen) expect(n > 20).toBe(true);
		expect(differ > 100).toBe(true);
	});

	it("the salt is the pacts' own (no other stream of the floor uses it)", () => {
		expect(PACTS.salt).toBe(0x5c3a91e7);
		expect(pactSeed(0)).toBe(0x5c3a91e7);
	});
});

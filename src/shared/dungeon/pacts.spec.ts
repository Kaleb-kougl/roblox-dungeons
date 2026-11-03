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

const CENSUS_RUNS = 20;
const CENSUS_FLOORS = 20;
const CENSUS: EndlessFloorLayout[] = [];
for (let run = 1; run <= CENSUS_RUNS; run++)
	for (let floor = 1; floor <= CENSUS_FLOORS; floor++) CENSUS.push(buildEndlessFloor(run, floor, dungeonFor));

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
 * diagonal grid steps, so a cell offset (ex, ey) = k x right + m x down. Throws on an offset off that lattice.
 */
function lineOf(cx: number, cz: number, x: number, z: number): [number, number] {
	const [rx, ry] = PACTS.screenRight;
	const [dx, dy] = PACTS.screenDown;
	const ex = x - cx;
	const ey = z - cz;
	const k = (ex * rx + ey * ry) / 2;
	const m = (ex * dx + ey * dy) / 2;
	expect(k * rx + m * dx).toBe(ex);
	expect(k * ry + m * dy).toBe(ey);
	return [k, m];
}

/** The floors whose encounter has a shrine room. */
function shrineFloors(): EndlessFloorLayout[] {
	return CENSUS.filter((l) => pactShrineRoom(l.encounter.rooms) !== undefined);
}

describe("pact altars (PS1)", () => {
	it("census: every floor with a shrine room gets both altars (fallback rate 0); none without one", () => {
		let shrines = 0;
		let placed = 0;
		let mirrored = 0;
		let shifted = 0;
		const offsets = new Map<number, number>();
		for (const l of CENSUS) {
			const room = pactShrineRoom(l.encounter.rooms);
			if (room === undefined) {
				expect(l.pactAltars).toBe(undefined);
				continue;
			}
			shrines++;
			const p = l.pactAltars;
			if (p === undefined) continue;
			placed++;
			const [kG, mG] = lineOf(room.cx, room.cz, p.altars[PactKind.GREED].x, p.altars[PactKind.GREED].z);
			const [kH] = lineOf(room.cx, room.cz, p.altars[PactKind.HORDE].x, p.altars[PactKind.HORDE].z);
			if (-kG === kH) mirrored++;
			if (mG !== 0) shifted++;
			offsets.set(-kG, (offsets.get(-kG) ?? 0) + 1);
			offsets.set(kH, (offsets.get(kH) ?? 0) + 1);
		}
		const parts: string[] = [];
		for (const k of PACTS.offsetSteps) parts.push(`${k}: ${offsets.get(k) ?? 0}`);
		print(
			`[PS1 census] ${CENSUS.size()} floors (runs 1-${CENSUS_RUNS} x floors 1-${CENSUS_FLOORS}): ${shrines} with a ` +
				`shrine room, ${placed} with both altars (${shrines - placed} keep the classic shrine), ${mirrored} ` +
				`mirrored pairs, ${shifted} shifted off the crystal's line; altar offsets (steps): ${parts.join(", ")}`,
		);
		expect(shrines > 0).toBe(true);
		expect(placed).toBe(shrines);
	});

	it("each altar: FLOOR of the shrine room, its zone on open floor with no piece or pellet, reachable", () => {
		for (const l of shrineFloors()) {
			const p = l.pactAltars;
			if (p === undefined) continue;
			const d = l.dungeon;
			const room = pactShrineRoom(l.encounter.rooms)!;
			expect(p.room).toBe(room.id);
			expect(p.seed).toBe(l.seed);
			expect(p.altars.size()).toBe(PACT_KIND_COUNT);
			const pieces = new Set<number>();
			for (const b of l.breakables ?? []) pieces.add(cellKey(b.x, b.y));
			const pellets = new Set<number>();
			for (const t of l.pellets?.tiles ?? []) pellets.add(cellKey(worldToGrid(t.x), worldToGrid(t.z)));
			const reach = reachableFloor(d, l.spawn.x, l.spawn.z, pieces);
			for (const a of p.altars) {
				const gx = worldToGrid(a.x);
				const gy = worldToGrid(a.z);
				expect(a.x).toBe(gx);
				expect(a.z).toBe(gy);
				expect(reach[gy * d.W + gx]).toBe(true);
				const c = PACTS.clearCells;
				for (let y = gy - c; y <= gy + c; y++)
					for (let x = gx - c; x <= gx + c; x++) {
						expect(tileAt(d, x, y)).toBe(TileType.FLOOR); // never solid decor, a pillar or a wall
						expect(d.roomId[y * d.W + x]).toBe(room.id);
						expect(pieces.has(cellKey(x, y))).toBe(false);
						expect(pellets.has(cellKey(x, y))).toBe(false);
					}
			}
		}
	});

	it("on one screen-horizontal line through (or shifted from) the crystal, Greed left, Horde right; zones apart", () => {
		const zone = PACTS.clearCells; // the sim's SHRINE_RADIUS in tiles (a sim spec checks it)
		for (const l of shrineFloors()) {
			const p = l.pactAltars;
			if (p === undefined) continue;
			const room = pactShrineRoom(l.encounter.rooms)!;
			const g = p.altars[PactKind.GREED];
			const h = p.altars[PactKind.HORDE];
			const [gk, gm] = lineOf(room.cx, room.cz, g.x, g.z);
			const [hk, hm] = lineOf(room.cx, room.cz, h.x, h.z);
			expect(gk < 0).toBe(true);
			expect(hk > 0).toBe(true);
			expect(gm).toBe(hm);
			expect(PACTS.shiftSteps.includes(gm)).toBe(true);
			expect(PACTS.offsetSteps.includes(-gk)).toBe(true);
			expect(PACTS.offsetSteps.includes(hk)).toBe(true);
			const apart = (ax: number, az: number, bx: number, bz: number) =>
				(ax - bx) * (ax - bx) + (az - bz) * (az - bz) > 4 * zone * zone;
			expect(apart(g.x, g.z, h.x, h.z)).toBe(true);
			expect(apart(g.x, g.z, room.cx, room.cz)).toBe(true);
			expect(apart(h.x, h.z, room.cx, room.cz)).toBe(true);
		}
	});

	it("pure and draws nothing: the same floor gets the same altars, and the rest of the floor is the same", () => {
		for (let i = 0; i < CENSUS.size(); i += 7) {
			const l = CENSUS[i];
			const again = placePactAltars(inputOf(l), l.breakables ?? [], l.pellets);
			expect(again).toEqual(l.pactAltars);
			const rebuilt = buildEndlessFloor(math.floor(i / CENSUS_FLOORS) + 1, l.floor, dungeonFor);
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
		const l = shrineFloors()[0];
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

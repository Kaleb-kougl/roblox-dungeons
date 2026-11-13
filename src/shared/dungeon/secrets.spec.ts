// Secret rooms (docs/SECRET_ROOMS.md SR1, Rules, Design 1): where an endless floor hides its cracked far wall, the
// chamber behind it and the chest's tier. Pure (a hand twin replays the stream: 0, 1 or 3 draws), never on floor 1 or in
// a boss / entrance / shrine / treasure room; the crack on a far wall between room FLOOR and VOID; the front box FLOOR of
// the room and free of pieces; the chamber inside the grid, its ring touching no other floor, one way in; the carved
// grid differs only on the chamber, ring and crack; the pieces appended last; and the option off (or a floor without a
// secret) is the floor exactly as before. The census is secrets.census.spec.ts.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AFFIXES,
	BOSS_PICK,
	BREAKABLE,
	BREAKABLE_KINDS,
	BREAKABLE_LOOT,
	BREAKABLE_PIECE_KINDS,
	CHEST_KIND,
	CRACKED_WALL_KIND,
	EncounterRng,
	FLOOR_MODIFIER_WORLD_ALL,
	FLOOR_SEED_MUL,
	GOLDEN_PLACE,
	MODIFIERS,
	PACTS,
	PELLETS,
	ROSTER,
	SECRET,
	SOLID_DECOR,
	TileType,
	VAULT,
	VaultTier,
	buildEndlessFloor,
	cellKey,
	generateDungeon,
	placeSecret,
	secretCandidates,
	secretCrackCells,
	secretSeed,
	tileAt,
	vaultFrontCells,
	type Dungeon,
	type EndlessFloorLayout,
	type EndlessFloorOptions,
	type FloorSecret,
	type ForgeParams,
	type SecretFloorInput,
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

const RUNS = 4;
const FLOORS = 9;
/** The endless worlds' options (shared/run endlessRunFloor) without and with secrets. */
const WORLD: EndlessFloorOptions = { vaults: true, unlockFloors: false, modifiers: FLOOR_MODIFIER_WORLD_ALL };
const ON: EndlessFloorOptions = { ...WORLD, secrets: true };
const EVERY: EndlessFloorOptions = { ...WORLD, secrets: true, secretOverride: { every: true } };

interface Built {
	readonly run: number;
	readonly floor: number;
	readonly off: EndlessFloorLayout;
	readonly on: EndlessFloorLayout;
	readonly every: EndlessFloorLayout;
}

const BUILT: Built[] = [];
for (let run = 1; run <= RUNS; run++)
	for (let floor = 1; floor <= FLOORS; floor++)
		BUILT.push({
			run,
			floor,
			off: buildEndlessFloor(run, floor, dungeonFor, 1, WORLD),
			on: buildEndlessFloor(run, floor, dungeonFor, 1, ON),
			every: buildEndlessFloor(run, floor, dungeonFor, 1, EVERY),
		});

/** The secrets of the `every` builds (floors with a candidate). */
const SECRETS: Array<{ readonly b: Built; readonly s: FloorSecret }> = [];
for (const b of BUILT) if (b.every.secret !== undefined) SECRETS.push({ b, s: b.every.secret });

/** placeSecret's input of a built floor (its pieces without the secret's own). */
function inputOf(l: EndlessFloorLayout): SecretFloorInput {
	const pieces = [...(l.breakables ?? [])];
	if (l.secret !== undefined) while (pieces.size() > l.secret.crackSlot) pieces.pop();
	return {
		seed: l.seed,
		dungeon: l.dungeon,
		encounter: l.encounter,
		roomSpawns: l.roomSpawns,
		spawn: l.spawn,
		stairwell: l.stairwell,
		pieces,
		vault: l.vault,
		pactAltars: l.pactAltars,
	};
}

/** The chamber rectangle grown by `g`, as a test. */
function inRect(s: FloorSecret, x: number, y: number, g: number): boolean {
	return x >= s.x0 - g && x < s.x0 + s.w + g && y >= s.y0 - g && y < s.y0 + s.h + g;
}

/** The cell's depth behind the wall line (0 on it, > 0 behind, < 0 in front). */
function depthOf(s: FloorSecret, x: number, y: number): number {
	return s.fx !== 0 ? s.x - x : s.y - y;
}

describe("secrets: data and stream", () => {
	it("the tunables are the plan's (SRD1 / SRD6 / SRD10)", () => {
		expect(SECRET.fromFloor).toBe(2);
		expect(SECRET.chancePercent).toBe(25);
		expect(SECRET.crackCells).toBe(2);
		expect(SECRET.frontDepth).toBe(3);
		expect(SECRET.chambers.map((c) => [c.along, c.depth])).toEqual([
			[5, 4],
			[4, 4],
			[4, 3],
			[3, 3],
		]);
		expect(SECRET.tierWeights.map((w) => [w.tier, w.weight])).toEqual([
			[VaultTier.RARE, 65],
			[VaultTier.LEGENDARY, 35],
		]);
	});

	it("piece kinds: the clutter kinds unchanged, the cracked wall appended as index 3", () => {
		expect(BREAKABLE_KINDS).toEqual(["barrel", "crate"]);
		expect(BREAKABLE_PIECE_KINDS).toEqual(["barrel", "crate", "chest", "crackedWall"]);
		expect(BREAKABLE_PIECE_KINDS[3]).toBe(CRACKED_WALL_KIND);
	});

	it("its own stream: floor seed ^ salt, a salt no other floor or sim stream uses", () => {
		expect(SECRET.salt).toBe(0x4b565343);
		expect(secretSeed(12345)).toBe(bit32.bxor(12345, SECRET.salt));
		const salts = [
			SECRET.salt,
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

	it("a hand twin replays the draws: none below fromFloor, then chance, pick, tier (0 / 1 / 3)", () => {
		for (const b of BUILT)
			for (const [l, every] of [
				[b.on, false],
				[b.every, true],
			] as const) {
				const input = inputOf(l);
				if (b.floor < SECRET.fromFloor) {
					expect(l.secret).toBe(undefined);
					continue;
				}
				const rng = new EncounterRng(secretSeed(l.seed));
				const hit = rng.int(0, SECRET.percentRange - 1) < SECRET.chancePercent;
				const candidates = secretCandidates(input);
				if ((!hit && !every) || candidates.size() === 0) {
					expect(l.secret).toBe(undefined);
					continue;
				}
				const c = candidates[rng.int(0, candidates.size() - 1)];
				const roll = rng.int(0, 99);
				const tier = roll < 65 ? VaultTier.RARE : VaultTier.LEGENDARY;
				const s = l.secret!;
				expect([s.room, s.x, s.y, s.fx, s.fz, s.along, s.depth, s.tier]).toEqual([
					c.room,
					c.x,
					c.y,
					c.fx,
					c.fz,
					c.along,
					c.depth,
					tier,
				]);
				expect(placeSecret(input, b.floor, every ? { every: true } : undefined)).toEqual(s);
			}
	});

	it("override: `every` keeps the stream aligned; `tier` replaces the drawn one and moves nothing else", () => {
		for (const { b, s } of SECRETS) {
			const input = inputOf(b.every);
			const legendary = placeSecret(input, b.floor, { every: true, tier: VaultTier.LEGENDARY })!;
			expect(legendary.tier).toBe(VaultTier.LEGENDARY);
			expect({ ...legendary, tier: s.tier }).toEqual(s);
			if (b.on.secret !== undefined) expect(b.on.secret).toEqual(s);
		}
	});

	it("the sample holds secrets (most floors from 2 have a candidate)", () => {
		let open = 0;
		for (const b of BUILT) if (b.floor >= SECRET.fromFloor) open++;
		expect(SECRETS.size() * 2 > open).toBe(true);
	});
});

describe("secrets: the crack, the front box and the chamber (every secret of the sample)", () => {
	it("rooms: combat / elite only, never the entrance or boss room, never floor 1", () => {
		for (const { b, s } of SECRETS) {
			const room = b.every.encounter.rooms[s.room];
			expect(SECRET.roomTypes.includes(room.type)).toBe(true);
			expect(s.room).never.toBe(b.every.dungeon.entrance);
			expect(s.room).never.toBe(b.every.dungeon.boss);
			expect(s.room).never.toBe(b.every.encounter.bossRoom);
			expect(b.floor >= SECRET.fromFloor).toBe(true);
		}
	});

	it("the crack: far-wall cells, outer WALL with the room's FLOOR in front and VOID behind, a straight run", () => {
		for (const { b, s } of SECRETS) {
			const d = b.every.dungeon;
			expect(s.fx > 0 || s.fz > 0).toBe(true);
			expect([s.ax, s.az]).toEqual([s.fz, s.fx]);
			const cells = secretCrackCells(s);
			expect(cells.size()).toBe(SECRET.crackCells);
			for (const c of cells) {
				expect(tileAt(d, c.x, c.y)).toBe(TileType.WALL);
				expect(d.roomId[c.y * d.W + c.x]).toBe(-1);
				expect(tileAt(d, c.x + s.fx, c.y + s.fz)).toBe(TileType.FLOOR);
				expect(d.roomId[(c.y + s.fz) * d.W + c.x + s.fx]).toBe(s.room);
				expect(tileAt(d, c.x - s.fx, c.y - s.fz)).toBe(TileType.VOID);
				for (const t of d.torches) expect(math.max(math.abs(t.x - c.x), math.abs(t.y - c.y)) > 1).toBe(true);
				for (let oy = -SECRET.doorClearTiles; oy <= SECRET.doorClearTiles; oy++)
					for (let ox = -SECRET.doorClearTiles; ox <= SECRET.doorClearTiles; ox++) {
						const x = c.x + ox;
						const y = c.y + oy;
						if (x >= 0 && y >= 0 && x < d.W && y < d.H) expect(d.doorway[y * d.W + x]).toBe(0);
					}
			}
			// At least one more WALL cell on each side along the wall.
			const first = cells[0];
			const last = cells[cells.size() - 1];
			expect(tileAt(d, first.x - s.ax, first.y - s.az)).toBe(TileType.WALL);
			expect(tileAt(d, last.x + s.ax, last.y + s.az)).toBe(TileType.WALL);
		}
	});

	it("the front box: FLOOR of the room, no piece, outside the vault chest's front box", () => {
		for (const { b, s } of SECRETS) {
			const l = b.every;
			const d = l.dungeon;
			const pieces = new Set<number>();
			for (let i = 0; i < s.crackSlot; i++) pieces.add(cellKey(l.breakables![i].x, l.breakables![i].y));
			const vaultFront = l.vault !== undefined ? vaultFrontCells(l.vault) : new Set<number>();
			for (const c of secretCrackCells(s))
				for (let k = 1; k <= SECRET.frontDepth; k++) {
					const x = c.x + s.fx * k;
					const y = c.y + s.fz * k;
					expect(tileAt(d, x, y)).toBe(TileType.FLOOR);
					expect(d.roomId[y * d.W + x]).toBe(s.room);
					expect(pieces.has(cellKey(x, y))).toBe(false);
					expect(vaultFront.has(cellKey(x, y))).toBe(false);
				}
		}
	});

	it("the chamber: a SECRET.chambers size behind the crack, inside the grid, VOID in the Forge grid", () => {
		for (const { b, s } of SECRETS) {
			const d = b.every.dungeon;
			const sizes = SECRET.chambers.map((c) => `${c.along}x${c.depth}`);
			expect(sizes.includes(`${s.along}x${s.depth}`)).toBe(true);
			expect(s.fx !== 0 ? [s.h, s.w] : [s.w, s.h]).toEqual([s.along, s.depth]);
			expect(s.x0 - 1 >= 0 && s.y0 - 1 >= 0 && s.x0 + s.w < d.W && s.y0 + s.h < d.H).toBe(true);
			for (let y = s.y0; y < s.y0 + s.h; y++)
				for (let x = s.x0; x < s.x0 + s.w; x++) {
					expect(tileAt(d, x, y)).toBe(TileType.VOID);
					expect(depthOf(s, x, y) >= 1 && depthOf(s, x, y) <= s.depth).toBe(true);
				}
			// The crack lies on the ring's wall-line row, inside the chamber's span.
			for (const c of secretCrackCells(s)) {
				expect(depthOf(s, c.x, c.y)).toBe(0);
				expect(inRect(s, c.x - s.fx, c.y - s.fz, 0)).toBe(true);
			}
		}
	});

	it("its ring touches no other floor: only the wall line has FLOOR beside it, and only its own room's", () => {
		for (const { b, s } of SECRETS) {
			const d = b.every.dungeon;
			for (let y = s.y0 - 1; y <= s.y0 + s.h; y++)
				for (let x = s.x0 - 1; x <= s.x0 + s.w; x++) {
					const wallLine = depthOf(s, x, y) === 0;
					for (let oy = -1; oy <= 1; oy++)
						for (let ox = -1; ox <= 1; ox++) {
							const nx = x + ox;
							const ny = y + oy;
							const t = tileAt(d, nx, ny);
							if (t === TileType.POOL) expect(wallLine).toBe(true);
							if (t !== TileType.FLOOR) continue;
							expect(wallLine).toBe(true);
							expect(d.roomId[ny * d.W + nx]).toBe(s.room);
							expect(d.corridor[ny * d.W + nx]).toBe(0);
						}
				}
		}
	});

	it("one way in: in the carved grid the chamber's floor meets the rest only through the crack", () => {
		for (const { b, s } of SECRETS) {
			const g = s.dungeon;
			const crack = new Set<number>();
			for (const c of secretCrackCells(s)) crack.add(cellKey(c.x, c.y));
			// Flood from the chest over FLOOR (4-neighbours), never through the crack.
			const seen = new Set<number>([cellKey(s.chestX, s.chestY)]);
			const queue = [[s.chestX, s.chestY]];
			let head = 0;
			while (head < queue.size()) {
				const [x, y] = queue[head++];
				for (const [ox, oy] of [
					[1, 0],
					[-1, 0],
					[0, 1],
					[0, -1],
				]) {
					const nx = x + ox;
					const ny = y + oy;
					const key = cellKey(nx, ny);
					if (seen.has(key) || crack.has(key) || tileAt(g, nx, ny) !== TileType.FLOOR) continue;
					seen.add(key);
					queue.push([nx, ny]);
				}
			}
			expect(seen.size()).toBe(s.w * s.h);
			for (const c of secretCrackCells(s)) {
				expect(tileAt(g, c.x, c.y)).toBe(TileType.FLOOR);
				expect(tileAt(g, c.x - s.fx, c.y - s.fz)).toBe(TileType.FLOOR);
				expect(tileAt(g, c.x + s.fx, c.y + s.fz)).toBe(TileType.FLOOR);
			}
		}
	});

	it("the carved copy: a new grid differing only on the chamber, its ring and the crack; every other field shared", () => {
		for (const { b, s } of SECRETS) {
			const d = b.every.dungeon;
			const g = s.dungeon;
			expect(g.grid).never.toBe(d.grid);
			expect(g.roomId).toBe(d.roomId);
			expect(g.doorway).toBe(d.doorway);
			expect(g.bfs).toBe(d.bfs);
			expect(g.rooms).toBe(d.rooms);
			expect([g.W, g.H, g.seed, g.entrance, g.boss]).toEqual([d.W, d.H, d.seed, d.entrance, d.boss]);
			const crack = new Set<number>();
			for (const c of secretCrackCells(s)) crack.add(cellKey(c.x, c.y));
			// Counted, then one expect (a per-cell expect over the whole grid is slow headlessly).
			const bad: string[] = [];
			for (let y = 0; y < d.H; y++)
				for (let x = 0; x < d.W; x++) {
					const i = y * d.W + x;
					const want =
						crack.has(cellKey(x, y)) || inRect(s, x, y, 0)
							? TileType.FLOOR
							: inRect(s, x, y, 1)
							? TileType.WALL
							: d.grid[i];
					if (g.grid[i] !== want) bad.push(`${x},${y}`);
				}
			expect(bad).toEqual([]);
			expect(g.grid.size()).toBe(d.grid.size());
		}
	});

	it("the chest: on the chamber's back row, facing the crack; the pieces appended last (cracks, then the chest)", () => {
		for (const { b, s } of SECRETS) {
			const l = b.every;
			expect(inRect(s, s.chestX, s.chestY, 0)).toBe(true);
			expect(depthOf(s, s.chestX, s.chestY)).toBe(s.depth);
			const n = l.breakables!.size();
			expect(s.chestSlot).toBe(n - 1);
			expect(s.crackSlot).toBe(n - 1 - SECRET.crackCells);
			const cells = secretCrackCells(s);
			for (let c = 0; c < cells.size(); c++)
				expect(l.breakables![s.crackSlot + c]).toEqual({
					x: cells[c].x,
					y: cells[c].y,
					kind: CRACKED_WALL_KIND,
				});
			expect(l.breakables![s.chestSlot]).toEqual({ x: s.chestX, y: s.chestY, kind: CHEST_KIND });
		}
	});
});

describe("secrets: the rest of the floor is the option-off floor's", () => {
	it("every output but the appended pieces and `secret` is identical; a floor without one is the option-off floor", () => {
		for (const b of BUILT)
			for (const l of [b.on, b.every]) {
				const off = b.off;
				expect(off.secret).toBe(undefined);
				for (const p of off.breakables ?? []) expect(p.kind).never.toBe(CRACKED_WALL_KIND);
				expect(l.dungeon).toBe(off.dungeon);
				expect(l.encounter).toEqual(off.encounter);
				expect(l.roomSpawns).toEqual(off.roomSpawns);
				expect(l.roomSpawnTiles).toEqual(off.roomSpawnTiles);
				expect(l.roomAffixes).toEqual(off.roomAffixes);
				expect(l.breakableLoot).toEqual(off.breakableLoot);
				expect(l.pellets).toEqual(off.pellets);
				expect(l.vault).toEqual(off.vault);
				expect(l.pactAltars).toEqual(off.pactAltars);
				expect(l.golden).toEqual(off.golden);
				expect([l.modifier, l.bossFloor, l.bossKind, l.roster, l.spawn, l.stairwell]).toEqual([
					off.modifier,
					off.bossFloor,
					off.bossKind,
					off.roster,
					off.spawn,
					off.stairwell,
				]);
				const offPieces = off.breakables ?? [];
				if (l.secret === undefined) {
					expect(l).toEqual(off);
					continue;
				}
				const pieces = l.breakables!;
				expect(pieces.size()).toBe(offPieces.size() + SECRET.crackCells + 1);
				for (let i = 0; i < offPieces.size(); i++) expect(pieces[i]).toEqual(offPieces[i]);
			}
	});

	it("a party of 3: the same rule", () => {
		for (let run = 1; run <= 2; run++)
			for (let floor = 2; floor <= 5; floor++) {
				const off = buildEndlessFloor(run, floor, dungeonFor, 3, WORLD);
				const on = buildEndlessFloor(run, floor, dungeonFor, 3, EVERY);
				expect(on.roomSpawns).toEqual(off.roomSpawns);
				expect(on.roomSpawnTiles).toEqual(off.roomSpawnTiles);
				expect(on.golden).toEqual(off.golden);
				if (on.secret === undefined) expect(on).toEqual(off);
				else expect(on.breakables!.size()).toBe((off.breakables ?? []).size() + SECRET.crackCells + 1);
			}
	});
});

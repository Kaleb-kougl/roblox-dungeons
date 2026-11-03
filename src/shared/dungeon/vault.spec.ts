// Vaults (docs/TREASURE.md TR1, Design §1, corrections 1 / 2 / 10-12): where an endless floor's vault is, its chest
// cell and facing, tier and lock. Pure (the same floor always gets the same vault), its own stream with fixed draws
// (a hand twin replays them: 0, 1 or 4), only combat / elite rooms with planned spawns (never the entrance, pedestal,
// shrine, boss or a spawnless room), a WALL back row with no solid decor, the far-wall preference, >= doorFarTiles
// from the doorways, full BFS reachability of every floor cell and pellet, no new pinch, the override's alignment,
// and the rest of the floor (layout, props, spawns, pieces, loot, affixes, pellets, boss pick) identical to the
// option-off build; roomSpawnTiles = the option-off list minus the chest cell. The census is vault.census.spec.ts.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AFFIXES,
	BOSS_PICK,
	BREAKABLE,
	BREAKABLE_KINDS,
	BREAKABLE_LOOT,
	BREAKABLE_PIECE_KINDS,
	CHEST_KIND,
	EncounterRng,
	FLOOR_SEED_MUL,
	PELLETS,
	ROSTER,
	TileType,
	VAULT,
	VAULT_PERCENT_RANGE,
	VaultLock,
	VaultTier,
	breakableCandidates,
	buildEndlessFloor,
	cellKey,
	generateDungeon,
	gridToWorld,
	isFarWallFacing,
	legendaryPercent,
	pieceFitsAt,
	placeVault,
	roomDoorways,
	tileAt,
	vaultCandidates,
	vaultChancePercent,
	vaultRoomOpen,
	vaultRooms,
	vaultSeed,
	worldToGrid,
	type BreakableFloorInput,
	type BreakablePlacement,
	type Dungeon,
	type EndlessFloorLayout,
	type ForgeParams,
	type VaultOverride,
	type VaultPlan,
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

const RUNS = 4;
const FLOORS = 10;
const EVERY: VaultOverride = { every: true };

/** One floor built three ways: option off, vaults on, vaults on with `every`. */
interface Built {
	readonly run: number;
	readonly off: EndlessFloorLayout;
	readonly on: EndlessFloorLayout;
	readonly every: EndlessFloorLayout;
}

const BUILT: Built[] = [];
for (let run = 1; run <= RUNS; run++)
	for (let floor = 1; floor <= FLOORS; floor++)
		BUILT.push({
			run,
			off: buildEndlessFloor(run, floor, dungeonFor),
			on: buildEndlessFloor(run, floor, dungeonFor, 1, { vaults: true }),
			every: buildEndlessFloor(run, floor, dungeonFor, 1, { vaults: true, vaultOverride: EVERY }),
		});

/** Every floor that holds a vault (natural or forced), with the option-off twin of the floor. */
const VAULTED: Array<{ off: EndlessFloorLayout; on: EndlessFloorLayout }> = [];
for (const b of BUILT) {
	if (b.on.vault !== undefined) VAULTED.push({ off: b.off, on: b.on });
	if (b.every.vault !== undefined) VAULTED.push({ off: b.off, on: b.every });
}

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

function piecesOf(l: EndlessFloorLayout): ReadonlyArray<BreakablePlacement> {
	return l.breakables ?? [];
}

function vaultOf(l: EndlessFloorLayout): VaultPlan {
	expect(l.vault).never.toBe(undefined);
	return l.vault!;
}

/**
 * A hand twin of placeVault from its file comment: the chance draw, then (on a hit with eligible rooms) the weighted
 * room pick, the tier draw and the weighted lock draw. Returns the plan and the draws taken.
 */
function twin(
	l: EndlessFloorLayout,
	pieces: ReadonlyArray<BreakablePlacement>,
	override?: VaultOverride,
	seed = l.seed,
): { plan: VaultPlan | undefined; draws: number } {
	if (l.floor < VAULT.fromFloor) return { plan: undefined, draws: 0 };
	const rng = new EncounterRng(bit32.bxor(seed, VAULT.salt));
	const hit = rng.int(0, 99) < vaultChancePercent(l.floor);
	if (!hit && override?.every !== true) return { plan: undefined, draws: 1 };
	const rooms = vaultRooms({ ...inputOf(l), seed }, pieces, l.pellets);
	if (rooms.size() === 0) return { plan: undefined, draws: 1 };
	let total = 0;
	for (const r of rooms) total += r.room.type === "elite" ? 2 : 1;
	let roll = rng.int(0, total - 1);
	let pick = rooms[rooms.size() - 1];
	for (const r of rooms) {
		const w = r.room.type === "elite" ? 2 : 1;
		if (roll < w) {
			pick = r;
			break;
		}
		roll -= w;
	}
	const legendary = rng.int(0, 99) < legendaryPercent(l.floor);
	const lock = rng.int(0, 1);
	const c = pick.cells[0];
	return {
		plan: {
			room: pick.room.id,
			x: c.x,
			y: c.y,
			fx: c.fx,
			fz: c.fz,
			slot: pieces.size(),
			lock: override?.lock ?? lock,
			tier: override?.tier ?? (legendary ? VaultTier.LEGENDARY : VaultTier.RARE),
		},
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

function decorCells(d: Dungeon): Set<number> {
	const out = new Set<number>();
	for (const p of d.solidDecor)
		for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) out.add(cellKey(x, y));
	return out;
}

// ---------------------------------------------------------------------------------------------

describe("vault: tunables, kinds and stream", () => {
	it("tunables (TRD6): bands, weights, sizes, the Legendary share, the lock split", () => {
		expect(VAULT.salt).toBe(0xb5297a4d);
		expect(VAULT.fromFloor).toBe(2);
		expect(VAULT.chanceByBand.map((b) => [b.fromFloor, b.percent])).toEqual([
			[2, 40],
			[5, 50],
			[10, 55],
		]);
		expect([VAULT.roomWeight.combat, VAULT.roomWeight.elite, VAULT.roomWeight.treasure]).toEqual([1, 2, undefined]);
		expect([VAULT.minRoomTiles, VAULT.wallClearTiles, VAULT.sideClearTiles]).toEqual([120, 2, 1]);
		expect([VAULT.doorFarTiles, VAULT.decorClearTiles, VAULT_PERCENT_RANGE]).toEqual([6, 1, 100]);
		expect([VAULT.legendaryPercent.base, VAULT.legendaryPercent.perFloor, VAULT.legendaryPercent.max]).toEqual([
			25, 1, 40,
		]);
		expect(VAULT.lockWeights).toEqual([1, 1]);
		expect([VaultLock.UNTOUCHED, VaultLock.SWIFT]).toEqual([0, 1]);
		expect([VaultTier.COMMON, VaultTier.RARE, VaultTier.LEGENDARY]).toEqual([0, 1, 2]);
	});

	it("chance by band and the Legendary share by floor", () => {
		expect([1, 2, 4, 5, 9, 10, 30].map((f) => vaultChancePercent(f))).toEqual([0, 40, 40, 50, 50, 55, 55]);
		expect([2, 3, 10, 17, 18, 40].map((f) => legendaryPercent(f))).toEqual([25, 26, 33, 40, 40, 40]);
	});

	it("piece kinds: the clutter kinds unchanged, the chest appended as index 2", () => {
		expect(BREAKABLE_KINDS).toEqual(["barrel", "crate"]);
		expect(BREAKABLE_PIECE_KINDS).toEqual(["barrel", "crate", "chest"]);
		expect(BREAKABLE_PIECE_KINDS[2]).toBe(CHEST_KIND);
	});

	it("its own stream: floor seed ^ salt, a salt no other floor stream uses", () => {
		expect(vaultSeed(12345)).toBe(bit32.bxor(12345, VAULT.salt));
		const salts = [
			VAULT.salt,
			PELLETS.salt,
			BREAKABLE.salt,
			BOSS_PICK.salt,
			AFFIXES.salt,
			BREAKABLE_LOOT.salt,
			ROSTER.salt,
			0x7f4a7c15, // forge/solidDecor's SOLID_DECOR.salt (TR0 row 2)
			0x4b564452, // the sim's drop stream "KVDR"
			0x4b565452, // the sim's treasure stream "KVTR" (TR2)
		];
		for (let i = 0; i < salts.size(); i++) {
			expect(salts[i]).never.toBe(FLOOR_SEED_MUL);
			for (let j = i + 1; j < salts.size(); j++) expect(salts[i]).never.toBe(salts[j]);
		}
	});
});

describe("vault: the option gate", () => {
	it("off (absent, empty, or an override without `vaults`): no vault, the floor exactly as before", () => {
		for (const b of BUILT.filter((_b, i) => i % 3 === 0)) {
			const l = b.off;
			expect(l.vault).toBe(undefined);
			const f = l.floor;
			expect(buildEndlessFloor(b.run, f, dungeonFor, 1, {})).toEqual(l);
			expect(buildEndlessFloor(b.run, f, dungeonFor, 1, { vaults: false, vaultOverride: EVERY })).toEqual(l);
			expect(buildEndlessFloor(b.run, f, dungeonFor, 1, { vaultOverride: EVERY })).toEqual(l);
		}
	});

	it("on: below fromFloor never; vault floors exist; with `every` most floors from fromFloor hold one", () => {
		let natural = 0;
		let forced = 0;
		let eligibleFloors = 0;
		for (const b of BUILT) {
			if (b.on.floor < VAULT.fromFloor) {
				expect([b.on.vault, b.every.vault]).toEqual([undefined, undefined]);
				expect(b.on).toEqual(b.off);
				continue;
			}
			eligibleFloors++;
			if (b.on.vault !== undefined) natural++;
			if (b.every.vault !== undefined) forced++;
			if (b.on.vault === undefined) expect(b.on).toEqual(b.off);
		}
		print(`[vault] ${natural} natural / ${forced} forced vault floors of ${eligibleFloors} (floors 2-${FLOORS})`);
		expect(natural > 0).toBe(true);
		expect(forced >= eligibleFloors * 0.9).toBe(true);
	});
});

describe("vault: determinism and fixed draws", () => {
	it("is a pure function of the floor (fresh dungeon too) and mutates nothing", () => {
		for (const { off, on } of VAULTED.filter((_v, i) => i % 7 === 0)) {
			const pieces = piecesOf(off).map((p) => ({ ...p }));
			const spawns = off.roomSpawns.map((s) => s.map((x) => ({ ...x })));
			const again = placeVault(inputOf(off), off.floor, piecesOf(off), off.pellets, EVERY);
			expect(piecesOf(off)).toEqual(pieces);
			expect(off.roomSpawns).toEqual(spawns);
			expect(again).toEqual(twin(off, piecesOf(off), EVERY).plan);
			expect(again !== undefined && again.x === on.vault!.x && again.y === on.vault!.y).toBe(true);
		}
		const b = BUILT.find((x) => x.on.vault !== undefined)!;
		const fresh = buildEndlessFloor(b.run, b.on.floor, (p) => generateDungeon(p), 1, { vaults: true });
		expect(fresh.vault).toEqual(b.on.vault);
		expect(fresh.breakables).toEqual(b.on.breakables);
	});

	it("a hand twin of the file comment gives the same vault: 0 draws below fromFloor, 1 on a miss, 4 on a hit", () => {
		for (const b of BUILT) {
			const t = twin(b.off, piecesOf(b.off));
			expect(t.plan).toEqual(b.on.vault);
			if (b.off.floor < VAULT.fromFloor) expect(t.draws).toBe(0);
			else expect(t.draws).toBe(b.on.vault !== undefined ? 4 : 1);
			expect(twin(b.off, piecesOf(b.off), EVERY).plan).toEqual(b.every.vault);
		}
	});

	it("1000 streams on one floor: the twin agrees; the chance, Legendary and lock shares hold", () => {
		const b = BUILT.find(
			(x) => x.off.floor === 6 && vaultRooms(inputOf(x.off), piecesOf(x.off), x.off.pellets).size() > 1,
		)!;
		expect(b).never.toBe(undefined);
		const l = b.off;
		let hits = 0;
		let legendary = 0;
		let swift = 0;
		let elite = 0;
		const n = 1000;
		for (let seed = 1; seed <= n; seed++) {
			const plan = placeVault({ ...inputOf(l), seed }, l.floor, piecesOf(l), l.pellets);
			if (seed <= 50) expect(plan).toEqual(twin(l, piecesOf(l), undefined, seed).plan);
			if (plan === undefined) continue;
			hits++;
			if (plan.tier === VaultTier.LEGENDARY) legendary++;
			else expect(plan.tier).toBe(VaultTier.RARE);
			if (plan.lock === VaultLock.SWIFT) swift++;
			if (l.encounter.rooms[plan.room].type === "elite") elite++;
		}
		print(
			`[vault] floor ${l.floor}, ${n} streams: ${hits} vaults (chance ${vaultChancePercent(l.floor)} %), ` +
				`${legendary} Legendary (${legendaryPercent(l.floor)} %), ${swift} SWIFT, ${elite} in elite rooms`,
		);
		expect(math.abs(hits / n - vaultChancePercent(l.floor) / 100) < 0.05).toBe(true);
		expect(math.abs(legendary / hits - legendaryPercent(l.floor) / 100) < 0.07).toBe(true);
		expect(math.abs(swift / hits - 0.5) < 0.08).toBe(true);
	});

	it("override: `every` keeps later draws aligned; tier / lock replace the drawn ones and move nothing else", () => {
		for (const b of BUILT) {
			const l = b.off;
			if (b.on.vault !== undefined) expect(b.every.vault).toEqual(b.on.vault);
			const plain = b.every.vault;
			if (plain === undefined) continue;
			const forced = placeVault(inputOf(l), l.floor, piecesOf(l), l.pellets, {
				every: true,
				tier: VaultTier.LEGENDARY,
				lock: VaultLock.SWIFT,
			});
			expect(forced).toEqual({ ...plain, tier: VaultTier.LEGENDARY, lock: VaultLock.SWIFT });
			// tier / lock alone, without `every`: a natural miss stays a miss.
			const only = placeVault(inputOf(l), l.floor, piecesOf(l), l.pellets, { tier: VaultTier.RARE });
			if (b.on.vault === undefined) expect(only).toBe(undefined);
			else expect(only).toEqual({ ...b.on.vault, tier: VaultTier.RARE });
		}
	});
});

describe("vault: rooms and cells (every vault floor)", () => {
	it("only combat / elite rooms with planned spawns and >= minRoomTiles; never entrance / pedestal / shrine / boss", () => {
		for (const { on } of VAULTED) {
			const v = vaultOf(on);
			const room = on.encounter.rooms[v.room];
			expect(room.type === "combat" || room.type === "elite").toBe(true);
			expect(v.room !== on.dungeon.entrance && v.room !== on.dungeon.boss).toBe(true);
			expect(on.roomSpawns[v.room].size() > 0).toBe(true);
			expect(room.floorTiles >= VAULT.minRoomTiles).toBe(true);
			expect(on.dungeon.roomId[v.y * on.dungeon.W + v.x]).toBe(v.room);
			expect([VaultTier.RARE, VaultTier.LEGENDARY].includes(v.tier as 1 | 2)).toBe(true);
			expect([VaultLock.UNTOUCHED, VaultLock.SWIFT].includes(v.lock as 0 | 1)).toBe(true);
		}
		// vaultRoomOpen refuses every other room of every floor.
		for (const b of BUILT) {
			const input = inputOf(b.off);
			for (const room of b.off.encounter.rooms) {
				const open = vaultRoomOpen(input, room);
				const want =
					(room.type === "combat" || room.type === "elite") &&
					room.id !== b.off.dungeon.entrance &&
					room.id !== b.off.dungeon.boss &&
					b.off.roomSpawns[room.id].size() > 0 &&
					room.floorTiles >= VAULT.minRoomTiles;
				expect([room.id, open]).toEqual([room.id, want]);
				if (!open) expect(vaultCandidates(input, room, piecesOf(b.off), b.off.pellets).size()).toBe(0);
			}
		}
	});

	it("the cell: a candidate, off pieces and pellets, >= doorFarTiles from doorways, WALL back row, no decor near", () => {
		for (const { off, on } of VAULTED) {
			const d = on.dungeon;
			const v = vaultOf(on);
			const room = on.encounter.rooms[v.room];
			const key = cellKey(v.x, v.y);
			expect(breakableCandidates(inputOf(off), room).some((c) => c.x === v.x && c.z === v.y)).toBe(true);
			for (const p of piecesOf(off)) expect(cellKey(p.x, p.y)).never.toBe(key);
			for (const t of off.pellets!.tiles) expect(cellKey(worldToGrid(t.x), worldToGrid(t.z))).never.toBe(key);
			for (const door of roomDoorways(d, v.room)) {
				const dx = door.x - v.x;
				const dz = door.z - v.y;
				expect(dx * dx + dz * dz >= VAULT.doorFarTiles * VAULT.doorFarTiles).toBe(true);
			}
			const decor = decorCells(d);
			for (let oy = -1; oy <= 1; oy++)
				for (let ox = -1; ox <= 1; ox++) expect(decor.has(cellKey(v.x + ox, v.y + oy))).toBe(false);
			expect(math.abs(v.fx) + math.abs(v.fz)).toBe(1);
			const px = math.abs(v.fz);
			const pz = math.abs(v.fx);
			for (let k = -1; k <= 1; k++) {
				const bx = v.x - v.fx + k * px;
				const by = v.y - v.fz + k * pz;
				expect(tileAt(d, bx, by)).toBe(TileType.WALL);
				expect(decor.has(cellKey(bx, by))).toBe(false);
			}
			const pieceCells = new Set(piecesOf(off).map((p) => cellKey(p.x, p.y)));
			const open = (x: number, y: number) =>
				tileAt(d, x, y) === TileType.FLOOR &&
				d.roomId[y * d.W + x] === v.room &&
				!pieceCells.has(cellKey(x, y));
			for (let k = 1; k <= VAULT.wallClearTiles; k++) expect(open(v.x + v.fx * k, v.y + v.fz * k)).toBe(true);
			for (let k = 1; k <= VAULT.sideClearTiles; k++) {
				expect(open(v.x + px * k, v.y + pz * k)).toBe(true);
				expect(open(v.x - px * k, v.y - pz * k)).toBe(true);
			}
		}
	});

	it("far wall first: a near-wall chest only in a room with no far-wall cell; the first cell of the room", () => {
		let far = 0;
		for (const { off, on } of VAULTED) {
			const v = vaultOf(on);
			const cells = vaultCandidates(inputOf(off), off.encounter.rooms[v.room], piecesOf(off), off.pellets);
			expect(cells[0]).toEqual({ x: v.x, y: v.y, fx: v.fx, fz: v.fz });
			if (isFarWallFacing(v.fx, v.fz)) far++;
			else for (const c of cells) expect(isFarWallFacing(c.fx, c.fz)).toBe(false);
			// The order: far first, then farther from the nearest doorway, then row order.
			const doors = roomDoorways(off.dungeon, v.room);
			const near = (x: number, y: number) => {
				let m = math.huge;
				for (const dd of doors) m = math.min(m, (dd.x - x) * (dd.x - x) + (dd.z - y) * (dd.z - y));
				return m;
			};
			for (let i = 1; i < cells.size(); i++) {
				const a = cells[i - 1];
				const c = cells[i];
				const fa = isFarWallFacing(a.fx, a.fz);
				const fc = isFarWallFacing(c.fx, c.fz);
				if (fa !== fc) expect(fa).toBe(true);
				else if (near(a.x, a.y) !== near(c.x, c.y)) expect(near(a.x, a.y) > near(c.x, c.y)).toBe(true);
				else expect(a.y < c.y || (a.y === c.y && a.x < c.x)).toBe(true);
			}
		}
		print(`[vault] ${far} of ${VAULTED.size()} vault chests on a far wall`);
		expect(far > VAULTED.size() / 2).toBe(true);
	});

	it("no new pinch: the chest passes the clutter's gap rule and ring test against the floor's pieces", () => {
		for (const { off, on } of VAULTED) {
			const v = vaultOf(on);
			expect(pieceFitsAt(on.dungeon, piecesOf(off), v.x, v.y)).toBe(true);
			const d = on.dungeon;
			const taken = new Set<number>();
			for (const b of piecesOf(on)) taken.add(cellKey(b.x, b.y));
			const solid = (x: number, y: number) => tileAt(d, x, y) !== TileType.FLOOR || taken.has(cellKey(x, y));
			// Gap < 2 at Chebyshev distance 2 from the chest: only through a solid touching both (breakables.spec).
			for (let oy = -2; oy <= 2; oy++)
				for (let ox = -2; ox <= 2; ox++) {
					if (math.max(math.abs(ox), math.abs(oy)) !== 2 || !solid(v.x + ox, v.y + oy)) continue;
					let joined = false;
					for (let ty = -1; ty <= 1; ty++)
						for (let tx = -1; tx <= 1; tx++) {
							if (tx === 0 && ty === 0) continue;
							const cx = v.x + tx;
							const cy = v.y + ty;
							if (math.abs(cx - (v.x + ox)) <= 1 && math.abs(cy - (v.y + oy)) <= 1 && solid(cx, cy))
								joined = true;
						}
					expect([on.seed, ox, oy, joined]).toEqual([on.seed, ox, oy, true]);
				}
		}
	});

	it("reachability: every floor cell and every pellet reached without the chest is still reached with it", () => {
		for (const { off, on } of VAULTED) {
			const d = on.dungeon;
			const v = vaultOf(on);
			const before = new Set<number>();
			for (const b of piecesOf(off)) before.add(cellKey(b.x, b.y));
			const after = new Set<number>();
			for (const k of before) after.add(k);
			after.add(cellKey(v.x, v.y));
			const r0 = reach(d, before);
			const r1 = reach(d, after);
			let lost = 0;
			for (const k of r0) if (k !== cellKey(v.x, v.y) && !r1.has(k)) lost++;
			expect([on.seed, lost]).toEqual([on.seed, 0]);
			for (const t of on.pellets!.tiles) expect(r1.has(cellKey(worldToGrid(t.x), worldToGrid(t.z)))).toBe(true);
		}
	});
});

describe("vault: the rest of the floor is the option-off floor's", () => {
	it("rooms, props, spawns, pieces, loot slots, affixes, pellets and boss pick identical; the chest appended last", () => {
		for (const { off, on } of VAULTED) {
			const v = vaultOf(on);
			expect(on.dungeon).toBe(off.dungeon);
			expect(on.encounter).toEqual(off.encounter);
			expect(on.roomSpawns).toEqual(off.roomSpawns);
			expect(on.roomAffixes).toEqual(off.roomAffixes);
			expect(on.breakableLoot).toEqual(off.breakableLoot);
			expect(on.pellets).toEqual(off.pellets);
			expect([on.bossFloor, on.bossKind, on.roster, on.spawn, on.stairwell]).toEqual([
				off.bossFloor,
				off.bossKind,
				off.roster,
				off.spawn,
				off.stairwell,
			]);
			expect(v.slot).toBe(piecesOf(off).size());
			expect(piecesOf(on)).toEqual([...piecesOf(off), { x: v.x, y: v.y, kind: CHEST_KIND }]);
			for (const loot of on.breakableLoot ?? []) expect(loot.slot < v.slot).toBe(true);
		}
	});

	it("roomSpawnTiles: the option-off list minus the chest cell (order kept)", () => {
		for (const { off, on } of VAULTED) {
			const v = vaultOf(on);
			const cx = gridToWorld(v.x);
			const cz = gridToWorld(v.y);
			expect(on.roomSpawnTiles.size()).toBe(off.roomSpawnTiles.size());
			for (let id = 0; id < off.roomSpawnTiles.size(); id++)
				expect(on.roomSpawnTiles[id]).toEqual(
					off.roomSpawnTiles[id].filter((t) => !(t.x === cx && t.z === cz)),
				);
		}
	});

	it("a party of 4: the gate and the rest-of-floor rule hold too", () => {
		for (let run = 1; run <= 2; run++)
			for (let floor = 2; floor <= 6; floor++) {
				const off = buildEndlessFloor(run, floor, dungeonFor, 4);
				const on = buildEndlessFloor(run, floor, dungeonFor, 4, { vaults: true, vaultOverride: EVERY });
				expect(twin(off, piecesOf(off), EVERY).plan).toEqual(on.vault);
				if (on.vault === undefined) {
					expect(on).toEqual(off);
					continue;
				}
				expect(on.roomSpawns).toEqual(off.roomSpawns);
				expect(on.pellets).toEqual(off.pellets);
				expect(piecesOf(on)).toEqual([...piecesOf(off), { x: on.vault.x, y: on.vault.y, kind: CHEST_KIND }]);
			}
	});
});

// The decor plan (docs/DECOR.md R3 / R6, written from the plan: the web source was not available). Deterministic;
// the slice's interactables, doorways and breakables stay clear; no standing piece can hide a bullet (an independent
// ray check, not the plan's own polygon clipping); every cap holds over the census (runs 1-20 x floors 1-5 through
// buildEndlessFloor, solid pillars and breakables on) and on M1 floors (walk-through pillars).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	KALEB_VALE_MVP_PARAMS,
	TileType,
	buildEndlessFloor,
	encounterRooms,
	entranceSpawn,
	generateDungeon,
	isBulletBlockingTile,
	tileAt,
	type Dungeon,
	type EndlessFloorLayout,
	type ForgeParams,
} from "shared/dungeon";
import { PEDESTAL_RADIUS, SHRINE_RADIUS, STAIRWELL_RADIUS } from "shared/sim";
import { DECOR_KIND_LAYERS, decorId } from "shared/theme";
import {
	BULLET_PAD_PX,
	BULLET_Y,
	DECOR_BOX,
	DECOR_CAMERA,
	DECOR_CLEAR,
	DECOR_BANNERS,
	DECOR_BOOKCASES,
	DECOR_DROP_REASONS,
	DECOR_KENNEY,
	DECOR_PATCHES,
	DECOR_RUNNER,
	DECOR_SCATTER,
	MAX_DECOR_SHARE,
	MAX_TALL_PER_ROOM,
	TALL_MIN_SPACING,
	bookcaseVariant,
	insideBy,
	kenneyVariant,
	wideBookcaseVariant,
	decorInputOfLayout,
	footprintClear,
	footprintStencil,
	planDecor,
	type DecorFootprint,
	screenDepth,
	screenX,
	screenY,
	type DecorEntry,
	type DecorPlan,
} from ".";
import { PIXELS_PER_TILE } from "shared/config";

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

interface Floor {
	readonly layout: EndlessFloorLayout;
	readonly plan: DecorPlan;
}

const CENSUS: Floor[] = [];
let planSeconds = 0;
for (let run = 1; run <= 20; run++)
	for (let floor = 1; floor <= 5; floor++) {
		const layout = buildEndlessFloor(run, floor, dungeonFor);
		const t0 = os.clock();
		const plan = planDecor(decorInputOfLayout(layout));
		planSeconds += os.clock() - t0;
		CENSUS.push({ layout, plan });
	}

/** M1 floors (walk-through pillars: the Forge's pillars are tall pieces to move onto far walls). */
const M1: Array<{ d: Dungeon; plan: DecorPlan }> = [];
for (const seed of [1, 7, 42, 1337, 2024]) {
	const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
	M1.push({ d, plan: planDecor({ dungeon: d }) });
}

const ALL: Array<{ d: Dungeon; plan: DecorPlan }> = [
	...CENSUS.map((f) => ({ d: f.layout.dungeon, plan: f.plan })),
	...M1,
];

function cellsOf(e: DecorEntry): Array<readonly [number, number]> {
	const out: Array<readonly [number, number]> = [];
	for (let i = 0; i < e.cells; i++) out.push([e.cellX + i * e.runX, e.cellY + i * e.runZ]);
	return out;
}

/** A standing piece under the wall-top and footprint rules (solid decor stands on its own cells: its own spec). */
const standing = (e: DecorEntry) => (e.layer === "tall" || e.layer === "low") && e.source !== "solid";

function serialize(p: DecorPlan): string {
	const parts: string[] = [];
	for (const e of p.entries)
		parts.push(
			`${e.kind}|${e.layer}|${e.x}|${e.y}|${e.z}|${e.cellX},${e.cellY}|${e.cells}|${e.roomId}|${e.hash}|${e.lit}|${e.fade}|${e.forgeIndex}`,
		);
	for (const r of DECOR_DROP_REASONS) parts.push(`${r}=${p.dropped.get(r)}`);
	return parts.join(";");
}

/** Collects rule violations (one expect per test: Jest's expect is slow under Lune over ~25k entries). */
class Problems {
	readonly list: string[] = [];
	check(ok: boolean, what: () => string): void {
		if (!ok && this.list.size() < 10) this.list.push(what());
	}
}

const at = (plan: DecorPlan, e: DecorEntry) => `floor seed ${plan.floorSeed}: ${e.kind} at ${e.cellX},${e.cellY}`;

describe("decor plan: determinism", () => {
	it("gives the same plan for the same Dungeon, also regenerated from its params", () => {
		for (let i = 0; i < CENSUS.size(); i += 9) {
			const f = CENSUS[i];
			const again = planDecor(decorInputOfLayout(f.layout));
			expect(serialize(again)).toBe(serialize(f.plan));
			const fresh = generateDungeon(f.layout.dungeon.params);
			const third = planDecor({ ...decorInputOfLayout(f.layout), dungeon: fresh });
			expect(serialize(third)).toBe(serialize(f.plan));
		}
	});

	it("names every entry decorId(biome, kind) with a layer its kind allows", () => {
		const p = new Problems();
		for (const { plan } of ALL)
			for (const e of plan.entries) {
				p.check(e.id === decorId(plan.biome, e.kind), () => `${at(plan, e)}: id ${e.id}`);
				p.check((DECOR_KIND_LAYERS[e.kind] as ReadonlyArray<string>).includes(e.layer), () => at(plan, e));
			}
		expect(p.list).toEqual([]);
	});
});

describe("decor plan: keep-out", () => {
	it("draws nothing on or next to a doorway (jamb columns only beside one), a breakable or an interactable", () => {
		const p = new Problems();
		for (const f of CENSUS) {
			const d = f.layout.dungeon;
			const plan = f.plan;
			const rooms = encounterRooms(d);
			const breakables = new Set<number>();
			for (const b of f.layout.breakables ?? []) breakables.add(b.y * d.W + b.x);
			const zones: Array<[number, number, number]> = [];
			for (const r of rooms) {
				if (r.type === "treasure") zones.push([r.cx, r.cz, PEDESTAL_RADIUS]);
				if (r.type === "shrine") zones.push([r.cx, r.cz, SHRINE_RADIUS]);
			}
			zones.push([f.layout.stairwell.x, f.layout.stairwell.z, STAIRWELL_RADIUS]);
			const spawn = entranceSpawn(d);
			const dr = DECOR_CLEAR.doorTiles;
			for (const e of plan.entries) {
				const column = e.kind === "column" || e.kind === "columnBroken";
				// the door braziers (docs/DECOR.md "Room themes") flank an opening by design
				const doorBrazier = e.source === "solid" && e.kind === "brazier";
				for (const [x, y] of cellsOf(e)) {
					p.check(d.doorway[y * d.W + x] === 0, () => `${at(plan, e)}: on a doorway`);
					p.check(!breakables.has(y * d.W + x), () => `${at(plan, e)}: on a breakable`);
					if (!column && !doorBrazier)
						for (let oy = -dr; oy <= dr; oy++)
							for (let ox = -dr; ox <= dr; ox++)
								if (tileAt(d, x + ox, y + oy) !== TileType.VOID)
									p.check(
										d.doorway[(y + oy) * d.W + x + ox] === 0,
										() => `${at(plan, e)}: by a door`,
									);
					for (const [zx, zz, r] of zones)
						p.check((x - zx) * (x - zx) + (y - zz) * (y - zz) >= r * r, () => `${at(plan, e)}: in a zone`);
					if (e.kind !== "ring")
						p.check(
							(x - spawn.x) ** 2 + (y - spawn.z) ** 2 >= DECOR_CLEAR.entranceTiles ** 2,
							() => `${at(plan, e)}: on the entrance spawn`,
						);
				}
			}
		}
		expect(p.list).toEqual([]);
	});

	it("never draws a chest, and drops the shrine crystal under the shrine", () => {
		let shrines = 0;
		let drawn = 0;
		for (const { d, plan } of ALL) {
			for (const e of plan.entries) if (e.kind === ("chest" as string) || e.kind === "shrineCrystal") drawn++;
			for (const pr of d.props) if (pr.kind === "shrineCrystal") shrines++;
			expect(plan.dropped.get("chest")).toBe(d.props.filter((pr) => pr.kind === "chest").size());
		}
		expect(drawn).toBe(0);
		expect(shrines).toBeGreaterThan(0);
	});
});

describe("decor plan: placement", () => {
	it("stands tall and low pieces only on wall tops: far walls of their room, or a solid pillar's own top", () => {
		const p = new Problems();
		for (const { d, plan } of ALL) {
			const solid = new Set<number>();
			for (const pr of d.props)
				if (pr.kind === "pillar" && tileAt(d, pr.x, pr.y) === TileType.WALL) solid.add(pr.y * d.W + pr.x);
			for (const e of plan.entries) {
				if (!standing(e)) continue;
				p.check(e.y === 1, () => `${at(plan, e)}: y ${e.y}`);
				for (const [x, y] of cellsOf(e)) {
					const c = y * d.W + x;
					p.check(tileAt(d, x, y) === TileType.WALL, () => `${at(plan, e)}: not on a wall`);
					if (e.source === "pillar") {
						p.check(e.kind === "columnBroken" && solid.has(c), () => `${at(plan, e)}: stump`);
						continue;
					}
					p.check(!solid.has(c) && d.roomId[c] < 0, () => `${at(plan, e)}: on an interior wall`);
					// the room is in front: +X, +Z, or (a back corner) the +X+Z diagonal
					const front = [
						[1, 0],
						[0, 1],
						[1, 1],
					].some(
						([fx, fy]) =>
							tileAt(d, x + fx, y + fy) === TileType.FLOOR &&
							d.roomId[(y + fy) * d.W + x + fx] === e.roomId,
					);
					p.check(front, () => `${at(plan, e)}: not a far wall of room ${e.roomId}`);
				}
			}
		}
		expect(p.list).toEqual([]);
	});

	it("never places a pillar prop of a solid pillar anywhere but its own cell", () => {
		const p = new Problems();
		let stumps = 0;
		for (const f of CENSUS) {
			const d = f.layout.dungeon;
			for (const e of f.plan.entries) {
				if (e.forgeIndex < 0 || e.source === "torch") continue;
				const pr = d.props[e.forgeIndex];
				if (pr.kind !== "pillar") continue;
				stumps++;
				p.check(
					tileAt(d, pr.x, pr.y) === TileType.WALL &&
						e.source === "pillar" &&
						e.cellX === pr.x &&
						e.cellY === pr.y,
					() => at(f.plan, e),
				);
			}
		}
		expect(p.list).toEqual([]);
		// Every census solid pillar is interior (floor right behind it), so even the stump would hide bullets: they
		// keep the wall material only (D2's expectation). Each one is accounted for.
		let solid = 0;
		let dropped = 0;
		for (const f of CENSUS) {
			for (const pr of f.layout.dungeon.props) if (pr.kind === "pillar") solid++;
			dropped += f.plan.dropped.get("solidPillar") ?? 0;
		}
		expect(stumps + dropped <= solid).toBe(true);
		expect(solid).toBeGreaterThan(0);
	});

	it("allows a stump on a solid pillar with nothing open behind it, and refuses one with floor behind it", () => {
		// a 7x7 grid: VOID everywhere, a 3x3 floor patch in front (+X +Z) of the centre wall cell (3, 3)
		const W = 7;
		const grid = new Array<number>(W * W, TileType.VOID);
		grid[3 * W + 3] = TileType.WALL;
		for (let y = 3; y <= 5; y++)
			for (let x = 3; x <= 5; x++) if (x !== 3 || y !== 3) grid[y * W + x] = TileType.FLOOR;
		const d = { W, H: W, grid } as unknown as Dungeon;
		const at33: DecorFootprint = { x0: 3, y0: 3, x1: 3, y1: 3, runX: 0, runZ: 0 };
		expect(footprintClear(d, at33, DECOR_BOX.columnBroken)).toBe(true);
		expect(footprintClear(d, at33, DECOR_BOX.column)).toBe(true);
		grid[2 * W + 2] = TileType.FLOOR; // diagonally behind: hidden by a tall column
		expect(footprintClear(d, at33, DECOR_BOX.column)).toBe(false);
		grid[2 * W + 2] = TileType.POOL; // bullets fly over pools too
		expect(footprintClear(d, at33, DECOR_BOX.column)).toBe(false);
		grid[2 * W + 2] = TileType.VOID;
		grid[3 * W + 2] = TileType.FLOOR; // right behind (-X)
		expect(footprintClear(d, at33, DECOR_BOX.columnBroken)).toBe(false);
		// the stencil does not depend on where the footprint stands
		const moved = footprintStencil({ ...at33, x0: 40, y0: 9, x1: 40, y1: 9 }, DECOR_BOX.column);
		expect(moved).toEqual(footprintStencil(at33, DECOR_BOX.column));
	});

	it("caps tall pieces per room and keeps them TALL_MIN_SPACING apart", () => {
		const p = new Problems();
		for (const { plan } of ALL) {
			const perRoom = new Map<number, number>();
			const tall = plan.entries.filter((e) => standing(e) && e.source !== "pillar");
			for (const e of tall) perRoom.set(e.roomId, (perRoom.get(e.roomId) ?? 0) + 1);
			for (const [r, k] of perRoom)
				p.check(k <= MAX_TALL_PER_ROOM, () => `seed ${plan.floorSeed} room ${r}: ${k}`);
			for (let i = 0; i < tall.size(); i++)
				for (let j = i + 1; j < tall.size(); j++) {
					let best = math.huge;
					for (const [ax, ay] of cellsOf(tall[i]))
						for (const [bx, by] of cellsOf(tall[j])) best = math.min(best, (ax - bx) ** 2 + (ay - by) ** 2);
					p.check(best >= TALL_MIN_SPACING * TALL_MIN_SPACING, () => `${at(plan, tall[i])}: too close`);
				}
		}
		expect(p.list).toEqual([]);
	});

	it("caps flat pieces at the band's share (<= MAX_DECOR_SHARE) of each room's floor, one per FLOOR cell", () => {
		const p = new Problems();
		for (const { d, plan } of ALL) {
			const floorTiles = new Map<number, number>();
			for (let c = 0; c < d.W * d.H; c++)
				if (d.grid[c] === TileType.FLOOR) {
					const r = d.roomId[c] >= 0 ? d.roomId[c] : -1;
					floorTiles.set(r, (floorTiles.get(r) ?? 0) + 1);
				}
			const per = new Map<number, number>();
			const cells = new Set<number>();
			for (const e of plan.entries) {
				if (e.layer !== "flat") continue;
				const c = e.cellY * d.W + e.cellX;
				p.check(tileAt(d, e.cellX, e.cellY) === TileType.FLOOR && !cells.has(c), () => at(plan, e));
				cells.add(c);
				per.set(e.roomId, (per.get(e.roomId) ?? 0) + 1);
			}
			const share = math.min(plan.profile.flatShare, MAX_DECOR_SHARE);
			for (const [r, k] of per)
				p.check(
					k <= math.floor(share * (floorTiles.get(r) ?? 0)),
					() => `seed ${plan.floorSeed} room ${r}: ${k}`,
				);
		}
		expect(p.list).toEqual([]);
	});

	it("hangs wall pieces on faces the camera sees, one per cell, never under a tall piece", () => {
		const p = new Problems();
		for (const { d, plan } of ALL) {
			const tallCells = new Set<number>();
			for (const e of plan.entries) if (standing(e)) for (const [x, y] of cellsOf(e)) tallCells.add(y * d.W + x);
			const seen = new Set<number>();
			for (const e of plan.entries) {
				if (e.layer !== "wall") continue;
				const c = e.cellY * d.W + e.cellX;
				const visible = (e.faceX === 1 && e.faceZ === 0) || (e.faceX === 0 && e.faceZ === 1);
				p.check(
					visible &&
						tileAt(d, e.cellX, e.cellY) === TileType.WALL &&
						tileAt(d, e.cellX + e.faceX, e.cellY + e.faceZ) === TileType.FLOOR &&
						!seen.has(c) &&
						!tallCells.has(c),
					() => at(plan, e),
				);
				seen.add(c);
			}
		}
		expect(p.list).toEqual([]);
	});

	it("lists every torch and brazier as a light of its room", () => {
		const p = new Problems();
		for (const { plan } of ALL) {
			let lights = 0;
			plan.entries.forEach((e, i) => {
				p.check(e.light === (e.kind === "torch" || e.kind === "brazier"), () => at(plan, e));
				if (!e.light) return;
				lights++;
				const list = e.roomId >= 0 ? plan.lightsByRoom[e.roomId] : plan.corridorLights;
				p.check(list.includes(i), () => `${at(plan, e)}: not listed`);
			});
			let listed = plan.corridorLights.size();
			for (const l of plan.lightsByRoom) listed += l.size();
			p.check(listed === lights, () => `seed ${plan.floorSeed}: ${listed} listed, ${lights} lights`);
		}
		expect(p.list).toEqual([]);
	});

	it("keeps every broken variant's box inside its whole kind's", () => {
		for (const [broken, whole] of [
			["columnBroken", "column"],
			["columnBroken", "pillar"],
			["wallBroken", "wall"],
		] as Array<[keyof typeof DECOR_BOX, keyof typeof DECOR_BOX]>) {
			const a = DECOR_BOX[broken];
			const b = DECOR_BOX[whole];
			expect(a.w <= b.w && a.h <= b.h && a.below <= b.below && (a.x ?? 0) === (b.x ?? 0)).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------------------------
// The footprint rule, checked independently: sample bullet centres over every bullet-open cell near each standing
// piece; a bullet (disc of BULLET_PAD_PX) whose screen disc touches the piece's box and that is deeper than the
// piece's plane must be hidden by the wall block under the piece anyway: the view ray from its centre and from four
// disc rim points (offset in the camera plane) must all pass through that block (a ray / box slab test in the world).

const LAYERS = ["tall", "low", "flat", "wall"] as const;

const PAD = BULLET_PAD_PX / PIXELS_PER_TILE;
const STEP = 0.125;

function distToPolygon(poly: ReadonlyArray<number>, x: number, y: number): number {
	const m = poly.size() / 2;
	let inside = true;
	let best = math.huge;
	for (let e = 0; e < m; e++) {
		const ax = poly[e * 2];
		const ay = poly[e * 2 + 1];
		const bx = poly[((e + 1) % m) * 2];
		const by = poly[((e + 1) % m) * 2 + 1];
		const ex = bx - ax;
		const ey = by - ay;
		if (ex * (y - ay) - ey * (x - ax) < 0) inside = false;
		const len2 = ex * ex + ey * ey;
		const t = len2 > 0 ? math.clamp(((x - ax) * ex + (y - ay) * ey) / len2, 0, 1) : 0;
		const dx = ax + ex * t - x;
		const dy = ay + ey * t - y;
		best = math.min(best, math.sqrt(dx * dx + dy * dy));
	}
	return inside ? 0 : best;
}

/** Does the ray from p toward the camera pass through box [x0,x1] x [0,1] x [z0,z1]? */
function rayHitsBlock(px: number, py: number, pz: number, x0: number, x1: number, z0: number, z1: number): boolean {
	const f = DECOR_CAMERA.forward;
	const dir = [-f[0], -f[1], -f[2]];
	let t0 = 0;
	let t1 = math.huge;
	const o = [px, py, pz];
	const lo = [x0, 0, z0];
	const hi = [x1, 1, z1];
	for (let k = 0; k < 3; k++) {
		if (math.abs(dir[k]) < 1e-12) {
			if (o[k] < lo[k] || o[k] > hi[k]) return false;
			continue;
		}
		let a = (lo[k] - o[k]) / dir[k];
		let b = (hi[k] - o[k]) / dir[k];
		if (a > b) [a, b] = [b, a];
		t0 = math.max(t0, a);
		t1 = math.min(t1, b);
		if (t0 > t1) return false;
	}
	return true;
}

function hiddenBullets(d: Dungeon, plan: DecorPlan): number {
	const right = DECOR_CAMERA.right;
	const up = DECOR_CAMERA.up;
	let bad = 0;
	for (const box of plan.fadeBoxes) {
		const e = plan.entries[box.entry];
		// solid decor is an obstacle on its own cells, drawn over what stands behind it (docs/DECOR.md "Solid decor")
		if (e.source === "solid") continue;
		const cells = cellsOf(e);
		let bx0 = math.huge;
		let bx1 = -math.huge;
		let bz0 = math.huge;
		let bz1 = -math.huge;
		for (const [x, y] of cells) {
			bx0 = math.min(bx0, x - 0.5);
			bx1 = math.max(bx1, x + 0.5);
			bz0 = math.min(bz0, y - 0.5);
			bz1 = math.max(bz1, y + 0.5);
		}
		const [cx, cy] = cells[0];
		for (let gy = cy - 12; gy <= cy + 6; gy++)
			for (let gx = cx - 12; gx <= cx + 6; gx++) {
				if (isBulletBlockingTile(tileAt(d, gx, gy))) continue;
				for (let sz = -0.5; sz <= 0.5 + 1e-9; sz += STEP)
					for (let sx = -0.5; sx <= 0.5 + 1e-9; sx += STEP) {
						const px = gx + sx;
						const pz = gy + sz;
						if (screenDepth(DECOR_CAMERA, px, BULLET_Y, pz) <= box.depth) continue;
						const qx = screenX(DECOR_CAMERA, px, BULLET_Y, pz);
						const qy = screenY(DECOR_CAMERA, px, BULLET_Y, pz);
						if (distToPolygon(box.polygon, qx, qy) > PAD) continue;
						let hidden = rayHitsBlock(px, BULLET_Y, pz, bx0, bx1, bz0, bz1);
						for (const [ox, oy] of [
							[PAD, 0],
							[-PAD, 0],
							[0, PAD],
							[0, -PAD],
						])
							hidden =
								hidden &&
								rayHitsBlock(
									px + right[0] * ox + up[0] * oy,
									BULLET_Y + right[1] * ox + up[1] * oy,
									pz + right[2] * ox + up[2] * oy,
									bx0,
									bx1,
									bz0,
									bz1,
								);
						if (!hidden) bad++;
					}
			}
	}
	return bad;
}

describe("decor plan: the footprint rule", () => {
	it("leaves no bullet-open cell where a standing piece could hide a bullet (independent ray check)", () => {
		let checked = 0;
		for (let i = 0; i < ALL.size(); i += 4) {
			const { d, plan } = ALL[i];
			expect(hiddenBullets(d, plan)).toBe(0);
			checked += plan.fadeBoxes.size();
		}
		expect(checked).toBeGreaterThan(50);
	});
});

describe("decor plan: census (runs 1-20 x floors 1-5)", () => {
	it("draws pieces in every layer and reports per-floor counts", () => {
		const totals = new Map<string, number>();
		const kinds = new Map<string, number>();
		const drops = new Map<string, number>();
		for (const { plan } of CENSUS) {
			for (const layer of LAYERS) totals.set(layer, (totals.get(layer) ?? 0) + plan.counts[layer]);
			for (const e of plan.entries) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
			for (const r of DECOR_DROP_REASONS) drops.set(r, (drops.get(r) ?? 0) + (plan.dropped.get(r) ?? 0));
		}
		const n = CENSUS.size();
		const fmt = (m: Map<string, number>, order?: ReadonlyArray<string>) => {
			const keys: string[] = [];
			if (order !== undefined) for (const k of order) keys.push(k);
			else for (const [k] of m) keys.push(k);
			if (order === undefined) keys.sort();
			return keys.map((k) => `${k} ${string.format("%.2f", (m.get(k) ?? 0) / n)}`).join(", ");
		};
		print(`[decor] census per floor: ${fmt(totals, LAYERS)}`);
		print(`[decor] kinds per floor: ${fmt(kinds)}`);
		print(`[decor] dropped per floor: ${fmt(drops, DECOR_DROP_REASONS)}`);
		print(`[decor] planDecor ${string.format("%.2f", (planSeconds / n) * 1000)} ms per floor (${n} floors)`);
		expect(totals.get("tall") ?? 0).toBeGreaterThan(0);
		expect(totals.get("flat") ?? 0).toBeGreaterThan(0);
		expect(totals.get("wall") ?? 0).toBeGreaterThan(0);
		expect(kinds.get("column") ?? 0).toBeGreaterThan(0);
		// wall props are not decoration (docs/DECOR.md R6, 2026-11-02): no wall segment anywhere
		expect([kinds.get("wall") ?? 0, kinds.get("wallBroken") ?? 0]).toEqual([0, 0]);
		expect(kinds.get("brazier") ?? 0).toBeGreaterThan(0);
		expect(kinds.get("torch") ?? 0).toBeGreaterThan(0);
	});

	it("moves M1's walk-through pillars onto far walls (or drops them), never leaving one on the floor", () => {
		let pillars = 0;
		let bad = 0;
		for (const { d, plan } of M1)
			for (const e of plan.entries) {
				if (e.forgeIndex < 0 || e.source !== "forge") continue;
				const p = d.props[e.forgeIndex];
				if (p.kind !== "pillar") continue;
				pillars++;
				if (tileAt(d, e.cellX, e.cellY) !== TileType.WALL || (e.kind !== "pillar" && e.kind !== "columnBroken"))
					bad++;
			}
		expect(bad).toBe(0);
		expect(pillars).toBeGreaterThan(0);
	});
});

describe('scattered pieces (docs/DECOR.md "3D kits": the fallen chandelier)', () => {
	const withArt = (kind: string) => (kind === "chandelier" ? 1 : 0);

	it("lays nothing without the pack's art, and with it only appends: every earlier entry stays put", () => {
		for (const f of CENSUS) expect(f.plan.entries.filter((e) => e.source === "scatter").size()).toBe(0);
		for (const f of CENSUS.filter((_, i) => i % 10 === 0)) {
			const plan = planDecor({ ...decorInputOfLayout(f.layout), variants: withArt });
			const prefix = { ...plan, entries: plan.entries.filter((e) => e.source !== "scatter") };
			const again = planDecor({ ...decorInputOfLayout(f.layout), variants: withArt });
			expect(serialize(again)).toBe(serialize(plan)); // deterministic
			const plain = f.plan.entries.map((e) => `${e.kind}|${e.cellX},${e.cellY}|${e.layer}`);
			expect(prefix.entries.map((e) => `${e.kind}|${e.cellX},${e.cellY}|${e.layer}`)).toEqual(plain);
		}
	});

	it("one per room at most, never the boss room, on clear floor away from doorways, interactables and flats", () => {
		const problems = new Problems();
		let laid = 0;
		let floorsWithOne = 0;
		for (const f of CENSUS) {
			const d = f.layout.dungeon;
			const plan = planDecor({ ...decorInputOfLayout(f.layout), variants: withArt });
			const scattered = plan.entries.filter((e) => e.source === "scatter");
			laid += scattered.size();
			if (scattered.size() > 0) floorsWithOne++;
			problems.check(
				scattered.size() <= DECOR_SCATTER.maxPerFloor,
				() => `floor seed ${plan.floorSeed}: too many`,
			);
			const rooms = new Set<number>();
			const flats = new Set<string>();
			for (const e of plan.entries)
				if (e.layer === "flat" && e.source !== "scatter") flats.add(`${e.cellX},${e.cellY}`);
			for (const e of scattered) {
				problems.check(e.kind === "chandelier" && e.layer === "flat", () => at(plan, e));
				problems.check(e.roomId >= 0 && e.roomId !== d.boss, () => `${at(plan, e)}: room ${e.roomId}`);
				problems.check(!rooms.has(e.roomId), () => `${at(plan, e)}: second in room ${e.roomId}`);
				rooms.add(e.roomId);
				problems.check(!flats.has(`${e.cellX},${e.cellY}`), () => `${at(plan, e)}: on a flat piece`);
				const ct = DECOR_SCATTER.clearTiles;
				for (let oy = -ct; oy <= ct; oy++)
					for (let ox = -ct; ox <= ct; ox++)
						problems.check(
							tileAt(d, e.cellX + ox, e.cellY + oy) === TileType.FLOOR,
							() => `${at(plan, e)}: not clear`,
						);
				const dr = DECOR_CLEAR.doorTiles;
				for (let oy = -dr; oy <= dr; oy++)
					for (let ox = -dr; ox <= dr; ox++) {
						const x = e.cellX + ox;
						const y = e.cellY + oy;
						if (x < 0 || y < 0 || x >= d.W || y >= d.H) continue;
						problems.check(d.doorway[y * d.W + x] === 0, () => `${at(plan, e)}: by a doorway`);
					}
				const spawn = decorInputOfLayout(f.layout).spawn ?? entranceSpawn(d);
				const dx = e.x - spawn.x;
				const dz = e.z - spawn.z;
				problems.check(
					dx * dx + dz * dz >= DECOR_CLEAR.entranceTiles * DECOR_CLEAR.entranceTiles,
					() => `${at(plan, e)}: on the spawn`,
				);
			}
		}
		expect(problems.list).toEqual([]);
		// a few per floor on most floors (printed for tuning)
		print(`[decor scatter] chandeliers: ${laid} over ${CENSUS.size()} floors, ${floorsWithOne} floors with one`);
		expect(floorsWithOne).toBeGreaterThan(CENSUS.size() / 2);
	});
});

describe('solid decor (docs/DECOR.md "Solid decor", "Room themes": set pieces on their own cells)', () => {
	it("draws every Dungeon.solidDecor piece once, standing on its cells at floor level with a fade box", () => {
		let n = 0;
		for (const f of CENSUS) {
			const d = f.layout.dungeon;
			const solid = f.plan.entries.filter((e) => e.source === "solid" && e.layer !== "flat");
			expect(solid.size()).toBe(d.solidDecor.size());
			d.solidDecor.forEach((p, i) => {
				const e = solid[i];
				// the stockpile stands tall (docs/KENNEY_DECOR.md KN9), every other set piece low
				const layer = p.kind === "stockpile" ? "tall" : "low";
				expect([e.kind, e.layer, e.y, e.cellX, e.cellY]).toEqual([p.kind, layer, 0, p.x, p.y]);
				expect(e.cells).toBe(math.max(p.w, p.h));
				expect([e.runX, e.runZ]).toEqual([p.w > 1 ? 1 : 0, p.h > 1 ? 1 : 0]);
				expect(e.roomId).toBe(p.room);
				expect(e.fade >= 0 && f.plan.fadeBoxes[e.fade].entry === f.plan.entries.indexOf(e)).toBe(true);
				// centred on its footprint
				expect(e.x).toBeCloseTo(p.x + (p.w - 1) / 2, 9);
				expect(e.z).toBeCloseTo(p.y + (p.h - 1) / 2, 9);
				n++;
			});
		}
		expect(n).toBeGreaterThan(0);
	});

	it("takes the tomb's axis as its variant when the pack has both", () => {
		const f = CENSUS.find((c) => c.layout.dungeon.solidDecor.some((p) => p.kind === "tomb"))!;
		const plan = planDecor({ ...decorInputOfLayout(f.layout), variants: (k) => (k === "tomb" ? 2 : 0) });
		for (const e of plan.entries)
			if (e.source === "solid" && e.kind === "tomb") expect(e.variant).toBe(e.runX === 1 ? 0 : 1);
	});

	it("takes a throne's and a statue's facing as its variant (docs/DECOR.md \"Room themes\")", () => {
		let n = 0;
		for (const f of CENSUS.filter((_, i) => i % 5 === 0)) {
			const plan = planDecor({
				...decorInputOfLayout(f.layout),
				variants: (k) => (k === "throne" || k === "statue" ? 2 : 0),
			});
			for (const e of plan.entries)
				if (e.source === "solid" && (e.kind === "throne" || e.kind === "statue")) {
					expect(e.faceX === 1 || e.faceZ === 1).toBe(true);
					expect(e.variant).toBe(e.faceX !== 0 ? 0 : 1);
					n++;
				}
		}
		expect(n).toBeGreaterThan(0);
	});

	it("takes a bookcase's facing as its variant and hangs nothing on the wall behind it (docs/BOOKSHELVES.md)", () => {
		let n = 0;
		for (const f of CENSUS.filter((_, i) => i % 3 === 0)) {
			const d = f.layout.dungeon;
			const plan = planDecor({
				...decorInputOfLayout(f.layout),
				variants: (k) => (k === "bookcase" || k === "banner" ? 2 : 0),
			});
			const behind = new Set<string>();
			for (const p of d.solidDecor) if (p.kind === "bookcase") behind.add(`${p.x - p.fx},${p.y - p.fz}`);
			for (const e of plan.entries) {
				if (e.source === "solid" && e.kind === "bookcase") {
					expect([e.layer, e.cells, e.runX, e.runZ]).toEqual(["low", 1, 0, 0]);
					expect(e.faceX === 1 || e.faceZ === 1).toBe(true);
					expect(e.variant).toBe(e.faceX !== 0 ? 0 : 1);
					expect(e.fade >= 0).toBe(true);
					n++;
				} else if (e.source !== "void" && e.layer !== "flat")
					expect([e.kind, behind.has(`${e.cellX},${e.cellY}`)]).toEqual([e.kind, false]);
			}
		}
		expect(n).toBeGreaterThan(0);
	});

	it("draws a room's bookcases from one art set, in facing pairs (docs/KENNEY_DECOR.md)", () => {
		// the pure pick: one pair keeps the facing alone; with the alternative set, a room takes pair 0 or pairs 1..
		expect(bookcaseVariant(2, 0, 0.1, 0.9)).toBe(0);
		expect(bookcaseVariant(2, 1, 0.1, 0.9)).toBe(1);
		expect(bookcaseVariant(0, 1, 0.1, 0.9)).toBe(-1);
		expect(bookcaseVariant(16, 1, DECOR_BOOKCASES.altRoomShare, 0.1)).toBe(1);
		expect(bookcaseVariant(16, 0, 0, 0)).toBe(2);
		expect(bookcaseVariant(16, 1, 0, DECOR_BOOKCASES.altCommonShare - 1e-9)).toBe(3);
		expect(bookcaseVariant(16, 0, 0, DECOR_BOOKCASES.altCommonShare)).toBe(4);
		expect(bookcaseVariant(16, 1, 0, 1 - 1e-12)).toBe(15);
		expect(bookcaseVariant(4, 0, 0, 0.99)).toBe(2);
		for (let i = 0; i < 200; i++) {
			const v = bookcaseVariant(16, i % 2, 0.2, i / 200);
			expect(v >= 2 && v < 16 && v % 2 === i % 2).toBe(true);
		}
		// on real floors: the facing is the variant's parity and every room keeps to one set; both sets appear
		const sets = new Map<number, boolean>();
		let n = 0;
		for (const f of CENSUS) {
			const plan = planDecor({
				...decorInputOfLayout(f.layout),
				variants: (k) => (k === "bookcase" ? 16 : 0),
			});
			const room = new Map<number, boolean>();
			for (const e of plan.entries)
				if (e.source === "solid" && e.kind === "bookcase") {
					expect(e.variant % 2).toBe(e.faceX !== 0 ? 0 : 1);
					expect(e.variant >= 0 && e.variant < 16).toBe(true);
					const alt = e.variant >= 2;
					const seen = room.get(e.roomId);
					if (seen !== undefined) expect(seen).toBe(alt);
					room.set(e.roomId, alt);
					sets.set(alt ? 1 : 0, true);
					n++;
				}
		}
		expect(n).toBeGreaterThan(0);
		expect(sets.get(0) === true && sets.get(1) === true).toBe(true);
	});

	it("draws two cells of a run as one wide case only in a room of the alternative set (docs/KENNEY_DECOR.md KN3)", () => {
		// the pure pick: facing pairs, the full case at the common share, else the others evenly
		expect(wideBookcaseVariant(0, 0, 0.5)).toBe(-1);
		expect(wideBookcaseVariant(12, -1, 0.5)).toBe(-1);
		expect(wideBookcaseVariant(2, 1, 0.99)).toBe(1);
		expect(wideBookcaseVariant(12, 0, DECOR_BOOKCASES.altCommonShare - 1e-9)).toBe(0);
		expect(wideBookcaseVariant(12, 1, DECOR_BOOKCASES.altCommonShare)).toBe(3);
		expect(wideBookcaseVariant(12, 0, 1 - 1e-12)).toBe(10);
		for (let i = 0; i < 200; i++) {
			const v = wideBookcaseVariant(12, i % 2, i / 200);
			expect(v >= 0 && v < 12 && v % 2 === i % 2).toBe(true);
		}
		const counts = (wide: number, narrow: number) => (k: string) =>
			k === "bookcase" ? narrow : k === "bookcaseWide" ? wide : 0;
		let wides = 0;
		let singles = 0;
		for (const f of CENSUS) {
			const d = f.layout.dungeon;
			const shelves = new Map<number, (typeof d.solidDecor)[number]>();
			for (const p of d.solidDecor) if (p.kind === "bookcase") shelves.set(p.y * 65536 + p.x, p);
			const input = decorInputOfLayout(f.layout);
			const plan = planDecor({ ...input, variants: counts(12, 16) });
			// without wide art, or without an alternative set, nothing pairs
			for (const v of [counts(0, 16), counts(12, 2)])
				for (const e of planDecor({ ...input, variants: v }).entries) expect(e.kind).never.toBe("bookcaseWide");
			// every Forge bookcase is drawn exactly once: as its own case or as one cell of a wide one
			const drawn = new Map<number, number>();
			const altRoom = new Map<number, boolean>();
			for (const e of plan.entries) {
				if (e.source !== "solid" || (e.kind !== "bookcase" && e.kind !== "bookcaseWide")) continue;
				expect(e.layer).toBe("low");
				expect(e.fade >= 0).toBe(true);
				const cells = e.kind === "bookcaseWide" ? 2 : 1;
				expect(e.cells).toBe(cells);
				const first = shelves.get(e.cellY * 65536 + e.cellX)!;
				expect(first).toBeDefined();
				for (let i = 0; i < cells; i++) {
					const key = (e.cellY + i * e.runZ) * 65536 + e.cellX + i * e.runX;
					const p = shelves.get(key)!;
					// the pair: one room, one facing, along its wall (across the facing)
					expect([p.room, p.fx, p.fz]).toEqual([e.roomId, e.faceX, e.faceZ]);
					drawn.set(key, (drawn.get(key) ?? 0) + 1);
				}
				if (e.kind === "bookcaseWide") {
					expect([e.runX, e.runZ]).toEqual(e.faceX !== 0 ? [0, 1] : [1, 0]);
					expect([e.x, e.z]).toEqual([e.cellX + e.runX / 2, e.cellY + e.runZ / 2]);
					expect(e.variant % 2).toBe(e.faceX !== 0 ? 0 : 1);
					expect(e.variant >= 0 && e.variant < 12).toBe(true);
					wides++;
				} else singles++;
				const alt = e.kind === "bookcaseWide" || e.variant >= 2;
				const seen = altRoom.get(e.roomId);
				if (seen !== undefined) expect([e.roomId, seen]).toEqual([e.roomId, alt]);
				altRoom.set(e.roomId, alt);
			}
			for (const [key] of shelves) expect([key, drawn.get(key)]).toEqual([key, 1]);
		}
		expect(wides).toBeGreaterThan(0);
		expect(singles).toBeGreaterThan(0);
	});

	it("lays floor patches on 2 x 2 blocks of open floor, after every other entry, only with patch art (docs/KENNEY_DECOR.md KN4)", () => {
		let patches = 0;
		let bossPatches = 0;
		for (let i = 0; i < CENSUS.size(); i += 3) {
			const f = CENSUS[i];
			const d = f.layout.dungeon;
			const W = d.W;
			const input = decorInputOfLayout(f.layout);
			const without = planDecor({ ...input, variants: () => 0 });
			const plan = planDecor({ ...input, variants: (k) => (k === "patch" ? 5 : 0) });
			for (const e of without.entries) expect(e.kind).never.toBe("patch");
			// every other entry exactly as without patch art, the patches appended
			const k = without.entries.size();
			for (let j = 0; j < k; j++) {
				const a = without.entries[j];
				const b = plan.entries[j];
				expect([b.kind, b.x, b.z, b.variant, b.fade]).toEqual([a.kind, a.x, a.z, a.variant, a.fade]);
			}
			expect(plan.fadeBoxes.size()).toBe(without.fadeBoxes.size());
			// the cells every other flat piece and carpet lies on
			const flat = new Set<number>();
			for (let j = 0; j < k; j++) {
				const e = without.entries[j];
				if (e.layer === "flat" && e.source !== "void") flat.add(e.cellY * W + e.cellX);
			}
			for (const cp of d.carpets ?? [])
				for (let y = cp.y; y < cp.y + cp.h; y++) for (let x = cp.x; x < cp.x + cp.w; x++) flat.add(y * W + x);
			const perRoom = new Map<number, Array<[number, number]>>();
			for (let j = k; j < plan.entries.size(); j++) {
				const e = plan.entries[j];
				expect(e.kind).toBe("patch");
				expect([e.layer, e.source, e.fade]).toEqual(["flat", "scatter", -1]);
				expect([e.x, e.z]).toEqual([e.cellX + 0.5, e.cellY + 0.5]);
				expect(e.variant >= 0 && e.variant < 5).toBe(true);
				// the block and its ring: FLOOR of the room, no other flat piece
				const rt = DECOR_PATCHES.ringTiles;
				for (let oy = -rt; oy <= 1 + rt; oy++)
					for (let ox = -rt; ox <= 1 + rt; ox++) {
						const c = (e.cellY + oy) * W + e.cellX + ox;
						expect([e.cellX + ox, e.cellY + oy, d.grid[c], d.roomId[c]]).toEqual([
							e.cellX + ox,
							e.cellY + oy,
							TileType.FLOOR,
							e.roomId,
						]);
						expect(flat.has(c)).toBe(false);
					}
				const list = perRoom.get(e.roomId) ?? [];
				for (const [x, y] of list)
					expect(
						math.abs(x - e.cellX) >= DECOR_PATCHES.spacingTiles ||
							math.abs(y - e.cellY) >= DECOR_PATCHES.spacingTiles,
					).toBe(true);
				list.push([e.cellX, e.cellY]);
				perRoom.set(e.roomId, list);
				patches++;
				if (e.roomId === d.boss) bossPatches++;
			}
			for (const [r, list] of perRoom)
				expect(list.size() <= (r === d.boss ? DECOR_PATCHES.bossMax : DECOR_PATCHES.maxPerRoom)).toBe(true);
		}
		expect(patches).toBeGreaterThan(20);
		expect(bossPatches).toBeGreaterThan(0);
	});

	it("takes a study table's long axis as its variant, low, with a fade box, and draws no pillar it cleared (docs/KENNEY_DECOR.md KN9)", () => {
		let tables = 0;
		let cleared = 0;
		const floors = CENSUS.filter((c) => c.layout.dungeon.solidDecor.some((p) => p.kind === "studyTable"));
		for (const f of floors) {
			const d = f.layout.dungeon;
			// the reading line (a table and two chairs) is gone: the study table took its cells (KND12)
			for (const p of d.solidDecor) expect([p.kind === "table", p.kind === "chair"]).toEqual([false, false]);
			const plan = planDecor({ ...decorInputOfLayout(f.layout), variants: (k) => (k === "studyTable" ? 6 : 0) });
			const gone = new Set<number>();
			for (const cp of d.clearedPillars ?? []) gone.add(cp.y * d.W + cp.x);
			cleared += gone.size();
			for (const e of plan.entries) {
				// a cleared pillar's prop draws nothing: no stump, no column moved to a far wall
				if (e.forgeIndex >= 0 && (e.source === "pillar" || e.source === "forge")) {
					const pr = d.props[e.forgeIndex];
					if (pr.kind === "pillar")
						expect([pr.x, pr.y, gone.has(pr.y * d.W + pr.x)]).toEqual([pr.x, pr.y, false]);
				}
				if (e.source !== "solid" || e.kind !== "studyTable") continue;
				expect([e.layer, e.y, e.cells, e.runX, e.runZ]).toEqual(["low", 0, 2, 1, 1]);
				expect(e.fade >= 0 && plan.fadeBoxes[e.fade].entry === plan.entries.indexOf(e)).toBe(true);
				// fx / fz is the long axis: variant 1 / 3 / 5 along X, 2 / 4 / 6 along Z
				expect(e.variant % 2).toBe(e.faceX !== 0 ? 0 : 1);
				tables++;
			}
		}
		print(
			`[decor study tables] ${floors.size()} of ${CENSUS.size()} floors: ${tables} tables, ${cleared} pillars cleared`,
		);
		expect(tables).toBeGreaterThan(0);
	});

	it("draws the Kenney pieces once each, their axis / facing / look as the variant, inside their boxes (docs/KENNEY_DECOR.md KN9)", () => {
		// the pure pick: looks in facing groups, the last rareLooks at rareShare, the others evenly
		const display = DECOR_KENNEY.display!;
		const lectern = DECOR_KENNEY.lectern!;
		const dining = DECOR_KENNEY.diningTable!;
		expect(kenneyVariant(0, display, 0, 0.5)).toBe(-1);
		expect(kenneyVariant(8, display, -1, 0.5)).toBe(-1);
		expect(kenneyVariant(8, display, 1, 0)).toBe(7); // the sword, along Z
		expect(kenneyVariant(8, display, 0, display.rareShare - 1e-9)).toBe(6);
		expect(kenneyVariant(8, display, 0, display.rareShare)).toBe(0);
		expect(kenneyVariant(8, display, 1, 1 - 1e-12)).toBe(5);
		expect(kenneyVariant(2, display, 1, 0)).toBe(1); // one look: the axis alone
		expect(kenneyVariant(8, lectern, 3, 0.1)).toBe(7); // empty, facing -Z
		expect(kenneyVariant(8, lectern, 2, 0.9)).toBe(2); // open, facing -X
		expect(kenneyVariant(8, dining, 0, 0.1)).toBe(6);
		expect(kenneyVariant(8, dining, 0, 0.2)).toBe(7);
		for (let i = 0; i < 200; i++) {
			const v = kenneyVariant(8, dining, 0, i / 200);
			expect(v >= 0 && v < 8).toBe(true);
			expect(v >= 6).toBe(i / 200 < dining.rareShare);
		}
		// on real floors, with every variant the vale pack has
		const COUNTS: Partial<Record<string, number>> = {
			studyTable: 6,
			display: 8,
			lectern: 8,
			fallenShelf: 2,
			diningTable: 8,
			barrelStack: 2,
			crateStack: 2,
			lumber: 2,
			barrelHeap: 2,
			stockpile: 2,
		};
		const variants = (k: string) => COUNTS[k] ?? 0;
		const seen = new Map<string, number>();
		const rare = new Map<string, number>();
		const problems = new Problems();
		for (const f of CENSUS) {
			const d = f.layout.dungeon;
			const plan = planDecor({ ...decorInputOfLayout(f.layout), variants });
			const solid = plan.entries.filter((e) => e.source === "solid" && e.layer !== "flat");
			expect(solid.size()).toBe(d.solidDecor.size());
			d.solidDecor.forEach((p, i) => {
				const e = solid[i];
				if (COUNTS[p.kind] === undefined) return;
				seen.set(p.kind, (seen.get(p.kind) ?? 0) + 1);
				problems.check(
					e.kind === p.kind && e.cellX === p.x && e.cellY === p.y,
					() => `${at(plan, e)}: not its piece`,
				);
				// one entry over the whole footprint, anchored at its centre
				problems.check(
					e.cells === math.max(p.w, p.h) &&
						math.abs(e.x - (p.x + (p.w - 1) / 2)) < 1e-9 &&
						math.abs(e.z - (p.y + (p.h - 1) / 2)) < 1e-9,
					() => `${at(plan, e)}: not centred on its ${p.w} x ${p.h} cells`,
				);
				const axis = p.w > 1 && p.h === 1 ? 0 : p.h > 1 && p.w === 1 ? 1 : p.fx !== 0 ? 0 : 1;
				const facing = p.fx > 0 ? 0 : p.fz > 0 ? 1 : p.fx < 0 ? 2 : 3;
				const v = e.variant;
				const ok =
					p.kind === "lectern"
						? v % 4 === facing
						: p.kind === "diningTable"
						? v >= 0 && v < 8
						: v % 2 === axis && v < (COUNTS[p.kind] ?? 0);
				problems.check(ok, () => `${at(plan, e)}: variant ${v} for facing ${p.fx},${p.fz}`);
				if (
					(p.kind === "display" && v >= 6) ||
					(p.kind === "lectern" && v >= 4) ||
					(p.kind === "diningTable" && v >= 6)
				)
					rare.set(p.kind, (rare.get(p.kind) ?? 0) + 1);
				// its own fade box (DECOR_BOX[kind], measured on the art: valeArt.spec holds the art inside it) holds its
				// anchor, the art's pivot
				problems.check(
					e.fade >= 0 &&
						plan.fadeBoxes[e.fade].entry === plan.entries.indexOf(e) &&
						insideBy(
							plan.fadeBoxes[e.fade].polygon,
							screenX(DECOR_CAMERA, e.x, 0, e.z),
							screenY(DECOR_CAMERA, e.x, 0, e.z),
							-1e-9,
						),
					() => `${at(plan, e)}: its box misses its anchor`,
				);
				problems.check(
					e.layer === (p.kind === "stockpile" ? "tall" : "low") &&
						(DECOR_KIND_LAYERS[e.kind] as ReadonlyArray<string>).includes(e.layer),
					() => `${at(plan, e)}: layer ${e.layer}`,
				);
			});
		}
		expect(problems.list).toEqual([]);
		const line: string[] = [];
		for (const k of [
			"studyTable",
			"display",
			"lectern",
			"fallenShelf",
			"diningTable",
			"barrelStack",
			"crateStack",
			"lumber",
			"barrelHeap",
			"stockpile",
		])
			line.push(`${k} ${seen.get(k) ?? 0}${rare.has(k) ? ` (${rare.get(k)} rare)` : ""}`);
		print(`[decor kenney pieces] ${CENSUS.size()} floors: ${line.join(", ")}`);
		for (const k of ["studyTable", "display", "lectern", "diningTable", "barrelStack"])
			expect([k, (seen.get(k) ?? 0) > 0]).toEqual([k, true]);
	});

	it("draws a library's runner as Kenney's segments between two ends, only with its art; the throne's carpet as before (docs/KENNEY_DECOR.md KN9)", () => {
		const R = DECOR_RUNNER;
		const runnerCount = R.firstVariant + R.variants;
		const dirIndex = (dx: number, dz: number) => (dx > 0 ? 0 : dz > 0 ? 1 : dx < 0 ? 2 : 3);
		let runners = 0;
		let segments = 0;
		for (const f of CENSUS) {
			const d = f.layout.dungeon;
			const runs = (d.carpets ?? []).filter((cp) => math.min(cp.w, cp.h) === 1);
			if (runs.size() === 0) continue;
			const four = planDecor({ ...decorInputOfLayout(f.layout), variants: (k) => (k === "carpet" ? 4 : 0) });
			const all = planDecor({
				...decorInputOfLayout(f.layout),
				variants: (k) => (k === "carpet" ? runnerCount : 0),
			});
			// the throne's carpet is the same with or without the runner's art
			const throne = (p: DecorPlan) =>
				p.entries
					.filter((e) => e.kind === "carpet" && e.variant < R.firstVariant)
					.map((e) => `${e.x},${e.z},${e.variant},${e.cellX},${e.cellY}`)
					.join(";");
			expect(throne(all)).toBe(throne(four));
			const onRunner = (x: number, y: number) =>
				runs.some((cp) => x >= cp.x && x < cp.x + cp.w && y >= cp.y && y < cp.y + cp.h);
			// without the runner's art: no runner entry, and its cells are free for the Forge's flat pieces
			for (const e of four.entries)
				if (e.kind === "carpet")
					expect([e.cellX, e.cellY, onRunner(e.cellX, e.cellY)]).toEqual([e.cellX, e.cellY, false]);
			const pieces = all.entries.filter((e) => e.kind === "carpet" && e.variant >= R.firstVariant);
			let k = 0;
			for (const cp of runs) {
				runners++;
				const len = math.max(cp.w, cp.h);
				const hx = cp.fx === -1 ? cp.x + cp.w - 1 : cp.x;
				const hy = cp.fz === -1 ? cp.y + cp.h - 1 : cp.y;
				const covered = new Map<string, number>();
				const take = (e: DecorEntry) => {
					expect([e.layer, e.source, e.roomId, e.fade]).toEqual(["flat", "solid", cp.room, -1]);
					for (const [x, y] of cellsOf(e)) covered.set(`${x},${y}`, (covered.get(`${x},${y}`) ?? 0) + 1);
				};
				// the head's end piece, open down the runner
				const head = pieces[k++];
				take(head);
				expect([head.cellX, head.cellY, head.cells]).toEqual([hx, hy, 1]);
				expect(head.variant).toBe(R.firstVariant + R.segmentVariants + dirIndex(-cp.fx, -cp.fz));
				// 2 x 1 segments along the run, anchored between their cells
				for (let a = 1; a + R.segmentCells <= len - 1; a += R.segmentCells) {
					const e = pieces[k++];
					take(e);
					expect([e.cells, e.runX, e.runZ, e.variant]).toEqual([
						R.segmentCells,
						cp.fx !== 0 ? 1 : 0,
						cp.fx !== 0 ? 0 : 1,
						R.firstVariant + (cp.fx !== 0 ? 0 : 1),
					]);
					const cx = hx + cp.fx * (a + 0.5);
					const cz = hy + cp.fz * (a + 0.5);
					expect(e.x).toBeCloseTo(cx, 9);
					expect(e.z).toBeCloseTo(cz, 9);
					segments++;
				}
				// the far end, open back up it
				const tail = pieces[k++];
				take(tail);
				expect([tail.cellX, tail.cellY, tail.cells]).toEqual([
					hx + cp.fx * (len - 1),
					hy + cp.fz * (len - 1),
					1,
				]);
				expect(tail.variant).toBe(R.firstVariant + R.segmentVariants + dirIndex(cp.fx, cp.fz));
				// every cell once
				expect(covered.size()).toBe(len);
				for (const [, n] of covered) expect(n).toBe(1);
			}
			expect(k).toBe(pieces.size());
			// no Forge flat piece lies on a drawn runner
			for (const e of all.entries)
				if (e.layer === "flat" && e.source === "forge")
					expect([e.cellX, e.cellY, onRunner(e.cellX, e.cellY)]).toEqual([e.cellX, e.cellY, false]);
		}
		print(`[decor runners] ${runners} runners, ${segments} segments`);
		expect(runners).toBeGreaterThan(0);
	});

	it("draws a library's candle stands as Kenney's only with their art; every other candle stand as before", () => {
		let swapped = 0;
		let kept = 0;
		for (const f of CENSUS.filter((_, i) => i % 2 === 0)) {
			const d = f.layout.dungeon;
			const themes = d.roomThemes ?? [];
			const without = planDecor({
				...decorInputOfLayout(f.layout),
				variants: (k) => (k === "candelabrum" ? 1 : 0),
			});
			const plan = planDecor({
				...decorInputOfLayout(f.layout),
				variants: (k) => (k === "candelabrum" ? 1 : k === "libraryCandle" ? 3 : 0),
			});
			const a = without.entries.filter((e) => e.source === "solid" && e.layer !== "flat");
			const b = plan.entries.filter((e) => e.source === "solid" && e.layer !== "flat");
			d.solidDecor.forEach((p, i) => {
				expect(a[i].kind).toBe(p.kind);
				if (p.kind !== "candelabrum") return;
				if (themes[p.room] === "library") {
					expect([b[i].kind, b[i].variant >= 0 && b[i].variant < 3]).toEqual(["libraryCandle", true]);
					swapped++;
				} else {
					expect([b[i].kind, b[i].variant]).toEqual(["candelabrum", 0]);
					expect(plan.fadeBoxes[b[i].fade].polygon).toEqual(without.fadeBoxes[a[i].fade].polygon);
					kept++;
				}
			});
		}
		print(`[decor library candles] ${swapped} swapped, ${kept} kept`);
		expect(swapped).toBeGreaterThan(0);
		expect(kept).toBeGreaterThan(0);
	});

	it("stands and hangs nothing on the walls screen-up of a stockpile (docs/KENNEY_DECOR.md KN9)", () => {
		let stockpiles = 0;
		let dropped = 0;
		for (const f of CENSUS) {
			const d = f.layout.dungeon;
			const behind = new Set<string>();
			for (const p of d.solidDecor) {
				if (p.kind !== "stockpile") continue;
				stockpiles++;
				for (let y = p.y - 1; y < p.y + p.h; y++)
					for (let x = p.x - 1; x < p.x + p.w; x++)
						if ((x < p.x || y < p.y) && tileAt(d, x, y) !== TileType.FLOOR) behind.add(`${x},${y}`);
			}
			if (behind.size() === 0) continue;
			const plan = planDecor({ ...decorInputOfLayout(f.layout), variants: (k) => (k === "banner" ? 1 : 0) });
			for (const e of plan.entries)
				if (e.source !== "void" && e.source !== "solid" && e.layer !== "flat")
					expect([e.kind, behind.has(`${e.cellX},${e.cellY}`)]).toEqual([e.kind, false]);
			dropped += plan.dropped.get("behindShelf") ?? 0;
		}
		print(`[decor stockpiles] ${stockpiles} stockpiles, ${dropped} pieces dropped behind shelves or stock`);
	});

	it("lays the throne's carpet in 2 x 2 segments from the dais, its end last, only with the pack's art", () => {
		let runs = 0;
		for (const f of CENSUS.filter((_, i) => i % 5 === 0)) {
			const d = f.layout.dungeon;
			expect(f.plan.entries.some((e) => e.kind === "carpet")).toBe(false);
			const plan = planDecor({ ...decorInputOfLayout(f.layout), variants: (k) => (k === "carpet" ? 4 : 0) });
			const segs = plan.entries.filter((e) => e.kind === "carpet");
			let k = 0;
			for (const cp of d.carpets ?? []) {
				// a library's runner (1 wide) needs its own variants (docs/KENNEY_DECOR.md KN9): not drawn with the
				// throne carpet's four
				if (math.min(cp.w, cp.h) === 1) continue;
				runs++;
				const len = cp.fx !== 0 ? cp.w : cp.h;
				for (let a = 0; a < len; a += 2) {
					const e = segs[k++];
					const last = a + 2 >= len;
					expect([e.layer, e.source, e.roomId]).toEqual(["flat", "solid", cp.room]);
					expect(e.variant).toBe((cp.fx !== 0 ? 0 : 1) + (last ? 2 : 0));
					// the segment's centre: between its 2 x 2 cells, `a` cells from the dais
					expect(e.x).toBeCloseTo(cp.fx !== 0 ? cp.x + a + 0.5 : cp.x + 0.5, 9);
					expect(e.z).toBeCloseTo(cp.fx !== 0 ? cp.y + 0.5 : cp.y + a + 0.5, 9);
				}
				// no Forge flat piece lies on it
				for (const e of plan.entries)
					if (e.layer === "flat" && e.source === "forge")
						expect(
							e.cellX >= cp.x && e.cellX < cp.x + cp.w && e.cellY >= cp.y && e.cellY < cp.y + cp.h,
						).toBe(false);
			}
			expect(k).toBe(segs.size());
		}
		expect(runs).toBeGreaterThan(0);
	});
});

describe('room banners (docs/DECOR.md "Solid decor": banners on room walls)', () => {
	it("hangs more banners only with the pack's art: on far walls of their room, spaced, never two on a cell", () => {
		const problems = new Problems();
		let added = 0;
		for (const f of CENSUS.filter((_, i) => i % 4 === 0)) {
			const d = f.layout.dungeon;
			const plan = planDecor({ ...decorInputOfLayout(f.layout), variants: (k) => (k === "banner" ? 1 : 0) });
			const extra = plan.entries.filter((e) => e.kind === "banner" && e.source === "dressing");
			expect(f.plan.entries.filter((e) => e.kind === "banner" && e.source === "dressing").size()).toBe(0);
			added += extra.size();
			const perRoom = new Map<number, number>();
			const cells = new Set<string>();
			for (const e of plan.entries)
				if (e.layer === "wall") {
					const key = `${e.cellX},${e.cellY}`;
					problems.check(!cells.has(key), () => `${at(plan, e)}: two wall pieces`);
					cells.add(key);
				}
			// the boss room's are the throne's pair: on its back wall, two cells past each end of the dais
			const flanks = new Set<string>();
			for (const t of d.solidDecor)
				if (t.kind === "throne") {
					const len = t.fx !== 0 ? t.h : t.w;
					for (const along of [-2, len + 1])
						flanks.add(t.fx !== 0 ? `${t.x - t.fx},${t.y + along}` : `${t.x + along},${t.y - t.fz}`);
				}
			for (const e of extra) {
				if (e.roomId === d.boss) {
					problems.check(
						flanks.has(`${e.cellX},${e.cellY}`),
						() => `${at(plan, e)}: boss room, not by the throne`,
					);
					continue;
				}
				perRoom.set(e.roomId, (perRoom.get(e.roomId) ?? 0) + 1);
				problems.check(tileAt(d, e.cellX, e.cellY) === TileType.WALL, () => `${at(plan, e)}: not a wall`);
				const fx = e.cellX + e.faceX;
				const fz = e.cellY + e.faceZ;
				problems.check(
					(e.faceX === 1 || e.faceZ === 1) &&
						tileAt(d, fx, fz) === TileType.FLOOR &&
						d.roomId[fz * d.W + fx] === e.roomId,
					() => `${at(plan, e)}: not a far wall of its room`,
				);
				for (const o of plan.entries)
					if (o !== e && o.layer === "wall" && !(o.roomId === d.boss && o.source === "dressing"))
						problems.check(
							math.max(math.abs(o.cellX - e.cellX), math.abs(o.cellY - e.cellY)) >=
								DECOR_BANNERS.spacingTiles,
							() => `${at(plan, e)}: too near ${o.kind}`,
						);
			}
			for (const [, n] of perRoom) problems.check(n <= DECOR_BANNERS.perRoom, () => "too many in a room");
		}
		expect(problems.list).toEqual([]);
		print(`[decor banners] ${added} more banners over ${CENSUS.size() / 4} floors`);
		expect(added).toBeGreaterThan(0);
	});
});

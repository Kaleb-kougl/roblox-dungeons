// The void set pieces in the decor plan (docs/VOID_DECOR.md VD5): planDecor given a VoidPlan appends source "void"
// entries standing / lying on the void's surfaces. Without the void plan nothing changes; with it, every earlier entry,
// fade box, drop count and light list is exactly the plan without it. No void piece hides a walkable cell: standing
// pieces by the same independent ray check decorPlan.spec uses (the block under the piece is the void surface, from the
// floor to its top), flat pieces by a ray from every sampled bullet toward the camera to the decal's height. Caps,
// spacing, determinism, biome void kinds, and a census line (per-floor void counts and plan timings).
// Census: endless floors through buildEndlessFloor (breakables, spawn, stairwell), runs 1-8 x floors 1, 3, 5 (boss),
// 7, 10 (boss), 12, 15 (boss), 18 (every depth band), plus M1 floors.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PIXELS_PER_TILE, STUDS_PER_TILE } from "shared/config";
import {
	KALEB_VALE_MVP_PARAMS,
	TileType,
	buildEndlessFloor,
	generateDungeon,
	isBulletBlockingTile,
	tileAt,
	type Dungeon,
	type EndlessFloorLayout,
	type ForgeParams,
} from "shared/dungeon";
import { DECOR_KIND_LAYERS, VOID_DECOR, decorId, voidDecorId, type VoidDecorKind } from "shared/theme";
import { VOID, VOID_PIECES, VoidLayer, planVoid, voidInputOfLayout, type VoidPlan } from "../voidDecor";
import { DECOR_VIEW } from "./fxConfig";
import {
	BULLET_PAD_PX,
	BULLET_Y,
	DECOR_BOX,
	DECOR_CAMERA,
	DECOR_DROP_REASONS,
	decorEntryFootprint,
	decorInputOfLayout,
	flatLayoutReach,
	flatLayoutWithin,
	footprintClear,
	footprintStencil,
	planDecor,
	screenDepth,
	screenX,
	screenY,
	type DecorEntry,
	type DecorFootprint,
	type DecorPlan,
	type DecorPlanInput,
	type StandingKind,
} from ".";

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
	readonly d: Dungeon;
	readonly input: DecorPlanInput;
	readonly vp: VoidPlan;
	/** planDecor without and with the void plan. */
	readonly base: DecorPlan;
	readonly plan: DecorPlan;
	readonly layout?: EndlessFloorLayout;
}

const RUNS = 8;
const FLOORS = [1, 3, 5, 7, 10, 12, 15, 18];
const CENSUS: Floor[] = [];
let baseSeconds = 0;
let voidSeconds = 0;
let planVoidSeconds = 0;
for (let run = 1; run <= RUNS; run++)
	for (const floor of FLOORS) {
		const layout = buildEndlessFloor(run, floor, dungeonFor);
		const input = decorInputOfLayout(layout);
		let t0 = os.clock();
		const vp = planVoid(voidInputOfLayout(layout));
		planVoidSeconds += os.clock() - t0;
		t0 = os.clock();
		const base = planDecor(input);
		baseSeconds += os.clock() - t0;
		t0 = os.clock();
		const plan = planDecor({ ...input, voidPlan: vp });
		voidSeconds += os.clock() - t0;
		CENSUS.push({ d: layout.dungeon, input, vp, base, plan, layout });
	}

const M1: Floor[] = [];
for (const seed of [1, 7, 42]) {
	const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
	const vp = planVoid({ dungeon: d });
	M1.push({
		d,
		input: { dungeon: d },
		vp,
		base: planDecor({ dungeon: d }),
		plan: planDecor({ dungeon: d, voidPlan: vp }),
	});
}

const ALL: Floor[] = [...CENSUS, ...M1];

const isVoidEntry = (e: DecorEntry) => e.source === "void";
const standing = (e: DecorEntry) => e.layer === "tall" || e.layer === "low";

function cellsOf(e: DecorEntry): Array<readonly [number, number]> {
	const out: Array<readonly [number, number]> = [];
	for (let i = 0; i < math.max(1, e.cells); i++) out.push([e.cellX + i * e.runX, e.cellY + i * e.runZ]);
	return out;
}

/** Every field of an entry (the decor spec's serialize, widened). */
function entryKey(e: DecorEntry): string {
	return (
		`${e.kind}|${e.id}|${e.layer}|${e.x}|${e.y}|${e.z}|${e.cellX},${e.cellY}|${e.cells}|${e.runX},${e.runZ}|` +
		`${e.faceX},${e.faceZ}|${e.roomId}|${e.hash}|${e.variant}|${e.fade}|${e.light}|${e.lit}|${e.source}|` +
		`${e.forgeIndex}|${e.rot}|${e.scale}|${e.voidKind}`
	);
}

function serialize(p: DecorPlan, entries = p.entries.size(), boxes = p.fadeBoxes.size()): string {
	const parts: string[] = [];
	for (let i = 0; i < entries; i++) parts.push(entryKey(p.entries[i]));
	for (let i = 0; i < boxes; i++) {
		const b = p.fadeBoxes[i];
		const poly: string[] = [];
		for (const v of b.polygon) poly.push(`${v}`);
		parts.push(`box ${b.entry}|${b.depth}|${poly.join(",")}`);
	}
	for (const r of DECOR_DROP_REASONS) parts.push(`${r}=${p.dropped.get(r)}`);
	p.lightsByRoom.forEach((l, r) => parts.push(`lights ${r}: ${l.join(",")}`));
	parts.push(`corridor lights ${p.corridorLights.join(",")}`);
	return parts.join(";");
}

/** Collects rule violations (one expect per test: Jest's expect is slow under Lune). */
class Problems {
	readonly list: string[] = [];
	check(ok: boolean, what: () => string): void {
		if (!ok && this.list.size() < 10) this.list.push(what());
	}
}

const at = (plan: DecorPlan, e: DecorEntry) => `floor seed ${plan.floorSeed}: ${e.kind} at ${e.cellX},${e.cellY}`;

describe("decor plan with the void (docs/VOID_DECOR.md VD5): nothing else changes", () => {
	it("plans no void piece without a void plan (voidCounts all 0)", () => {
		for (const f of ALL) {
			expect(f.base.entries.filter(isVoidEntry).size()).toBe(0);
			const v = f.base.voidCounts;
			expect([v.flat, v.low, v.tall, v.wall]).toEqual([0, 0, 0, 0]);
		}
	});

	it("keeps every entry, fade box, drop count and light list of the plan without the void, void pieces after them", () => {
		for (const f of ALL) {
			const n = f.base.entries.size();
			expect(serialize(f.plan, n, f.base.fadeBoxes.size())).toBe(serialize(f.base));
			for (let i = n; i < f.plan.entries.size(); i++) expect(isVoidEntry(f.plan.entries[i])).toBe(true);
			const counts = f.plan.counts;
			const v = f.plan.voidCounts;
			const b = f.base.counts;
			expect([counts.flat - v.flat, counts.low - v.low, counts.tall - v.tall, counts.wall - v.wall]).toEqual([
				b.flat,
				b.low,
				b.tall,
				b.wall,
			]);
		}
	});

	it("is deterministic: the same plan for the same Dungeon and void plan, also regenerated from the params", () => {
		for (let i = 0; i < CENSUS.size(); i += 7) {
			const f = CENSUS[i];
			const layout = f.layout!;
			const again = planDecor({ ...f.input, voidPlan: planVoid(voidInputOfLayout(layout)) });
			expect(serialize(again)).toBe(serialize(f.plan));
			const fresh = generateDungeon(layout.dungeon.params);
			const vp = planVoid({ ...voidInputOfLayout(layout), dungeon: fresh });
			expect(serialize(planDecor({ ...f.input, dungeon: fresh, voidPlan: vp }))).toBe(serialize(f.plan));
		}
	});
});

describe("decor plan with the void: placement", () => {
	it("stands / lays each void piece on its void surface, at that surface's top, with a legal id and layer", () => {
		const p = new Problems();
		for (const f of ALL) {
			const { d, vp, plan } = f;
			for (const e of plan.entries) {
				if (!isVoidEntry(e)) continue;
				p.check(e.voidKind === undefined, () => `${at(plan, e)}: biome kind without voidVariants`);
				p.check(e.id === decorId(plan.biome, e.kind), () => `${at(plan, e)}: id ${e.id}`);
				p.check((DECOR_KIND_LAYERS[e.kind] as ReadonlyArray<string>).includes(e.layer), () => at(plan, e));
				p.check(e.layer !== "wall" && !e.light && e.forgeIndex === -1, () => at(plan, e));
				for (const [x, y] of cellsOf(e)) {
					const c = y * d.W + x;
					p.check(tileAt(d, x, y) === TileType.VOID, () => `${at(plan, e)}: not on void`);
					const l = vp.layer[c];
					const ok = standing(e)
						? l === VoidLayer.SHOULDER
						: l === VoidLayer.SHOULDER || l === VoidLayer.LEDGE;
					p.check(ok, () => `${at(plan, e)}: on layer ${l}`);
					p.check(vp.top[c] === e.y, () => `${at(plan, e)}: y ${e.y}, surface ${vp.top[c]}`);
				}
				p.check(e.fade >= 0 === standing(e), () => `${at(plan, e)}: fade ${e.fade}`);
				// the footprint rule at the surface's top, for the box it is drawn in
				if (standing(e))
					p.check(
						footprintClear(d, decorEntryFootprint(e), DECOR_BOX[e.kind as StandingKind], DECOR_CAMERA, e.y),
						() => `${at(plan, e)}: footprint`,
					);
			}
		}
		expect(p.list).toEqual([]);
	});

	it("caps standing pieces per room and per floor, flats per floor, and spaces them", () => {
		const p = new Problems();
		const P = VOID_PIECES;
		for (const f of ALL) {
			const { d, vp, plan } = f;
			const voids = plan.entries.filter(isVoidEntry);
			const stand = voids.filter(standing);
			const flats = voids.filter((e) => e.layer === "flat");
			let shoulder = 0;
			for (const l of vp.layer) if (l === VoidLayer.SHOULDER) shoulder++;
			p.check(stand.size() <= P.maxStanding, () => `seed ${plan.floorSeed}: ${stand.size()} standing`);
			p.check(
				flats.size() <= math.min(P.maxFlat, math.floor(P.flatShare * shoulder)),
				() => `seed ${plan.floorSeed}: ${flats.size()} flat`,
			);
			const perRoom = new Map<number, number>();
			const curbs = new Map<number, number>();
			for (const e of stand) {
				p.check(e.roomId >= 0, () => `${at(plan, e)}: no room`);
				const m = e.kind === "curb" ? curbs : perRoom;
				m.set(e.roomId, (m.get(e.roomId) ?? 0) + 1);
			}
			for (const [r, k] of perRoom) p.check(k <= P.tallPerRoom, () => `seed ${plan.floorSeed} room ${r}: ${k}`);
			for (const [r, k] of curbs)
				p.check(k <= P.curbPerRoom, () => `seed ${plan.floorSeed} room ${r}: ${k} curbs`);
			// standing: tallMinSpacing apart, decorClearTiles from every decor standing / wall piece
			const decorCells: Array<readonly [number, number]> = [];
			for (const e of plan.entries)
				if (!isVoidEntry(e) && e.layer !== "flat") for (const c of cellsOf(e)) decorCells.push(c);
			for (let i = 0; i < stand.size(); i++) {
				for (let j = i + 1; j < stand.size(); j++) {
					let best = math.huge;
					for (const [ax, ay] of cellsOf(stand[i]))
						for (const [bx, by] of cellsOf(stand[j]))
							best = math.min(best, (ax - bx) ** 2 + (ay - by) ** 2);
					p.check(best >= P.tallMinSpacing ** 2, () => `${at(plan, stand[i])}: too close to another`);
				}
				for (const [ax, ay] of cellsOf(stand[i]))
					for (const [bx, by] of decorCells)
						p.check(
							(ax - bx) ** 2 + (ay - by) ** 2 >= P.decorClearTiles ** 2,
							() => `${at(plan, stand[i])}: next to decor at ${bx},${by}`,
						);
			}
			// flats: flatMinSpacing apart, every cell within flatRadiusTiles the same surface
			const k = math.ceil(P.flatRadiusTiles);
			for (let i = 0; i < flats.size(); i++) {
				const e = flats[i];
				for (let j = i + 1; j < flats.size(); j++) {
					const o = flats[j];
					p.check(
						(e.cellX - o.cellX) ** 2 + (e.cellY - o.cellY) ** 2 >= P.flatMinSpacing ** 2,
						() => `${at(plan, e)}: flats overlap`,
					);
				}
				const c0 = e.cellY * d.W + e.cellX;
				for (let oy = -k; oy <= k; oy++)
					for (let ox = -k; ox <= k; ox++) {
						const nx = math.max(0, math.abs(ox) - 0.5);
						const ny = math.max(0, math.abs(oy) - 0.5);
						if (nx * nx + ny * ny >= P.flatRadiusTiles ** 2) continue;
						const c = (e.cellY + oy) * d.W + e.cellX + ox;
						p.check(
							vp.layer[c] === vp.layer[c0] && vp.top[c] === vp.top[c0],
							() => `${at(plan, e)}: patch leaves its surface at ${ox},${oy}`,
						);
					}
			}
		}
		expect(p.list).toEqual([]);
	});

	it("plans a biome void kind only when the pack has art for it, under the same rules", () => {
		const counts: Partial<Record<VoidDecorKind, number>> = { spire: 2, vent: 1, drift: 1 };
		const voidVariants = (k: VoidDecorKind) => counts[k] ?? 0;
		const p = new Problems();
		let biomePieces = 0;
		for (let i = 0; i < CENSUS.size(); i += 4) {
			const f = CENSUS[i];
			const plan = planDecor({ ...f.input, voidPlan: f.vp, voidVariants });
			// biome kinds only change which void pieces are drawn, never the plan before them
			expect(serialize(plan, f.base.entries.size(), f.base.fadeBoxes.size())).toBe(serialize(f.base));
			for (const e of plan.entries) {
				if (e.voidKind === undefined) continue;
				biomePieces++;
				const kind = e.voidKind;
				p.check(counts[kind] !== undefined, () => `${at(plan, e)}: ${kind} has no art`);
				p.check(e.id === voidDecorId(plan.biome, kind), () => `${at(plan, e)}: id ${e.id}`);
				p.check(
					(VOID_DECOR.layers[kind] as ReadonlyArray<string>).includes(e.layer),
					() => `${at(plan, e)}: ${kind}`,
				);
				p.check(e.variant < (counts[kind] ?? 0), () => `${at(plan, e)}: variant ${e.variant}`);
				// the box the footprint rule checked: column (tall kinds), columnBroken (low-only), debris (flat)
				const stand = e.layer === "flat" ? "debris" : e.layer === "tall" ? "column" : "columnBroken";
				p.check(e.kind === stand, () => `${at(plan, e)}: ${e.kind}`);
			}
			p.check(hiddenByStanding(f.d, plan) === 0, () => `seed ${plan.floorSeed}: a biome piece hides a bullet`);
		}
		expect(p.list).toEqual([]);
		expect(biomePieces).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------------------------
// No void piece hides a bullet, checked independently of the plan's polygon clipping. Standing pieces: decorPlan.spec's
// ray check with the block under the piece from the floor to its surface top. Flat pieces: the view ray from a bullet
// rises toward the camera; it must not cross the decal's height inside the decal's reach (flatRadiusTiles + the pad).

const PAD = BULLET_PAD_PX / PIXELS_PER_TILE;
/** A surface this much higher than the shoulder casts a larger stencil (the per-top cache check). */
const TALLER_TOP_TILES = 2;
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

/** Does the ray from p toward the camera pass through box [x0,x1] x [0,top] x [z0,z1]? */
function rayHitsBlock(
	px: number,
	py: number,
	pz: number,
	x0: number,
	x1: number,
	z0: number,
	z1: number,
	top: number,
): boolean {
	const f = DECOR_CAMERA.forward;
	const dir = [-f[0], -f[1], -f[2]];
	let t0 = 0;
	let t1 = math.huge;
	const o = [px, py, pz];
	const lo = [x0, 0, z0];
	const hi = [x1, top, z1];
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

/** Sampled bullet points hidden by the void standing pieces of `plan` (decorPlan.spec's hiddenBullets at their top). */
function hiddenByStanding(d: Dungeon, plan: DecorPlan): number {
	const right = DECOR_CAMERA.right;
	const up = DECOR_CAMERA.up;
	let bad = 0;
	for (const box of plan.fadeBoxes) {
		const e = plan.entries[box.entry];
		if (!isVoidEntry(e)) continue;
		const top = e.y;
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
		for (let gy = cy - 12; gy <= cy + 8; gy++)
			for (let gx = cx - 12; gx <= cx + 8; gx++) {
				if (isBulletBlockingTile(tileAt(d, gx, gy))) continue;
				for (let sz = -0.5; sz <= 0.5 + 1e-9; sz += STEP)
					for (let sx = -0.5; sx <= 0.5 + 1e-9; sx += STEP) {
						const px = gx + sx;
						const pz = gy + sz;
						if (screenDepth(DECOR_CAMERA, px, BULLET_Y, pz) <= box.depth) continue;
						const qx = screenX(DECOR_CAMERA, px, BULLET_Y, pz);
						const qy = screenY(DECOR_CAMERA, px, BULLET_Y, pz);
						if (distToPolygon(box.polygon, qx, qy) > PAD) continue;
						let hidden = rayHitsBlock(px, BULLET_Y, pz, bx0, bx1, bz0, bz1, top);
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
									top,
								);
						if (!hidden) bad++;
					}
			}
	}
	return bad;
}

/**
 * Sampled bullet points a flat decal of `radius` world tiles lying at height `top` (plus the flat Part's lift) centred
 * on (x, z) would hide: the view ray from the bullet reaches the decal's height inside its reach (+ the bullet's pad).
 */
function hiddenByFlat(d: Dungeon, x: number, z: number, top: number, radius: number): number {
	const f = DECOR_CAMERA.forward;
	const h = top + DECOR_VIEW.flatLiftStuds / STUDS_PER_TILE; // the flat Part's top, a hair above the surface
	if (h <= BULLET_Y) return 0;
	// the ray toward the camera climbs -forward; at the decal's height it has moved (h - y) / -f.y along it
	const t = (h - BULLET_Y) / -f[1];
	let bad = 0;
	const reach = radius + PAD;
	const cx = math.round(x);
	const cz = math.round(z);
	const k = math.ceil(reach) + 2;
	for (let gy = cz - k; gy <= cz + k; gy++)
		for (let gx = cx - k; gx <= cx + k; gx++) {
			if (isBulletBlockingTile(tileAt(d, gx, gy))) continue;
			for (let sz = -0.5; sz <= 0.5 + 1e-9; sz += STEP)
				for (let sx = -0.5; sx <= 0.5 + 1e-9; sx += STEP) {
					const hx = gx + sx - f[0] * t;
					const hz = gy + sz - f[2] * t;
					if ((hx - x) ** 2 + (hz - z) ** 2 < reach * reach) bad++;
				}
		}
	return bad;
}

describe("decor plan with the void: nothing hides a bullet", () => {
	it("finds no bullet hidden by a void standing piece at its surface's top (independent ray check)", () => {
		let checked = 0;
		for (let i = 0; i < ALL.size(); i += 2) {
			const { d, plan } = ALL[i];
			expect([plan.floorSeed, hiddenByStanding(d, plan)]).toEqual([plan.floorSeed, 0]);
			checked += plan.entries.filter((e) => isVoidEntry(e) && standing(e)).size();
		}
		expect(checked).toBeGreaterThan(100);
	});

	it("finds no bullet hidden by a void flat piece, and the check does find one for a decal over a wall", () => {
		let checked = 0;
		for (let i = 0; i < ALL.size(); i += 2) {
			const { d, plan } = ALL[i];
			let bad = 0;
			for (const e of plan.entries) {
				if (!isVoidEntry(e) || e.layer !== "flat") continue;
				bad += hiddenByFlat(d, e.x, e.z, e.y, VOID_PIECES.flatRadiusTiles);
				checked++;
			}
			expect([plan.floorSeed, bad]).toEqual([plan.floorSeed, 0]);
		}
		expect(checked).toBeGreaterThan(500);
		// the same decal laid at shoulder height on a wall cell next to the floor would hide bullets
		const f = CENSUS[0];
		const d = f.d;
		let wall: readonly [number, number] | undefined;
		for (let c = 0; c < d.W * d.H && wall === undefined; c++) {
			const x = c % d.W;
			const y = (c - x) / d.W;
			if (d.grid[c] === TileType.WALL && tileAt(d, x + 1, y) === TileType.FLOOR) wall = [x, y];
		}
		expect(wall).toBeDefined();
		const [wx, wy] = wall!;
		expect(hiddenByFlat(d, wx, wy, VOID.shoulderTopTiles, VOID_PIECES.flatRadiusTiles)).toBeGreaterThan(0);
	});

	it("refuses a void column with floor behind it at shoulder height, and caches stencils per surface top", () => {
		// a 9x9 grid: VOID everywhere; the column on (4, 4) at the shoulder's top; a floor cell diagonally behind it
		const W = 9;
		const grid = new Array<number>(W * W, TileType.VOID);
		const d = { W, H: W, grid } as unknown as Dungeon;
		const top = VOID.shoulderTopTiles;
		const at44: DecorFootprint = { x0: 4, y0: 4, x1: 4, y1: 4, runX: 0, runZ: 0 };
		expect(footprintClear(d, at44, DECOR_BOX.column, DECOR_CAMERA, top)).toBe(true);
		grid[2 * W + 2] = TileType.FLOOR;
		expect(footprintClear(d, at44, DECOR_BOX.column, DECOR_CAMERA, top)).toBe(false);
		// the cached stencil at this top is the uncached one (a copy of the camera skips the cache)
		const copy = { ...DECOR_CAMERA };
		for (const box of [DECOR_BOX.column, DECOR_BOX.wall, DECOR_BOX.curb]) {
			const run: DecorFootprint = { x0: 4, y0: 4, x1: 7, y1: 4, runX: 1, runZ: 0 };
			expect(footprintStencil(at44, box, DECOR_CAMERA, top)).toEqual(footprintStencil(at44, box, copy, top));
			expect(footprintStencil(run, box, DECOR_CAMERA, top)).toEqual(footprintStencil(run, box, copy, top));
			// a taller surface's stencil is its own (the cache keys on the top): it reaches farther
			const higher = footprintStencil(at44, box, DECOR_CAMERA, top + TALLER_TOP_TILES);
			expect(higher).toEqual(footprintStencil(at44, box, copy, top + TALLER_TOP_TILES));
			expect(higher.size() > footprintStencil(at44, box, DECOR_CAMERA, top).size()).toBe(true);
		}
	});
});

describe("decor plan with the void: drawn sizes", () => {
	it("holds a flat image within a reach from its pivot (flatLayoutWithin), leaving small art alone", () => {
		const big = { frameW: 186, frameH: 138, pivot: { x: 92, y: 67.5 }, pixelsPerTile: 29.6 };
		expect(flatLayoutReach(big)).toBeGreaterThan(VOID_PIECES.flatRadiusTiles);
		const held = flatLayoutWithin(big, VOID_PIECES.flatRadiusTiles);
		expect(flatLayoutReach(held)).toBeCloseTo(VOID_PIECES.flatRadiusTiles, 6);
		expect([held.frameW, held.frameH, held.pivot.x, held.pivot.y]).toEqual([186, 138, 92, 67.5]);
		const small = { frameW: 20, frameH: 16, pivot: { x: 10, y: 8 }, pixelsPerTile: 29.6 };
		expect(flatLayoutWithin(small, VOID_PIECES.flatRadiusTiles)).toBe(small);
	});
});

describe("decor plan with the void: census", () => {
	it("plans standing and flat void pieces within the targets and reports per-floor counts and timings", () => {
		const n = CENSUS.size();
		let tall = 0;
		let low = 0;
		let flat = 0;
		let maxStand = 0;
		let maxFlat = 0;
		const kinds = new Map<string, number>();
		const bands = new Map<string, [number, number, number]>();
		for (const f of CENSUS) {
			const v = f.plan.voidCounts;
			tall += v.tall;
			low += v.low;
			flat += v.flat;
			maxStand = math.max(maxStand, v.tall + v.low);
			maxFlat = math.max(maxFlat, v.flat);
			for (const e of f.plan.entries) if (isVoidEntry(e)) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
			const b = bands.get(f.plan.profile.bandName) ?? [0, 0, 0];
			bands.set(f.plan.profile.bandName, [b[0] + 1, b[1] + v.tall + v.low, b[2] + v.flat]);
		}
		const fmt = (x: number) => string.format("%.2f", x / n);
		const ms = (s: number) => string.format("%.2f", (s / n) * 1000);
		const keys: string[] = [];
		for (const [k] of kinds) keys.push(k);
		keys.sort();
		print(
			`[void pieces] per floor (${n} floors): tall ${fmt(tall)}, low ${fmt(low)}, flat ${fmt(flat)}; ` +
				`max standing ${maxStand}, max flat ${maxFlat}`,
		);
		print(`[void pieces] kinds per floor: ${keys.map((k) => `${k} ${fmt(kinds.get(k) ?? 0)}`).join(", ")}`);
		const bandLine: string[] = [];
		for (const name of ["kept", "worn", "ruined", "abyss"]) {
			const b = bands.get(name);
			if (b !== undefined)
				bandLine.push(
					`${name} ${string.format("%.1f", b[1] / b[0])} standing / ${string.format(
						"%.1f",
						b[2] / b[0],
					)} flat`,
				);
		}
		print(`[void pieces] by band: ${bandLine.join(", ")}`);
		print(
			`[void pieces] planDecor ${ms(baseSeconds)} ms without the void, ${ms(voidSeconds)} ms with it ` +
				`(+${ms(voidSeconds - baseSeconds)}); planVoid ${ms(planVoidSeconds)} ms`,
		);
		expect(tall).toBeGreaterThan(0);
		expect(low).toBeGreaterThan(0);
		expect(flat).toBeGreaterThan(0);
		expect(maxStand <= VOID_PIECES.maxStanding).toBe(true);
		expect(maxFlat <= VOID_PIECES.maxFlat).toBe(true);
		expect(kinds.get("wall") ?? 0).toBeGreaterThan(0);
		expect(kinds.get("column") ?? 0).toBeGreaterThan(0);
		expect(kinds.get("curb") ?? 0).toBeGreaterThan(0);
		expect(kinds.get("flagstones") ?? 0).toBeGreaterThan(0);
	});
});

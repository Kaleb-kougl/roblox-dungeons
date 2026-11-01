// The void planner (docs/VOID_DECOR.md VD2, VD4): deterministic; non-void cells untouched; every wall-adjacent void
// cell is shoulder; pocket fill; ledges only on the shoulder's rim; outcrops in the mid band, never above the shoulder;
// rects cover exactly the raised cells; an independent ray check finds no walkable point hidden by a void column; the
// Part budget holds; the depth bands move the stats the expected way. Census: endless floors (endlessFloorParams +
// generateDungeon), runs 1-10 x floors 1, 3, 5 (boss), 7, 10 (boss), 12, 15 (boss), 18: every band.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PIXELS_PER_TILE } from "shared/config";
import {
	TileType,
	buildEndlessFloor,
	endlessFloorParams,
	generateDungeon,
	type Dungeon,
	type ForgeParams,
} from "shared/dungeon";
import { BULLET_PAD_PX, BULLET_Y, DECOR_CAMERA, DECOR_DEPTH, type DecorProfile } from "../decor";
import { GAME_WORLD } from "../config";
import {
	VOID,
	VOID_DEPTH,
	VoidLayer,
	planVoid,
	planVoidCached,
	voidInputOfLayout,
	type VoidPlan,
	type VoidPlanInput,
} from ".";

interface Floor {
	readonly run: number;
	readonly floor: number;
	readonly input: VoidPlanInput;
	readonly plan: VoidPlan;
}

const RUNS = 10;
const FLOORS = [1, 3, 5, 7, 10, 12, 15, 18];
const CENSUS: Floor[] = [];
let planSeconds = 0;
for (let run = 1; run <= RUNS; run++)
	for (const floor of FLOORS) {
		const params = endlessFloorParams(run, floor);
		const dungeon = generateDungeon(params);
		const input: VoidPlanInput = { dungeon, floorSeed: params.seed, floor };
		const t0 = os.clock();
		const plan = planVoid(input);
		planSeconds += os.clock() - t0;
		CENSUS.push({ run, floor, input, plan });
	}

/** Collects rule violations (one expect per test: Jest's expect is slow under Lune over many cells). */
class Problems {
	readonly list: string[] = [];
	check(ok: boolean, what: () => string): void {
		if (!ok && this.list.size() < 10) this.list.push(what());
	}
}

const isVoid = (d: Dungeon, c: number) => d.grid[c] === TileType.VOID;
const raised = (l: number) => l === VoidLayer.SHOULDER || l === VoidLayer.LEDGE || l === VoidLayer.OUTCROP;

function serialize(p: VoidPlan): string {
	const parts: string[] = [`${p.W}x${p.H}|${p.floorSeed}|${p.band}`];
	for (let c = 0; c < p.W * p.H; c++) parts.push(`${p.layer[c]}:${p.top[c]}`);
	for (const r of p.rects) parts.push(`${r.x},${r.y},${r.w},${r.h},${r.layer},${r.top}`);
	return parts.join(";");
}

/** Calls fn(j) for each in-grid 8-neighbour j of cell c. */
function around(p: VoidPlan, c: number, fn: (j: number) => void): void {
	const x = c % p.W;
	const y = (c - x) / p.W;
	for (let ny = y - 1; ny <= y + 1; ny++)
		for (let nx = x - 1; nx <= x + 1; nx++)
			if ((nx !== x || ny !== y) && nx >= 0 && ny >= 0 && nx < p.W && ny < p.H) fn(ny * p.W + nx);
}

describe("void plan: config", () => {
	it("has one VOID_DEPTH band per DECOR_DEPTH band, same names, sane knobs", () => {
		expect(VOID_DEPTH.bands.size()).toBe(DECOR_DEPTH.bands.size());
		VOID_DEPTH.bands.forEach((b, i) => {
			expect(b.name).toBe(DECOR_DEPTH.bands[i].name);
			expect(b.shoulderExtraMin >= 0 && b.shoulderExtraMin <= b.shoulderExtraMax).toBe(true);
			expect(b.ledgeKeep >= 0 && b.ledgeKeep <= 1).toBe(true);
			expect(b.outcropRate >= 0 && b.outcropRate <= VOID.outcropRatePer).toBe(true);
		});
	});

	it("keeps every raised top below the wall top and above the floor, the abyss under the floor", () => {
		expect(VOID.shoulderTopTiles).toBeCloseTo(0.85 * GAME_WORLD.wallHeightTiles, 9);
		expect(VOID.shoulderTopTiles < GAME_WORLD.wallHeightTiles).toBe(true);
		expect(VOID.ledgeTopTiles > 0 && VOID.ledgeTopTiles < VOID.shoulderTopTiles).toBe(true);
		expect(VOID.abyssDepthTiles > 0).toBe(true);
		expect(VOID.outcropMinDist <= VOID.outcropMaxDist).toBe(true);
	});

	it("uses distinct salts", () => {
		const seen = new Set<number>();
		for (const [, v] of pairs(VOID.salt)) {
			expect(seen.has(v)).toBe(false);
			seen.add(v);
		}
	});
});

describe("void plan: determinism and the cache", () => {
	it("gives the same plan for the same input, also from a regenerated Dungeon", () => {
		for (let i = 0; i < CENSUS.size(); i += 7) {
			const f = CENSUS[i];
			expect(serialize(planVoid(f.input))).toBe(serialize(f.plan));
			const fresh = generateDungeon(f.input.dungeon.params as ForgeParams);
			expect(serialize(planVoid({ ...f.input, dungeon: fresh }))).toBe(serialize(f.plan));
		}
	});

	it("planVoidCached returns the same object for the same floor and a new one for a new floor or band", () => {
		const a = CENSUS[0].input;
		const b = CENSUS[1].input;
		const p1 = planVoidCached(a);
		expect(planVoidCached(a)).toBe(p1);
		expect(planVoidCached({ ...a })).toBe(p1);
		expect(serialize(p1)).toBe(serialize(CENSUS[0].plan));
		const p2 = planVoidCached(b);
		expect(p2).never.toBe(p1);
		expect(p2.floorSeed).toBe(CENSUS[1].plan.floorSeed);
		const p3 = planVoidCached({ ...b, forceBand: 3 });
		expect(p3).never.toBe(p2);
		expect(p3.band).toBe(3);
		const regenerated = generateDungeon(b.dungeon.params as ForgeParams);
		expect(planVoidCached({ ...b, dungeon: regenerated, forceBand: 3 })).never.toBe(p3);
	});

	it("voidInputOfLayout passes the layout's dungeon, floor seed and floor", () => {
		const layout = buildEndlessFloor(3, 6, generateDungeon);
		const input = voidInputOfLayout(layout, 2);
		expect(input.dungeon).toBe(layout.dungeon);
		expect(input.floorSeed).toBe(layout.seed);
		expect(input.floor).toBe(6);
		expect(input.depth).toBe(2);
		expect(planVoid(input).band).toBe(1);
	});

	it("reads the band from decorProfile (floor bands, forceBand, a ready profile)", () => {
		const d = CENSUS[0].input.dungeon;
		expect(planVoid({ dungeon: d }).band).toBe(0);
		expect(planVoid({ dungeon: d, floor: 16 }).band).toBe(3);
		expect(planVoid({ dungeon: d, floor: 16, forceBand: 1 }).band).toBe(1);
		expect(planVoid({ dungeon: d, forceBand: 99 }).band).toBe(VOID_DEPTH.bands.size() - 1);
		const profile = { band: 2 } as unknown as DecorProfile;
		expect(planVoid({ dungeon: d, floor: 16, profile }).band).toBe(2);
	});
});

describe("void plan: layers", () => {
	it("leaves non-void cells NONE at top 0; gives every void cell a layer; abyss at -abyssDepthTiles", () => {
		const p = new Problems();
		for (const { input, plan } of CENSUS) {
			const d = input.dungeon;
			for (let c = 0; c < plan.W * plan.H; c++) {
				const l = plan.layer[c];
				if (!isVoid(d, c)) p.check(l === VoidLayer.NONE && plan.top[c] === 0, () => `${plan.floorSeed} @${c}`);
				else p.check(l !== VoidLayer.NONE, () => `${plan.floorSeed} @${c}: void NONE`);
				if (l === VoidLayer.ABYSS) p.check(plan.top[c] === -VOID.abyssDepthTiles, () => `${c}: abyss top`);
				if (l === VoidLayer.SHOULDER) p.check(plan.top[c] === VOID.shoulderTopTiles, () => `${c}: top`);
				if (l === VoidLayer.LEDGE) p.check(plan.top[c] === VOID.ledgeTopTiles, () => `${c}: top`);
			}
		}
		expect(p.list).toEqual([]);
	});

	it("makes every void cell within shoulderMinTiles of a wall shoulder", () => {
		const p = new Problems();
		let n = 0;
		for (const { input, plan } of CENSUS)
			for (let c = 0; c < plan.W * plan.H; c++)
				if (isVoid(input.dungeon, c) && plan.field.dist[c] <= VOID.shoulderMinTiles) {
					n++;
					p.check(plan.layer[c] === VoidLayer.SHOULDER, () => `${plan.floorSeed} @${c}`);
				}
		expect(p.list).toEqual([]);
		expect(n).toBeGreaterThan(0);
	});

	it("fills every enclosed pocket no deeper than pocketFillTiles with shoulder", () => {
		const p = new Problems();
		let filled = 0;
		for (const { plan } of CENSUS) {
			const f = plan.field;
			for (let c = 0; c < plan.W * plan.H; c++) {
				const k = f.pocket[c];
				if (k < 0 || f.pocketMaxDist[k] > VOID.pocketFillTiles) continue;
				filled++;
				p.check(plan.layer[c] === VoidLayer.SHOULDER, () => `${plan.floorSeed} pocket ${k} @${c}`);
			}
		}
		expect(p.list).toEqual([]);
		expect(filled).toBeGreaterThan(0);
	});

	it("keeps the shoulder in one band: no detached pieces, no 1-cell holes, width within the band's range", () => {
		const p = new Problems();
		for (const { plan } of CENSUS) {
			const n = plan.W * plan.H;
			const W = plan.W;
			// every 8-connected shoulder component touches the dungeon (holds a cell at the minimum distance)
			const seen = new Array<boolean>(n, false);
			for (let s = 0; s < n; s++) {
				if (seen[s] || plan.layer[s] !== VoidLayer.SHOULDER) continue;
				const stack = [s];
				seen[s] = true;
				let anchored = false;
				while (stack.size() > 0) {
					const c = stack.pop()!;
					if (plan.field.dist[c] <= VOID.shoulderMinTiles) anchored = true;
					around(plan, c, (j) => {
						if (!seen[j] && plan.layer[j] === VoidLayer.SHOULDER) {
							seen[j] = true;
							stack.push(j);
						}
					});
				}
				p.check(anchored, () => `${plan.floorSeed}: detached shoulder at ${s}`);
			}
			// no void cell short of shoulder closed in on four sides by shoulder or the dungeon
			const closed = (j: number) => plan.layer[j] === VoidLayer.SHOULDER || plan.layer[j] === VoidLayer.NONE;
			for (let c = 0; c < n; c++) {
				const l = plan.layer[c];
				if (l === VoidLayer.NONE || l === VoidLayer.SHOULDER) continue;
				const x = c % W;
				const y = (c - x) / W;
				if (x === 0 || y === 0 || x === W - 1 || y === plan.H - 1) continue;
				p.check(
					!(closed(c - 1) && closed(c + 1) && closed(c - W) && closed(c + W)),
					() => `${plan.floorSeed}: hole at ${c}`,
				);
			}
			// band width: no shoulder past min + extraMax unless a pocket or hole fill put it there
			const b = VOID_DEPTH.bands[plan.band];
			for (let c = 0; c < n; c++)
				if (plan.layer[c] === VoidLayer.SHOULDER && plan.field.pocket[c] < 0)
					p.check(
						plan.field.dist[c] <= VOID.shoulderMinTiles + b.shoulderExtraMax + 1,
						() => `${plan.floorSeed}: shoulder at dist ${plan.field.dist[c]}`,
					);
		}
		expect(p.list).toEqual([]);
	});

	it("puts ledges only next to the shoulder", () => {
		const p = new Problems();
		let ledges = 0;
		for (const { plan } of CENSUS)
			for (let c = 0; c < plan.W * plan.H; c++) {
				if (plan.layer[c] !== VoidLayer.LEDGE) continue;
				ledges++;
				let rim = false;
				around(plan, c, (j) => {
					if (plan.layer[j] === VoidLayer.SHOULDER) rim = true;
				});
				p.check(rim, () => `${plan.floorSeed}: ledge at ${c} off the rim`);
			}
		expect(p.list).toEqual([]);
		expect(ledges).toBeGreaterThan(0);
	});

	it("keeps outcrops in their distance range, 1..outcropMaxCells cells, apart, never above the shoulder top", () => {
		const p = new Problems();
		let clusters = 0;
		for (const { plan } of CENSUS) {
			const n = plan.W * plan.H;
			const seen = new Array<boolean>(n, false);
			for (let s = 0; s < n; s++) {
				if (plan.layer[s] !== VoidLayer.OUTCROP) continue;
				const dc = plan.field.dist[s];
				p.check(dc >= VOID.outcropMinDist && dc <= VOID.outcropMaxDist, () => `${plan.floorSeed}: dist ${dc}`);
				p.check(
					plan.top[s] === VOID.shoulderTopTiles || plan.top[s] === VOID.ledgeTopTiles,
					() => `${plan.floorSeed}: outcrop top ${plan.top[s]}`,
				);
				around(plan, s, (j) => {
					const l = plan.layer[j];
					p.check(
						l === VoidLayer.ABYSS || l === VoidLayer.OUTCROP,
						() => `${plan.floorSeed}: outcrop at ${s} touches layer ${l}`,
					);
				});
				if (seen[s]) continue;
				clusters++;
				// an 8-connected outcrop group is one outcrop: small, one height
				const stack = [s];
				seen[s] = true;
				let size = 0;
				while (stack.size() > 0) {
					const c = stack.pop()!;
					size++;
					p.check(plan.top[c] === plan.top[s], () => `${plan.floorSeed}: mixed outcrop heights`);
					around(plan, c, (j) => {
						if (!seen[j] && plan.layer[j] === VoidLayer.OUTCROP) {
							seen[j] = true;
							stack.push(j);
						}
					});
				}
				p.check(size <= VOID.outcropMaxCells, () => `${plan.floorSeed}: outcrop of ${size} cells`);
			}
		}
		expect(p.list).toEqual([]);
		expect(clusters).toBeGreaterThan(0);
	});

	it("covers every raised cell with exactly one rect of its layer and top, and nothing else", () => {
		const p = new Problems();
		for (const { plan } of CENSUS) {
			const n = plan.W * plan.H;
			const cover = new Array<number>(n, 0);
			for (const r of plan.rects) {
				p.check(raised(r.layer) && r.w >= 1 && r.h >= 1, () => `${plan.floorSeed}: rect layer ${r.layer}`);
				for (let y = r.y; y < r.y + r.h; y++)
					for (let x = r.x; x < r.x + r.w; x++) {
						const c = y * plan.W + x;
						cover[c]++;
						p.check(
							plan.layer[c] === r.layer && plan.top[c] === r.top,
							() => `${plan.floorSeed}: rect over ${c} (layer ${plan.layer[c]})`,
						);
					}
			}
			for (let c = 0; c < n; c++)
				p.check(
					cover[c] === (raised(plan.layer[c]) ? 1 : 0),
					() => `${plan.floorSeed}: cell ${c} covered ${cover[c]}x`,
				);
		}
		expect(p.list).toEqual([]);
	});

	it("stays within the Part budget (VOID.maxRects rects per floor)", () => {
		let worst = 0;
		for (const { plan } of CENSUS) worst = math.max(worst, plan.rects.size());
		expect(worst <= VOID.maxRects).toBe(true);
	});
});

// ---------------------------------------------------------------------------------------------
// Ray-cast safety, independent of the planner's reasoning: from sample points over every walkable cell (FLOOR or
// POOL) at bullet height, and four rim points of the bullet's drawn disc (offset in the camera plane, as decorPlan's
// spec does), march the view ray toward the camera across the grid (exact cell traversal). A void cell whose top is
// above the ray's height where the ray enters it would hide that bullet.

const PAD = BULLET_PAD_PX / PIXELS_PER_TILE;
const SAMPLE_STEP = 0.25;
const EPS = 1e-9;

/** Points (and rim points) of walkable cells hidden by a void column of `top`. */
function hiddenPoints(d: Dungeon, top: ReadonlyArray<number>): number {
	const W = d.W;
	const H = d.H;
	const f = DECOR_CAMERA.forward;
	const dx = -f[0];
	const dy = -f[1];
	const dz = -f[2];
	const right = DECOR_CAMERA.right;
	const up = DECOR_CAMERA.up;
	let maxTop = 0;
	for (let c = 0; c < W * H; c++) if (d.grid[c] === TileType.VOID && top[c] > maxTop) maxTop = top[c];
	const rim = [
		[0, 0],
		[PAD, 0],
		[-PAD, 0],
		[0, PAD],
		[0, -PAD],
	];
	const hidden = (px: number, py: number, pz: number): boolean => {
		let gx = math.floor(px + 0.5);
		let gz = math.floor(pz + 0.5);
		const sx = dx > 0 ? 1 : -1;
		const sz = dz > 0 ? 1 : -1;
		let tMaxX = math.abs(dx) < EPS ? math.huge : (gx + 0.5 * sx - px) / dx;
		let tMaxZ = math.abs(dz) < EPS ? math.huge : (gz + 0.5 * sz - pz) / dz;
		const tdX = math.abs(dx) < EPS ? math.huge : math.abs(1 / dx);
		const tdZ = math.abs(dz) < EPS ? math.huge : math.abs(1 / dz);
		let t = 0;
		for (;;) {
			const h = py + dy * t; // the ray climbs (dy > 0): its lowest point in a cell is where it enters
			if (h > maxTop) return false;
			if (gx >= 0 && gz >= 0 && gx < W && gz < H) {
				const c = gz * W + gx;
				if (d.grid[c] === TileType.VOID && top[c] > h) return true;
			}
			if (tMaxX < tMaxZ) {
				t = tMaxX;
				tMaxX += tdX;
				gx += sx;
			} else {
				t = tMaxZ;
				tMaxZ += tdZ;
				gz += sz;
			}
		}
	};
	let bad = 0;
	for (let gy = 0; gy < H; gy++)
		for (let gx = 0; gx < W; gx++) {
			const g = d.grid[gy * W + gx];
			if (g !== TileType.FLOOR && g !== TileType.POOL) continue;
			for (let oz = -0.5; oz <= 0.5 + EPS; oz += SAMPLE_STEP)
				for (let ox = -0.5; ox <= 0.5 + EPS; ox += SAMPLE_STEP)
					for (const [rx, ry] of rim) {
						const px = gx + ox + right[0] * rx + up[0] * ry;
						const py = BULLET_Y + right[1] * rx + up[1] * ry;
						const pz = gy + oz + right[2] * rx + up[2] * ry;
						if (hidden(px, py, pz)) bad++;
					}
		}
	return bad;
}

describe("void plan: nothing hides a bullet", () => {
	it("the camera looks down at the ray check's slope (the ray climbs toward the camera)", () => {
		expect(-DECOR_CAMERA.forward[1] > 0).toBe(true);
	});

	it("finds no walkable point hidden by a shoulder, ledge or outcrop (independent ray check)", () => {
		let floors = 0;
		for (let i = 0; i < CENSUS.size(); i += 2) {
			const { input, plan } = CENSUS[i];
			expect(hiddenPoints(input.dungeon, plan.top)).toBe(0);
			floors++;
		}
		expect(floors).toBeGreaterThan(30);
	});

	it("would catch a void column taller than the wall (the check is not vacuous)", () => {
		const { input, plan } = CENSUS[0];
		const tall: number[] = [];
		const h = 3 * GAME_WORLD.wallHeightTiles;
		for (let c = 0; c < plan.W * plan.H; c++) tall.push(raised(plan.layer[c]) ? h : plan.top[c]);
		expect(hiddenPoints(input.dungeon, tall)).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------------------------
// Depth bands (VD4) and the census line

interface BandStats {
	shoulder: number;
	ledge: number;
	rim: number;
	outcrops: number;
	eligible: number;
}

function bandStats(plans: ReadonlyArray<VoidPlan>): BandStats {
	const s: BandStats = { shoulder: 0, ledge: 0, rim: 0, outcrops: 0, eligible: 0 };
	for (const plan of plans) {
		s.shoulder += plan.stats.shoulder - plan.stats.pocketFilled;
		s.ledge += plan.stats.ledge;
		s.outcrops += plan.stats.outcrops;
		s.eligible += plan.stats.outcropEligible;
		for (let c = 0; c < plan.W * plan.H; c++) {
			const l = plan.layer[c];
			if (l !== VoidLayer.LEDGE && l !== VoidLayer.ABYSS) continue;
			let rim = false;
			around(plan, c, (j) => {
				if (plan.layer[j] === VoidLayer.SHOULDER) rim = true;
			});
			if (rim) s.rim++;
		}
	}
	return s;
}

describe("void plan: depth bands", () => {
	it("narrows the shoulder, breaks the ledge and raises the outcrop rate with depth", () => {
		const sample: Dungeon[] = [];
		const seeds: number[] = [];
		for (let i = 0; i < CENSUS.size(); i += 3) {
			sample.push(CENSUS[i].input.dungeon);
			seeds.push(CENSUS[i].input.floorSeed!);
		}
		const per: BandStats[] = [];
		for (let band = 0; band < VOID_DEPTH.bands.size(); band++) {
			const plans: VoidPlan[] = [];
			sample.forEach((d, i) => plans.push(planVoid({ dungeon: d, floorSeed: seeds[i], forceBand: band })));
			per.push(bandStats(plans));
		}
		const lines: string[] = [];
		per.forEach((s, band) =>
			lines.push(
				`${VOID_DEPTH.bands[band].name}: shoulder ${string.format(
					"%.0f",
					s.shoulder / sample.size(),
				)}, ledge kept ${string.format("%.2f", s.ledge / s.rim)}, outcrops/100 ${string.format(
					"%.2f",
					(100 * s.outcrops) / s.eligible,
				)}`,
			),
		);
		print(`[void] bands over ${sample.size()} floors: ${lines.join("; ")}`);
		// the same widths give the same shoulder (kept and worn share 2-3)
		expect(per[1].shoulder).toBe(per[0].shoulder);
		expect(per[2].shoulder < per[0].shoulder).toBe(true);
		expect(per[3].shoulder < per[2].shoulder).toBe(true);
		for (let band = 1; band < per.size(); band++) {
			expect(per[band].ledge / per[band].rim < per[band - 1].ledge / per[band - 1].rim).toBe(true);
			// outcrops per eligible cell: within half of the band's rate (hash noise over a few thousand cells)
			const rate = (VOID.outcropRatePer * per[band].outcrops) / per[band].eligible;
			const want = VOID_DEPTH.bands[band].outcropRate;
			expect(math.abs(rate - want) < want * 0.5).toBe(true);
		}
		expect(per[3].outcrops / per[3].eligible > per[0].outcrops / per[0].eligible).toBe(true);
	});

	it("prints the census per floor", () => {
		const n = CENSUS.size();
		let shoulder = 0;
		let ledge = 0;
		let outcrop = 0;
		let outcrops = 0;
		let rects = 0;
		let maxRects = 0;
		const rectsByBand = [0, 0, 0, 0];
		const floorsByBand = [0, 0, 0, 0];
		for (const { plan } of CENSUS) {
			shoulder += plan.stats.shoulder;
			ledge += plan.stats.ledge;
			outcrop += plan.stats.outcrop;
			outcrops += plan.stats.outcrops;
			rects += plan.rects.size();
			maxRects = math.max(maxRects, plan.rects.size());
			rectsByBand[plan.band] += plan.rects.size();
			floorsByBand[plan.band]++;
		}
		const avg = (v: number) => string.format("%.0f", v / n);
		const byBand = rectsByBand
			.map((r, i) => `${VOID_DEPTH.bands[i].name} ${string.format("%.0f", r / math.max(1, floorsByBand[i]))}`)
			.join(" / ");
		print(
			`[void] census per floor (${n} floors): shoulder ${avg(shoulder)}, ledge ${avg(ledge)}, outcrop ${avg(
				outcrop,
			)} cells in ${string.format("%.1f", outcrops / n)} outcrops; rects ${avg(
				rects,
			)} (max ${maxRects}; by band ${byBand}); planVoid ${string.format("%.2f", (planSeconds / n) * 1000)} ms`,
		);
		expect(rects).toBeGreaterThan(0);
	});
});

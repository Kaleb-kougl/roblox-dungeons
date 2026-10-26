// The decor renderers' pure half (docs/DECOR.md R4 / R9): the light pool (nearest selection, hand-over with fades,
// hysteresis), seeded flicker, loop frames with per-piece phases, facings, fade bodies and tween, footprints, the
// ambient emitter's counts (caps, juice level, reduced motion) and the floor scene.
import { describe, expect, it } from "@rbxts/jest-globals";
import { THEMES, type ThemeKey } from "shared/dungeon";
import { buildEndlessRunConfig } from "shared/run";
import { PLAYER_RADIUS, createSimState, killPlayerState, playerAt } from "shared/sim";
import {
	DECOR_BOX,
	DECOR_FX,
	DECOR_LIGHTS,
	DecorLightPool,
	NO_DECOR_LIGHT,
	ambientEmitterSpec,
	decorEntryFootprint,
	decorFacingDir,
	decorFadeBodies,
	decorFadeStep,
	decorFlicker,
	decorFlickerScale,
	decorInputOfLayout,
	decorLoopFrame,
	decorScene,
	footprintStencil,
	nearestDecorLights,
	planDecor,
	type DecorBody,
	type StandingKind,
} from ".";

describe("decor light pool", () => {
	it("picks the nearest lit candidates, nearest first, ties to the lower index", () => {
		const xs = [0, 5, 1, 1, 9, 2];
		const zs = [0, 0, 0, 0, 0, 0];
		const lv = [1, 1, 1, 1, 1, 0];
		const out: number[] = [];
		nearestDecorLights(xs, zs, lv, 0, 0, 3, 0.05, out);
		expect(out).toEqual([0, 2, 3]);
		nearestDecorLights(xs, zs, lv, 10, 0, 2, 0.05, out);
		expect(out).toEqual([4, 1]);
		nearestDecorLights(xs, zs, lv, 2, 0, 10, 0.05, out); // the unlit one at the focus is skipped
		expect(out).toEqual([2, 3, 0, 1, 4]);
	});

	it("keeps lights on wanted keys, fades the others out before handing them over", () => {
		const pool = new DecorLightPool(2, 0.25, 0.3);
		expect(pool.due(0)).toBe(true); // the first frame assigns
		pool.assign([10, 11, 12]);
		expect(pool.key).toEqual([10, 11]);
		pool.fade(0.3);
		expect(pool.level).toEqual([1, 1]);
		expect(pool.due(0.1)).toBe(false);
		expect(pool.due(0.2)).toBe(true);
		pool.assign([11, 12]); // 10 leaves, 12 waits for a free light
		expect(pool.lightOf(11)).toBe(1);
		expect(pool.lightOf(12)).toBe(-1);
		pool.fade(0.15);
		expect(pool.level[0]).toBeCloseTo(0.5, 9);
		expect(pool.level[1]).toBe(1);
		pool.fade(0.15); // faded out: freed, 12 takes it at level 0
		expect(pool.key).toEqual([12, 11]);
		expect(pool.level[0]).toBe(0);
		pool.fade(0.3);
		expect(pool.level).toEqual([1, 1]);
		const changes = pool.changes;
		pool.assign([12, 11]); // same set, other order: nobody moves
		expect(pool.changes).toBe(changes);
		pool.clear();
		expect(pool.key).toEqual([NO_DECOR_LIGHT, NO_DECOR_LIGHT]);
	});

	it("uses DECOR_LIGHTS.pool lights by default", () => {
		expect(new DecorLightPool().size).toBe(DECOR_LIGHTS.pool);
	});

	it("flickers deterministically per light, within [-1, 1], scaled to nothing without motion", () => {
		let lo = math.huge;
		let hi = -math.huge;
		for (let i = 0; i < 600; i++) {
			const f = decorFlicker(123456789, i / 60);
			lo = math.min(lo, f);
			hi = math.max(hi, f);
			expect(decorFlicker(123456789, i / 60)).toBe(f);
		}
		expect(lo >= -1 && hi <= 1).toBe(true);
		expect(hi - lo > 0.5).toBe(true);
		expect(decorFlicker(1, 0.5) !== decorFlicker(2, 0.5)).toBe(true);
		expect(decorFlickerScale(99, 0.37, 0)).toBe(1);
		const s = decorFlickerScale(99, 0.37, 1);
		expect(math.abs(s - 1) <= DECOR_LIGHTS.flickerAmplitude + 1e-9).toBe(true);
	});
});

describe("decor renderer helpers", () => {
	it("loops effect frames with a phase per piece", () => {
		expect(decorLoopFrame(0, 8, 8, 0)).toBe(0);
		expect(decorLoopFrame(0, 8, 8, 3)).toBe(3);
		expect(decorLoopFrame(1, 8, 8, 3)).toBe(3); // a full loop later
		expect(decorLoopFrame(0.125, 8, 8, 7)).toBe(0);
		expect(decorLoopFrame(5, 0, 4, 6)).toBe(2); // no fps: the hash's frame
		expect(decorLoopFrame(5, 8, 1, 6)).toBe(0);
	});

	it("faces grid pieces along their wall's normal and round ones by hash", () => {
		expect(decorFacingDir({ kind: "wall", faceX: 0, faceZ: 1, hash: 5 })).toEqual([0, 1]);
		expect(decorFacingDir({ kind: "torch", faceX: 1, faceZ: 0, hash: 5 })).toEqual([1, 0]);
		expect(decorFacingDir({ kind: "columnBroken", faceX: 0, faceZ: 0, hash: 5 })).toEqual([1, 0]);
		const [x, z] = decorFacingDir({ kind: "bones", faceX: 0, faceZ: 0, hash: 90 });
		expect(x).toBeCloseTo(0, 9);
		expect(z).toBeCloseTo(1, 9);
		const a = decorFacingDir({ kind: "debris", faceX: 0, faceZ: 0, hash: 10 });
		const b = decorFacingDir({ kind: "debris", faceX: 0, faceZ: 0, hash: 200 });
		expect(a[0] !== b[0]).toBe(true);
	});

	it("tweens fades at full range per `seconds`", () => {
		expect(decorFadeStep(0, 1, 0.075, 0.15)).toBeCloseTo(0.5, 9);
		expect(decorFadeStep(0.9, 1, 0.075, 0.15)).toBe(1);
		expect(decorFadeStep(1, 0, 0.3, 0.15)).toBe(0);
		expect(decorFadeStep(0.2, 0.7, 1, 0)).toBe(0.7);
	});

	it("lists the living players (and a live boss) as fade bodies, reusing the objects", () => {
		const setup = buildEndlessRunConfig(1337, 2);
		const state = createSimState(1337, setup.spawn!.x, setup.spawn!.z, setup.config);
		const out: DecorBody[] = [];
		decorFadeBodies(state, out);
		expect(out.size()).toBe(2);
		expect(out[0].radius).toBe(PLAYER_RADIUS);
		const first = out[0];
		killPlayerState(playerAt(state, 0));
		decorFadeBodies(state, out);
		expect(out.size()).toBe(1);
		expect(out[0]).toBe(first);
		expect(out[0].x).toBe(playerAt(state, 1).x);
		// floor 5 starts with Mother Bramble in her arena
		const boss = buildEndlessRunConfig(1337).endlessFloor(5);
		const bs = createSimState(1337, boss.spawnX, boss.spawnZ, { ...boss.config });
		decorFadeBodies(bs, out);
		expect(out.size()).toBe(2);
		expect(out[1].height > out[0].height).toBe(true);
	});

	it("rebuilds a standing entry's footprint for the footprint stencil", () => {
		const setup = buildEndlessRunConfig(1337);
		const layout = setup.endlessFloor(1).layout;
		const plan = planDecor(decorInputOfLayout(layout, 1));
		let segments = 0;
		for (const e of plan.entries) {
			if (e.layer !== "tall" && e.layer !== "low") continue;
			const f = decorEntryFootprint(e);
			expect(math.max(math.abs(f.x1 - f.x0), math.abs(f.y1 - f.y0)) + 1).toBe(e.cells);
			if (e.cells > 1) segments++;
			const st = footprintStencil(f, DECOR_BOX[e.kind as StandingKind]);
			expect(st.size() % 2).toBe(0);
		}
		print(`[decor fx] floor 1: ${plan.entries.size()} entries, ${segments} wall segments`);
	});
});

describe("decor ambient particles", () => {
	const keys: ThemeKey[] = ["ancient", "molten", "frost", "grim", "verdant"];

	it("follows the biome's Forge count x band light x juice level, capped, none without motion", () => {
		for (const key of keys) {
			const n = THEMES[key].particles.n;
			const normal = ambientEmitterSpec(key, 1, "normal", 1);
			expect(normal.live).toBe(math.min(DECOR_FX.maxParticles, n));
			expect(normal.rate > 0).toBe(true);
			const abyss = ambientEmitterSpec(key, 0.7, "low", 1);
			expect(abyss.live <= normal.live).toBe(true);
			expect(ambientEmitterSpec(key, 1, "high", 1).live <= DECOR_FX.maxParticles).toBe(true);
			expect(ambientEmitterSpec(key, 1, "off", 1).live).toBe(0);
			const still = ambientEmitterSpec(key, 1, "high", 0);
			expect(still.live).toBe(0);
			expect(still.rate).toBe(0);
		}
		expect(ambientEmitterSpec("molten", 1, "normal", 1).motion.up).toBe(true);
		expect(ambientEmitterSpec("frost", 1, "normal", 1).motion.up).toBe(false);
	});
});

describe("decor scene", () => {
	it("lists the floor's pedestals, shrine, stairwell and boss room from its layout", () => {
		const setup = buildEndlessRunConfig(1337);
		for (const floor of [1, 2, 3, 4, 5]) {
			const layout = setup.endlessFloor(floor).layout;
			const input = decorInputOfLayout(layout, 1);
			const scene = decorScene(input, planDecor(input), layout.bossFloor);
			const rooms = layout.encounter.rooms;
			expect(scene.roomCount).toBe(layout.dungeon.rooms.size());
			expect(scene.bossRoom).toBe(layout.dungeon.boss);
			expect(scene.stairwell).toEqual({ x: layout.stairwell.x, z: layout.stairwell.z });
			expect(scene.pedestals.size()).toBe(rooms.filter((r) => r.type === "treasure").size());
			const shrine = rooms.find((r) => r.type === "shrine");
			expect(scene.shrineRoom).toBe(shrine !== undefined ? shrine.id : -1);
			expect(scene.bossFloor).toBe(floor === 5);
			expect(scene.plan.lightsByRoom.size()).toBe(scene.roomCount);
		}
	});
});

describe("decor budgets", () => {
	it("reports pieces, lights and the instance budget per floor (seed 1337, floors 1-10)", () => {
		const setup = buildEndlessRunConfig(1337);
		let maxEntries = 0;
		let sumEntries = 0;
		let sumLit = 0;
		let sumRing = 0;
		const floors = 10;
		for (let floor = 1; floor <= floors; floor++) {
			const layout = setup.endlessFloor(floor).layout;
			const input = decorInputOfLayout(layout, 1);
			const scene = decorScene(input, planDecor(input), layout.bossFloor);
			const plan = scene.plan;
			let lit = 0;
			for (const e of plan.entries) if (e.light && e.lit) lit++;
			const c = plan.counts;
			print(
				`[decor budget] floor ${floor} (${plan.profile.bandName}): ${plan.entries.size()} entries ` +
					`(flat ${c.flat}, low ${c.low}, tall ${c.tall}, wall ${c.wall}), ${lit} lit lights, ` +
					`${scene.bossRing.size()} ring pits`,
			);
			maxEntries = math.max(maxEntries, plan.entries.size());
			sumEntries += plan.entries.size();
			sumLit += lit;
			sumRing += scene.bossRing.size();
		}
		// every drawn piece is 3 instances (Part + Gui + ImageLabel); a lit light with flame and glow art 6 more
		const avg = sumEntries / floors;
		const avgLit = sumLit / floors;
		print(
			`[decor budget] mean ${string.format("%.0f", avg)} entries, ${string.format("%.0f", avgLit)} lit lights, ` +
				`${string.format("%.1f", sumRing / floors)} ring pits; with art for every kind ~${string.format(
					"%.0f",
					avg * 3 + avgLit * 6,
				)} instances + ${DECOR_LIGHTS.pool} pool + <= ${
					DECOR_LIGHTS.bossRingLights + 1 + DECOR_LIGHTS.shrineLights
				} fixed PointLights`,
		);
		expect(maxEntries < 600).toBe(true);
	});
});

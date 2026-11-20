// Breakables on screen (docs/DECOR.md D4, task R13): the frame diff against the sim's state (multi-tick frames, floor
// changes, restarts), the hit blink / shake, placement and the height cap, the debris pick, the aim-line clip and the
// chip burst.
import { describe, expect, it } from "@rbxts/jest-globals";
import { STUDS_PER_TILE } from "shared/config";
import { cellKey, gridToWorld, type BreakablePlacement, type SolidCells } from "shared/dungeon";
import { defaultJuiceSettings, type JuiceSettings } from "shared/settings";
import {
	BREAKABLES_CONFIG,
	BreakableKind,
	BreakableSource,
	NOT_BROKEN,
	createBreakablesState,
	createSimState,
	damageBreakable,
	resetBreakables,
	solidCells,
	type BreakablesState,
} from "shared/sim";
import {
	BREAKABLE_KINDS,
	BREAKABLE_OUTLINE_ROLE,
	DECOR_KIND_LAYERS,
	PLACEHOLDER_MANIFEST,
	ThemePack,
} from "shared/theme";
import {
	BREAKABLE_DEBRIS,
	BREAKABLE_VIEW,
	BreakableTracker,
	breakableArtLayout,
	breakableBaseStuds,
	breakableBoxStuds,
	breakableCellHash,
	breakableHitActive,
	breakableHitFlash,
	breakableKindName,
	breakableShakeStuds,
	clipToSolidCells,
	debrisVariant,
	floorStudsY,
	isChestPiece,
	isInertPieceKind,
	oneShotSec,
	studsX,
	studsZ,
} from "shared/view";
import { DeathParticleSystem } from "shared/view/fx";

const PIECES: ReadonlyArray<BreakablePlacement> = [
	{ x: 4, y: 5, kind: "barrel" },
	{ x: 6, y: 5, kind: "crate" },
	{ x: 9, y: 2, kind: "crate" },
];

function fresh(list: ReadonlyArray<BreakablePlacement> = PIECES): BreakablesState {
	return createBreakablesState(BREAKABLES_CONFIG, list);
}

function quietPack(): ThemePack {
	return new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });
}

describe("BreakableTracker", () => {
	it("reports a new layout on the first frame, then nothing while nothing changes", () => {
		const b = fresh();
		const t = new BreakableTracker();
		expect(t.update(b, 0)).toBe(true);
		expect(t.count()).toBe(3);
		expect([t.kindAt(0), t.cellX(0), t.cellY(0), t.isIntact(0)]).toEqual([BreakableKind.BARREL, 4, 5, true]);
		expect([t.kindAt(1), t.cellX(1), t.cellY(1)]).toEqual([BreakableKind.CRATE, 6, 5]);
		expect(t.update(b, 1)).toBe(false);
		expect([[...t.hits], [...t.broken], [...t.restored]]).toEqual([[], [], []]);
	});

	it("keeps a vault's chest in the layout but never lists it (docs/TREASURE.md TR7: the treasure view draws it)", () => {
		const b = fresh([...PIECES, { x: 12, y: 3, kind: "chest" }]);
		const t = new BreakableTracker();
		expect(t.update(b, 0)).toBe(true);
		expect([t.count(), t.kindAt(3), isChestPiece(t.kindAt(3))]).toEqual([4, BreakableKind.CHEST, true]);
		expect([isChestPiece(BreakableKind.BARREL), isChestPiece(BreakableKind.CRATE)]).toEqual([false, false]);
		// Defensive: even a chest whose hp / brokenTick moved is never hit, broken or restored.
		b.pieces[3].hp = 0;
		b.pieces[3].brokenTick = 1;
		expect(t.update(b, 2)).toBe(false);
		expect([[...t.hits], [...t.broken], [...t.restored]]).toEqual([[], [], []]);
	});

	it("a secret's crack and chest are inert: in the layout, never listed, not a barrel (docs/SECRET_ROOMS.md SR2)", () => {
		const b = fresh([
			...PIECES,
			{ x: 12, y: 3, kind: "crackedWall" },
			{ x: 13, y: 3, kind: "crackedWall" },
			{ x: 12, y: 0, kind: "chest" },
		]);
		const t = new BreakableTracker();
		expect(t.update(b, 0)).toBe(true);
		expect([t.count(), t.kindAt(3), t.kindAt(4), t.kindAt(5)]).toEqual([
			6,
			BreakableKind.CRACKED_WALL,
			BreakableKind.CRACKED_WALL,
			BreakableKind.CHEST,
		]);
		expect([isInertPieceKind(BreakableKind.CRACKED_WALL), isInertPieceKind(BreakableKind.CHEST)]).toEqual([
			true,
			true,
		]);
		expect([isInertPieceKind(BreakableKind.BARREL), isInertPieceKind(BreakableKind.CRATE)]).toEqual([false, false]);
		// A crack is no chest (the treasure view draws chests only) and has no clutter name (no barrel / crate art).
		expect([isChestPiece(BreakableKind.CRACKED_WALL), breakableKindName(BreakableKind.CRACKED_WALL)]).toEqual([
			false,
			undefined,
		]);
		// The open sets both pieces' brokenTick without a break: never a shatter here; a barrel's hit still lists.
		b.pieces[3].hp = 0;
		b.pieces[3].brokenTick = 1;
		b.pieces[4].hp = 0;
		b.pieces[4].brokenTick = 1;
		b.pieces[0].hp -= 1;
		expect(t.update(b, 2)).toBe(false);
		expect([[...t.hits], [...t.broken], [...t.restored]]).toEqual([[0], [], []]);
	});

	it("classifies each piece once per frame from hp / brokenTick, however many ticks the frame ran", () => {
		const b = fresh();
		const t = new BreakableTracker();
		t.update(b, 0);
		// One frame of several ticks: the crate in slot 1 hit twice, the barrel hit then broken, slot 2 untouched.
		b.pieces[1].hp -= 1;
		b.pieces[1].hp -= 0.5;
		b.pieces[0].hp -= 1;
		b.pieces[0].hp = 0;
		b.pieces[0].brokenTick = 3;
		expect(t.update(b, 4)).toBe(false);
		expect([...t.hits]).toEqual([1]);
		expect([...t.broken]).toEqual([0]);
		expect(t.isIntact(0)).toBe(false);
		// The next frame: nothing new (a broken piece stays broken quietly).
		expect(t.update(b, 5)).toBe(false);
		expect([[...t.hits], [...t.broken]]).toEqual([[], []]);
	});

	it("follows the sim's own damage path (damageBreakable on a real state)", () => {
		const state = createSimState(1, 0, 0, { breakables: { ...BREAKABLES_CONFIG, pieces: PIECES } });
		const t = new BreakableTracker();
		expect(t.update(state.breakables, state.tick)).toBe(true);
		const crateHp = state.breakables!.pieces[1].hp;
		damageBreakable(state, 1, 1, BreakableSource.PLAYER_BULLET);
		damageBreakable(state, 0, state.breakables!.pieces[0].hp, BreakableSource.MELEE);
		expect(t.update(state.breakables, state.tick)).toBe(false);
		expect([...t.hits]).toEqual([1]);
		expect([...t.broken]).toEqual([0]);
		expect(state.breakables!.pieces[1].hp).toBe(crateHp - 1);
		expect(state.breakables!.hitSlots.size()).toBe(2);
	});

	it("an endless floor change (new pieces) is a new layout, without hits or breaks", () => {
		const b = fresh();
		const t = new BreakableTracker();
		t.update(b, 0);
		b.pieces[0].hp = 0;
		b.pieces[0].brokenTick = 9;
		resetBreakables(b, [
			{ x: 1, y: 1, kind: "crate" },
			{ x: 2, y: 7, kind: "barrel" },
			{ x: 3, y: 3, kind: "barrel" },
		]);
		expect(t.update(b, 10)).toBe(true);
		expect([[...t.hits], [...t.broken]]).toEqual([[], []]);
		expect([t.cellX(0), t.cellY(0), t.kindAt(0), t.isIntact(0)]).toEqual([1, 1, BreakableKind.CRATE, true]);
	});

	it("a restart (tick back, same floor) is a new layout; reset() forces one; no state is an empty layout", () => {
		const t = new BreakableTracker();
		const b = fresh();
		t.update(b, 500);
		b.pieces[2].hp = 0;
		b.pieces[2].brokenTick = 498;
		// Same cells and kinds, but the tick went back: a new run on the same floor, the broken piece shows broken.
		expect(t.update(b, 0)).toBe(true);
		expect(t.isIntact(2)).toBe(false);
		t.reset();
		expect(t.update(b, 1)).toBe(true);
		expect(t.update(undefined, 2)).toBe(true);
		expect(t.count()).toBe(0);
		expect(t.update(undefined, 3)).toBe(false);
	});

	it("a piece back to intact without a new layout is restored quietly (no hit, no break)", () => {
		const b = fresh();
		const t = new BreakableTracker();
		t.update(b, 0);
		b.pieces[1].hp = 0;
		b.pieces[1].brokenTick = 2;
		t.update(b, 2);
		b.pieces[1].hp = BREAKABLES_CONFIG.hp[BreakableKind.CRATE];
		b.pieces[1].brokenTick = NOT_BROKEN;
		expect(t.update(b, 3)).toBe(false);
		expect([[...t.restored], [...t.hits], [...t.broken]]).toEqual([[1], [], []]);
	});
});

describe("outline", () => {
	it("draws the theme's breakable outline role, rim only, hidden behind walls like the bodies", () => {
		const v = BREAKABLE_VIEW;
		expect(v.outlineRole).toBe(BREAKABLE_OUTLINE_ROLE);
		expect(v.highlightFillTransparency).toBe(1);
		expect(v.highlightOutlineTransparency).toBe(0);
		expect(v.highlightDepthMode).toBe("Occluded");
	});
});

describe("hit look", () => {
	it("blinks in the first hitBlinkSec, on in the even periods", () => {
		const v = BREAKABLE_VIEW;
		expect(breakableHitFlash(0)).toBe(true);
		expect(breakableHitFlash(v.blinkPeriodSec * 1.5)).toBe(false);
		expect(breakableHitFlash(v.blinkPeriodSec * 2.5)).toBe(v.blinkPeriodSec * 2.5 < v.hitBlinkSec);
		expect(breakableHitFlash(v.hitBlinkSec)).toBe(false);
		expect(breakableHitFlash(-1)).toBe(false);
		expect(breakableHitActive(0)).toBe(true);
		expect(breakableHitActive(math.max(v.hitBlinkSec, v.shakeSec))).toBe(false);
		expect(breakableHitActive(-math.huge)).toBe(false);
	});

	it("shakes within shakeStuds x motionScale, decaying to 0; never under reduced motion", () => {
		const v = BREAKABLE_VIEW;
		let peak = 0;
		for (let i = 0; i < 64; i++) {
			const age = (i / 64) * v.shakeSec;
			const s = breakableShakeStuds(age, 1);
			expect(math.abs(s) <= v.shakeStuds * (1 - age / v.shakeSec) + 1e-12).toBe(true);
			peak = math.max(peak, math.abs(s));
			expect(breakableShakeStuds(age, 0)).toBe(0);
			expect(math.abs(breakableShakeStuds(age, 0.5))).toBeCloseTo(math.abs(s) / 2, 12);
		}
		expect(peak > 0).toBe(true);
		expect(breakableShakeStuds(v.shakeSec, 1)).toBe(0);
		expect(breakableShakeStuds(-0.01, 1)).toBe(0);
	});
});

describe("placement and the height cap", () => {
	it("stands on its cell centre, just above the floor", () => {
		const [x, y, z] = breakableBaseStuds(6, 5);
		expect(x).toBe(studsX(gridToWorld(6)));
		expect(z).toBe(studsZ(gridToWorld(5)));
		expect(y).toBe(floorStudsY() + BREAKABLE_VIEW.liftStuds);
	});

	it("the placeholder boxes fit under maxHeightTiles; a taller box is cut to it, footprint kept", () => {
		const cap = BREAKABLE_VIEW.maxHeightTiles * STUDS_PER_TILE;
		const pack = quietPack();
		for (const kind of BREAKABLE_KINDS) {
			const size = pack.breakable(kind).placeholder.size;
			expect([kind, size[1] <= cap]).toEqual([kind, true]);
			expect(breakableBoxStuds(size)).toEqual([size[0], size[1], size[2]]);
		}
		expect(breakableBoxStuds([4, 9, 3])).toEqual([4, cap, 3]);
	});

	it("art taller than the cap is scaled down uniformly; shorter art is untouched", () => {
		const cap = BREAKABLE_VIEW.maxHeightTiles;
		const short = { frameW: 32, frameH: 16, pivot: { x: 16, y: 16 }, pixelsPerTile: 32 };
		expect(breakableArtLayout(short)).toBe(short);
		const tall = { frameW: 32, frameH: 64, pivot: { x: 16, y: 64 }, pixelsPerTile: 32 };
		const fit = breakableArtLayout(tall);
		expect(fit.frameH / fit.pixelsPerTile).toBeCloseTo(cap, 12);
		expect([fit.frameW, fit.frameH, fit.pivot]).toEqual([32, 64, tall.pivot]);
		// only the part above the pivot counts: what hangs below it (a shatter's planks) lies on the floor
		const planks = { frameW: 32, frameH: 64, pivot: { x: 16, y: 16 }, pixelsPerTile: 32 };
		expect(breakableArtLayout(planks)).toBe(planks);
		const high = { frameW: 32, frameH: 64, pivot: { x: 16, y: 40 }, pixelsPerTile: 32 };
		const lowered = breakableArtLayout(high);
		expect(lowered.pivot.y / lowered.pixelsPerTile).toBeCloseTo(cap, 12);
		expect(lowered.frameH / lowered.pixelsPerTile > cap).toBe(true);
	});

	it("one-shot length", () => {
		expect(oneShotSec(8, 16)).toBe(0.5);
		expect(oneShotSec(0, 16)).toBe(0);
		expect(oneShotSec(8, 0)).toBe(0);
	});
});

describe("debris", () => {
	it("each kind leaves a flat decor kind", () => {
		for (let k = 0; k < BREAKABLE_KINDS.size(); k++) {
			const name = breakableKindName(k)!;
			expect(name).toBe(BREAKABLE_KINDS[k]);
			const layers = DECOR_KIND_LAYERS[BREAKABLE_DEBRIS[name]] as ReadonlyArray<string>;
			expect([...layers]).toEqual(["flat"]);
		}
		expect(breakableKindName(BREAKABLE_KINDS.size())).toBe(undefined);
	});

	it("picks a variant by cell hash: stable, in range, every variant used across a floor", () => {
		expect(debrisVariant(3, 4, 0)).toBe(-1);
		expect(debrisVariant(3, 4, 1)).toBe(0);
		expect(breakableCellHash(3, 4)).toBe(breakableCellHash(3, 4));
		expect(breakableCellHash(3, 4) !== breakableCellHash(4, 3)).toBe(true);
		const seen = [0, 0, 0];
		for (let x = 0; x < 30; x++) {
			for (let y = 0; y < 30; y++) {
				const v = debrisVariant(x, y, 3);
				expect(v >= 0 && v < 3).toBe(true);
				seen[v]++;
			}
		}
		for (const n of seen) expect(n > 200).toBe(true);
	});
});

describe("aim clip", () => {
	const solid: SolidCells = new Map([[cellKey(5, 0), 0]]);

	it("stops where the line enters the first piece's cell", () => {
		expect(clipToSolidCells(solid, 0, 0, 1, 0, 10)).toBeCloseTo(4.5, 12);
		expect(clipToSolidCells(solid, 0.2, 0.1, 1, 0, 10)).toBeCloseTo(4.3, 12);
		// A non-unit direction: the kept length is still along len.
		expect(clipToSolidCells(solid, 0, 0, 2, 0, 5)).toBeCloseTo(2.25, 12);
		// From the other side.
		expect(clipToSolidCells(solid, 9, 0, -1, 0, 10)).toBeCloseTo(3.5, 12);
	});

	it("diagonals cross the right cells", () => {
		const diag: SolidCells = new Map([[cellKey(3, 3), 0]]);
		const d = math.sqrt(0.5);
		expect(clipToSolidCells(diag, 0, 0, d, d, 10)).toBeCloseTo(2.5 * math.sqrt(2), 9);
		// Passing beside it (one row up) misses.
		expect(clipToSolidCells(diag, 0, 1, 1, 0, 10)).toBe(10);
	});

	it("keeps the whole line without pieces, short of them, from inside one, or with none intact", () => {
		expect(clipToSolidCells(undefined, 0, 0, 1, 0, 10)).toBe(10);
		expect(clipToSolidCells(new Map(), 0, 0, 1, 0, 10)).toBe(10);
		expect(clipToSolidCells(solid, 0, 0, 1, 0, 4)).toBe(4);
		expect(clipToSolidCells(solid, 5, 0, 1, 0, 3)).toBe(3);
		expect(clipToSolidCells(solid, 0, 0, 0, 0, 3)).toBe(3);
		expect(clipToSolidCells(solid, 0, 0, 0, 1, 10)).toBe(10);
	});

	it("reads the sim's intact cells (solidCells): a broken piece no longer clips", () => {
		const state = createSimState(1, 0, 0, {
			breakables: { ...BREAKABLES_CONFIG, pieces: [{ x: 5, y: 0, kind: "barrel" }] },
		});
		expect(clipToSolidCells(solidCells(state), 0, 0, 1, 0, 10)).toBeCloseTo(4.5, 12);
		damageBreakable(state, 0, 99, BreakableSource.SLAM);
		expect(clipToSolidCells(solidCells(state), 0, 0, 1, 0, 10)).toBe(10);
	});
});

describe("chips", () => {
	const burst = (k: number) => {
		const c = BREAKABLE_VIEW.chips[k];
		return {
			chunks: c.chunks,
			bits: c.bits,
			sparks: c.sparks,
			startPx: BREAKABLE_VIEW.chipStartPx,
			radius: BREAKABLE_VIEW.chipRadiusTiles,
			speed: BREAKABLE_VIEW.chipSpeed,
		};
	};

	it("one chip set per kind; the burst follows the particle level", () => {
		expect(BREAKABLE_VIEW.chips.size()).toBe(BREAKABLE_KINDS.size());
		const normal: JuiceSettings = { ...defaultJuiceSettings(), particles: "normal", reducedMotion: false };
		const sys = new DeathParticleSystem();
		const c = BREAKABLE_VIEW.chips[1];
		sys.chips(1, 2, 5, burst(1), 77, normal);
		expect(sys.pool.count).toBe(c.chunks + c.bits + c.sparks);
		const off = new DeathParticleSystem();
		off.chips(1, 2, 5, burst(1), 77, { ...normal, particles: "off" });
		expect(off.pool.count).toBe(0);
		const low = new DeathParticleSystem();
		low.chips(1, 2, 5, burst(0), 77, { ...normal, particles: "low" });
		expect(low.pool.count > 0 && low.pool.count < sys.pool.count).toBe(true);
	});
});

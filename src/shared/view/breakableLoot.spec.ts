// Boosts from breakables on screen (docs/BREAKABLE_DROPS.md BL6): the loaded piece's glint (per-cell phase, slow
// cadence, still under reduced motion, its billboard on the piece's top, ducking for enemy bullets), the released
// boost's hop (the arc from the piece's top, the bob after it) and the KV_LootDebug label.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CAMERA_PITCH_DEG, STUDS_PER_TILE } from "shared/config";
import { Boost } from "shared/sim";
import {
	BREAKABLE_LOOT_VIEW,
	BREAKABLE_VIEW,
	LOOT_GLINT_HIDDEN,
	artPieceTop,
	boxPieceTop,
	degToRad,
	lootDebugText,
	lootGlintBillboard,
	lootGlintDucked,
	lootGlintFrame,
	lootGlintPassSec,
	lootGlintPhaseSec,
	lootGlintTransparency,
	lootHopStuds,
	lootSettledAgeSec,
	spriteBillboard,
	type LootGlintBullets,
} from ".";

const V = BREAKABLE_LOOT_VIEW;
const S = STUDS_PER_TILE;

/** A fake bullet pool: visible bullets at the given floor points. */
function pool(points: ReadonlyArray<readonly [number, number]>, hidden: ReadonlyArray<number> = []): LootGlintBullets {
	return {
		highWater() {
			return points.size();
		},
		isVisible(i) {
			return !hidden.includes(i);
		},
		positionAt(i) {
			return { x: points[i][0], z: points[i][1] };
		},
	};
}

describe("breakable loot: tunables", () => {
	it("are slow and soft, start the hop at the pieces' height cap, and keep their own seed salt", () => {
		expect(V.glintEverySeconds).toBeGreaterThan(lootGlintPassSec(8, 8));
		expect(V.glintTransparency).toBeLessThan(V.reducedTransparency);
		expect(V.hopFromTiles).toBe(BREAKABLE_VIEW.maxHeightTiles);
		expect(V.hopTiles).toBeGreaterThan(0);
		expect(V.hopSeconds).toBeGreaterThan(0);
		// apart from the breakables' (11, 12), boosts' (13, 14), room clear (15) and near misses' (16, 17)
		expect([11, 12, 13, 14, 15, 16, 17].includes(V.fizzleSeedSalt)).toBe(false);
		expect(V.debugAttribute).toBe("KV_LootDebug");
	});
});

describe("breakable loot: the glint's phase and cadence", () => {
	it("phases by cell: deterministic, inside the cycle, on one of the phase slots, different across cells", () => {
		const seen = new Set<number>();
		for (let x = 0; x < 12; x++) {
			for (let y = 0; y < 12; y++) {
				const p = lootGlintPhaseSec(x, y);
				expect(p).toBe(lootGlintPhaseSec(x, y));
				expect(p >= 0 && p < V.glintEverySeconds).toBe(true);
				const slot = (p / V.glintEverySeconds) * V.glintPhaseSlots;
				expect(slot).toBeCloseTo(math.round(slot), 9);
				seen.add(p);
			}
		}
		// 144 cells over 64 slots: most slots used (a random-looking spread, not a few clumps)
		expect(seen.size()).toBeGreaterThan(V.glintPhaseSlots / 2);
	});

	it("plays one pass at the start of every cycle, hidden between; the phase shifts it", () => {
		const fps = 10;
		const frames = 5; // a 0.5 s pass
		expect(lootGlintPassSec(fps, frames)).toBe(0.5);
		expect(lootGlintFrame(0, 0, fps, frames, 1)).toBe(0);
		expect(lootGlintFrame(0.25, 0, fps, frames, 1)).toBe(2);
		expect(lootGlintFrame(0.49, 0, fps, frames, 1)).toBe(4);
		expect(lootGlintFrame(0.5, 0, fps, frames, 1)).toBe(LOOT_GLINT_HIDDEN);
		expect(lootGlintFrame(V.glintEverySeconds - 0.01, 0, fps, frames, 1)).toBe(LOOT_GLINT_HIDDEN);
		expect(lootGlintFrame(V.glintEverySeconds + 0.1, 0, fps, frames, 1)).toBe(1);
		// a piece phased 1 s: its pass starts 1 s before the cycle's end
		const at = V.glintEverySeconds - 1;
		expect(lootGlintFrame(at, 1, fps, frames, 1)).toBe(0);
		expect(lootGlintFrame(0, 1, fps, frames, 1)).toBe(LOOT_GLINT_HIDDEN);
	});

	it("shows art without frames for glintFlashSeconds; a pass longer than the cycle loops", () => {
		expect(lootGlintPassSec(0, 1)).toBe(V.glintFlashSeconds);
		expect(lootGlintFrame(0.1, 0, 0, 1, 1)).toBe(0);
		expect(lootGlintFrame(V.glintFlashSeconds + 0.01, 0, 0, 1, 1)).toBe(LOOT_GLINT_HIDDEN);
		const slowFrames = 100; // 10 s at 10 fps
		expect(lootGlintFrame(V.glintEverySeconds + 0.05, 0, 10, slowFrames, 1)).toBe(
			math.floor((V.glintEverySeconds + 0.05) * 10),
		);
	});

	it("reduced motion: a still sparkle, always shown, at the reduced transparency", () => {
		for (const t of [0, 0.7, 2, V.glintEverySeconds * 3.3]) {
			expect(lootGlintFrame(t, 0.4, 10, 8, 0)).toBe(V.glintStillFrame % 8);
		}
		expect(lootGlintFrame(1, 0, 10, 1, 0)).toBe(0);
		expect([lootGlintTransparency(1), lootGlintTransparency(0)]).toEqual([
			V.glintTransparency,
			V.reducedTransparency,
		]);
	});
});

describe("breakable loot: the glint's place", () => {
	it("an art piece's top is its cell's height above the pivot; its front the billboard's own depth", () => {
		const layout = { frameW: 40, frameH: 60, pivot: { x: 20, y: 30 }, pixelsPerTile: 48 };
		const top = artPieceTop(layout);
		expect(top.upStuds).toBeCloseTo((30 / 48) * S, 9);
		expect(top.frontStuds).toBe(spriteBillboard(layout).offsetZ);
		// a pivot below the frame is clamped to the frame
		expect(artPieceTop({ ...layout, pivot: { x: 20, y: 90 } }).upStuds).toBeCloseTo((60 / 48) * S, 9);
	});

	it("a placeholder box's top face is h cos(pitch) up and h sin(pitch) + half its footprint toward the camera", () => {
		const p = degToRad(CAMERA_PITCH_DEG);
		const top = boxPieceTop([2, 2.5, 3]);
		expect(top.upStuds).toBeCloseTo(2.5 * math.cos(p), 9);
		expect(top.frontStuds).toBeCloseTo(2.5 * math.sin(p) + 1.5, 9);
	});

	it("centres the glint on the piece's top, in front of it, at the art's size x glintScale", () => {
		const glint = { frameW: 16, frameH: 16, pivot: { x: 8, y: 8 }, pixelsPerTile: 32 };
		const b = lootGlintBillboard({ upStuds: 2, frontStuds: 0.5 }, glint);
		expect(b.w).toBeCloseTo((16 / 32) * S * V.glintScale, 9);
		expect(b.h).toBeCloseTo(b.w, 9);
		expect(b.offsetX).toBe(0);
		expect(b.offsetY).toBeCloseTo(2 * V.glintTopFraction, 9);
		expect(b.offsetZ).toBeCloseTo(0.5 + V.glintDepthStuds, 9);
		// inside the piece's height: its centre never above the top
		expect(b.offsetY <= 2).toBe(true);
	});

	it("ducks while a visible enemy bullet is within duckTiles of the piece (square, edge inclusive)", () => {
		const r = V.duckTiles;
		expect(lootGlintDucked(5, 5, pool([]))).toBe(false);
		expect(lootGlintDucked(5, 5, pool([[5 + r, 5 - r]]))).toBe(true);
		expect(lootGlintDucked(5, 5, pool([[5 + r + 0.01, 5]]))).toBe(false);
		expect(
			lootGlintDucked(
				5,
				5,
				pool([
					[9, 9],
					[5.2, 4.9],
				]),
			),
		).toBe(true);
		// a dead (invisible) slot never ducks it
		expect(lootGlintDucked(5, 5, pool([[5, 5]], [0]))).toBe(false);
	});
});

describe("breakable loot: the hop", () => {
	it("starts at the piece's top, rises over the straight line, lands at 0 after hopSeconds", () => {
		const from = V.hopFromTiles * S;
		expect(lootHopStuds(0, 1)).toBeCloseTo(from, 9);
		// at the middle: half the start height plus the whole rise
		expect(lootHopStuds(V.hopSeconds / 2, 1)).toBeCloseTo(from / 2 + V.hopTiles * S, 9);
		expect(lootHopStuds(V.hopSeconds, 1)).toBe(0);
		expect(lootHopStuds(V.hopSeconds + 1, 1)).toBe(0);
		// continuous into the landing: just before the end it is close to the floor
		expect(lootHopStuds(V.hopSeconds * 0.999, 1)).toBeLessThan(0.05);
		// never below the floor on the way
		for (let i = 0; i <= 20; i++) expect(lootHopStuds((V.hopSeconds * i) / 20, 1) >= 0).toBe(true);
	});

	it("is none under reduced motion or for a negative age", () => {
		expect(lootHopStuds(0.1, 0)).toBe(0);
		expect(lootHopStuds(-0.1, 1)).toBe(0);
	});

	it("a hopped drop's bob starts at the landing; a kill drop's at its age", () => {
		expect(lootSettledAgeSec(1, false)).toBe(1);
		expect(lootSettledAgeSec(0.1, true)).toBe(0);
		expect(lootSettledAgeSec(V.hopSeconds + 0.5, true)).toBeCloseTo(0.5, 9);
	});
});

describe("breakable loot: KV_LootDebug", () => {
	it("labels a piece with its boost kind (developer text)", () => {
		expect(lootDebugText(Boost.FURY)).toBe("loot: fury");
		expect(lootDebugText(Boost.AEGIS)).toBe("loot: aegis");
		expect(lootDebugText(9)).toBe("loot: 9");
	});
});

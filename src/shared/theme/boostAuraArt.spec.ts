// Boost aura art (docs/BOOST_ART.md BAD3): an `fx.boost.aura.<kind>` sprite set may carry its art per stack rank
// (`ringPx`, `play` + `rank.<r>` loops, the kind's own role as its tint), held to boostAuraArt.ts' rules (folded into
// validateManifest; aura IDs only); read with ThemeCore.fx / ThemePack.fx `ranks`. The placeholder pack is unchanged
// (no aura entry: the Neon discs).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOOST_AURA_ART,
	boostAuraArtProblems,
	boostAuraKindOf,
	boostAuraRankAnimation,
	boostAuraRanksOf,
} from "./boostAuraArt";
import { BOOST_FX_IDS, BOOST_KINDS, FX_ANIMATION, boostAuraFxId, type FxId } from "./contract";
import { ThemeCore } from "./core";
import { ThemePack } from "./pack";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { deepClone, startsWith, type Obj } from "./util";
import { fxColorReport, validateManifest } from "./validate";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const assetsOf = (m: Obj): Obj => m.assets as Obj;
const FURY = boostAuraFxId("fury");
const quiet = () => undefined;

/** A valid aura set: 21 x 21 cells, `ranks` loops of 2 frames at 10 fps in a 42 x 84 sheet (2 x 4 cells). */
function auraSet(ranks = 4, ring: Array<number> = [4, 6, 8, 10]): Obj {
	const animations: Obj = {};
	for (let r = 0; r < ranks; r++) {
		animations[boostAuraRankAnimation(r)] = { sheet: 0, start: r * 2, frames: 2, fps: 10, loop: true };
	}
	const ringPx = new Array<number>();
	for (let r = 0; r < ranks; r++) ringPx.push(ring[r]);
	return {
		kind: "sprites",
		frameW: 21,
		frameH: 21,
		pivot: { x: 10.5, y: 10.5 },
		pixelsPerTile: 29.6,
		resample: "Pixelated",
		facings: { count: 1, zeroDeg: 0, ccw: true },
		sheets: [{ assetId: "rbxassetid://4201", w: 42, h: 84 }],
		animations,
		tint: "boost.fury",
		additive: true,
		ringPx,
	};
}

/** validateManifest's messages for asset `id`. */
function messages(m: Obj, id: string): Array<string> {
	return validateManifest(m).filter((e) => startsWith(e, `assets["${id}"]`));
}

function withAsset(id: string, def: Obj): Obj {
	const m = clone();
	assetsOf(m)[id] = def;
	return m;
}

describe("boost aura art: names", () => {
	it("rank 0 plays `play`, rank r `rank.<r>`; up to one rank per boost kind; the aura IDs map back to their kinds", () => {
		expect(boostAuraRankAnimation(0)).toBe(FX_ANIMATION);
		expect([boostAuraRankAnimation(1), boostAuraRankAnimation(3)]).toEqual(["rank.1", "rank.3"]);
		expect(BOOST_AURA_ART.maxRanks).toBe(BOOST_KINDS.size());
		for (const k of BOOST_KINDS) expect(boostAuraKindOf(boostAuraFxId(k))).toBe(k);
		expect(boostAuraKindOf("fx.boost.collect")).toBe(undefined);
		expect(boostAuraKindOf("fx.hit.light")).toBe(undefined);
	});
});

describe("boost aura art: the rules (validateManifest)", () => {
	it("a well-formed aura validates with zero problems and its tint passes the fx colour rule", () => {
		const m = withAsset(FURY, auraSet());
		expect(validateManifest(m)).toEqual([]);
		expect(boostAuraArtProblems(m)).toEqual([]);
		const tint = fxColorReport(m).filter((e) => e.subject === FURY);
		expect(tint.size() > 0).toBe(true);
		for (const e of tint) expect([e.against, e.ok]).toEqual([e.against, true]);
		// one rank is enough (the renderer draws the disc for the ranks past it)
		expect(messages(withAsset(FURY, auraSet(1)), FURY)).toEqual([]);
	});

	it("needs ringPx: 1..maxRanks positive numbers, increasing", () => {
		const bad: Array<unknown> = [undefined, "4", [], [0, 6, 8, 10], [4, 4, 8, 10], [4, 6, 8, 10, 12]];
		for (const ringPx of bad) {
			const def = auraSet();
			def.ringPx = ringPx;
			const msgs = messages(withAsset(FURY, def), FURY);
			expect([ringPx, msgs.size() > 0 && msgs.some((e) => startsWith(e, `assets["${FURY}"].ringPx`))]).toEqual([
				ringPx,
				true,
			]);
		}
	});

	it("one loop per ring: a missing rank.<r>, a rank.<r> past ringPx, a one-shot rank", () => {
		const missing = auraSet();
		(missing.animations as Obj)["rank.2"] = undefined;
		expect(
			messages(withAsset(FURY, missing), FURY).some((e) => e.find("missing rank.2", 1, true)[0] !== undefined),
		).toBe(true);
		const extra = auraSet(2);
		(extra.animations as Obj)["rank.3"] = { sheet: 0, start: 6, frames: 2, fps: 10, loop: true };
		expect(
			messages(withAsset(FURY, extra), FURY).some((e) => e.find("no ring for it", 1, true)[0] !== undefined),
		).toBe(true);
		const once = auraSet();
		((once.animations as Obj)["rank.1"] as Obj).loop = false;
		expect(
			messages(withAsset(FURY, once), FURY).some((e) => e.find("an aura loops", 1, true)[0] !== undefined),
		).toBe(true);
	});

	it("every rank's frames inside the sheet (the sprite set rule) and its ring inside the cell", () => {
		const outside = auraSet();
		((outside.animations as Obj)["rank.3"] as Obj).start = 7; // cells 7..8 of 8
		expect(messages(withAsset(FURY, outside), FURY).size() > 0).toBe(true);
		const wide = auraSet(4, [4, 6, 8, 11]); // 11 > 10.5 from the pivot to the edge
		expect(
			messages(withAsset(FURY, wide), FURY).some((e) => e.find("reaches past", 1, true)[0] !== undefined),
		).toBe(true);
	});

	it("is tinted by its kind's own role", () => {
		for (const tint of [undefined, "boost.aegis", "uiAccent"]) {
			const def = auraSet();
			def.tint = tint;
			expect([
				tint,
				messages(withAsset(FURY, def), FURY).some((e) => startsWith(e, `assets["${FURY}"].tint`)),
			]).toEqual([tint, true]);
		}
	});

	it("ringPx and rank.* are refused on every other fx ID", () => {
		const def = auraSet();
		def.tint = "uiAccent";
		for (const id of ["fx.hit.light", "fx.boost.collect"]) {
			const msgs = messages(withAsset(id, def), id);
			expect([id, msgs.some((e) => startsWith(e, `assets["${id}"].ringPx`))]).toEqual([id, true]);
			const rankMsg = (e: string) =>
				e.find("per-rank animations", 1, true)[0] !== undefined && e.find("rank.1", 1, true)[0] !== undefined;
			expect([id, msgs.some(rankMsg)]).toEqual([id, true]);
		}
	});
});

describe("boost aura art: the runtime (ThemeCore.fx / ThemePack.fx ranks)", () => {
	it("reads every rank's loop and ring; frames address start + f of each rank", () => {
		const pack = new ThemePack(withAsset(FURY, auraSet()) as never, { warn: quiet });
		const fx = pack.fx(FURY);
		expect(fx).never.toBe(undefined);
		const ranks = fx!.ranks!;
		expect(ranks.size()).toBe(4);
		for (let r = 0; r < 4; r++) {
			expect([ranks[r].frames, ranks[r].fps, ranks[r].ringPx]).toEqual([2, 10, [4, 6, 8, 10][r]]);
			for (let f = 0; f < 3; f++) {
				const c = r * 2 + (f % 2);
				const frame = ranks[r].frame(f);
				expect([r, f, frame.offset.X, frame.offset.Y, frame.size.X]).toEqual([
					r,
					f,
					(c % 2) * 21,
					math.floor(c / 2) * 21,
					21,
				]);
			}
		}
		expect(boostAuraRanksOf(FURY, auraSet())).toEqual([
			{ animation: "play", ringPx: 4 },
			{ animation: "rank.1", ringPx: 6 },
			{ animation: "rank.2", ringPx: 8 },
			{ animation: "rank.3", ringPx: 10 },
		]);
		expect(boostAuraRanksOf("fx.hit.light", auraSet())).toBe(undefined);
	});

	it("a malformed aura warns once and has no ranks (the renderer draws its disc); other effects have none", () => {
		const def = auraSet();
		def.tint = "boost.aegis";
		const warnings = new Array<string>();
		const core = new ThemeCore(withAsset(FURY, def) as never, { warn: (msg) => warnings.push(msg) });
		const art = core.fx(FURY);
		expect(art).never.toBe(undefined);
		expect(art!.ranks).toBe(undefined);
		core.fx(FURY);
		expect(warnings.filter((w) => w.find("boost aura", 1, true)[0] !== undefined).size()).toBe(1);
	});

	it("the placeholder pack is unchanged: no aura entry, no effect", () => {
		for (const id of BOOST_FX_IDS) expect((PLACEHOLDER_MANIFEST.assets as Obj)[id]).toBe(undefined);
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		for (const k of BOOST_KINDS) expect(pack.fx(boostAuraFxId(k) as FxId)).toBe(undefined);
	});
});

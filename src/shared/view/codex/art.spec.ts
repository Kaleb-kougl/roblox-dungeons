// A Codex entry's tile art (claude/codex-plan.md CX7 codexTileArt): build items reuse the items row's cells (icon art
// when the pack has every image, else labels), evolutions wear the evolved frame, boosts their icon or label, champions
// a ring in their colour, enemies and bosses a still frame of their idle sprite facing the camera (a silhouette while
// unknown), the placeholder pack labels and the help glyph.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CODEX_CATALOG } from "shared/codex";
import { PLACEHOLDER_MANIFEST, ThemePack, boonIconId, boostIconId, duoIconId } from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import {
	CODEX_ART,
	codexSpriteId,
	codexStillFrame,
	codexTileArt,
	type CodexArtPack,
	type CodexSpriteFrame,
	type CodexSpriteSource,
} from ".";

const quiet = { warn: () => undefined };

function packOf(theme: ThemePack): CodexArtPack {
	return {
		has(id) {
			return theme.image(id) !== undefined;
		},
		sprites(id) {
			return theme.sprites(id)?.layout;
		},
	};
}

const placeholder = packOf(new ThemePack(PLACEHOLDER_MANIFEST, quiet));
const vale = packOf(new ThemePack(VALE_MANIFEST, quiet));

/** A fake 8-facing set (zeroDeg 0, ccw): records the frame asked for. */
function fakeSet(asked: Array<[string, number, number]>): CodexSpriteSource {
	return {
		facings: { count: 8, zeroDeg: 0, ccw: true },
		resample: "Pixelated",
		has(anim) {
			return anim === "idle";
		},
		frame(anim, facing, index): CodexSpriteFrame {
			asked.push([anim, facing, index]);
			return { assetId: "fake-sheet", x: facing * 10, y: 0, w: 10, h: 12 };
		},
	};
}

describe("codex tile art", () => {
	it("the placeholder pack: labels for items, a help glyph or ??? when unknown", () => {
		const boon = codexTileArt(placeholder, "boon:volatile");
		expect(boon.kind).toBe("icons");
		if (boon.kind === "icons") {
			expect([boon.art, boon.labels, boon.fills, boon.frame]).toEqual([
				undefined,
				["boon.volatile.icon"],
				["boon.common"],
				undefined,
			]);
		}
		const evo = codexTileArt(placeholder, "evo:volatile");
		expect(evo.kind === "icons" && evo.frame).toBe("boon.evolved");
		// A duo without its own icon: its two boons joined.
		const duo = codexTileArt(placeholder, "duo:chainReaction");
		expect(duo.kind === "icons" && duo.labels).toEqual(["boon.volatile.icon", "boon.chainSpark.icon"]);
		const boost = codexTileArt(placeholder, "boost:fury");
		expect(boost.kind === "icons" && [boost.art, boost.labels, boost.fills]).toEqual([
			undefined,
			["boost.fury.icon"],
			["boost.fury"],
		]);
		expect(codexTileArt(placeholder, "relic:hourglass").kind).toBe("icons");
		expect(codexTileArt(placeholder, "curse:thirst").kind).toBe("icons");
		expect(codexTileArt(placeholder, "affix:swift")).toEqual({
			kind: "ring",
			role: "affix.swift",
			labelKey: "affix.swift.name",
		});
		// No sprite set: the name as a label (found / seen), the glyph slot when unknown.
		expect(codexTileArt(placeholder, "enemy:swarmer")).toEqual({
			kind: "label",
			key: "enemy.swarmer.name",
			role: "uiText",
		});
		expect(codexTileArt(placeholder, "boss:act1", "seen")).toEqual({
			kind: "label",
			key: "boss.act1.name",
			role: "uiHealth",
		});
		const unknown = codexTileArt(placeholder, "enemy:swarmer", "unknown");
		expect(unknown.kind).toBe("unknown");
		expect(codexTileArt(placeholder, "boon:volatile", "unknown").kind).toBe("unknown");
		expect(codexTileArt(placeholder, "nope").kind).toBe("unknown");
	});

	it("icon art where the pack has every image (the vale sheets)", () => {
		const boon = codexTileArt(vale, "boon:volatile");
		if (vale.has(boonIconId("boon.volatile")!)) {
			expect(boon.kind === "icons" && boon.art).toEqual([boonIconId("boon.volatile")]);
		}
		const own = duoIconId("duo.chainReaction");
		if (own !== undefined && vale.has(own)) {
			const duo = codexTileArt(vale, "duo:chainReaction");
			expect(duo.kind === "icons" && duo.art).toEqual([own]);
		}
		if (vale.has(boostIconId("fury"))) {
			const boost = codexTileArt(vale, "boost:fury");
			expect(boost.kind === "icons" && boost.art).toEqual([boostIconId("fury")]);
		}
	});

	it("the still frame: idle, frame 0, the facing pointing at the camera (screen down)", () => {
		const asked: Array<[string, number, number]> = [];
		const frame = codexStillFrame(fakeSet(asked));
		// 8 facings from 0 degrees counter-clockwise: 270 is facing 6.
		expect(asked).toEqual([[CODEX_ART.stillAnim, 6, 0]]);
		expect([frame.x, frame.w, frame.h]).toEqual([60, 10, 12]);
		const pack: CodexArtPack = {
			has() {
				return false;
			},
			sprites() {
				return fakeSet([]);
			},
		};
		expect(codexTileArt(pack, "enemy:imp")).toEqual({
			kind: "sprite",
			frame: { assetId: "fake-sheet", x: 60, y: 0, w: 10, h: 12 },
			pixelated: true,
			silhouette: false,
		});
		const dark = codexTileArt(pack, "boss:demonlord", "unknown");
		expect(dark.kind === "sprite" && dark.silhouette).toBe(true);
	});

	it("every enemy and boss names a registered sprite id; the vale pack has a still for each it draws", () => {
		for (const e of CODEX_CATALOG) {
			if (e.artRef.kind !== "actor") continue;
			const id = codexSpriteId(e.artRef.archetype);
			expect([e.id, id !== undefined]).toEqual([e.id, true]);
			const art = codexTileArt(vale, e);
			if (art.kind === "sprite") {
				expect([e.id, art.frame.w > 0 && art.frame.h > 0, typeIs(art.frame.assetId, "string")]).toEqual([
					e.id,
					true,
					true,
				]);
			} else {
				expect([e.id, art.kind]).toEqual([e.id, "label"]);
			}
		}
	});
});

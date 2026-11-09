// The stage audit (docs/STAGE_ASSETS.md SA11) and the merged prefetch manifest (SA7): every watched name is a ThemePack
// method, how each call names its id, one floor's recording (first use once, content filter, no manifest = no report,
// closed after end), and stageMergedAssets (input order, each id once, every first-floor biome reachable).
import { describe, expect, it } from "@rbxts/jest-globals";
import { ThemePack } from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import {
	NO_STAGE_FEATURES,
	STAGE_AUDIT,
	STAGE_CHARACTERS,
	StageAuditLog,
	stageAssetsInOrder,
	stageAuditIdsOf,
	stageMergedAssets,
	type StageAssetInput,
} from "shared/view";

const quiet = () => undefined;
const vale = new ThemePack(VALE_MANIFEST, { warn: quiet });

function input(biome: number): StageAssetInput {
	return {
		world: "endless",
		floor: 1,
		biome,
		characters: STAGE_CHARACTERS,
		actorKinds: ["swarmer"],
		features: NO_STAGE_FEATURES,
		runStart: true,
	};
}

describe("STAGE_AUDIT", () => {
	it("watches only ThemePack methods, each once", () => {
		const seen = new Set<string>();
		const fields = vale as unknown as Record<string, unknown>;
		for (const [method] of STAGE_AUDIT.methods) {
			expect([method, typeIs(fields[method], "function")]).toEqual([method, true]);
			expect(seen.has(method)).toBe(false);
			seen.add(method);
		}
	});

	it("names the id by argument, by result or as a biome entry", () => {
		expect(stageAuditIdsOf("arg", "enemy.imp", undefined)).toBe("enemy.imp");
		expect(stageAuditIdsOf("arg", 3, undefined)).toBe(undefined);
		expect(stageAuditIdsOf("result", 0, { id: "breakable.barrel" })).toBe("breakable.barrel");
		expect(stageAuditIdsOf("result", 0, undefined)).toBe(undefined);
		expect(stageAuditIdsOf("biome", "biome.2", undefined)).toBe("biome:biome.2");
	});
});

describe("StageAuditLog", () => {
	it("reports the used ids with content its manifest lacks, sorted, each once", () => {
		const log = new StageAuditLog();
		log.record("enemy.imp"); // closed: ignored
		log.begin(4);
		expect(log.isOpen()).toBe(true);
		log.record("enemy.slime");
		log.record("enemy.swarmer");
		log.record("enemy.slime");
		log.record("ui.unused"); // no content: never a miss
		log.record("bullet.enemy.small");
		log.setManifest({ must: ["enemy.swarmer"], soon: ["bullet.enemy.small"] });
		const r = log.close((id) => id !== "ui.unused");
		expect(r).toEqual({ floor: 4, used: 3, listed: 2, misses: ["enemy.slime"] });
		expect(log.isOpen()).toBe(false);
		expect(log.close(() => true)).toBe(undefined);
	});

	it("a floor whose manifest never came reports nothing; a begin starts afresh", () => {
		const log = new StageAuditLog();
		log.begin(2);
		log.record("enemy.imp");
		expect(log.close(() => true)).toBe(undefined);
		log.begin(3);
		log.setManifest({ must: [], soon: [] });
		expect(log.close(() => true)).toEqual({ floor: 3, used: 0, listed: 0, misses: [] });
	});
});

describe("stageMergedAssets", () => {
	it("keeps the first input's order, then adds each later input's new ids, each once", () => {
		const first = stageAssetsInOrder(vale, input(1));
		const merged = stageMergedAssets(vale, [input(1), input(2), input(3), input(4), input(5)]);
		for (let i = 0; i < first.size(); i++) expect(merged.must[i]).toBe(first[i]);
		const seen = new Set<string>();
		for (const id of merged.must) {
			expect(seen.has(id)).toBe(false);
			seen.add(id);
		}
		for (let b = 2; b <= 5; b++) {
			for (const id of stageAssetsInOrder(vale, input(b))) expect([b, id, seen.has(id)]).toEqual([b, id, true]);
		}
		expect(merged.must.size()).toBeGreaterThan(first.size()); // the other biomes add their tiles and decor
		expect(merged.soon).toEqual([]);
	});
});

// The stage manifest's coverage guard (docs/STAGE_ASSETS.md SA2): every logical id the vale pack has content for (and
// every biome) is reachable from some stage manifest (over every world with extras, biomes 1-5, every registered
// archetype, every boss, every feature, every character, a run start) or listed in STAGE_ASSETS.notStaged. A new asset
// no manifest knows about fails here, so new art can never fall silently outside the per-floor guarantee.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ThemePack } from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import { archetypeIds } from "shared/sim";
import {
	ALL_STAGE_FEATURES,
	PRELOAD_BIOME_PREFIX,
	PRELOAD_BOSS_IDS,
	STAGE_ASSETS,
	STAGE_CHARACTERS,
	stageAssets,
	stageEntriesMatch,
	type PreloadSource,
	type StageAssetsConfig,
} from "shared/view";

const quiet = () => undefined;

/** The union of every stage manifest of `pack` (must and soon). */
function reachable(pack: PreloadSource, cfg: StageAssetsConfig = STAGE_ASSETS): Set<string> {
	const worlds = ["endless"];
	for (const [w] of STAGE_ASSETS.worlds as unknown as ReadonlyMap<string, unknown>) worlds.push(w);
	const bosses = new Array<string>();
	for (const [k] of PRELOAD_BOSS_IDS as unknown as ReadonlyMap<string, string>) bosses.push(k);
	bosses.sort();
	const out = new Set<string>();
	for (const world of worlds) {
		for (let biome = 1; biome <= 5; biome++) {
			// "" stands for no boss (an array cannot hold undefined in Luau)
			for (const boss of ["", ...bosses]) {
				const bossKind = boss !== "" ? boss : undefined;
				const set = stageAssets(
					pack,
					{
						world,
						floor: 1,
						biome,
						characters: STAGE_CHARACTERS,
						actorKinds: archetypeIds(),
						bossKind,
						features: ALL_STAGE_FEATURES,
						runStart: true,
					},
					cfg,
				);
				for (const id of set.must) out.add(id);
				for (const id of set.soon) out.add(id);
			}
		}
	}
	return out;
}

describe("stage manifest coverage (docs/STAGE_ASSETS.md SA2)", () => {
	it("vale: every logical id and biome is in some stage manifest or notStaged", () => {
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		const union = reachable(pack);
		const missing = new Array<string>();
		for (const id of pack.assetIdList()) {
			if (!union.has(id) && !stageEntriesMatch(STAGE_ASSETS.notStaged, id)) missing.push(id);
		}
		for (const b of pack.biomeKeys()) {
			const id = `${PRELOAD_BIOME_PREFIX}${b}`;
			if (pack.biomeContentIds(b).size() > 0 && !union.has(id)) missing.push(id);
		}
		expect(missing).toEqual([]);
		expect(pack.assetIdList().size()).toBeGreaterThan(0);
	});

	it("vale: notStaged ids are in no stage manifest (menu only)", () => {
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		const union = reachable(pack);
		const staged = new Array<string>();
		for (const id of union) if (stageEntriesMatch(STAGE_ASSETS.notStaged, id)) staged.push(id);
		expect(staged).toEqual([]);
	});

	it("the guard is live: a table without the altar's entry leaves pact.altar out", () => {
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		const cfg = { ...STAGE_ASSETS, features: { ...STAGE_ASSETS.features, pacts: [] } };
		expect(reachable(pack).has("pact.altar")).toBe(true);
		expect(reachable(pack, cfg).has("pact.altar")).toBe(false);
	});
});

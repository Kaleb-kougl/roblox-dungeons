/**
 * Theme groups of the stage manifest (docs/STAGE_ASSETS.md SA1): game things -> the pack's logical ids, read through
 * the preload surface (PreloadSource: ThemePack satisfies it). Pure, no Roblox APIs. Every group lists only ids the pack
 * has content for (`assetIdList`; a biome as `biome:<key>` when `biomeContentIds` is not empty), so a placeholder
 * pack's groups are all empty. Tunables: STAGE_ASSETS in stageAssetsConfig.ts.
 *
 *   actor kind  the archetype's own `data.spriteId` (the id ActorRenderController draws: turret.sniper -> enemy.sniper,
 *               slime.small -> enemy.slime, boss.act1 -> boss.act1); an unregistered kind: PRELOAD_BOSS_IDS, else
 *               `enemy.<kind>`
 *   character   the class id itself (class.vanguard)
 *   biome n     `biome:biome.<n>` (its tiles, PreloadSource.biomeContentIds), `tile.biome.<n>.*`, every decor id with a
 *               `b<n>` segment (decor.delve.b<n>.*, decor.void.b<n>.*, decor.fx.ambient.b<n>); its beds are
 *               stageBiomeAudio: `music.biome.<n>` and `amb.b<n>` (shared/view/audio biomeMusic / biomeAmbience)
 *   free decor  decor ids with no biome segment that no feature claims (decor.fx.torch, .flame, .glow, .zone)
 *   feature     STAGE_ASSETS.features[name]
 */
import { AMBIENCE_IDS, BIOMES } from "shared/theme";
import { archetypeAt, archetypeIndex, hasArchetype } from "shared/sim";
import type { PreloadSource } from "./preload";
import { PRELOAD_BIOME_PREFIX, PRELOAD_BOSS_IDS } from "./preloadConfig";
import { STAGE_ASSETS, STAGE_FEATURES, type StageAssetsConfig, type StageFeatureName } from "./stageAssetsConfig";

/** What every group lookup reads of a pack: its listed ids (sorted, biomes last) and a membership test. */
interface StageIdIndex {
	readonly ids: ReadonlyArray<string>;
	readonly has: ReadonlySet<string>;
}

const indexCache = new WeakMap<PreloadSource, StageIdIndex>();

function startsWith(s: string, prefix: string): boolean {
	return s.sub(1, prefix.size()) === prefix;
}

/** The pack's ids with content: assetIdList (sorted), then `biome:<key>` for each biome that draws something. */
function indexOf(pack: PreloadSource): StageIdIndex {
	const hit = indexCache.get(pack);
	if (hit !== undefined) return hit;
	const ids = [...pack.assetIdList()];
	for (const b of pack.biomeKeys()) {
		if (pack.biomeContentIds(b).size() > 0) ids.push(`${PRELOAD_BIOME_PREFIX}${b}`);
	}
	const index: StageIdIndex = { ids, has: new ReadonlySet(ids) };
	indexCache.set(pack, index);
	return index;
}

/** Does group entry `entry` match id `id`? An entry ending in "." is a prefix; any other entry is one exact id. */
export function stageEntryMatches(entry: string, id: string): boolean {
	if (entry.sub(-1) === ".") return startsWith(id, entry);
	return id === entry;
}

/** Does any of `entries` match `id`? */
export function stageEntriesMatch(entries: ReadonlyArray<string>, id: string): boolean {
	for (const e of entries) if (stageEntryMatches(e, id)) return true;
	return false;
}

/** Appends `id` to `out` unless `seen` has it. */
function addOnce(id: string, seen: Set<string>, out: Array<string>): void {
	if (seen.has(id)) return;
	seen.add(id);
	out.push(id);
}

/**
 * The pack's ids matching `entries`, entry by entry (an exact entry: that id if the pack has it; a prefix: every match,
 * sorted), each once.
 */
export function stageExpand(pack: PreloadSource, entries: ReadonlyArray<string>): Array<string> {
	const index = indexOf(pack);
	const seen = new Set<string>();
	const out = new Array<string>();
	for (const e of entries) {
		if (e.sub(-1) !== ".") {
			if (index.has.has(e)) addOnce(e, seen, out);
			continue;
		}
		for (const id of index.ids) if (startsWith(id, e)) addOnce(id, seen, out);
	}
	return out;
}

/** Does the pack have content for logical id (or `biome:<key>`) `id`? */
export function stageHasId(pack: PreloadSource, id: string): boolean {
	return indexOf(pack).has.has(id);
}

// --- actors and characters ------------------------------------------------------------------------------------------

/**
 * The logical id an actor kind (an archetype id: "swarmer", "turret.sniper", "boss.act1") draws: the registered
 * archetype's `data.spriteId`, exactly what ActorRenderController reads; for an unregistered kind, PRELOAD_BOSS_IDS,
 * else `enemy.<kind>`.
 */
export function stageActorVisualId(kind: string): string {
	if (hasArchetype(kind)) return archetypeAt(archetypeIndex(kind)).data.spriteId;
	return PRELOAD_BOSS_IDS[kind] ?? `enemy.${kind}`;
}

/**
 * `kinds` with their runtime children (STAGE_ASSETS.children) to a fixed point: each kind, then its children (depth
 * first), each once, in that order.
 */
export function stageKindsWithChildren(
	kinds: ReadonlyArray<string>,
	cfg: StageAssetsConfig = STAGE_ASSETS,
): Array<string> {
	const seen = new Set<string>();
	const out = new Array<string>();
	const visit = (kind: string): void => {
		if (seen.has(kind)) return;
		seen.add(kind);
		out.push(kind);
		const children = cfg.children[kind];
		if (children !== undefined) for (const c of children) visit(c);
	};
	for (const k of kinds) visit(k);
	return out;
}

/** The pack ids of actor kinds `kinds` and their runtime children, in order, each once. */
export function stageActorGroup(
	pack: PreloadSource,
	kinds: ReadonlyArray<string>,
	cfg: StageAssetsConfig = STAGE_ASSETS,
): Array<string> {
	const seen = new Set<string>();
	const out = new Array<string>();
	for (const kind of stageKindsWithChildren(kinds, cfg)) {
		const id = stageActorVisualId(kind);
		if (stageHasId(pack, id)) addOnce(id, seen, out);
	}
	return out;
}

/** The pack ids of the characters (class logical ids: "class.vanguard"), in order, each once. */
export function stageCharacterGroup(pack: PreloadSource, characters: ReadonlyArray<string>): Array<string> {
	return stageExpand(pack, characters);
}

// --- biomes ---------------------------------------------------------------------------------------------------------

/** The theme's biome key of biome index 1..5 (BIOMES order: "biome.1" ..), or undefined. */
export function stageBiomeKey(biome: number): string | undefined {
	return biome >= 1 && biome % 1 === 0 ? BIOMES[biome - 1]?.id : undefined;
}

/** The biome index (n of a `b<n>` segment) a decor id belongs to, or 0 for a biome-free one. */
export function stageDecorBiome(id: string, cfg: StageAssetsConfig = STAGE_ASSETS): number {
	if (!startsWith(id, cfg.decorPrefix)) return 0;
	for (const seg of id.split(".")) {
		const [n] = seg.match("^b(%d+)$");
		if (n !== undefined) return tonumber(n as string) ?? 0;
	}
	return 0;
}

/**
 * The art of biome `biome` (1..5): its own content (`biome:<key>`), its tiles (`tile.<key>.*`) and its decor (every
 * decor id with a `b<n>` segment). Empty for 0 or an unknown biome.
 */
export function stageBiomeGroup(
	pack: PreloadSource,
	biome: number,
	cfg: StageAssetsConfig = STAGE_ASSETS,
): Array<string> {
	const key = stageBiomeKey(biome);
	if (key === undefined) return [];
	const out = stageExpand(pack, [`${PRELOAD_BIOME_PREFIX}${key}`, `${cfg.tilePrefix}${key}.`]);
	for (const id of indexOf(pack).ids) {
		if (stageDecorBiome(id, cfg) === biome) out.push(id);
	}
	return out;
}

/** The beds of biome `biome` (1..5): its music (`music.biome.<n>`) and ambience (`amb.b<n>`). Empty for 0. */
export function stageBiomeAudio(
	pack: PreloadSource,
	biome: number,
	cfg: StageAssetsConfig = STAGE_ASSETS,
): Array<string> {
	if (stageBiomeKey(biome) === undefined) return [];
	const amb = AMBIENCE_IDS[biome - 1];
	const entries = [`${cfg.biomeMusicPrefix}${biome}`];
	if (amb !== undefined) entries.push(amb);
	return stageExpand(pack, entries);
}

/** Decor ids with no biome segment that no feature claims (torches, flames, glows: on every floor). */
export function stageFreeDecorGroup(pack: PreloadSource, cfg: StageAssetsConfig = STAGE_ASSETS): Array<string> {
	const out = new Array<string>();
	for (const id of indexOf(pack).ids) {
		if (!startsWith(id, cfg.decorPrefix) || stageDecorBiome(id, cfg) !== 0) continue;
		let claimed = false;
		for (const f of STAGE_FEATURES) {
			if (stageEntriesMatch(cfg.features[f], id)) {
				claimed = true;
				break;
			}
		}
		if (!claimed) out.push(id);
	}
	return out;
}

// --- features -------------------------------------------------------------------------------------------------------

/** The pack ids of feature `feature` (STAGE_ASSETS.features). */
export function stageFeatureGroup(
	pack: PreloadSource,
	feature: StageFeatureName,
	cfg: StageAssetsConfig = STAGE_ASSETS,
): Array<string> {
	return stageExpand(pack, cfg.features[feature]);
}

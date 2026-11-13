/**
 * The stage asset manifest (docs/STAGE_ASSETS.md SA2): every logical id a floor can show or play, from a description of
 * the floor (StageAssetInput: exact from a forged floor or a forecast, shared/run stageInput.ts), in front-lane order.
 * Pure, no Roblox APIs; the groups are stageGroups.ts, the tables STAGE_ASSETS (stageAssetsConfig.ts).
 *
 * Order (revision 2: what is on screen soonest first): the party's characters, every bullet look, the floor's actor
 * kinds in input order (nearest room first for an exact input) each followed by its runtime children, then the boss,
 * the biome (its tiles and decor, then biome-free decor), the features, the run kit (a run start only), and last the
 * audio (the world's tracks, the biome's music and bed, the boss track). Each id once, at its first group. Ids matching
 * STAGE_ASSETS.soon go to `soon`, the rest to `must`. A pack without an id yields nothing for it, so a placeholder
 * pack's manifest is empty.
 */
import type { ContentRef } from "shared/theme";
import type { PreloadSource } from "./preload";
import { PRELOAD_BIOME_PREFIX } from "./preloadConfig";
import {
	STAGE_ASSETS,
	STAGE_FEATURES,
	STAGE_GROUPS,
	type StageAssetsConfig,
	type StageFeatureName,
	type StageGroupName,
} from "./stageAssetsConfig";
import {
	stageActorGroup,
	stageBiomeAudio,
	stageBiomeGroup,
	stageCharacterGroup,
	stageEntriesMatch,
	stageExpand,
	stageFeatureGroup,
	stageFreeDecorGroup,
} from "./stageGroups";

/** Which features a floor has (each adds STAGE_ASSETS.features[name]). */
export type StageFeatures = { readonly [K in StageFeatureName]: boolean };

/** Every feature off. */
export const NO_STAGE_FEATURES: StageFeatures = {
	breakables: false,
	breakableLoot: false,
	pellets: false,
	powerPellet: false,
	vault: false,
	pedestals: false,
	pacts: false,
	golden: false,
	secret: false,
};

/** Every feature on (a forecast: the features are small, so a guess includes them all). */
export const ALL_STAGE_FEATURES: StageFeatures = {
	breakables: true,
	breakableLoot: true,
	pellets: true,
	powerPellet: true,
	vault: true,
	pedestals: true,
	pacts: true,
	golden: true,
	secret: true,
};

/** One stage (a run start or a floor change) as the manifest sees it. */
export interface StageAssetInput {
	/** The world registry kind (shared/run worlds.ts: endless, daily, dev, tutorial, game, ...). */
	readonly world: string;
	/** The floor number (1 for a single-floor world). Informational (logs). */
	readonly floor: number;
	/** The floor's biome, 1..5 (theme BIOMES order); 0: none (greybox). */
	readonly biome: number;
	/** The present players' character ids (class logical ids: class.vanguard, ...), in player order. */
	readonly characters: ReadonlyArray<string>;
	/**
	 * Archetype ids the floor spawns (planned room spawns and initial spawns, the boss among them), each once, in the
	 * order they will be seen (exact inputs: nearest the player's spawn first). Runtime children are added by the
	 * manifest (STAGE_ASSETS.children).
	 */
	readonly actorKinds: ReadonlyArray<string>;
	/** The floor's boss archetype id, if any (its track joins the audio; its art is an actor kind). */
	readonly bossKind?: string;
	readonly features: StageFeatures;
	/** A run start: the run kit joins (STAGE_ASSETS.runKit). */
	readonly runStart: boolean;
}

/** A stage's logical ids (and `biome:<key>` entries), in front-lane order. */
export interface StageAssetSet {
	/** What the stage waits for / downloads first. */
	readonly must: ReadonlyArray<string>;
	/** Queued in the `next` lane, never waited for (SAD5). */
	readonly soon: ReadonlyArray<string>;
}

/** One group of a stage manifest, in order. */
export interface StageAssetGroup {
	readonly group: StageGroupName;
	readonly ids: ReadonlyArray<string>;
}

/**
 * The stage's groups in STAGE_GROUPS order, each id once (at its first group; a group may come out empty). The front
 * lane's order (characters, bullets, the floor's kinds, then the rest) is this order.
 */
export function stageAssetGroups(
	pack: PreloadSource,
	input: StageAssetInput,
	cfg: StageAssetsConfig = STAGE_ASSETS,
): Array<StageAssetGroup> {
	const extras = cfg.worlds[input.world];
	const kinds = [...input.actorKinds];
	if (extras !== undefined) for (const k of extras.actors) kinds.push(k);
	if (input.bossKind !== undefined) kinds.push(input.bossKind);

	const features = new Array<string>();
	for (const f of STAGE_FEATURES) {
		if (input.features[f]) for (const id of stageFeatureGroup(pack, f, cfg)) features.push(id);
	}
	const biome = stageBiomeGroup(pack, input.biome, cfg);
	if (input.biome !== 0) for (const id of stageFreeDecorGroup(pack, cfg)) biome.push(id);

	const audioEntries = new Array<string>();
	if (extras !== undefined) for (const e of extras.audio) audioEntries.push(e);
	const audio = stageExpand(pack, audioEntries);
	for (const id of stageBiomeAudio(pack, input.biome, cfg)) audio.push(id);
	if (input.bossKind !== undefined) for (const id of stageExpand(pack, cfg.bossAudio)) audio.push(id);

	const raw: Record<StageGroupName, ReadonlyArray<string>> = {
		characters: stageCharacterGroup(pack, input.characters),
		bullets: stageExpand(pack, cfg.bullets),
		actors: stageActorGroup(pack, kinds, cfg),
		biome,
		features,
		runKit: input.runStart ? stageExpand(pack, cfg.runKit) : [],
		audio,
	};
	const seen = new Set<string>();
	const out = new Array<StageAssetGroup>();
	for (const group of STAGE_GROUPS) {
		const ids = new Array<string>();
		for (const id of raw[group]) {
			if (seen.has(id)) continue;
			seen.add(id);
			ids.push(id);
		}
		out.push({ group, ids });
	}
	return out;
}

/** Every id of the stage's groups, flattened in front-lane order (must and soon together). */
export function stageAssetsInOrder(
	pack: PreloadSource,
	input: StageAssetInput,
	cfg: StageAssetsConfig = STAGE_ASSETS,
): Array<string> {
	const out = new Array<string>();
	for (const g of stageAssetGroups(pack, input, cfg)) for (const id of g.ids) out.push(id);
	return out;
}

/** The stage's manifest: stageAssetsInOrder split by STAGE_ASSETS.soon (matching ids to `soon`, the rest `must`). */
export function stageAssets(
	pack: PreloadSource,
	input: StageAssetInput,
	cfg: StageAssetsConfig = STAGE_ASSETS,
): StageAssetSet {
	const must = new Array<string>();
	const soon = new Array<string>();
	for (const id of stageAssetsInOrder(pack, input, cfg)) {
		(stageEntriesMatch(cfg.soon, id) ? soon : must).push(id);
	}
	return { must, soon };
}

function startsWith(s: string, prefix: string): boolean {
	return s.sub(1, prefix.size()) === prefix;
}

/** The content ids of one manifest id (a logical id, or `biome:<key>`: that biome's own content). */
function refsOf(pack: PreloadSource, id: string): ReadonlyArray<ContentRef> {
	return startsWith(id, PRELOAD_BIOME_PREFIX)
		? pack.biomeContentIds(id.sub(PRELOAD_BIOME_PREFIX.size() + 1))
		: pack.contentIds(id);
}

/**
 * The content ids to queue for a manifest: `must`'s, then `soon`'s, in the set's order, each content id once (an id
 * both share stays in `must`).
 */
export function stageContentRefs(
	pack: PreloadSource,
	set: StageAssetSet,
): { must: Array<ContentRef>; soon: Array<ContentRef> } {
	const seen = new Set<string>();
	const emit = (ids: ReadonlyArray<string>): Array<ContentRef> => {
		const out = new Array<ContentRef>();
		for (const id of ids) {
			for (const ref of refsOf(pack, id)) {
				if (seen.has(ref.contentId)) continue;
				seen.add(ref.contentId);
				out.push(ref);
			}
		}
		return out;
	};
	const must = emit(set.must);
	const soon = emit(set.soon);
	return { must, soon };
}

/**
 * The stage audit's diff (SA11, KV_StageAssetAudit): the logical ids a floor's views resolved (`usedIds`) that its
 * manifest (`manifestIds`: a StageAssetSet's must + soon) does not hold, sorted, each once.
 */
export function stageAuditMisses(manifestIds: ReadonlyArray<string>, usedIds: ReadonlyArray<string>): Array<string> {
	const listed = new Set<string>(manifestIds);
	const out = new Array<string>();
	const seen = new Set<string>();
	for (const id of usedIds) {
		if (listed.has(id) || seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	out.sort();
	return out;
}

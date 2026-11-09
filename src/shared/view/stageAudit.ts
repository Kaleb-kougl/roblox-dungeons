/**
 * The stage asset audit and prefetch helpers (docs/STAGE_ASSETS.md SA7 / SA11). Pure, no Roblox APIs.
 *
 *   STAGE_AUDIT         the ThemePack lookups the client's recording wrapper (ThemeController, under
 *                       `KV_StageAssetAudit`) watches, and how each names its logical id: by its first argument (an
 *                       id), by its result's `id` (a kind lookup: breakable, boost, ...) or as a biome entry
 *                       (`biome:<key>`, the manifest's biome content). stageAudit.spec checks every name is a ThemePack
 *                       method, so a rename fails the suite.
 *   stageAuditIdsOf     the logical ids one recorded call resolved
 *   StageAuditLog       one floor's recording: opened at the stage's cut (`begin`), its manifest set once known
 *                       (`setManifest`), every recorded id kept once in first-use order, closed at the next stage, the
 *                       run's end or an exit (`close`): the used ids with content (`hasContent`) the manifest lacks
 *                       (stageAuditMisses)
 *   stageMergedAssets   several stage inputs' manifests as one StageAssetSet in input order, each id once (the menu /
 *                       lobby prefetch of every possible first-floor biome)
 */
import type { PreloadSource } from "./preload";
import { stageAssetsInOrder, stageAuditMisses, type StageAssetInput, type StageAssetSet } from "./stageAssets";
import { STAGE_ASSETS, type StageAssetsConfig } from "./stageAssetsConfig";
import { PRELOAD_BIOME_PREFIX } from "./preloadConfig";
import { stageEntriesMatch } from "./stageGroups";

/** How a watched lookup names its logical id. */
export type StageAuditKey = "arg" | "result" | "biome";

export interface StageAuditConfig {
	/** ThemePack method name -> how its logical id is read. */
	readonly methods: ReadonlyArray<readonly [method: string, key: StageAuditKey]>;
	/** At most this many misses are printed one per line; the rest are counted on one line. */
	readonly maxMissLines: number;
}

export const STAGE_AUDIT: StageAuditConfig = {
	methods: [
		["texture", "arg"],
		["spriteSheet", "arg"],
		["image", "arg"],
		["sprites", "arg"],
		["decor", "arg"],
		["treasurePiece", "arg"],
		["sound", "arg"],
		["bullet", "arg"],
		["floorSprite", "arg"],
		["hazardSprite", "arg"],
		["fx", "arg"],
		["breakable", "result"],
		["boost", "result"],
		["pellet", "result"],
		["pactAltar", "result"],
		["ambient", "result"],
		["biome", "biome"],
	],
	maxMissLines: 40,
};

/** The logical id one recorded call resolved (undefined: nothing to record). */
export function stageAuditIdsOf(key: StageAuditKey, firstArg: unknown, result: unknown): string | undefined {
	if (key === "arg") return typeIs(firstArg, "string") ? firstArg : undefined;
	if (key === "biome") return typeIs(firstArg, "string") ? `${PRELOAD_BIOME_PREFIX}${firstArg}` : undefined;
	if (!typeIs(result, "table")) return undefined;
	const id = (result as { id?: unknown }).id;
	return typeIs(id, "string") ? id : undefined;
}

/** One closed floor of the audit. */
export interface StageAuditResult {
	readonly floor: number;
	/** Distinct ids recorded (with content). */
	readonly used: number;
	/** The manifest's id count (must + soon). */
	readonly listed: number;
	/** Used ids with content the manifest does not hold, sorted. */
	readonly misses: ReadonlyArray<string>;
}

/** One floor's recording (see the file comment). */
export class StageAuditLog {
	private openFloor = -1;
	private manifest: ReadonlyArray<string> | undefined;
	private readonly seen = new Set<string>();
	private readonly used = new Array<string>();

	/** Opens the recording for `floor` (the caller ends the previous one first: a begin drops it unreported). */
	begin(floor: number): void {
		this.openFloor = floor;
		this.manifest = undefined;
		this.seen.clear();
		this.used.clear();
	}

	isOpen(): boolean {
		return this.openFloor >= 0;
	}

	/** The open floor's manifest ids (a StageAssetSet's must + soon). */
	setManifest(set: StageAssetSet): void {
		if (!this.isOpen()) return;
		const ids = new Array<string>();
		for (const id of set.must) ids.push(id);
		for (const id of set.soon) ids.push(id);
		this.manifest = ids;
	}

	record(id: string): void {
		if (!this.isOpen() || this.seen.has(id)) return;
		this.seen.add(id);
		this.used.push(id);
	}

	/**
	 * Closes the recording. Undefined when none was open or its manifest never came (the cover was cancelled before
	 * the views were built). `hasContent`: the id has content ids in the pack (an id drawn as its placeholder in every
	 * case has nothing to download, so it is never a miss).
	 */
	close(hasContent: (id: string) => boolean): StageAuditResult | undefined {
		if (!this.isOpen()) return undefined;
		const floor = this.openFloor;
		const manifest = this.manifest;
		this.openFloor = -1;
		this.manifest = undefined;
		if (manifest === undefined) return undefined;
		const used = this.used.filter((id) => hasContent(id));
		return { floor, used: used.size(), listed: manifest.size(), misses: stageAuditMisses(manifest, used) };
	}
}

/** The manifests of `inputs`, merged in input order, each id once, split by STAGE_ASSETS.soon as stageAssets does. */
export function stageMergedAssets(
	pack: PreloadSource,
	inputs: ReadonlyArray<StageAssetInput>,
	cfg: StageAssetsConfig = STAGE_ASSETS,
): StageAssetSet {
	const seen = new Set<string>();
	const must = new Array<string>();
	const soon = new Array<string>();
	for (const input of inputs) {
		for (const id of stageAssetsInOrder(pack, input, cfg)) {
			if (seen.has(id)) continue;
			seen.add(id);
			(stageEntriesMatch(cfg.soon, id) ? soon : must).push(id);
		}
	}
	return { must, soon };
}

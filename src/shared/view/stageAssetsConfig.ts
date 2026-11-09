/**
 * Tunables of the stage asset manifest (docs/STAGE_ASSETS.md SA1 / SA2; logic in stageGroups.ts and stageAssets.ts).
 * Presentation only: nothing here reaches the sim, the lockstep wire or a hash. Roblox-port choices, no web source.
 *
 * Group entries are logical ids matched by `stageEntryMatches` (stageGroups.ts): an entry ending in "." is a prefix
 * ("sfx." matches every sfx id), any other entry is one exact id ("pellet.power"), and `biome:<key>` names a biome's
 * own content (PreloadSource.biomeContentIds).
 */
import { ACTOR_VIEW } from "./config";

/** The groups of a stage manifest, in front-lane order (docs/STAGE_ASSETS.md revision 2: what is on screen soonest). */
export const STAGE_GROUPS = ["characters", "bullets", "actors", "biome", "features", "runKit", "audio"] as const;
export type StageGroupName = (typeof STAGE_GROUPS)[number];

/** The floor features with their own art (StageFeatures' keys), in manifest order. */
export const STAGE_FEATURES = [
	"breakables",
	"breakableLoot",
	"pellets",
	"powerPellet",
	"vault",
	"pedestals",
	"pacts",
	"golden",
] as const;
export type StageFeatureName = (typeof STAGE_FEATURES)[number];

/** A world's own extras (archetype ids it always shows, sounds it always plays). */
export interface StageWorldExtras {
	/** Archetype ids (mapped like any actor kind: stageActorVisualId). */
	readonly actors: ReadonlyArray<string>;
	/** Audio entries (logical ids or prefixes). */
	readonly audio: ReadonlyArray<string>;
}

export interface StageAssetsConfig {
	/** Every bullet look (the second group: bullets fly from the first second of a floor). */
	readonly bullets: ReadonlyArray<string>;
	/**
	 * The run kit, added on a run start only (`StageAssetInput.runStart`): the in-run UI (HUD, draft, icons, pips, the
	 * pause overlay's panels), every sound effect, bullet, sprite effect, boost, breakable and pellet. Small and used
	 * everywhere; a floor change finds it already loaded.
	 */
	readonly runKit: ReadonlyArray<string>;
	/**
	 * Runtime spawns not in a floor's planned spawns (archetype id -> the archetype ids it can spawn), expanded to a
	 * fixed point: the Summoner's swarmers, the Ooze's slimelets, each boss's swarmer adds. The Goldling is a feature.
	 */
	readonly children: Readonly<Record<string, ReadonlyArray<string>>>;
	/** Feature -> its entries. */
	readonly features: Readonly<Record<StageFeatureName, ReadonlyArray<string>>>;
	/** World kind (shared/run worlds.ts) -> its extras. A world not listed has none. */
	readonly worlds: Readonly<Record<string, StageWorldExtras>>;
	/** A floor with a boss: these audio entries join (its art comes with the boss's actor kind). */
	readonly bossAudio: ReadonlyArray<string>;
	/** Biome music: this prefix + the biome index ("music.biome.<n>", shared/view/audio biomeMusic). */
	readonly biomeMusicPrefix: string;
	/** A biome's tiles: this prefix + the biome key + "." ("tile.biome.<n>."). */
	readonly tilePrefix: string;
	/**
	 * Decor: an id under this prefix belongs to biome n when one of its dot segments is `b<n>` (decor.delve.b2.torch,
	 * decor.void.b2.cage.1, decor.fx.ambient.b2); every other decor id is biome-free (decor.fx.torch, ...).
	 */
	readonly decorPrefix: string;
	/**
	 * Entries no stage manifest needs: menu-only art and sound (the menu and lobby tracks). The coverage guard
	 * (stageAssets.coverage.spec.ts) fails on a pack id that is neither in some manifest nor here.
	 */
	readonly notStaged: ReadonlyArray<string>;
	/**
	 * Entries a manifest lists in `soon` instead of `must` (queued in the `next` lane, never waited for; SAD5: none at
	 * first, every id starts in `must`).
	 */
	readonly soon: ReadonlyArray<string>;
	/** The stage wait's tunables (SA5 / SA19; decisions SAD3 / SAD4; read by shared/view StageLoad). */
	readonly wait: StageAssetWaitConfig;
}

/**
 * The run start's asset wait (docs/STAGE_ASSETS.md SA5 / SA19, StageLoad's `assets` phase). Floor changes and co-op
 * covers never wait for assets (SAD4 / SAD8); only a solo run start (Play solo, a restart, the tutorial, a dev run) does.
 */
export interface StageAssetWaitConfig {
	/**
	 * Revision 2 (SAD3, SAD16): renderers draw a stand-in (the placeholder) for art not downloaded yet, so a run start
	 * waits at most `softWaitSec`. False (a pack or build without stand-ins): the old full wait, lifting on `hardCapSec`
	 * (or a Skip, StageLoad.skipAssets, offered after `skipAfterSec`; no Skip button is drawn yet).
	 */
	readonly standIns: boolean;
	/** With stand-ins: a run start waits at most this long for its manifest, then reveals with stand-ins. */
	readonly softWaitSec: number;
	/** The cover shows "Loading n / m" only once the wait has run this long and something is missing (cached: none). */
	readonly showProgressAfterSec: number;
	/** Without stand-ins: Skip may end the wait after this long (StageLoad.canSkipAssets). */
	readonly skipAfterSec: number;
	/** Without stand-ins: the wait lifts on its own after this long. */
	readonly hardCapSec: number;
}

/** The present players' characters when the caller has no roster (today: the knight only; the Archer is planned). */
export const STAGE_CHARACTERS: ReadonlyArray<string> = [ACTOR_VIEW.playerVisualId];

export const STAGE_ASSETS: StageAssetsConfig = {
	bullets: ["bullet."],
	runKit: ["ui.", "sfx.", "bullet.", "fx.", "boost.", "breakable.", "pellet."],
	children: {
		// shared/sim summoner.ts summonKind (SWARMER.id)
		summoner: ["swarmer"],
		// shared/sim slime.ts splitKind (SLIME_SMALL_ID)
		slime: ["slime.small"],
		// shared/sim boss/act1.ts SUMMON_KIND, boss/demonlord.ts's summon spec
		"boss.act1": ["swarmer"],
		"boss.demonlord": ["swarmer"],
	},
	features: {
		breakables: ["breakable."],
		// docs/BREAKABLE_DROPS.md BL6: the loaded piece's glint
		breakableLoot: ["decor.fx.glint", "decor.fx.loot"],
		pellets: ["pellet.normal"],
		powerPellet: ["pellet.power"],
		// docs/TREASURE.md: chest, open chest, cage and the light column
		vault: ["treasure.", "fx.treasure.column"],
		// docs/TREASURE.md "Relic pedestals as chests": every treasure room's pedestal is the vault's chest
		pedestals: ["treasure.chest", "treasure.chestopen", "fx.treasure.column"],
		pacts: ["pact."],
		// docs/FORTUNE.md GE: the Goldling and its coin burst (a runtime spawn, so a feature, not a planned kind)
		golden: ["enemy.golden", "fx.golden.coin"],
	},
	worlds: {
		// shared/run TUTORIAL_WORLD_KIND (pinned by stageInput.spec): the dummy and the tutorial's track
		tutorial: { actors: ["dummy"], audio: ["music.tutorial"] },
	},
	bossAudio: ["music.boss"],
	biomeMusicPrefix: "music.biome.",
	tilePrefix: "tile.",
	decorPrefix: "decor.",
	notStaged: ["music.menu", "music.lobby"],
	soon: [],
	wait: { standIns: true, softWaitSec: 1.5, showProgressAfterSec: 0.4, skipAfterSec: 6, hardCapSec: 30 },
};

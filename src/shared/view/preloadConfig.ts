/**
 * Tunables of asset preloading and the join loading screen (docs/PRELOAD.md; logic in preload.ts, the queue in the
 * client's PreloadController). Presentation only: nothing here reaches the sim, the lockstep wire or a hash. Roblox-port
 * choices, no web source.
 */
import { BOSS_ACT1_KIND, BOSS_DEMONLORD_KIND } from "shared/dungeon";

/**
 * How the client hands a content id to `ContentProvider:PreloadAsync` (docs/PRELOAD.md D4): "instance" builds a hidden
 * ImageLabel / Sound per id (never parented), "string" passes the content id string itself.
 */
export type PreloadEntryMode = "instance" | "string";

/**
 * A tier entry naming a biome: `biome:` + the pack's biome key (the manifest's `biomes` table: "biome.1" .. "biome.5").
 * With a key it matches exactly that biome ("biome:biome.1" never matches "biome.10"); bare it matches every biome.
 * A plain entry is a logical-id prefix ("sfx." matches every sfx id; "music.menu" matches music.menu).
 */
export const PRELOAD_BIOME_PREFIX = "biome:";

/** The device classes with their own chunk size (docs/STAGE_ASSETS.md SAD11: the one per-device difference). */
export type PreloadDevice = "desktop" | "touch" | "console";

export interface PreloadConfig {
	/** Logical-id prefixes (and biome entries) of the core tier, in download order (first = first on screen). */
	readonly core: ReadonlyArray<string>;
	/** Entries of the later tier, in download order. An id matching no entry of either tier goes last in `later`. */
	readonly later: ReadonlyArray<string>;
	/** Seconds after the screen opens before Skip shows (D6). */
	readonly skipAfterSec: number;
	/** Seconds after which the screen lifts on its own, whatever is left (D2). */
	readonly timeoutSec: number;
	/** The screen's fade-out on release, seconds (instant under reduced motion). */
	readonly fadeSec: number;
	/**
	 * Entries per PreloadAsync call, per device class (docs/STAGE_ASSETS.md SAD11; shared/view preloadDeviceOf): small,
	 * so a run start's request gets in between chunks. Equal until SA0 / SA20 measure each device.
	 */
	readonly chunkSizeByDevice: Readonly<Record<PreloadDevice, number>>;
	/**
	 * Before fetching a chunk, ask `ContentProvider:GetAssetFetchStatus` (behind pcall) and resolve an id already
	 * `Success` in the engine without a fetch (docs/STAGE_ASSETS.md SA16). Skipped under the Studio fake latency.
	 * Provisional until SA0 (e) says the status is reliable.
	 */
	readonly fetchStatusPrecheck: boolean;
	/** P6 (D5): draw each core image once under the cover before release. Off unless the P0 spike finds a hitch. */
	readonly warmCoreImages: boolean;
	/** D4: hidden instances (default) or bare content id strings. */
	readonly entryMode: PreloadEntryMode;
}

/**
 * The preload tiers. Since docs/STAGE_ASSETS.md SA8 (SAD2) core is the MENU KIT only: what the join screen waits for
 * before the menu (every `ui.` id: menu skins and icons share their sheets with the in-run HUD; the menu's ui sounds;
 * the menu and lobby tracks). Floor art is the stage manifest's: each run start pushes its floor's manifest to the
 * front lane (a soft wait, stand-ins for the rest), each reveal prefetches the next floor on `next`, and the menu /
 * lobby prefetch floor 1's guess on `next` (StageController). Later = everything else on the back lane, roughly in the
 * order a first run meets it (the knight, bullets, regular enemies, the run's sfx and pieces, biome 1 and its track,
 * the tutorial's track, then bosses, other music, ambience and biomes 2-5). Each id goes to the tier of its LONGEST
 * matching entry (`sfx.ui.` beats `sfx.`, `music.menu` beats `music.`, `biome:biome.1` beats `biome:`).
 */
export const PRELOAD: PreloadConfig = {
	core: ["ui.", "sfx.ui.", "music.menu", "music.lobby"],
	later: [
		"class.",
		// docs/PROJECTILE_ART.md: the bullet atlas (every flying bullet's sprite and fx.bullet.hit)
		"bullet.",
		"enemy.",
		"sfx.",
		"breakable.",
		"boost.",
		"pellet.",
		"fx.",
		"decor.",
		`${PRELOAD_BIOME_PREFIX}biome.1`,
		"music.biome.1",
		"music.tutorial",
		"treasure.",
		"pact.",
		"boss.",
		"music.",
		"amb.",
		PRELOAD_BIOME_PREFIX,
	],
	skipAfterSec: 3,
	timeoutSec: 15,
	fadeSec: 0.25,
	chunkSizeByDevice: { desktop: 4, touch: 4, console: 4 },
	fetchStatusPrecheck: true,
	warmCoreImages: false,
	entryMode: "instance",
};

/**
 * Boss kind (shared/dungeon: EndlessFloorLayout.bossKind, bossKindFor) -> the theme's logical id of its art, for the
 * floor-change push of a boss floor's sheets (bossContentIds). A kind not listed has nothing to push.
 */
export const PRELOAD_BOSS_IDS: Readonly<Record<string, string>> = {
	[BOSS_ACT1_KIND]: "boss.act1",
	[BOSS_DEMONLORD_KIND]: "boss.demonlord",
};

/**
 * The join loading screen (docs/PRELOAD.md P4; client/ui/loading LoadingScreen), in the HUD's 1280x720 reference
 * pixels under the same UIScale. Colours are theme roles: the opaque `background` cover, the bar's `uiTextDim` track
 * and `uiAccent` fill.
 */
export const LOADING_VIEW = {
	/**
	 * ScreenGui DisplayOrder: above the HUD (HUD_VIEW.hudDisplayOrder 10), the pause button (12), the menu shell
	 * (MENU_VIEW.displayOrder 15) and the pause / settings layer (HUD_VIEW.menuDisplayOrder 20); under the spikes HUD
	 * (100). docs/CURSOR.md's cursor, once it lands, must sit above this.
	 */
	displayOrder: 30,
	/** Width of the centre column (title, bar, count, Skip). */
	width: 420,
	/** The progress bar's height. */
	barHeight: 8,
	/** Vertical gap between the column's rows. */
	gap: 14,
	/** The Skip button's size. */
	skipButton: { x: 160, y: 36 },
	/** Key names (Enum.KeyCode names) that press Skip once it shows, besides a click / tap on it. */
	skipKeys: ["Return", "KeypadEnter", "ButtonA"] as ReadonlyArray<string>,
} as const;

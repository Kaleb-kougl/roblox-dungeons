/** The theme contract's colour rules (docs/CODEBASE_SCALE.md DX8: a pure move out of contract.ts): contrast and difference thresholds and the role lists they apply to. */
import type { ColorRole } from "../types";
import { BOOST_KINDS, CLASS_IDS, boostId } from "./ids";

/**
 * Minimum WCAG contrast ratio between enemyBullet and every biome floor and wall
 * (GDD: enemy bullets must read against every floor). 3.0 is WCAG's bar for graphics.
 */
export const MIN_ENEMY_BULLET_CONTRAST = 3.0;

/**
 * Roblox port (enemy outline plan O1): minimum WCAG contrast ratio between `enemyOutline` and every biome floor and
 * wall, at full light and (shared/view decorBandContrastReport, run by its spec for every bundled pack) at the darkest
 * decor band. The rim is what makes an enemy read on a floor of its own colour, so it takes the bullets' graphics bar.
 */
export const MIN_ENEMY_OUTLINE_CONTRAST = 3.0;

/** Juice: enemy health bar fill (enemyHealth, enemyHealthElite) vs its back plate, WCAG graphics bar. */
export const MIN_HEALTH_BAR_CONTRAST = 3.0;
/** Juice: every damage-number colour vs every biome floor (WCAG AA text; the digits are tiny). */
export const MIN_DAMAGE_NUMBER_CONTRAST = 4.5;
/** Bar fill roles checked against `enemyHealthBack`. */
export const HEALTH_BAR_FILL_ROLES = ["enemyHealth", "enemyHealthElite"] as const;
/** Damage-number roles checked against every biome floor. */
export const DAMAGE_NUMBER_ROLES = ["damageNumber", "damageHeavy", "damageCapped"] as const;

/**
 * Roblox port (docs/DECOR.md D4): enemy bullets are drawn over breakables just as over walls, so every breakable
 * colour role is held to MIN_ENEMY_BULLET_CONTRAST against `enemyBullet` too.
 */
export const BREAKABLE_ROLES: ReadonlyArray<ColorRole> = ["breakable.barrel", "breakable.crate"];

/**
 * Roblox port (docs/BOOSTS.md B5): one identity colour per boost kind (BOOST_KINDS order), the placeholder gem's tint
 * and the HUD row's / aura's colour. A pickup lies on the floor among bullets, so the validator holds every one to
 * MIN_BOOST_CONTRAST against every biome floor and wall and to MIN_BOOST_BULLET_DIFFERENCE (CIE76) from every
 * ENEMY_BULLET_ROLES colour (`boostColorReport`), exactly as it holds `enemyOutline`.
 */
export const BOOST_ROLES: ReadonlyArray<ColorRole> = BOOST_KINDS.map((k) => boostId(k));

/** Minimum WCAG contrast of every BOOST_ROLES colour on every biome floor and wall (enemyOutline's bar). */
export const MIN_BOOST_CONTRAST = 3.0;

/** The colours an enemy bullet is drawn in (core and outline): decor fx must never be mistaken for them. */
export const ENEMY_BULLET_ROLES: ReadonlyArray<ColorRole> = ["enemyBullet", "enemyBulletOutline"];

/**
 * Minimum CIE76 colour difference (Delta E*ab, CIELAB under D65; `colorDifference` in color.ts) between every
 * DECOR_FX_ROLES colour and every ENEMY_BULLET_ROLES colour. A luminance contrast ratio is the wrong test here (a
 * flame and a bullet can share a luminance and still never be confused; a darker pink can pass a ratio and still read
 * as a bullet), so this measures hue, chroma and lightness together. 40 rules out the bullet's own hue family
 * (#ff40a0 is 2, #e03090 is 9, #ff2a6a is 30 from the placeholder bullet #ff3fa4) while every flame, glow, glint,
 * zone and biome particle colour the Forge themes use sits at 77 or more.
 */
export const MIN_DECOR_FX_BULLET_DIFFERENCE = 40;

/**
 * Roblox port (enemy outline plan O1): minimum CIE76 colour difference between `enemyOutline` and every
 * ENEMY_BULLET_ROLES colour, so the rim around an enemy never reads as a bullet. The same bar as decor fx
 * (MIN_DECOR_FX_BULLET_DIFFERENCE, for the same reason); the placeholder rim #ff3b30 is 63 from enemyBullet #ff3fa4.
 */
export const MIN_ENEMY_OUTLINE_BULLET_DIFFERENCE = 40;

/**
 * Roblox port (docs/BOOSTS.md B5): minimum CIE76 colour difference between every BOOST_ROLES colour and every
 * ENEMY_BULLET_ROLES colour, so a pickup never reads as a bullet: the decor fx / enemy outline bar.
 */
export const MIN_BOOST_BULLET_DIFFERENCE = MIN_DECOR_FX_BULLET_DIFFERENCE;

/**
 * Roblox port (player outline, step 1): minimum WCAG contrast ratio between `playerOutline` and every biome floor and
 * wall, at full light and (shared/view decorBandContrastReport, run by its spec for every bundled pack) at the darkest
 * decor band. The rim is what finds your own character in a crowded room, so it takes the enemy outline's graphics bar.
 */
export const MIN_PLAYER_OUTLINE_CONTRAST = MIN_ENEMY_OUTLINE_CONTRAST;

/**
 * The colours the player outline must never be mistaken for (player outline, step 1): the threats (the enemy bullets,
 * `telegraph`, the `enemyOutline` rim, so the player never reads as an enemy) and every boost colour (a boost's aura is
 * drawn on the player, around the rim).
 */
export const PLAYER_OUTLINE_DIFFERENCE_ROLES: ReadonlyArray<ColorRole> = [
	...ENEMY_BULLET_ROLES,
	"telegraph",
	"enemyOutline",
	...BOOST_ROLES,
];

/**
 * Minimum CIE76 colour difference between `playerOutline` and every PLAYER_OUTLINE_DIFFERENCE_ROLES colour: the decor
 * fx / enemy outline bar. The placeholder rim #f4f1ea (minimap.self, the map's "you") is >= 49 from all of them.
 */
export const MIN_PLAYER_OUTLINE_DIFFERENCE = MIN_DECOR_FX_BULLET_DIFFERENCE;

/**
 * Roblox port (docs/ROOM_EDGES.md RE4): the dashed line on the floor where a corridor meets a room, one colour per
 * room state, in RoomEdgeState order (index = shared/view RoomEdgeState: SAFE 0, WAITING 1, LIVE 2). Required in every
 * pack like every role. A value ramp (dim -> grey -> near-white), not hues: the validator (`roomEdgeReport`) holds
 * waiting and live to MIN_ROOM_EDGE_CONTRAST on every biome floor and all three to MIN_ROOM_EDGE_DIFFERENCE (CIE76)
 * from ROOM_EDGE_DIFFERENCE_ROLES.
 */
export const ROOM_EDGE_ROLES: ReadonlyArray<ColorRole> = ["roomEdge.safe", "roomEdge.waiting", "roomEdge.live"];

/**
 * The room-edge roles held to MIN_ROOM_EDGE_CONTRAST on every biome floor (docs/ROOM_EDGES.md RE4). The lines lie on
 * floors, never on walls, so walls are not checked; `roomEdge.safe` is meant to recede and has no contrast floor.
 */
export const ROOM_EDGE_CONTRAST_ROLES: ReadonlyArray<ColorRole> = ["roomEdge.waiting", "roomEdge.live"];

/**
 * Roblox port (docs/ROOM_EDGES.md RE4): minimum WCAG contrast ratio between every ROOM_EDGE_CONTRAST_ROLES colour and
 * every biome floor. WCAG's bar for graphics, like the enemy outline's (MIN_ENEMY_OUTLINE_CONTRAST).
 */
export const MIN_ROOM_EDGE_CONTRAST = 3.0;

/**
 * The colours a room edge must never be mistaken for (docs/ROOM_EDGES.md RE4): the enemy bullets and `telegraph`, the
 * other dashed floor lines that mean danger.
 */
export const ROOM_EDGE_DIFFERENCE_ROLES: ReadonlyArray<ColorRole> = [...ENEMY_BULLET_ROLES, "telegraph"];

/**
 * Roblox port (docs/ROOM_EDGES.md RE4): minimum CIE76 colour difference between every ROOM_EDGE_ROLES colour and every
 * ROOM_EDGE_DIFFERENCE_ROLES colour: the decor fx / enemy outline bar. A red "live" line fails it (#ff6a6a is 35 from
 * the placeholder telegraph #ff8a3d).
 */
export const MIN_ROOM_EDGE_DIFFERENCE = MIN_DECOR_FX_BULLET_DIFFERENCE;

/**
 * Roblox port (docs/MINIMAP.md M6): the minimap's colours (shared/view/minimap paint and markers). Required in every
 * pack like every role. UI colours, drawn over `uiPanel` (the unknown fog), never on a biome floor: the tiles (floor,
 * wall, pool, frontier) and the markers (self, enemy, boss, stairs, boost). The validator (`minimapReport`) holds the
 * markers to MIN_MINIMAP_MARKER_CONTRAST on `minimap.floor`, on `uiPanel` and on every tinted room floor
 * (MINIMAP_TINT_ROLES mixed into `minimap.floor` at MINIMAP_ROOM_TINT_MIX), and `minimap.enemy` to
 * MIN_MINIMAP_ENEMY_DIFFERENCE (CIE76) from MINIMAP_ENEMY_DIFFERENCE_ROLES.
 */
export const MINIMAP_ROLES: ReadonlyArray<ColorRole> = [
	"minimap.floor",
	"minimap.wall",
	"minimap.pool",
	"minimap.frontier",
	"minimap.self",
	"minimap.enemy",
	"minimap.boss",
	"minimap.stairs",
	"minimap.boost",
];

/** The minimap markers (docs/MINIMAP.md M6): held to MIN_MINIMAP_MARKER_CONTRAST on MINIMAP_MARKER_BACKGROUNDS. */
export const MINIMAP_MARKER_ROLES: ReadonlyArray<ColorRole> = [
	"minimap.self",
	"minimap.enemy",
	"minimap.boss",
	"minimap.stairs",
	"minimap.boost",
];

/** What a minimap marker is drawn over: a seen floor tile and the panel itself (the unknown fog). */
export const MINIMAP_MARKER_BACKGROUNDS: ReadonlyArray<ColorRole> = ["minimap.floor", "uiPanel"];

/**
 * Roblox port (docs/MINIMAP.md M5, review fix): how far a seen room's floor moves toward its room-edge state colour
 * (MINIMAP_TINT_ROLES) on the map, 0..1. Owned here, not in shared/view/minimap MINIMAP_VIEW (which reads it as
 * `roomTintMix`), because the validator checks the markers on the tinted floors it makes. 0.1 (was 0.35): the live
 * tint is the near-white roomEdge.live, so at 0.35 the enemy dot fell to 1.2:1 on a live room's floor.
 */
export const MINIMAP_ROOM_TINT_MIX = 0.1;

/** The colours a seen room's floor is tinted toward (one per room-edge state, docs/ROOM_EDGES.md). */
export const MINIMAP_TINT_ROLES: ReadonlyArray<ColorRole> = ROOM_EDGE_ROLES;

/**
 * Roblox port (docs/MINIMAP.md M6): minimum WCAG contrast ratio between every MINIMAP_MARKER_ROLES colour and every
 * MINIMAP_MARKER_BACKGROUNDS colour. WCAG's bar for graphics, like the enemy outline's and the room edges'.
 */
export const MIN_MINIMAP_MARKER_CONTRAST = 3.0;

/**
 * The colours an enemy dot must never be mistaken for (docs/MINIMAP.md M6): the watched player's arrow, a boost glint
 * and every teammate dot (the `class.*` roles), so a hostile dot never reads as a friend or a pickup.
 */
export const MINIMAP_ENEMY_DIFFERENCE_ROLES: ReadonlyArray<ColorRole> = [
	"minimap.self",
	"minimap.boost",
	...CLASS_IDS.map((c) => `class.${c}` as ColorRole),
];

/**
 * Roblox port (docs/MINIMAP.md M6): minimum CIE76 colour difference between `minimap.enemy` and every
 * MINIMAP_ENEMY_DIFFERENCE_ROLES colour: the decor fx / enemy outline bar. An enemy dot in `class.ranger` green fails
 * (0), and a warm red like the outline's #ff3b30 does too (39 from the placeholder `class.pyromancer` #d9784a).
 */
export const MIN_MINIMAP_ENEMY_DIFFERENCE = MIN_DECOR_FX_BULLET_DIFFERENCE;

/**
 * Roblox port (docs/COMBO.md CB3, CD10): the combo's colours (shared/view/hud COMBO_TIERS, the meter, the multiplier,
 * the tier name and the floor shout). Required in every pack like every role. One per named tier (x2 rampage, x3
 * carnage, x4 dominating, x5 unstoppable; the tier below x2 keeps `ember`), then `combo.broken`, the grey of a broken
 * streak. The validator (`comboReport`) holds them to COMBO_COLOR_RULES.
 */
export const COMBO_ROLES: ReadonlyArray<ColorRole> = [
	"combo.rampage",
	"combo.carnage",
	"combo.dominating",
	"combo.unstoppable",
	"combo.broken",
];

/**
 * The combo's ladder, one colour per tier in tier order (index = shared/view/hud comboTier: 0 none, 1 rampage .. 4
 * unstoppable): `ember` (today's meter gold) below x2, then the four named tiers. Each is drawn on `uiPanel` (the score
 * panel), and each step up must read as a new colour.
 */
export const COMBO_TIER_ROLES: ReadonlyArray<ColorRole> = [
	"ember",
	"combo.rampage",
	"combo.carnage",
	"combo.dominating",
	"combo.unstoppable",
];

/** What `comboReport` checks against what, and the bars (COMBO_COLOR_RULES). */
export interface ComboColorRules {
	/** The ladder (COMBO_TIER_ROLES), each held to `minPanelContrast` on `panel` and `minStepDifference` from the one below. */
	readonly tiers: ReadonlyArray<ColorRole>;
	/** What the meter, multiplier and tier name are drawn over: the score panel. */
	readonly panel: ColorRole;
	/** The named tiers (`tiers` without `ember`): the floor shout is drawn in these, in the world. */
	readonly shouted: ReadonlyArray<ColorRole>;
	/**
	 * The colours a shout must never be mistaken for (docs/COMBO.md CD9): the enemy bullets and `telegraph`. The shout is
	 * painted on the floor under them, so a bullet crossing it must still read as a bullet.
	 */
	readonly shoutAgainst: ReadonlyArray<ColorRole>;
	/** The broken streak's grey (the meter and multiplier after a break). */
	readonly broken: ColorRole;
	/** WCAG contrast of every tier on `panel`: the graphics bar, like the room edges' and the minimap markers'. */
	readonly minPanelContrast: number;
	/**
	 * CIE76 between consecutive tiers (ember -> rampage -> ... -> unstoppable), so every tier-up is a visible colour
	 * change (the tier name carries the meaning too; the colour is its twin).
	 */
	readonly minStepDifference: number;
	/**
	 * CIE76 between every `shouted` colour and every `shoutAgainst` colour: the decor fx / enemy outline bar. The plan's
	 * starting coral #ff7a59 failed it (19.5 from the placeholder telegraph #ff8a3d), as did its crimson #ff3b6b (31.1)
	 * and magenta #e04bd6 (32.1) against the pink bullet #ff3fa4.
	 */
	readonly minShoutDifference: number;
	/** CIE LCh chroma C* (sqrt(a*^2 + b*^2), `labChroma`) of `broken`, at most: it reads as grey, not as another tier. */
	readonly maxBrokenChroma: number;
	/** CIE76 between `broken` and every tier. */
	readonly minBrokenDifference: number;
}

/**
 * Roblox port (docs/COMBO.md CB3): the combo colour rules (`comboReport`). One object, so the validator imports one
 * name: its compiled Luau module sits at the 200-locals-per-function limit.
 */
export const COMBO_COLOR_RULES: ComboColorRules = {
	tiers: COMBO_TIER_ROLES,
	panel: "uiPanel",
	shouted: ["combo.rampage", "combo.carnage", "combo.dominating", "combo.unstoppable"],
	shoutAgainst: [...ENEMY_BULLET_ROLES, "telegraph"],
	broken: "combo.broken",
	minPanelContrast: 3.0,
	minStepDifference: 25,
	minShoutDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
	maxBrokenChroma: 10,
	minBrokenDifference: 40,
};

/**
 * Roblox port (docs/GRAZE_PARRY.md GP3): the near misses' colours (shared/view/fx, GP5 / GP7). Required in every pack
 * like every role: `nearMiss.graze`, the white-cyan spark where a bullet skimmed past, and `nearMiss.parry`, the
 * gold-white burst at every bullet a guard erased and the PARRY! floor text. Both are drawn in the world, on the floor
 * and among bullets, so the validator (`nearMissReport`) holds them to NEAR_MISS_COLOR_RULES.
 */
export const NEAR_MISS_ROLES: ReadonlyArray<ColorRole> = ["nearMiss.graze", "nearMiss.parry"];

/** What `nearMissReport` checks against what, and the bars (NEAR_MISS_COLOR_RULES). */
export interface NearMissColorRules {
	/** The roles checked (NEAR_MISS_ROLES). */
	readonly roles: ReadonlyArray<ColorRole>;
	/** WCAG contrast of every role on every biome floor (walls are not checked: sparks and text lie on floors). */
	readonly minFloorContrast: number;
	/**
	 * The colours a spark or the PARRY! text must never be mistaken for: the enemy bullets and `telegraph`. Sparks fly
	 * among bullets and the text is painted on the floor under them (the combo shout's construction, docs/COMBO.md CD9).
	 */
	readonly against: ReadonlyArray<ColorRole>;
	/** CIE76 between every role and every `against` colour: the decor fx / enemy outline bar. */
	readonly minDifference: number;
}

/**
 * Roblox port (docs/GRAZE_PARRY.md GP3): the near-miss colour rules (`nearMissReport`). One object holding the roles
 * too, so the validator imports one name: its compiled Luau module sits at the 200-locals-per-function limit, as this
 * one nearly does (so no spread here: `against` is the room edges' list, the enemy bullets and `telegraph`, whose
 * temporaries would be top-level locals).
 */
export const NEAR_MISS_COLOR_RULES: NearMissColorRules = {
	roles: NEAR_MISS_ROLES,
	minFloorContrast: 3.0,
	against: ROOM_EDGE_DIFFERENCE_ROLES,
	minDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
};

/**
 * Roblox port (docs/DRAFT_REVEAL.md DR3, DRD3): the boon draft's rarity colours in rarity order (common, rare,
 * legendary; shared/view/hud RARITY_COLOR_ROLES): the card names, the rarity stroke and the owned-boon icons. Bone,
 * blood red and candle gold from the ToffeeCraft Horror UI sheet, so legendary is the brightest colour on the card.
 * Required in every pack like every role; the loot `rarity.*` roles are separate. Held to BOON_RARITY_COLOR_RULES by
 * `boonRarityReport`.
 */
export const BOON_RARITY_ROLES: ReadonlyArray<ColorRole> = ["boon.common", "boon.rare", "boon.legendary"];

/**
 * The boon rarity rules (`boonRarityReport`): every `roles` colour >= `minPanelContrast` (WCAG, the graphics bar) on
 * `panel` (the draft card is drawn over the HUD's panel colour) and >= `minStepDifference` (CIE76) from the rarity below
 * it, so each step up the ladder reads as a new colour. One object, so the validator imports one name (its compiled
 * Luau sits near the 200-locals-per-function limit).
 */
export const BOON_RARITY_COLOR_RULES = {
	// The rarity ladder (BOON_RARITY_ROLES), then docs/BUILDS.md's evolution and duo card frames (builds.ts
	// BOON_BUILD_ROLES) on top of it, written out (a spread here would be top-level Luau temporaries).
	roles: ["boon.common", "boon.rare", "boon.legendary", "boon.evolved", "boon.duo"] as ReadonlyArray<ColorRole>,
	panel: "uiPanel" as ColorRole,
	minPanelContrast: 3.0,
	minStepDifference: 25,
} as const;

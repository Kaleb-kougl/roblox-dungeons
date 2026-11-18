/**
 * Enemy outlines (enemy outline plan O2): a rim in the theme's `enemyOutline` role around every living enemy and the
 * boss, so a body reads on a floor of its own colour. Presentation only; nothing here feeds the sim.
 *
 * Placeholder bodies (3D Parts) get theirs from ONE shared Highlight: ActorRenderController splits its folder
 * (ACTOR_VIEW.folderName) into ACTOR_OUTLINE.groups: `enemies` (a Model, which a Highlight can adorn) holds the pieces
 * of every outlined actor, `corpses` every other actor's (dead, or a visual with no `outline` role), `players` the
 * party's views. A body moves between `enemies` and `corpses` only when actorGroup changes (its death), so the outline
 * costs one Highlight and no per-frame work. Sprite bodies (billboards; a Highlight cannot outline GUI) get the baked
 * rim instead (plan O4): the frame's outline sheet (SpriteFrame.outlineImage) in an "Outline" ImageLabel under the
 * frame (ACTOR_OUTLINE.spriteZIndex), tinted the same role, shown by the same rule (actorOutlined) and drawn only while
 * spriteOutlineVisible.
 *
 * Debug switch: Workspace attribute ACTOR_OUTLINE.enabledAttribute (boolean; absent = on, outlineSwitchOn) turns the
 * Highlight off and on at runtime for A/B in Studio.
 */
import type { ColorRole } from "shared/theme";

/** Enemy outline tunables (the Highlight's look, the folder split, the debug switch). */
export const ACTOR_OUTLINE = {
	/** The rim's colour role (theme validator: >= 3:1 on every biome floor and wall, CIE76 >= 40 from bullets). */
	role: "enemyOutline" as ColorRole,
	/** Names of ActorRenderController's children of ACTOR_VIEW.folderName (enemies: a Model; the others: Folders). */
	groups: {
		enemies: "Enemies",
		corpses: "Corpses",
		players: "Players",
	},
	/** The shared Highlight (a child of the enemies Model, adorning it). */
	highlightName: "EnemyOutline",
	/** Rim only: the body keeps its own colour and hit flash / telegraph tint (plan E5). */
	fillTransparency: 1,
	outlineTransparency: 0,
	/** Enum.HighlightDepthMode name: walls hide the rim exactly as they hide the body (plan E3). */
	depthMode: "Occluded" as "Occluded" | "AlwaysOnTop",
	/** Workspace attribute (boolean): false turns every enemy outline off (Highlight and sprite rims); absent = on. */
	enabledAttribute: "KV_EnemyOutline",
	/** Sprite rims (plan O4): the outline ImageLabel's name in a SpriteView's BillboardGui. */
	spriteLabelName: "Outline",
	/** ZIndex of a SpriteView's labels (the gui's ZIndexBehavior is Sibling): the rim draws under the frame. */
	spriteZIndex: { outline: 1, frame: 2, dye: 3 },
	/** docs/COSMETICS.md CS5: the sprite's dye label (a SpriteView built with a dye), above the frame. */
	spriteDyeLabelName: "Dye",
} as const;

/** Which child of the actors folder a placeholder body is parented to (ACTOR_OUTLINE.groups). */
export type ActorGroup = keyof typeof ACTOR_OUTLINE.groups;

/** The debug switch from the Workspace attribute's value: on unless it is exactly `false` (absent = on). */
export function outlineSwitchOn(attribute: unknown): boolean {
	return attribute !== false;
}

/**
 * Whether an actor shows an enemy outline: its visual has an outline role (`hasOutline`: enemies and bosses, never the
 * player), it is alive (a corpse drops the rim the tick it dies, so it never reads as a live threat; plan E2) and the
 * debug switch is on (`enabled`, outlineSwitchOn).
 */
export function actorOutlined(hasOutline: boolean, alive: boolean, enabled: boolean): boolean {
	return enabled && hasOutline && alive;
}

/**
 * The group an enemy's placeholder body belongs in: `enemies` (under the shared Highlight) while actorOutlined with the
 * switch on, else `corpses`. The switch itself is the Highlight's Enabled, so toggling it never reparents a body.
 */
export function actorGroup(hasOutline: boolean, alive: boolean): ActorGroup {
	return actorOutlined(hasOutline, alive, true) ? "enemies" : "corpses";
}

/**
 * Whether a sprite's outline label draws (plan O4): the sprite is visible (the post-hit blink hides both labels), its
 * rim is shown (`shown`: actorOutlined, so a corpse or the debug switch hides it while the body stays) and the current
 * frame's sheet has an outline image (a sheet whose outline is not uploaded draws rimless).
 */
export function spriteOutlineVisible(visible: boolean, shown: boolean, outlineImage: string | undefined): boolean {
	return visible && shown && outlineImage !== undefined;
}

/**
 * Player outline (docs/PLAYER_OUTLINE.md): a rim in the theme's `playerOutline` role around the watched player's
 * character only (the local player, or the teammate a dead player spectates: SimController.getViewPlayerIndex), so you
 * find yourself in a crowded room. Decisions P1-P4: only you, Occluded (walls hide it like the body), 1 art px, on by
 * default (Options > Display > Player outline). Presentation only; nothing here feeds the sim.
 *
 * The knight sprite draws its baked outline sheet (art/atlases.json `class.vanguard` outline, 1 px, clipAtCellEdge) in
 * the SpriteView's "Outline" label, tinted this role; the placeholder capsule sits in PLAYER_OUTLINE.modelName (a Model
 * under the players folder) under ONE Highlight while outlined. Debug switch: Workspace attribute
 * PLAYER_OUTLINE.enabledAttribute (boolean; absent = on, outlineSwitchOn).
 */
export const PLAYER_OUTLINE = {
	/** The rim's colour role (theme validator: >= 3:1 on every biome floor and wall, CIE76 >= 40 from threats and boosts). */
	role: "playerOutline" as ColorRole,
	/** The Model (a child of the players folder) holding the outlined placeholder capsule, and its Highlight. */
	modelName: "Outlined",
	highlightName: "PlayerOutline",
	/** Rim only, like the enemy outline: the body keeps its own colour, i-frame tint and blink. */
	fillTransparency: 1,
	outlineTransparency: 0,
	/** Enum.HighlightDepthMode name: walls hide the rim exactly as they hide the body (decision P2). */
	depthMode: "Occluded" as "Occluded" | "AlwaysOnTop",
	/** Workspace attribute (boolean): false turns the player outline off (Highlight and sprite rim); absent = on. */
	enabledAttribute: "KV_PlayerOutline",
} as const;

/**
 * Whether a player's view shows the player outline: it is the watched player (`isView`: the local player, or the one a
 * dead player spectates; teammates never get it, decision P1), alive (the rim drops the tick they die, like an enemy
 * corpse's), the Display setting is on (`settingOn`, DisplaySettings.playerOutline) and the debug switch is on
 * (`switchOn`, outlineSwitchOn of PLAYER_OUTLINE.enabledAttribute).
 */
export function playerOutlined(isView: boolean, dead: boolean, settingOn: boolean, switchOn: boolean): boolean {
	return isView && !dead && settingOn && switchOn;
}

/**
 * Enemy outlines (enemy outline plan O2): a rim in the theme's `enemyOutline` role around every living enemy and the
 * boss, so a body reads on a floor of its own colour. Presentation only; nothing here feeds the sim.
 *
 * Placeholder bodies (3D Parts) get theirs from ONE shared Highlight: ActorRenderController splits its folder
 * (ACTOR_VIEW.folderName) into ACTOR_OUTLINE.groups: `enemies` (a Model, which a Highlight can adorn) holds the pieces
 * of every outlined actor, `corpses` every other actor's (dead, or a visual with no `outline` role), `players` the
 * party's views. A body moves between `enemies` and `corpses` only when actorGroup changes (its death), so the outline
 * costs one Highlight and no per-frame work. Sprite bodies (billboards; a Highlight cannot outline GUI) get a baked rim
 * later (plan O4) from the same rule, actorOutlined.
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
	/** Workspace attribute (boolean): false turns every enemy outline off; absent or true = on. */
	enabledAttribute: "KV_EnemyOutline",
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

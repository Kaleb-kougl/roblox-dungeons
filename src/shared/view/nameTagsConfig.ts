import type { ColorRole } from "shared/theme";

/**
 * Co-op name tags (docs/PLAYER_NAMES.md): each living teammate's display name, laid flat on the floor so it reads just
 * above their character's head on screen. Presentation only; nothing here feeds the sim.
 *
 * Why the floor (PND1): a BillboardGui over the head would draw in front of every bullet and telegraph behind the
 * player. A floor text on the combo shout's layer (client fxHelpers floorTextTopStuds) is under every bullet, marking,
 * effect and body, so it loses every overlap and can never hide a threat. Placed screen-up of the feet by the body's
 * height / sin(pitch), it lands just above the head.
 *
 * Box: `widthTiles` along screen-right, `depthTiles` along screen-up on the floor (foreshortened by the pitch). The text
 * is drawn at a fixed size (`textShare` of the canvas height) and truncated at the box's width, so every tag has the
 * same letter height (about a third of a tile on screen) and a long name never grows.
 */
export const NAME_TAGS = {
	/** Text and stroke colour roles (the HUD's text on the floor texts' dark stroke). */
	role: "uiText" as ColorRole,
	strokeRole: "background" as ColorRole,
	widthTiles: 4,
	depthTiles: 0.5,
	/** Canvas px per tile along the width (the depth follows from the pitch, nameTagCanvasSize). */
	canvasPxPerTile: 64,
	/** The text's size, a share of the canvas height. */
	textShare: 0.9,
	/** Lit like the HUD (the floor shouts' rule, COMBO_SHOUT_DRAW.lightInfluence): the role's colour on every biome. */
	lightInfluence: 0,
	/** The stroke's transparency at full opacity (it fades with the fill). */
	strokeTransparency: 0.2,
	/**
	 * The tallest character's visible height above its feet, tiles on screen (the Knight's bodyTiles 1.5; the Archer is
	 * shorter, so its tag sits a little higher above its head).
	 */
	headTiles: 1.5,
	/** Screen gap between the head and the tag's bottom edge, tiles. */
	gapTiles: 0.12,
	/** Below the feet (PND3, the fallback side): screen gap between the feet and the tag's top edge, tiles. */
	belowGapTiles: 0.55,
	/**
	 * The above side is used only while every cell from the feet to the tag's far edge across its width is open floor
	 * (nameTagAboveClear): a wall or the void there stands in front of the tag and would hide it. Sampled every
	 * `sampleTiles` along both axes, starting `sampleStartTiles` up from the feet (the body's own cell is floor).
	 */
	sampleTiles: 0.5,
	sampleStartTiles: 0.5,
	/** The wanted side must hold this long before the tag moves (no flicker along a wall's end). */
	sideHoldSec: 0.3,
	/** Opacity while clear, near the watched player, and ducked (an enemy bullet in the box grown by duckMarginTiles). */
	maxOpacity: 0.6,
	nearOpacity: 0.3,
	duckOpacity: 0.12,
	/** A teammate within this of the watched player is "near" (you already know who is beside you). */
	nearTiles: 3,
	duckMarginTiles: 0.75,
	/** Time to fade between 0 and maxOpacity (every change eases at maxOpacity / fadeSec per second). */
	fadeSec: 0.15,
	/** Frame dt cap (a hitch never jumps the fade). */
	maxDtSec: 0.1,
	folderName: "KV_NameTags",
} as const;

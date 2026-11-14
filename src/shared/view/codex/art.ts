/**
 * A Codex entry's tile art (claude/codex-plan.md "Design" CX7: `codexTileArt(pack, entry)`). Pure: the client's
 * CodexArt (client/ui/hud) draws the result on the Codex screen's tiles and detail and on a codex toast (16 px).
 *
 *   icons    a boon, an evolution, a duo, a relic, a curse or a boost: the RunItems cell look (shared/view/hud
 *            runItemCells / itemCellArt): the icon art where the pack has every image, else the short text labels
 *            (`<id>.icon`) on the cell's fill; an evolution is its boon's cell in the boon.evolved frame; a duo its own
 *            icon or the two boons joined; a boost its `ui.boost.<kind>` icon or label on the kind's colour
 *   sprite   an enemy or a boss with a sprite set: one still frame of its idle animation, facing the camera
 *            (CODEX_ART.stillAnim / stillFacingDeg; the frame's ImageRectOffset / Size from the set's layout).
 *            Unknown tiles draw it as a dark silhouette (CODEX_ART.silhouette*: a tease, not readable art)
 *   ring     a champion affix: a ring in the affix's colour (its floor ring's look) with its name's label
 *   label    an enemy or boss without a sprite set (the placeholder pack): its name as text on its colour; the secret
 *            rooms' entry (docs/SECRET_ROOMS.md SR9) always: its name in the dust's pale stone (`secret.dust`). The
 *            crack overlay is greyscale darkening on a transparent ground and the chest is the vault's, so neither reads
 *            as the feature on a dark tile; the name does
 *   unknown  any other unknown tile: the `ui.icon.help` glyph, or the `???` text without the icon
 * The pack is read through CodexArtPack (the client: uiImage readiness for ui images, the theme's sprite sets), so the
 * same rules hold headlessly. Kept out of shared/view sprites.ts (its compiled Luau sits near the 200-locals limit).
 */
import { codexEntry, type CodexEntry } from "shared/codex";
import { DUOS, archetypeAt, archetypeIndex, hasArchetype } from "shared/sim";
import {
	BOOST_KINDS,
	SECRET_DUST_ROLE,
	affixNameKey,
	affixRole,
	boostIconId,
	boostId,
	boostStringKey,
	type ColorRole,
	type SpriteFacings,
} from "shared/theme";
import { BUILD_EVOLVED_ROLE, itemCellArt, runItemCells, type ItemCellModel } from "shared/view/hud";
// By file: the shared/view barrel is this folder's parent.
import { facingIndex } from "../sprites";
import type { CodexTileState } from "./screen";

/** Tunables of the tile art. */
export const CODEX_ART = {
	/** An unknown tile's glyph (theme ui icon). */
	unknownIcon: "ui.icon.help",
	/** The still frame: this animation's first frame, facing the camera (screen down, degrees). */
	stillAnim: "idle",
	stillFacingDeg: 270,
	/** An unknown enemy / boss: the still drawn in the background colour at this transparency (60 % opacity). */
	silhouetteRole: "background" as ColorRole,
	silhouetteTransparency: 0.4,
	/** A champion's ring: its stroke as a share of the tile, and the label's share of the tile's height. */
	ringStrokeShare: 0.08,
	ringLabelShare: 0.4,
} as const;

/** The one frame of a sprite set the tile draws. */
export interface CodexSpriteFrame {
	readonly assetId: string;
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

/** What the art reads of a sprite set (shared/theme SpriteSetLayout satisfies it). */
export interface CodexSpriteSource {
	readonly facings: Readonly<SpriteFacings>;
	readonly resample: "Default" | "Pixelated";
	has(anim: string): boolean;
	frame(anim: string, facing: number, index: number): CodexSpriteFrame;
}

/** What the art reads of the theme pack. */
export interface CodexArtPack {
	/** The pack has (and has loaded) ui image `id`. */
	has(id: string): boolean;
	/** The pack's sprite set for a sprite id (`enemy.swarmer`, `boss.act1`), or undefined (placeholder art). */
	sprites(id: string): CodexSpriteSource | undefined;
}

export type CodexTileArt =
	| {
			readonly kind: "icons";
			/** Icon art per cell (undefined: draw `labels` instead), the labels (`<id>.icon` keys) and fills. */
			readonly art?: ReadonlyArray<string>;
			readonly labels: ReadonlyArray<string>;
			readonly fills: ReadonlyArray<ColorRole>;
			/** The cell's outline role (an evolution's boon.evolved frame), undefined: the plain one. */
			readonly frame?: ColorRole;
	  }
	| {
			readonly kind: "sprite";
			readonly frame: CodexSpriteFrame;
			readonly pixelated: boolean;
			readonly silhouette: boolean;
	  }
	| { readonly kind: "ring"; readonly role: ColorRole; readonly labelKey: string }
	| { readonly kind: "label"; readonly key: string; readonly role: ColorRole }
	| { readonly kind: "unknown"; readonly icon?: string };

/** An item cell's art (icon art when the pack has every image, else the labels). */
function iconsOf(cell: ItemCellModel | undefined, pack: CodexArtPack, frame?: ColorRole): CodexTileArt {
	if (cell === undefined) return unknownArt(pack);
	return {
		kind: "icons",
		art: itemCellArt(cell, (id) => pack.has(id)),
		labels: cell.icons,
		fills: cell.fills,
		frame: frame ?? cell.frame,
	};
}

function unknownArt(pack: CodexArtPack): CodexTileArt {
	return { kind: "unknown", icon: pack.has(CODEX_ART.unknownIcon) ? CODEX_ART.unknownIcon : undefined };
}

/** An archetype's sprite id (`enemy.swarmer`), or undefined for an unregistered id. */
export function codexSpriteId(archetype: string): string | undefined {
	if (!hasArchetype(archetype)) return undefined;
	return archetypeAt(archetypeIndex(archetype)).data.spriteId;
}

/** The still frame of a sprite set: CODEX_ART.stillAnim (else its first frame of `idle`'s fallback), facing the camera. */
export function codexStillFrame(set: CodexSpriteSource): CodexSpriteFrame {
	return set.frame(CODEX_ART.stillAnim, facingIndex(CODEX_ART.stillFacingDeg, set.facings), 0);
}

/** An enemy's / boss's art: its sprite still (a silhouette while unknown), else its name label. */
function actorArt(entry: CodexEntry, archetype: string, pack: CodexArtPack, state: CodexTileState): CodexTileArt {
	const spriteId = codexSpriteId(archetype);
	const set = spriteId !== undefined ? pack.sprites(spriteId) : undefined;
	if (set !== undefined) {
		return {
			kind: "sprite",
			frame: codexStillFrame(set),
			pixelated: set.resample === "Pixelated",
			silhouette: state === "unknown",
		};
	}
	if (state === "unknown") return unknownArt(pack);
	return { kind: "label", key: entry.nameKey, role: entry.group === "bosses" ? "uiHealth" : "uiText" };
}

/**
 * The art of `entry` (an entry or its id) in `state` (default found: a codex toast's): see the module comment. An
 * unknown item / boost / affix tile is the unknown glyph; only enemies and bosses tease their silhouette.
 */
export function codexTileArt(
	pack: CodexArtPack,
	entry: CodexEntry | string,
	state: CodexTileState = "found",
): CodexTileArt {
	const e = typeIs(entry, "string") ? codexEntry(entry) : entry;
	if (e === undefined) return unknownArt(pack);
	const a = e.artRef;
	if (a.kind === "actor") return actorArt(e, a.archetype, pack, state);
	if (state === "unknown") return unknownArt(pack);
	const has = (id: string) => pack.has(id);
	switch (a.kind) {
		case "boon":
			return iconsOf(runItemCells([a.index], [], [], [], [], has)[0], pack);
		case "evo":
			return iconsOf(runItemCells([a.index], [], [], [], [], has)[0], pack, BUILD_EVOLVED_ROLE);
		case "duo":
			return a.index < DUOS.size()
				? iconsOf(runItemCells([], [], [a.index], [], [], has)[0], pack)
				: unknownArt(pack);
		case "relic":
			return iconsOf(runItemCells([], [], [], [a.index], [], has)[0], pack);
		case "curse":
			return iconsOf(runItemCells([], [], [], [], [a.index], has)[0], pack);
		case "boost": {
			const kind = BOOST_KINDS[a.index];
			if (kind === undefined) return unknownArt(pack);
			const icon = boostIconId(kind);
			return {
				kind: "icons",
				art: pack.has(icon) ? [icon] : undefined,
				labels: [boostStringKey(kind, "icon")],
				fills: [boostId(kind)],
			};
		}
		case "affix":
			return { kind: "ring", role: affixRole(a.affix), labelKey: affixNameKey(a.affix) };
		case "secret":
			return { kind: "label", key: e.nameKey, role: SECRET_DUST_ROLE };
	}
	return unknownArt(pack);
}

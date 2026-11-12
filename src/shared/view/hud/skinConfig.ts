/**
 * Tunables of the UI skin (docs/UI_ART.md UA5, Architecture 3): the pixel density of the 9-sliced frames, the boxes the
 * HUD fits its icons into, and which theme ui ids (contract.ts uiSkinIds / uiIconIds, all optional) each primitive
 * draws. The logic is skin.ts. Presentation only; reference px are the HUD's 1280 x 720 design pixels (HUD_VIEW).
 */
import type { SliceInsets } from "shared/theme";
import { DRAFT_REVEAL_VIEW } from "./draftRevealView";
import { HUD_VIEW } from "./layout";

/** Where a panel sits (UAD2): the menus' red-rimmed frame, the run's dark rounded one, a tall list frame. */
export type SkinPanelContext = "menu" | "hud" | "list";
/** A button's look: focused (hover, gamepad selection) and active (pressed, chosen) share the red fill. */
export type SkinButtonState = "normal" | "focused" | "active" | "disabled";
/**
 * A Panel's `skin` prop (docs/UI_ART.md UA7): a context, or "none" = always today's flat look (the draft reveal's
 * panels, which keep the look the reveal built). Default: a corner panel is "hud", every other panel "menu".
 */
export type PanelSkin = SkinPanelContext | "none";
/** Which MenuButton family a button draws: the long button, or an Options value (the option bars). */
export type SkinButtonVariant = "button" | "option";

/** One focus bracket: the bracket art (a top-left L) turned clockwise by `rotation`, its corner at the parent's (ax, ay). */
export interface FocusCornerPlacement {
	readonly rotation: number;
	readonly ax: 0 | 1;
	readonly ay: 0 | 1;
}

export const UI_ART = {
	/**
	 * Reference px per art px of a 9-sliced frame before snapping (ImageLabel SliceScale): the draft cards' scale
	 * (DRAFT_REVEAL_VIEW.artScale), so the menus and the cards share one pixel size.
	 */
	refPerArt: DRAFT_REVEAL_VIEW.artScale,
	/**
	 * Reference px per art px of the in-run (`hud` context) frames and the list rows: a finer density, so ui.panel.hud's
	 * 6 art px border is 6 reference px, under HUD_VIEW.pad (8), and no corner panel changes size (footprint.spec.ts).
	 */
	hudRefPerArt: 1,
	/**
	 * The panel context of a menu list row (ListRow, at hudRefPerArt): ui.panel.tall's 10 + 8 art px top and bottom
	 * borders leave no room for a line in MENU_VIEW.rowHeight at UIScale 1.5 (1080 p), ui.panel.hud's 6 + 6 do at every
	 * scale (skin.spec.ts), so rows draw the hud frame.
	 */
	rowContext: "hud" satisfies SkinPanelContext as SkinPanelContext,
	/**
	 * The four focus brackets (FocusCorners): ui.focus.corner is a top-left L, turned clockwise (Roblox Rotation) to sit
	 * in each corner of the focused button.
	 */
	focusCorners: [
		{ rotation: 0, ax: 0, ay: 0 },
		{ rotation: 90, ax: 1, ay: 0 },
		{ rotation: 180, ax: 1, ay: 1 },
		{ rotation: 270, ax: 0, ay: 1 },
	] satisfies ReadonlyArray<FocusCornerPlacement> as ReadonlyArray<FocusCornerPlacement>,
	/** Degrees in a half turn and a quarter turn (a quarter-turned image swaps its width and height on screen). */
	halfTurn: 180,
	quarterTurn: 90,
	/** Fewest whole screen px per art px (a very small window draws the art at 1:1 rather than not at all). */
	minArtScale: 1,
	/**
	 * Slack when comparing a scaled art size with its box, in screen px per art px: `24 * 1.5 / 18` must read as 2 even
	 * when float64 lands a hair under it.
	 */
	fitEpsilon: 1e-9,
	/**
	 * Square boxes (reference px) the HUD fits its art icons into (fitArt, UAD7): the heart box is 24 (= HUD_VIEW.heartSize
	 * since UA10; footprint.spec.ts pins it under a label line), so an 18 x 15 heart draws at 2
	 * screen px per art px at 1080 p. Flasks and candles sit in the hearts' rows; chips are pips; glyphs sit beside
	 * button labels.
	 */
	iconBox: {
		heart: 24,
		flask: 24,
		ember: 24,
		pip: HUD_VIEW.pipSize,
		glyph: 16,
		/**
		 * A screen header's icon (the run-over skull / RIP stone beside "Run over"): the 43 x 42 stone fits at UIScale 1
		 * (one screen px per art px), a little over the title's line (HUD_VIEW.bigText 36 + 4).
		 */
		header: 44,
		/**
		 * The spectate bar's ghost (48 x 60 art), its largest box: the ghost takes the bar's height inside its frame rails
		 * up to this (spectateGhostBox), shrinking below one screen px per art px on a small screen.
		 */
		ghost: 60,
	},
	/**
	 * The visible border of each sliced panel, art px per side (docs/UI_ART.md UA7): the frame's rails, knobs and lips
	 * that content must not sit on, measured on UiHorror.png (the alpha / luminance map of the crop, cross-checked with
	 * its `flatBoxes` in art/atlases.json). Padding follows these, not the slice insets: ui.panel.menu's slice is 43 wide
	 * at the sides only so its top tab's rounded ends sit in the fixed corners; its side rails are 5 px. Each value is <=
	 * the slice inset on that side (skin.spec.ts). An id without an entry pads by its slice insets (contentInsetsOf).
	 *   - ui.panel.menu (87 x 78): side rails cols 0-4 / 82-86; top = the tab's lower lip (rows 0-10); bottom rails 71-77.
	 *   - ui.panel.tall (64 x 76): side rails 0-4 / 59-63; top = the tab (rows 0-9); bottom rails 69-75.
	 *   - ui.panel.hud (90 x 44): a 1-2 px rim at the sides; top rim rows 0-2; bottom the inner shade and rim, rows 41-43.
	 */
	contentInsets: {
		"ui.panel.menu": { left: 5, top: 11, right: 5, bottom: 7 },
		"ui.panel.tall": { left: 5, top: 10, right: 5, bottom: 7 },
		"ui.panel.hud": { left: 2, top: 3, right: 2, bottom: 3 },
	} satisfies Record<string, SliceInsets> as Readonly<Record<string, Readonly<SliceInsets>>>,
	/**
	 * The menu ornament (ui.ornament.bones, UAD8): drawn at the menu frames' density (refPerArt, snapped), centred on the
	 * panel's top edge horizontally, its art's `anchorY` fraction on that edge (0.5: half above, half over the top rail),
	 * outside the layout (it never moves content), only on a skinned menu panel.
	 */
	ornament: { anchorY: 0.5 },
	/**
	 * The pill progress bar (ui.bar.track / .fill, UA9): drawn at its own art height (16 px, the rows never stretch) at
	 * this density, snapped: 16 reference px at 720 p, so a loading bar grows from its flat 8 / 4 px to the pill's height.
	 */
	barRefPerArt: 1,
	/** The curse skull (ui.icon.skull.curse) behind a curse cell's label in RunItems: this transparent, the label reads. */
	curseSkullTransparency: 0.5,
	/** The panel skin per context (UAD2): red-rimmed in menus, dark in a run (red keeps meaning danger), tall for lists. */
	panels: {
		menu: "ui.panel.menu",
		hud: "ui.panel.hud",
		list: "ui.panel.tall",
	} satisfies Record<SkinPanelContext, string>,
	/** The theme ui ids the other parts draw (contract.ts uiSkinIds / uiIconIds). */
	ids: {
		button: "ui.button",
		buttonFocus: "ui.button.focus",
		buttonDisabled: "ui.button.disabled",
		optionOn: "ui.option.on",
		optionOff: "ui.option.off",
		heartFull: "ui.heart.full",
		heartHalf: "ui.heart.half",
		heartEmpty: "ui.heart.empty",
		flaskFull: "ui.flask.full",
		flaskEmpty: "ui.flask.empty",
		chip: "ui.chip",
		chipWhite: "ui.chip.white",
		barTrack: "ui.bar.track",
		barFill: "ui.bar.fill",
		candle: "ui.candle",
		focusCorner: "ui.focus.corner",
		ornament: "ui.ornament.bones",
		divider: "ui.divider",
		iconPause: "ui.icon.pause",
		iconCheck: "ui.icon.check",
		iconCross: "ui.icon.cross",
		iconGear: "ui.icon.gear",
		iconHome: "ui.icon.home",
		iconSpeaker: "ui.icon.speaker",
		iconMute: "ui.icon.mute",
		iconSkull: "ui.icon.skull",
		iconSkullCurse: "ui.icon.skull.curse",
		iconGhost: "ui.icon.ghost",
		iconRip: "ui.icon.rip",
	},
} as const;

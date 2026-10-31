/**
 * Tunables of the UI skin (docs/UI_ART.md UA5, Architecture 3): the pixel density of the 9-sliced frames, the boxes the
 * HUD fits its icons into, and which theme ui ids (contract.ts uiSkinIds / uiIconIds, all optional) each primitive
 * draws. The logic is skin.ts. Presentation only; reference px are the HUD's 1280 x 720 design pixels (HUD_VIEW).
 */
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
	 * Square boxes (reference px) the HUD fits its art icons into (fitArt, UAD7): the heart box is 24 (HUD_VIEW.heartSize
	 * is 22 until the client's status panel task, UA10, moves it with the footprint spec), so an 18 x 15 heart draws at 2
	 * screen px per art px at 1080 p. Flasks and candles sit in the hearts' rows; chips are pips; glyphs sit beside
	 * button labels.
	 */
	iconBox: {
		heart: 24,
		flask: 24,
		ember: 24,
		pip: HUD_VIEW.pipSize,
		glyph: 16,
	},
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
	},
} as const;

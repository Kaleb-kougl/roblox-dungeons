/**
 * The character screen (docs/ARCHER.md AR7 / AR8, "The character screen"; owner answers 2 and 8), pure: the cards (one
 * per character, in CHARACTER_IDS order: left to right, top to bottom in portrait), which card is focused (the last
 * pick, the remembered DisplaySettings.character) and how keys move it, what Confirm does and where Back goes for each
 * screen that opens it, the layout per arrangement (row / compact row / column) for MenuFit, the idle preview's facing
 * and frame, and the run-over panel's Character button and its exits rows. client/ui/menu CharacterScreen draws it;
 * MenuController routes every run start from the menu through it. Headlessly tested (character.spec.ts).
 *
 *   origin    what opened the screen: the main menu's Play solo (`solo`), the Daily card (`daily`), the tutorial
 *             outro's Start my first run (`outro`), the dev panel's Go (`dev`), a lobby member's Ready (`lobby`), the
 *             run-over panel's Character button (`runOver`). Again on the run-over panel never opens it (owner answer
 *             8: it keeps the run's character and starts at once).
 *   confirm   remembers the pick (SettingsController.setSelectedCharacter), then starts what the origin asked for
 *             (characterConfirmPlan): a solo / daily / dev run, readies the lobby member with the pick, or restarts
 *             the finished run as the pick.
 *   back      one screen back when the screen opened over another menu screen (the main menu, the lobby room), else
 *             the menu closes and what was under it shows again (the run-over panel, the tutorial outro, a dev run):
 *             characterBackAction. A lobby member's Back stays unready.
 *
 * @module
 */
import { CHARACTER_IDS, DEFAULT_CHARACTER, characterDef, isCharacterId, type CharacterId } from "shared/characters";
import {
	CHARACTER_SCREEN_STRINGS,
	CHARACTER_SUMMARY_LINES,
	characterLineKey,
	type ColorRole,
	type SpriteFacings,
} from "shared/theme";
import { HUD_VIEW, RECAP_UI, type RecapLayout } from "shared/view/hud";
import { MENU_VIEW } from "./config";
import { MENU_FIT } from "./fit";
import { canGoBack, type MenuNav } from "./nav";
import { LOBBY_STRINGS } from "./strings";
// By file: the shared/view barrel is this one's parent.
import { facingIndex } from "../sprites";

/** What opened the character screen (see the file comment). */
export type CharacterScreenOrigin = "solo" | "daily" | "outro" | "dev" | "lobby" | "runOver";

/** Every origin. */
export const CHARACTER_SCREEN_ORIGINS: ReadonlyArray<CharacterScreenOrigin> = [
	"solo",
	"daily",
	"outro",
	"dev",
	"lobby",
	"runOver",
];

/** One card: the character, its visual (sprite set and placeholder colour role), its name and summary line keys. */
export interface CharacterCard {
	readonly id: CharacterId;
	/** The theme visual (`class.vanguard` / `class.ranger`): the idle sprite, else the placeholder capsule. */
	readonly visualId: string;
	/** The placeholder capsule's colour role (the visual's own role). */
	readonly role: ColorRole;
	/** `class.<visual>.name` ("Knight" / "Archer"). */
	readonly nameKey: string;
	/** `character.<id>.line.1` .. `.CHARACTER_SUMMARY_LINES`. */
	readonly lineKeys: ReadonlyArray<string>;
}

function cardOf(id: CharacterId): CharacterCard {
	const visualId = characterDef(id).visualId;
	const lineKeys: string[] = [];
	for (let n = 1; n <= CHARACTER_SUMMARY_LINES; n++) lineKeys.push(characterLineKey(id, n));
	return { id, visualId, role: visualId as ColorRole, nameKey: `${visualId}.name`, lineKeys };
}

/** The cards in focus order (CHARACTER_IDS: the Knight, then the Archer). */
export function characterCards(): ReadonlyArray<CharacterCard> {
	return CHARACTER_IDS.map((id) => cardOf(id));
}

/** The card focused when the screen opens: the last pick (an untrusted stored value), else the default character. */
export function characterInitialFocus(lastPick: unknown): CharacterId {
	return isCharacterId(lastPick) ? lastPick : DEFAULT_CHARACTER;
}

/** `focus`'s index in the focus order (an unknown id: the first card). */
export function characterFocusIndex(focus: unknown): number {
	const i = isCharacterId(focus) ? CHARACTER_IDS.indexOf(focus) : -1;
	return i < 0 ? 0 : i;
}

/** The card `delta` steps from `focus` in the focus order, held at the ends (no wrap: two cards, a press is a choice). */
export function characterFocusStep(focus: unknown, delta: number): CharacterId {
	const n = CHARACTER_IDS.size();
	const i = math.clamp(characterFocusIndex(focus) + (delta > 0 ? 1 : delta < 0 ? -1 : 0), 0, n - 1);
	return CHARACTER_IDS[i];
}

/** A keyboard press on the screen: the previous / next card, or Confirm with the focused one. */
export type CharacterKeyAction = "prev" | "next" | "confirm";

/**
 * The screen's keys (Enum.KeyCode names): arrows and A / D (and W / S: the column in portrait reads either axis),
 * Enter / Space confirm. Back (Backspace, pad B) is MenuController's / the focus scope's, as on every screen.
 */
export const CHARACTER_SCREEN_KEYS = {
	prev: ["Left", "A", "Up", "W"],
	next: ["Right", "D", "Down", "S"],
	confirm: ["Return", "KeypadEnter", "Space"],
} as const;

/** What key `keyName` does on the character screen (undefined: nothing). */
export function characterKeyAction(keyName: string): CharacterKeyAction | undefined {
	if ((CHARACTER_SCREEN_KEYS.prev as ReadonlyArray<string>).includes(keyName)) return "prev";
	if ((CHARACTER_SCREEN_KEYS.next as ReadonlyArray<string>).includes(keyName)) return "next";
	if ((CHARACTER_SCREEN_KEYS.confirm as ReadonlyArray<string>).includes(keyName)) return "confirm";
	return undefined;
}

/** What Confirm starts (after remembering the pick). */
export type CharacterStart =
	/** A solo endless run (startSolo with the pick; KV_Daily still turns Play solo into the Daily). */
	| "solo"
	/** The Daily (startSolo on DAILY_WORLD_KIND with the pick). */
	| "daily"
	/** The dev panel's run (startDev with its options, seed and the pick; "Both weapons" kept). */
	| "dev"
	/** The finished run again as the pick (SimController.restartAs: same world, seed rules as Again). */
	| "restart"
	/** The lobby member readies with the pick (LobbyController.setReady(true, pick)). */
	| "ready";

export interface CharacterConfirmPlan {
	readonly start: CharacterStart;
	/** The tutorial outro reports its choice (TutorialController.closeOutro) before the run starts. */
	readonly closeOutro: boolean;
	/** After it: the menu closes (a run starts), or one screen back (the lobby room). */
	readonly after: "close" | "back";
}

const CONFIRM_PLANS: { readonly [K in CharacterScreenOrigin]: CharacterConfirmPlan } = {
	solo: { start: "solo", closeOutro: false, after: "close" },
	daily: { start: "daily", closeOutro: false, after: "close" },
	outro: { start: "solo", closeOutro: true, after: "close" },
	dev: { start: "dev", closeOutro: false, after: "close" },
	lobby: { start: "ready", closeOutro: false, after: "back" },
	runOver: { start: "restart", closeOutro: false, after: "close" },
};

/** What Confirm does for the screen `origin` opened. */
export function characterConfirmPlan(origin: CharacterScreenOrigin): CharacterConfirmPlan {
	return CONFIRM_PLANS[origin];
}

/**
 * Back (the Back button, Backspace, pad B): one screen back when the character screen opened over another menu screen
 * (`back`: the main menu, the lobby room), else the menu closes (`close`) and the run-over panel, the tutorial outro or
 * the dev run under it shows again.
 */
export function characterBackAction(nav: MenuNav): "back" | "close" {
	return canGoBack(nav) ? "back" : "close";
}

/** The confirm button's label: Ready in a lobby (it readies the member), else Start. */
export function characterConfirmKey(origin: CharacterScreenOrigin): string {
	return origin === "lobby" ? LOBBY_STRINGS.readyUp : CHARACTER_SCREEN_STRINGS.start;
}

// --- layout -------------------------------------------------------------------------------------

/** Layout tunables, reference px (the HUD's 1280 x 720 layout under its UIScale). */
export const CHARACTER_VIEW = {
	/** A card's width: side by side, and stacked in portrait (wider: the column has the room, and Start + Back fit). */
	cardWidth: { row: 232, compact: 232, column: 280 },
	/** The idle preview's square: the full row, the compact row (a landscape phone), the portrait column. */
	previewPx: { row: 128, compact: 72, column: 96 },
	/** Inside a card, around its content. */
	cardPad: 8,
	/** Between the cards. */
	cardGap: 12,
	/** Lines each summary line is given room for (they wrap at the card's width). */
	summaryRows: 2,
	/** A text line is its size + this (client/ui/hud Text). */
	lineExtra: 4,
	/** The card's outline: dim, and the focused card's in uiAccent. */
	stroke: 1,
	focusStroke: 3,
	/** The unfocused card's text dims this much (0 = full). */
	dimText: 0.35,
	/** The Start button (the screen's largest: touch's target after a tap) and Back (the menus' small button). */
	startButton: { x: 160, y: 40 },
	backButton: MENU_VIEW.smallButton,
	/** The placeholder capsule (no sprite set): its share of the preview square, wide x tall. */
	capsule: { w: 0.38, h: 0.8 },
	/** The screen panel's padding (HUD_VIEW.pad x 2, like the other menu screens). */
	panelPad: HUD_VIEW.pad * 2,
	/** docs/SILVER.md SV18: the lock row's height (the unlock hold button) and the locked card's art transparency. */
	lockRow: MENU_VIEW.smallButton.y,
	lockedArtTransparency: 0.6,
} as const;

/** How the cards are arranged: side by side, side by side with a smaller preview (a short safe area), or stacked. */
export type CharacterArrangement = "row" | "compact" | "column";

/** MenuFit's flags -> the arrangement: narrow (portrait) stacks the cards, compact (a landscape phone) shrinks them. */
export function characterArrangement(compact: boolean, narrow: boolean): CharacterArrangement {
	if (narrow) return "column";
	return compact ? "compact" : "row";
}

export interface CharacterLayout {
	readonly arrangement: CharacterArrangement;
	readonly previewPx: number;
	readonly cardW: number;
	readonly cardH: number;
	/** The Panel's width (its padding included). */
	readonly panelW: number;
}

function line(size: number): number {
	return size + CHARACTER_VIEW.lineExtra;
}

/**
 * A card's height: the preview, the name, the summary lines (each given summaryRows lines of small text), then (docs/
 * SILVER.md SV18) the lock row (the Archer's `Unlock 300` hold or `Need N more`; every card keeps its room so the
 * cards stay one size) and the upgrades line (the upgrades the next run applies).
 */
export function characterCardHeight(previewPx: number): number {
	const v = CHARACTER_VIEW;
	const summary =
		CHARACTER_SUMMARY_LINES * v.summaryRows * HUD_VIEW.smallText + CHARACTER_SUMMARY_LINES * v.lineExtra;
	const silver = HUD_VIEW.gap + v.lockRow + HUD_VIEW.gap + line(HUD_VIEW.smallText);
	return 2 * v.cardPad + previewPx + HUD_VIEW.gap + line(HUD_VIEW.titleText) + HUD_VIEW.gap + summary + silver;
}

/** The layout of `arrangement`. */
export function characterLayout(arrangement: CharacterArrangement): CharacterLayout {
	const v = CHARACTER_VIEW;
	const previewPx = v.previewPx[arrangement];
	const n = CHARACTER_IDS.size();
	const cardW = v.cardWidth[arrangement];
	const cards = arrangement === "column" ? cardW : n * cardW + (n - 1) * v.cardGap;
	return {
		arrangement,
		previewPx,
		cardW,
		cardH: characterCardHeight(previewPx),
		panelW: cards + 2 * v.panelPad,
	};
}

/**
 * The panel's size as drawn (reference px, before any fit), for the fit specs: the title (the balance beside it), the cards (a column stacks
 * them with the card gap), the buttons row, and on a desktop / pad the key hint or hint bar line; the vertical padding
 * is the caller's (it depends on the frame art's snapped scale).
 */
export function characterContentHeight(arrangement: CharacterArrangement, hintLine: boolean): number {
	const l = characterLayout(arrangement);
	const n = CHARACTER_IDS.size();
	const cards = arrangement === "column" ? n * l.cardH + (n - 1) * CHARACTER_VIEW.cardGap : l.cardH;
	// docs/SILVER.md SV18: the balance (or `Characters unavailable`) sits beside the title, in its row.
	const rows = [line(HUD_VIEW.titleText), cards, CHARACTER_VIEW.startButton.y];
	if (hintLine) rows.push(line(HUD_VIEW.smallText));
	let h = 0;
	for (const r of rows) h += r;
	return h + (rows.size() - 1) * HUD_VIEW.gap;
}

// --- the idle preview ---------------------------------------------------------------------------

/** The preview's screen angle: the character faces the camera (screen down). */
export const CHARACTER_PREVIEW_ANGLE_DEG = 270;

/** The facing row of a sprite set that faces the camera. */
export function characterPreviewFacing(facings: SpriteFacings): number {
	return facingIndex(CHARACTER_PREVIEW_ANGLE_DEG, facings);
}

/** The idle loop's frame `sec` seconds after the screen opened (reduced motion: the first frame, held). */
export function characterPreviewFrame(sec: number, fps: number, frames: number, reducedMotion: boolean): number {
	if (reducedMotion || frames <= 1 || !(fps > 0) || !(sec > 0)) return 0;
	return math.floor(sec * fps) % frames;
}

/**
 * A `w` x `h` cell fitted into a `box` square, aspect kept, whole reference px (the art is Pixelated or Default per
 * its set; a fractional size would shimmer).
 */
export function characterPreviewSize(w: number, h: number, box: number): { readonly w: number; readonly h: number } {
	if (!(w > 0) || !(h > 0) || !(box > 0)) return { w: 0, h: 0 };
	const s = math.min(box / w, box / h);
	return { w: math.max(1, math.floor(w * s)), h: math.max(1, math.floor(h * s)) };
}

// --- the run-over panel's Character button ---------------------------------------------------------

/**
 * The run-over panel shows Character beside Again (owner answer 8): a solo run (a party run's run over is Back to lobby
 * only), with Again on the panel (`again`: runOverExits) and the recap's exits (`recapOn`: the endless, daily and dev
 * worlds, the ones built with characters), for a run played as a character (RunInfo.character: "" for M1's two
 * weapons and the tutorial's world, which has no run over of its own).
 */
export function runOverCharacterShown(coop: boolean, again: boolean, recapOn: boolean, runCharacter: unknown): boolean {
	return !coop && again && recapOn && isCharacterId(runCharacter);
}

/** One button of the run-over exits. */
export type RunOverExitButton = "again" | "character" | "exit" | "details";

/** The exits in order: Again, Character beside it, the exit (Main menu / Back to lobby), Details. */
export function runOverExitButtons(again: boolean, character: boolean, details: boolean): RunOverExitButton[] {
	const out: RunOverExitButton[] = [];
	if (again) out.push("again");
	if (again && character) out.push("character");
	out.push("exit");
	if (details) out.push("details");
	return out;
}

/** The room the exits row has in `layout`: the panel's inner width (compact: the left column). */
export function runOverExitRowWidth(layout: RecapLayout): number {
	const inner = HUD_VIEW.pad * 4; // the run-over panel's padding, both sides
	if (layout === "compact") return MENU_FIT.runOverLeftWidth;
	if (layout === "narrow") return MENU_FIT.runOverNarrowWidth - inner;
	return HUD_VIEW.panelWidth * 2 - inner;
}

/** A row of exits' width: Again's size, every other button's (RECAP_UI.exits), list gaps of `gap`. */
export function runOverExitsRowWidth(row: ReadonlyArray<RunOverExitButton>, layout: RecapLayout, gap: number): number {
	const e = RECAP_UI.exits[layout];
	let w = 0;
	for (const b of row) w += b === "again" ? e.again.x : e.other.x;
	return w + math.max(0, row.size() - 1) * gap;
}

/** Where the exits go: rows in the exits' place, and whether Details stands aside (compact: atop the right column). */
export interface RunOverExitLayout {
	readonly rows: ReadonlyArray<ReadonlyArray<RunOverExitButton>>;
	/**
	 * Compact (a landscape phone) only: Details moves to the right column (it swaps that column's highlights and
	 * breakdown), so Again, Character and the exit keep one row in the left column: a second row there would cost the
	 * smallest phone its fit (fit.spec.ts).
	 */
	readonly detailsAside: boolean;
}

/**
 * The exits' layout: one row when they fit the layout's room (every run without Character: exactly today's row);
 * compact: Details aside when that leaves one row (`asideAllowed`: the panel has the right column, a scored run);
 * else Again and Character on the first row and the rest under them. Character always stands beside Again, and Again
 * keeps its place, size and focus.
 */
export function runOverExitLayout(
	buttons: ReadonlyArray<RunOverExitButton>,
	layout: RecapLayout,
	gap: number,
	asideAllowed = true,
): RunOverExitLayout {
	const room = runOverExitRowWidth(layout);
	if (runOverExitsRowWidth(buttons, layout, gap) <= room) return { rows: [buttons], detailsAside: false };
	const others: RunOverExitButton[] = [];
	for (const b of buttons) if (b !== "details") others.push(b);
	const aside = asideAllowed && layout === "compact" && others.size() < buttons.size();
	if (aside && runOverExitsRowWidth(others, layout, gap) <= room) {
		return { rows: [others], detailsAside: true };
	}
	const first: RunOverExitButton[] = [];
	const rest: RunOverExitButton[] = [];
	for (const b of buttons) {
		if (b === "again" || b === "character") first.push(b);
		else rest.push(b);
	}
	return { rows: rest.size() > 0 && first.size() > 0 ? [first, rest] : [buttons], detailsAside: false };
}

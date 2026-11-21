/**
 * The HUD's pure helpers and tunables (task 8 part B; client/ui/hud draws them with React). Plain numbers and strings,
 * tested headlessly (hud.spec.ts).
 *
 * Ported pieces (project-kaleb-vale @ 42897e2): heartFills (src/player/PlayerHud.tsx), formatClock
 * (src/playtest/PlaytestOverlay.tsx), the boss phase in Roman numerals (src/boss/BossHud.tsx). The rest is new.
 *
 * @module
 */
import { formatTenths } from "shared/l10n";
import { deviceHintOf, type DeviceHint, type InputLabelStr } from "shared/play";
import { TUTORIAL_STRINGS } from "shared/tutorial";

/**
 * The HUD font token: ONE place picks the font every HUD text uses, by Enum.Font name (headless-safe strings; the
 * client resolves them). Arcade is Roblox's built-in pixel font, the closest stand-in for the web build's pixel look;
 * a theme pack with its own font later replaces these names.
 */
export const HUD_FONTS = {
	/** Labels, numbers, banners. */
	text: "Arcade",
	/** The debug line (monospace). */
	mono: "Code",
} as const;

/** The HUD scale setting is a whole percent (shared/settings display.ts). */
const PERCENT = 100;

/** Enum.KeyCode name that toggles the Options screen (the juice settings panel; web: KeyO). */
export const SETTINGS_KEY = "O";
/** Gamepad button that closes the Options screen (B: GUI "back"). */
export const SETTINGS_PAD_CLOSE_KEY = "ButtonB";
/** Input names (Enum.KeyCode) the menus' close / resume hints name, per last-used device: label them with *Hint. */
export const SETTINGS_INPUTS = { keyboard: SETTINGS_KEY, gamepad: SETTINGS_PAD_CLOSE_KEY } as const;
/**
 * Input names (Enum.KeyCode) that pause and resume the run, per last-used device: `pauseHint` labels them. They match
 * shared/play's fixed pause inputs (bindings.spec.ts), which are not rebindable.
 */
export const PAUSE_INPUTS = { keyboard: "P", gamepad: "ButtonStart" } as const;

/** The Options screen's close hint labels ("O" / "B"), through `input.key.*` when given a string lookup. */
export function settingsHint(s?: InputLabelStr): DeviceHint {
	return deviceHintOf(SETTINGS_INPUTS, s);
}

/** The pause / resume hint labels ("P" / "Start"), through `input.key.*` when given a string lookup. */
export function pauseHint(s?: InputLabelStr): DeviceHint {
	return deviceHintOf(PAUSE_INPUTS, s);
}

/** HUD layout tunables, in reference pixels (the UIScale maps them to the screen). */
export const HUD_VIEW = {
	/** The layout is designed for this viewport; UIScale = min(w / x, h / y), clamped. */
	referenceSize: { x: 1280, y: 720 },
	minScale: 0.6,
	/** On touch (docs/MOBILE.md MB10): never below this, so body text stays >= 15 pt on a phone. */
	touchMinScale: 0.75,
	/**
	 * Upright on touch (docs/PORTRAIT.md PT7): the HUD scale never makes this many reference px wider than the screen,
	 * the widest top-centre bar on touch (the slim boss bar and the spectate bar, 420) plus a margin on each side, so a
	 * larger HUD scale setting stops where they still fit (a 360 pt phone: 0.8 at most). portraitHud.spec.ts holds it.
	 */
	touchUprightWidth: 452,
	maxScale: 1.75,
	/** Console / TV (GuiService:IsTenFootInterface): everything this much larger (read from across the room). */
	tenFootBoost: 1.25,
	/** Gap from the safe-area edges. */
	margin: 16,
	pad: 8,
	gap: 6,
	textSize: 20,
	smallText: 16,
	bigText: 36,
	titleText: 24,
	/**
	 * Hearts, pips, weapon slots (docs/HUD_LAYOUT.md H5: compact slots, 132 x 40 / text 20 before). The heart box went
	 * 22 -> 24 with the UI art (docs/UI_ART.md UA10, UAD7): an 18 x 15 art heart fits it at 2 screen px per art px at
	 * 1080 p; 24 is a label line's height, so no status row grows (statusEstimate unchanged).
	 */
	heartSize: 24,
	pipSize: 12,
	weaponSlotSize: { x: 108, y: 30 },
	weaponTextSize: 16,
	/** The inactive weapon slot's background transparency (the slot in hand is opaque). */
	weaponInactiveTransparency: 0.7,
	/** StatusPanel: the HP / Flask / Ember labels' column width (docs/HUD_LAYOUT.md H4, HD8: the words stay). */
	statusLabelWidth: 86,
	/**
	 * Boss bar. Its bar went 12 -> 16 with the UI art (docs/UI_ART.md UA11): the ui.bar pill is 16 art px tall, so 16 is
	 * the smallest row it fits at a whole screen px per art px at 720 p (shared/view/hud hudSkin pillFit); the flat bar
	 * takes the same row, so both looks lay out alike (HUD_TRANSIENT.bossBar, the touch tutorial prompt under it).
	 */
	bossWidth: 520,
	bossBarHeight: 16,
	bossNotchWidth: 2,
	/** Panels. */
	panelTransparency: 0.25,
	overlayTransparency: 0.45,
	panelWidth: 420,
	buttonSize: { x: 260, y: 40 },
	/** Settings option buttons. */
	optionSize: { x: 92, y: 30 },
	/** The HUD scale row's narrower buttons: six percent steps (70-125, docs/HUD_LAYOUT.md H8) fit OPTIONS_VIEW.width. */
	scaleOptionWidth: 76,
	settingsLabelWidth: 210,
	/** Characters of a server hash shown in the verdict line. */
	hashChars: 8,
	/**
	 * Score panel (top right, scored runs): width and the combo meter's bar height (docs/COMBO.md CB5, CD8: 6 -> 10,
	 * the tier colours and the warning blink need the room; scoreEstimate 158 of HUD_FOOTPRINT.score's 160).
	 */
	scoreWidth: 200,
	comboBarHeight: 10,
	/** Results breakdown: label and value column widths. */
	breakdownLabelWidth: 200,
	breakdownValueWidth: 110,
	/** Display order: the HUD under the pause / settings layer. */
	hudDisplayOrder: 10,
	menuDisplayOrder: 20,
	/**
	 * The full-screen layer the overlays' dims draw into (client/ui/hud ScreenDim, docs/UI_ART.md "Phones"): just under
	 * the pause / settings layer, over the menu shell (MENU_VIEW.displayOrder 15) as the dims were.
	 */
	menuDimDisplayOrder: 19,
} as const;

/**
 * The clamped HUD scale for a viewport (console screens get HUD_VIEW.tenFootBoost), times the player's HUD scale
 * setting (`userPercent`, shared/settings display.ts; applied after the clamp so 80 % is always smaller). On touch the
 * lower clamp is HUD_VIEW.touchMinScale instead of minScale; upright on touch the result is capped so
 * HUD_VIEW.touchUprightWidth fits the width (docs/PORTRAIT.md PT7).
 */
export function computeHudScale(
	viewportW: number,
	viewportH: number,
	tenFoot: boolean,
	userPercent = PERCENT,
	touch = false,
): number {
	const user = userPercent > 0 ? userPercent / PERCENT : 1;
	if (!(viewportW > 0) || !(viewportH > 0)) return user;
	const s = math.min(viewportW / HUD_VIEW.referenceSize.x, viewportH / HUD_VIEW.referenceSize.y);
	const floor = touch ? HUD_VIEW.touchMinScale : HUD_VIEW.minScale;
	const scale = math.clamp(s * (tenFoot ? HUD_VIEW.tenFootBoost : 1), floor, HUD_VIEW.maxScale) * user;
	return touch && viewportH > viewportW ? math.min(scale, viewportW / HUD_VIEW.touchUprightWidth) : scale;
}

/** heartFills' entries: a whole heart's half hearts (0 / 1 / 2), or the half container of an odd maximum. */
export const HEART_FILL = {
	EMPTY: 0,
	HALF: 1,
	FULL: 2,
	/** The last heart of an ODD heartsMax holding its half heart: a half container (docs/SILVER.md SV16, OC18). */
	HALF_MAX_FULL: 3,
	/** The last heart of an odd heartsMax, spent: the half container, empty. */
	HALF_MAX_EMPTY: 4,
} as const;

/** Half hearts in a whole heart. */
const HALVES_PER_HEART = 2;

/** A heartFills entry is the half container of an odd maximum (HALF_MAX_FULL or HALF_MAX_EMPTY). */
export function isHalfContainer(fill: number): boolean {
	return fill === HEART_FILL.HALF_MAX_FULL || fill === HEART_FILL.HALF_MAX_EMPTY;
}

/**
 * Splits half-heart health into per-heart fills, one entry per heart of heartsMax (ceil(heartsMax / 2)): 2 full, 1 half,
 * 0 empty (web PlayerHud). docs/SILVER.md SV16 (OC18): with an ODD heartsMax the last entry is a half container,
 * HALF_MAX_FULL while it holds its half heart (hearts >= heartsMax) and HALF_MAX_EMPTY once spent, never a half-filled
 * heart (which means hurt). Even maxima are exactly the web split.
 */
export function heartFills(hearts: number, heartsMax: number): number[] {
	const n = math.ceil(heartsMax / HALVES_PER_HEART);
	const odd = heartsMax % HALVES_PER_HEART === 1;
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const held = hearts - i * HALVES_PER_HEART;
		if (odd && i === n - 1) out.push(held >= 1 ? HEART_FILL.HALF_MAX_FULL : HEART_FILL.HALF_MAX_EMPTY);
		else out.push(math.max(HEART_FILL.EMPTY, math.min(HEART_FILL.FULL, held)));
	}
	return out;
}

/**
 * Enum.KeyCode name that toggles the leaderboard panel ("B" for boards). Not N: that is the endless debug floor skip
 * (shared/play KEY_BINDINGS); L / F8 are the debug replay check, O the settings panel, R restart. Gamepads open the
 * panel from the pause overlay (no pad binding). hud.spec.ts checks it clashes with no other binding.
 */
export const LEADERBOARD_KEY = "B";
// The leaderboard panel's close hint follows the player's bindings: shared/play leaderboardHint (default B / B).

/** Leaderboard panel layout (reference pixels) and refresh. */
export const LEADERBOARD_VIEW = {
	width: 560,
	/** The scrolling list of the top rows. */
	listHeight: 360,
	rowHeight: 22,
	rankWidth: 52,
	scoreWidth: 120,
	floorWidth: 80,
	/** The panel asks the server again for a board at most this often (the server caches 60 s anyway). */
	refreshSeconds: 15,
	scrollBarThickness: 6,
	/** docs/DAILY.md DS9: the scope tabs (Today / Yesterday / All time: 3 across the 528 px content). */
	scopeTab: { x: 170, y: 36 },
	/** The board tabs (Solo / Co-op) and, on daily scopes, the filter tabs (Global / Friends): 4 across. */
	boardTab: { x: 126, y: 30 },
} as const;

/** m:ss of sim time (web formatClock). */
export function formatClock(seconds: number): string {
	const s = math.max(0, math.floor(seconds));
	return string.format("%d:%02d", math.floor(s / 60), s % 60);
}

const ROMAN = ["", "I", "II", "III", "IV", "V"];

/** Boss phase as the web BossHud shows it: Roman numerals for 1..5, else the number. */
export function romanPhase(phase: number): string {
	return phase >= 1 && phase < ROMAN.size() && phase === math.floor(phase) ? ROMAN[phase] : tostring(phase);
}

/** The `skipped` code of a tutorial run (shared/play UnsubmittedReason "tutorial"): its own verdict line. */
export const TUTORIAL_VERDICT_CODE = "tutorial";

/**
 * The string key of a verdict status line ("" for none). A tutorial run's line (skipped, code `tutorial`) is the
 * tutorial's own "Practice: not submitted (tutorial)".
 */
export function verdictKey(status: string, code?: string): string {
	if (status === "skipped" && code === TUTORIAL_VERDICT_CODE) return TUTORIAL_STRINGS.verdict;
	switch (status) {
		case "pending":
		case "accepted":
		case "rejected":
		case "skipped":
			return `hud.verdict.${status}`;
		default:
			return "";
	}
}

/** The first `n` characters of a hash (the verdict line shows a short one). */
export function shortHash(hash: string | undefined, n: number = HUD_VIEW.hashChars): string {
	return hash === undefined ? "" : hash.sub(1, n);
}

/** Boss bar fill fraction, clamped to [0, 1]. */
export function bossFraction(hp: number, hpMax: number): number {
	return hpMax > 0 ? math.clamp(hp / hpMax, 0, 1) : 0;
}

/** Combo tenths as the HUD shows it: one decimal in the number locale's separator (13 -> "1.3" / "1,3"). */
export function formatCombo(tenths: number): string {
	return formatTenths(tenths);
}

/** Combo meter fill: ticks left over the window, clamped to [0, 1]. */
export function comboFraction(ticksLeft: number, windowTicks: number): number {
	return windowTicks > 0 ? math.clamp(ticksLeft / windowTicks, 0, 1) : 0;
}

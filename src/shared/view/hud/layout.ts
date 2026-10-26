/**
 * The HUD's pure helpers and tunables (task 8 part B; client/ui/hud draws them with React). Plain numbers and strings,
 * tested headlessly (hud.spec.ts).
 *
 * Ported pieces (project-kaleb-vale @ 42897e2): heartFills (src/player/PlayerHud.tsx), formatClock
 * (src/playtest/PlaytestOverlay.tsx), the boss phase in Roman numerals (src/boss/BossHud.tsx). The rest is new.
 */
import { COMBO_DENOMINATOR } from "shared/sim";
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
/** Key names the menus show, per last-used device. */
export const SETTINGS_HINT = { keyboard: SETTINGS_KEY, gamepad: "B" } as const;
export const PAUSE_HINT = { keyboard: "P", gamepad: "Start" } as const;

/** HUD layout tunables, in reference pixels (the UIScale maps them to the screen). */
export const HUD_VIEW = {
	/** The layout is designed for this viewport; UIScale = min(w / x, h / y), clamped. */
	referenceSize: { x: 1280, y: 720 },
	minScale: 0.6,
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
	/** Hearts, pips, weapon slots. */
	heartSize: 22,
	pipSize: 12,
	weaponSlotSize: { x: 132, y: 40 },
	/** Boss bar. */
	bossWidth: 520,
	bossBarHeight: 12,
	bossNotchWidth: 2,
	/** Panels. */
	panelTransparency: 0.25,
	overlayTransparency: 0.45,
	panelWidth: 420,
	buttonSize: { x: 260, y: 40 },
	/** Settings option buttons. */
	optionSize: { x: 92, y: 30 },
	settingsLabelWidth: 210,
	/** Characters of a server hash shown in the verdict line. */
	hashChars: 8,
	/** Score panel (top right, scored runs): width and the combo meter's bar height. */
	scoreWidth: 200,
	comboBarHeight: 6,
	/** Results breakdown: label and value column widths. */
	breakdownLabelWidth: 200,
	breakdownValueWidth: 110,
	/** Display order: the HUD under the pause / settings layer. */
	hudDisplayOrder: 10,
	menuDisplayOrder: 20,
} as const;

/**
 * The clamped HUD scale for a viewport (console screens get HUD_VIEW.tenFootBoost), times the player's HUD scale
 * setting (`userPercent`, shared/settings display.ts; applied after the clamp so 80 % is always smaller).
 */
export function computeHudScale(viewportW: number, viewportH: number, tenFoot: boolean, userPercent = PERCENT): number {
	const user = userPercent > 0 ? userPercent / PERCENT : 1;
	if (!(viewportW > 0) || !(viewportH > 0)) return user;
	const s = math.min(viewportW / HUD_VIEW.referenceSize.x, viewportH / HUD_VIEW.referenceSize.y);
	return math.clamp(s * (tenFoot ? HUD_VIEW.tenFootBoost : 1), HUD_VIEW.minScale, HUD_VIEW.maxScale) * user;
}

/** Splits half-heart health into per-heart fills (2 full, 1 half, 0 empty), one entry per heart of heartsMax. */
export function heartFills(hearts: number, heartsMax: number): number[] {
	const n = math.ceil(heartsMax / 2);
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(math.max(0, math.min(2, hearts - i * 2)));
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

/** Combo tenths as the HUD shows it: one decimal (13 -> "1.3"). */
export function formatCombo(tenths: number): string {
	return string.format("%d.%d", math.floor(tenths / COMBO_DENOMINATOR), tenths % COMBO_DENOMINATOR);
}

/** Combo meter fill: ticks left over the window, clamped to [0, 1]. */
export function comboFraction(ticksLeft: number, windowTicks: number): number {
	return windowTicks > 0 ? math.clamp(ticksLeft / windowTicks, 0, 1) : 0;
}

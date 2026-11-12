/**
 * Menu shell and lobby UI tunables (client/ui/menu), in the HUD's reference pixels (shared/view/hud HUD_VIEW: the
 * 1280x720 layout under the HUD's UIScale), plus the menu's fixed keys.
 */

/** Enum.KeyCode names that go back one menu screen (pad B: GUI "back"; Escape stays Roblox's menu key). */
export const MENU_BACK_KEYS: ReadonlyArray<string> = ["ButtonB", "Backspace"];

/** Key names the menu's back hint shows, per last-used device. */
export const MENU_BACK_HINT = { keyboard: "Backspace", gamepad: "B" } as const;

/**
 * The pad button that presses the selected menu button. While a menu (or the run-over panel) is open the pad drives
 * the GUI selection, so the run-over panel's pad hint is this (its "Again" button starts selected), not the D-pad.
 */
export const PAD_CONFIRM_LABEL = "A";

export const MENU_VIEW = {
	/** Backdrop over the world while a menu screen is up (uiPanel / background roles). */
	backdropTransparency: 0.15,
	/** Main menu column. */
	mainWidth: 420,
	/** Lobby browser and lobby room panels. */
	screenWidth: 700,
	/** The Credits screen's panel (main menu > Credits; long titles wrap). */
	creditsWidth: 520,
	/** Scrolling lists (browser rows, members, the invite list). */
	listHeight: 300,
	inviteListHeight: 180,
	rowHeight: 36,
	scrollBarThickness: 6,
	/** Row columns (browser: name, count, visibility; room: name, tags). */
	nameWidth: 220,
	countWidth: 60,
	tagWidth: 100,
	smallButton: { x: 110, y: 30 },
	wideButton: { x: 180, y: 30 },
	/**
	 * A MenuButton's count badge (claude/codex-plan.md CX7: the Codex button's NEW count): a uiAccent pill on the
	 * button's top-right corner, `offset` px out past it each way, its text padded by padX / padY.
	 */
	buttonBadge: { textSize: 14, padX: 5, padY: 1, offset: 6, zIndex: 6 },
	/** Invite toasts (top right, on menu screens) and the in-run invite badge (bottom centre). */
	inviteToastWidth: 380,
	inviteToastTop: 16,
	badgeBottom: 72,
	/** Lobby notices (top centre). */
	noticeTop: 120,
	noticeWidth: 520,
	noticeSeconds: 4,
	/** A notice with a button (inviteArrived's Invite) stays this long instead. */
	actionNoticeSeconds: 10,
	maxNotices: 3,
	/** Most invite toasts shown at once (the rest wait). */
	maxInviteToasts: 3,
	/** The countdown / invite expiry labels refresh this often while shown. */
	refreshSeconds: 0.2,
	/** Display order of the menu shell: above the HUD, under the pause / settings layer (shared/view/hud HUD_VIEW). */
	displayOrder: 15,
	/**
	 * The backdrop's own full-screen ScreenGui, just under the shell (docs/UI_ART.md "Phones"): inside the shell's
	 * safe-area ScreenGui it stopped at the top bar and a phone's notch insets and read as a second, plain panel.
	 */
	backdropDisplayOrder: 14,
	/**
	 * The shell's pointer sink (client/ui/menu MenuLayer, pointer.ts menuPointerSinkShown): a full-screen, invisible,
	 * Active button over the menu screen while a panel (Options, leaderboards) is open, so mouse and touch never reach
	 * the screen under the panel's dim. Its ZIndex among the shell's Screen frame children (the screen body and the
	 * invite toasts, which leave the default 1): above them under ZIndexBehavior.Sibling.
	 */
	pointerSinkZIndex: 10,
} as const;

/**
 * The on-screen pause button (client/ui/hud PauseButton): a round button in the Roblox top bar, right of Roblox's own
 * buttons (GuiService.TopbarInset, plus the touch allowance: pauseButtonSlot), in screen pixels (the top bar is not
 * under the HUD's UIScale). With the top bar hidden (TopbarInset empty) it sits `fallbackMargin` from the screen's top
 * left corner.
 */
export const PAUSE_BUTTON_VIEW = {
	/** Diameter; never taller than the top bar. */
	size: 44,
	/** Gap from the end of Roblox's buttons (TopbarInset.Min.X, plus the touch allowance on touch). */
	gap: 8,
	/**
	 * Touch only: Roblox's own top-bar buttons can reach one of its buttons (`robloxButton`, the 44 pt circle / pill
	 * slot) and its gap past TopbarInset.Min.X. On the owner's phone (693 x 320, voice chat on, 2026-10-31) the pill's
	 * voice / headset button ended 49 pt past Min.X (TopbarInset leaves it out), so the pause button was drawn behind
	 * it. Applied on every touch device: whether that button shows is not known up front (it depends on the player's
	 * voice eligibility and appears late). Desktop (mouse / pad) keeps Min.X.
	 */
	robloxButton: 44,
	robloxButtonGap: 8,
	fallbackMargin: 12,
	backgroundTransparency: 0.3,
	/** The two bars of the pause glyph, as fractions of the button: width, height, gap between them. */
	barWidth: 0.12,
	barHeight: 0.42,
	barGap: 0.12,
	/**
	 * The framed pause icon (ui.icon.pause, 14 x 14 art; docs/UI_ART.md UA8) in place of the bars: its box as a fraction
	 * of the button (0.7 x 44 = 30.8 screen px: the art at 2 px per art px, 28 px, whose corners stay inside the circle).
	 */
	iconFraction: 0.7,
	strokeThickness: 2,
	/** Above the HUD, under the menu shell (MENU_VIEW.displayOrder) and the pause / settings layer. */
	displayOrder: 12,
} as const;

/**
 * Gamepad menus (docs/GAMEPAD_MENUS.md GM1): the focus controller's and the pad shortcuts' tunables (client
 * FocusController / useFocusScope / PadHintBar; pure rules in focus.ts, padActions.ts, padHints.ts).
 */
export const GAMEPAD_MENU = {
	/** Run over: holding B this long does what the Exit button does (section 3, GMD13). */
	holdExitSec: 0.6,
	/** Right stick: pixels a scope's main list scrolls per step (reference pixels, under the HUD's UIScale). */
	scrollStepPx: 36,
	/** Right stick: seconds between scroll steps while the stick is held past the dead zone. */
	scrollRepeatSec: 0.06,
	/** Right stick: an axis inside this magnitude does not scroll (0..1). */
	stickDeadZone: 0.35,
	/** A list that follows the selection keeps the selected row this far inside its frame (reference pixels). */
	followMarginPx: 12,
	/**
	 * TV-safe inset on a ten-foot interface (GM12), as a fraction of the screen on each side. Provisional: GM0 measures
	 * what the engine already leaves (GuiService:GetGuiInset, the ScreenGui safe-area modes) on a console.
	 */
	tvSafe: { x: 0.05, y: 0.05 },
	/**
	 * A scope's default button's SelectionOrder (FocusController): below every other button's 0, so
	 * `GuiService:Select(scopeRoot)` lands on it.
	 */
	defaultSelectionOrder: -1,
	/**
	 * A MenuButton activation counts as the pad's confirm (its haptic tick, GM9) only when ButtonA went down this many
	 * seconds before it or less (a mouse click while the device still reads gamepad does not buzz).
	 */
	confirmPressWindowSec: 0.25,
	/** The run-over Exit button's hold fill (uiAccent under the label, MenuButton `fill`): its transparency. */
	holdFillTransparency: 0.45,
	/**
	 * A Roblox CoreGui prompt (GuiService.SelectedCoreObject set, or our invite prompt) keeps FocusController away for
	 * this long after it went, so the B that closed it never also goes back a screen (CorePromptGuard).
	 */
	corePromptGraceSec: 0.3,
	/**
	 * Our invite prompt (PromptGameInvite) counts as open from the request until SocialService.GameInvitePromptClosed,
	 * a refusal, or this many seconds at most (a prompt that never reports closing never locks the menus for long).
	 */
	invitePromptHoldSec: 60,
} as const;

/**
 * The Name of FocusController's empty PlayerGui.SelectionImageObject (GMD7). The pad spike (KV_PadSpike) treats a
 * frame of this Name as "no image" when it saves the original, so it never restores a frame FocusController destroyed.
 */
export const NO_SELECTION_IMAGE_NAME = "KV_NoSelectionImage";

/**
 * The hint bar (client/ui/hud PadHintBar, GM7), reference px: one row of `[glyph] label` items at the bottom of a
 * scope's panel, shown only on a gamepad.
 */
export const PAD_HINT_VIEW = {
	/** A glyph's square (the engine's image, or the text fallback's box height). */
	glyphSize: 22,
	/** Between a hint's glyphs (LB RB) and between the glyphs and the label. */
	glyphGap: 2,
	labelGap: 4,
	/** Between two hints. */
	itemGap: 14,
	/** The text fallback's plate behind a key name (uiPanel, this transparent). */
	plateTransparency: 0.2,
	/** The plate's outline (uiTextDim). */
	plateStroke: 1,
} as const;

/**
 * Workspace attributes of the gamepad menus (client FocusController). Off by default:
 * `workspace:SetAttribute("KV_FocusDebug", true)` prints every change of the scope that owns the pad and every
 * selection the controller makes (with its path under PlayerGui).
 */
export const GAMEPAD_MENU_ATTRIBUTES = {
	focusDebug: "KV_FocusDebug",
} as const;

/** The pad's vibration motors the menu uses (Enum.VibrationMotor names). */
export type MenuHapticMotor = "Small" | "Large";

/** One vibration pulse: a motor at `strength` (0..1) for `seconds`, starting `delaySec` after the cue. */
export interface MenuHapticPulse {
	readonly motor: MenuHapticMotor;
	readonly strength: number;
	readonly seconds: number;
	readonly delaySec: number;
}

/** The menu's haptic cues (GM9). No haptic on focus moves (the console guidelines warn against overuse). */
export type MenuHaptic = "confirm" | "disabled" | "listEnd" | "holdComplete";
export const MENU_HAPTIC_KINDS: ReadonlyArray<MenuHaptic> = ["confirm", "disabled", "listEnd", "holdComplete"];

/** Longest single pulse a menu cue may play: a tick, never a rumble. */
export const MENU_HAPTIC_MAX_PULSE_SEC = 0.2;

/**
 * Every menu cue's pulses (client PadHaptics plays them; silent where the pad has no such motor, and with
 * DisplaySettings.padVibration Off): a light tick on confirm, a short double buzz on pressing a disabled button, a
 * tick at a list's end when scrolling into it, a firmer tick when hold-B completes.
 */
export const MENU_HAPTICS: { readonly [K in MenuHaptic]: ReadonlyArray<MenuHapticPulse> } = {
	confirm: [{ motor: "Small", strength: 0.35, seconds: 0.05, delaySec: 0 }],
	disabled: [
		{ motor: "Small", strength: 0.5, seconds: 0.06, delaySec: 0 },
		{ motor: "Small", strength: 0.5, seconds: 0.06, delaySec: 0.12 },
	],
	listEnd: [{ motor: "Small", strength: 0.25, seconds: 0.04, delaySec: 0 }],
	holdComplete: [{ motor: "Large", strength: 0.5, seconds: 0.1, delaySec: 0 }],
};

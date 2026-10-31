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
} as const;

/**
 * The on-screen pause button (client/ui/hud PauseButton): a round button in the Roblox top bar, right of Roblox's own
 * buttons (GuiService.TopbarInset), in screen pixels (the top bar is not under the HUD's UIScale). With the top bar
 * hidden (TopbarInset empty) it sits `fallbackMargin` from the screen's top left corner.
 */
export const PAUSE_BUTTON_VIEW = {
	/** Diameter; never taller than the top bar. */
	size: 44,
	/** Gap from the end of Roblox's buttons (TopbarInset.Min.X). */
	gap: 8,
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

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
	maxNotices: 3,
	/** Most invite toasts shown at once (the rest wait). */
	maxInviteToasts: 3,
	/** The countdown / invite expiry labels refresh this often while shown. */
	refreshSeconds: 0.2,
	/** Display order of the menu shell: above the HUD, under the pause / settings layer (shared/view/hud HUD_VIEW). */
	displayOrder: 15,
} as const;

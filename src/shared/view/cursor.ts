/**
 * The gauntlet cursor (docs/CURSOR.md section 3, task C3): which pointer shows (cursorMode), which art (cursorVisualId),
 * its whole-number scale for the window and the Cursor size setting (cursorScale), and where its label goes so the
 * fingertip sits exactly on the mouse, through the click squeeze too (cursorPlacement). Plain numbers, so it is specced
 * headlessly (cursor.spec.ts); the client's CursorController reads the engine and writes the GUI. Presentation only.
 *
 * The gauntlet shows in a menu context only (menus, panels, the loading screen and stage cover, pause, the party
 * overlay, the boon draft, run over, the tutorial outro); gameplay always keeps Roblox's pointer (D1).
 */
import type { CursorSize } from "shared/settings";
import { CURSOR_VIEW } from "./cursorConfig";

/** custom: the gauntlet, the system pointer off; system: Roblox's pointer; hidden: no pointer at all. */
export type CursorMode = "custom" | "system" | "hidden";

export interface CursorModeInput {
	/** The pack has gauntlet art (the placeholder pack has none). */
	readonly hasCustomArt: boolean;
	/** That art has downloaded on this device (docs/STAGE_ASSETS.md: never an empty pointer while it loads). */
	readonly artReady: boolean;
	/** A menu screen, panel, the loading screen / stage cover, a paused run, run over, the outro, or the local draft. */
	readonly menuContext: boolean;
	/** UserInputService.MouseEnabled. */
	readonly mouseEnabled: boolean;
	/** A touch device without a mouse: never the gauntlet. */
	readonly touchOnly: boolean;
	/** The last input was a gamepad: no pointer in either context until the mouse moves or clicks. */
	readonly onGamepad: boolean;
	/** The Roblox menu (Esc) is open: CoreGui draws its own cursor above ours. */
	readonly robloxMenuOpen: boolean;
	/** The game window has focus. */
	readonly windowFocused: boolean;
	/** KV_SystemCursor: Roblox's pointer everywhere. */
	readonly killSwitch: boolean;
}

/**
 * The pointer to show: hidden on a gamepad (either context); custom in a menu context with the art present and ready,
 * a mouse, not touch-only, the Roblox menu closed and no kill switch, but hidden while the window is unfocused there
 * (no frozen gauntlet at the window's edge); system everywhere else, so gameplay is never custom.
 */
export function cursorMode(input: CursorModeInput): CursorMode {
	if (input.onGamepad) return "hidden";
	const custom =
		input.menuContext &&
		input.hasCustomArt &&
		input.artReady &&
		input.mouseEnabled &&
		!input.touchOnly &&
		!input.robloxMenuOpen &&
		!input.killSwitch;
	if (!custom) return "system";
	return input.windowFocused ? "custom" : "hidden";
}

export type CursorVisualId = typeof CURSOR_VIEW.visualId | typeof CURSOR_VIEW.hoverVisualId;

/** The yellow gauntlet over a button, else the white one (D3). */
export function cursorVisualId(state: { readonly overButton: boolean }): CursorVisualId {
	return state.overButton ? CURSOR_VIEW.hoverVisualId : CURSOR_VIEW.visualId;
}

/**
 * The cursor's whole-number scale: Normal follows the viewport's height in whole steps (baseScale at referenceHeight,
 * at least 1), the size adds its step, clamped to [minScale, maxScale]. Normal at 720 / 1080 / 1440 / 2160 px = 1 / 2 /
 * 3 / 4; Small 1 / 1 / 2 / 3; Large 2 / 3 / 4 / 5. A height that is not a positive number reads as the smallest.
 */
export function cursorScale(viewportHeight: number, size: CursorSize): number {
	const v = CURSOR_VIEW;
	const auto = viewportHeight > 0 ? math.max(1, math.round((v.baseScale * viewportHeight) / v.referenceHeight)) : 1;
	const step = v.sizeSteps[size];
	return math.clamp(auto + step, v.minScale, v.maxScale);
}

/**
 * The click squeeze's factor, seconds into a press: a triangle down from 1 to pressScale at pressSec / 2 and back to 1
 * at pressSec; exactly 1 outside [0, pressSec] (no press: undefined).
 */
export function cursorSqueeze(pressT: number | undefined): number {
	const v = CURSOR_VIEW;
	if (pressT === undefined || !(pressT >= 0) || !(pressT <= v.pressSec)) return 1;
	const half = v.pressSec / 2;
	const depth = 1 - math.abs(pressT - half) / half;
	return 1 - (1 - v.pressScale) * depth;
}

/** A point or size in screen pixels (GetMouseLocation's space; the cursor's ScreenGui ignores the GUI inset). */
export interface CursorPoint {
	readonly x: number;
	readonly y: number;
}

/** The cursor label's top-left and size, screen pixels. */
export interface CursorPlacement {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/**
 * Where the cursor's label goes: the art (imageSize, art px, with its fingertip at pivot) drawn at scale x the squeeze
 * (cursorSqueeze(pressT)), placed so the pivot lands exactly on the mouse. The squeeze scales about the fingertip, so
 * the click point never moves.
 */
export function cursorPlacement(
	mouse: CursorPoint,
	pivot: CursorPoint,
	imageSize: CursorPoint,
	scale: number,
	pressT: number | undefined,
): CursorPlacement {
	const k = scale * cursorSqueeze(pressT);
	return {
		x: mouse.x - pivot.x * k,
		y: mouse.y - pivot.y * k,
		width: imageSize.x * k,
		height: imageSize.y * k,
	};
}

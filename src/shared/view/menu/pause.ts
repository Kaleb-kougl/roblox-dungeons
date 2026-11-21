/**
 * When the pause overlay and the on-screen pause button show, and what closing the Roblox menu does to a solo run
 * (client/ui/hud PauseOverlay / PauseButton, client SimController), and where the pause button sits in the Roblox top
 * bar (pauseButtonSlot). Pure, headlessly tested (pause.spec.ts).
 *
 * Roblox keeps Escape (and the pad's Start) for its own menu and a game cannot take it. A solo run pauses while
 * that menu is open, the pause overlay stays hidden under it (one menu at a time), and closing it leaves the run
 * paused with the overlay up, so the player resumes when ready (P / Start / Resume) instead of landing in live bullets.
 *
 * @module
 */
import { PAUSE_BUTTON_VIEW } from "./config";

/** What the pause overlay and the pause button read. */
export interface PauseView {
	/** A run is on screen (the HUD is active). */
	readonly active: boolean;
	/** A co-op (lockstep) run: it never pauses; the pause key / button opens the party overlay instead. */
	readonly coop: boolean;
	/** The run is still being played (snapshot outcome "playing"). */
	readonly playing: boolean;
	/** Solo: the sim is paused (P / Start, the button, the Roblox menu, a panel). */
	readonly paused: boolean;
	/** Co-op: the party overlay is open. */
	readonly coopOverlay: boolean;
	/** A panel over the run (Options, leaderboards). */
	readonly panelOpen: boolean;
	/** A menu shell screen is up (main menu, lobbies). */
	readonly menuScreen: boolean;
	/** The Roblox menu (Escape) is open. */
	readonly robloxMenuOpen: boolean;
	/** The tutorial run finished (frozen under its outro card). */
	readonly tutorialEnded: boolean;
}

/**
 * The pause / party overlay shows: hidden under a panel, under the Roblox menu, under a menu screen (the character
 * screen a dev panel's Go opens over a paused run, docs/ARCHER.md AR7) and once the run is over.
 */
export function pauseOverlayShown(v: PauseView): boolean {
	return v.playing && !v.panelOpen && !v.robloxMenuOpen && !v.menuScreen && (v.coop ? v.coopOverlay : v.paused);
}

/** The on-screen pause button shows while the run is being played and nothing that pauses or covers it is open. */
export function pauseButtonShown(v: PauseView): boolean {
	if (!v.active || !v.playing || v.tutorialEnded || v.menuScreen || v.panelOpen || v.robloxMenuOpen) return false;
	return v.coop ? !v.coopOverlay : !v.paused;
}

/**
 * The Roblox menu closed. `pausedByMenu`: opening it paused the solo run (it was running). A run still being played
 * stays paused (the pause overlay shows); a finished or frozen one resumes as before (no overlay would show over
 * it, and its run-over / outro screen keeps animating). Not paused by the menu: nothing changes.
 */
export function afterRobloxMenuClosed(
	pausedByMenu: boolean,
	playing: boolean,
	frozen: boolean,
): "stayPaused" | "resume" | "unchanged" {
	if (!pausedByMenu) return "unchanged";
	return playing && !frozen ? "stayPaused" : "resume";
}

/** A rect in screen px (GuiService.TopbarInset as x / y / width / height). */
export interface TopbarRect {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

/** Where the pause button goes, screen px. */
export interface PauseButtonSlot {
	readonly x: number;
	readonly y: number;
	readonly size: number;
	/**
	 * Screen px from the free top bar's left (TopbarInset.Min.X) to the button's right edge, or, with no top bar, from
	 * the screen's left: what the touch strip keeps clear of (shared/view/hud touchStrip `reserveLeft`).
	 */
	readonly reserveLeft: number;
}

/**
 * The furthest Roblox's own left-side top-bar buttons may reach, screen px: TopbarInset.Min.X (`topbarX`), plus on
 * touch one Roblox button and its gap (PAUSE_BUTTON_VIEW.robloxButton / robloxButtonGap: the voice button TopbarInset
 * leaves out on phones).
 */
export function robloxButtonsEnd(topbarX: number, touch: boolean): number {
	const v = PAUSE_BUTTON_VIEW;
	return topbarX + (touch ? v.robloxButton + v.robloxButtonGap : 0);
}

/**
 * The pause button's slot for the free top bar `topbar` (GuiService.TopbarInset; zero-sized when the top bar is
 * hidden): PAUSE_BUTTON_VIEW.gap right of Roblox's buttons (robloxButtonsEnd), vertically centred in the bar, never
 * taller than it; with no top bar, `fallbackMargin` from the screen's top left. `touch` only moves it right in the bar
 * (desktop is exactly TopbarInset.Min.X + gap).
 */
export function pauseButtonSlot(topbar: TopbarRect, touch: boolean): PauseButtonSlot {
	const v = PAUSE_BUTTON_VIEW;
	if (!(topbar.w > 0 && topbar.h > 0)) {
		return { x: v.fallbackMargin, y: v.fallbackMargin, size: v.size, reserveLeft: v.fallbackMargin + v.size };
	}
	const size = math.min(v.size, topbar.h);
	const x = robloxButtonsEnd(topbar.x, touch) + v.gap;
	return { x, y: topbar.y + (topbar.h - size) / 2, size, reserveLeft: x + size - topbar.x };
}

/**
 * When the pause overlay and the on-screen pause button show, and what closing the Roblox menu does to a solo run
 * (client/ui/hud PauseOverlay / PauseButton, client SimController). Pure, headlessly tested (pause.spec.ts).
 *
 * Roblox keeps Escape (and the pad's Start) for its own menu and a game cannot take it. A solo run pauses while
 * that menu is open, the pause overlay stays hidden under it (one menu at a time), and closing it leaves the run
 * paused with the overlay up, so the player resumes when ready (P / Start / Resume) instead of landing in live bullets.
 */

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

/** The pause / party overlay shows: hidden under a panel, under the Roblox menu and once the run is over. */
export function pauseOverlayShown(v: PauseView): boolean {
	return v.playing && !v.panelOpen && !v.robloxMenuOpen && (v.coop ? v.coopOverlay : v.paused);
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

/**
 * Which touch surface the screen shows (docs/MOBILE_IMPL.md MB6, docs/MOBILE.md): the rule TouchControlsController
 * reads each frame. Pure, so it is specced headlessly.
 *
 * @module
 */
import type { InputDeviceKind } from "../inputMapping";

/** hidden: no touch controls; play: the move and action controls; spectate: only Next / Prev. */
export type TouchMode = "hidden" | "play" | "spectate";

/**
 * The facts `touchMode` judges, gathered each frame by the TouchControlsController from the client store and the run.
 */
export interface TouchModeInput {
	readonly device: InputDeviceKind;
	readonly gameActive: boolean;
	/** The client store's selectMenuOpen (pause, overlays, panels, run over, stage cover, loading). */
	readonly menuOpen: boolean;
	readonly robloxMenuOpen: boolean;
	/** The full map is open (a tap anywhere closes it). */
	readonly mapOpen: boolean;
	/** The finished tutorial run is frozen. */
	readonly frozen: boolean;
	readonly draftOpen: boolean;
	readonly spectating: boolean;
}

/**
 * Which touch surface to show. `hidden` unless touch was the last-used device and a game is active, and whenever
 * anything covers or freezes play (a menu, the Roblox menu, the full map, the frozen tutorial end, the boon draft);
 * otherwise `spectate` while the local player watches a teammate and `play` the rest of the time.
 */
export function touchMode(i: TouchModeInput): TouchMode {
	if (i.device !== "touch" || !i.gameActive) return "hidden";
	if (i.menuOpen || i.robloxMenuOpen || i.mapOpen || i.frozen || i.draftOpen) return "hidden";
	return i.spectating ? "spectate" : "play";
}

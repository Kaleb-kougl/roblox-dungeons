/**
 * The music track and the ambience bed the client should be playing (pure; the AudioController cross-fades to them).
 *
 *   menu      the main menu and the lobby browser: music.menu
 *   lobby     the lobby room: music.lobby, or music.menu while music.lobby is silent
 *   run       none after a death (X7: the run-over jingle, then silence), music.boss during the fight, music.tutorial
 *             in the tutorial (the floor's biome track while it is silent), else the floor's music.biome.<n>
 *   none      no run and no menu screen (the join waiting for the first-run gate, a run starting): silence
 *
 * The ambience bed follows the floor's biome (amb.b<n>) during a run only, and stops after a death.
 *
 * @module
 */
import { BIOME_MUSIC_COUNT, EVERY_ID, MUSIC, biomeAmbience, biomeMusic, type Playable } from "./cues";

/** Where the player is, for the music choice. */
export type MusicPlace = "run" | "menu" | "lobby" | "none";

/** What the music choice depends on (the HUD snapshot, the run info and the menu screen carry all of it). */
export interface MusicView {
	readonly outcome: "playing" | "dead" | "victory";
	/** A live boss is engaged. */
	readonly bossVisible: boolean;
	/** The floor's biome index 1..5, or 0 when there is no floor (greybox). */
	readonly biome: number;
	/** Where the player is; absent: in a run. */
	readonly place?: MusicPlace;
	/** The run is the first-run tutorial (RunInfo.world is the tutorial world). */
	readonly tutorial?: boolean;
}

/**
 * Where the player is, from the store's facts: a run is active, else the menu screen (lobby room, other, none).
 * `under`: the screen under the current one (MenuNav.stack's last): the character screen over the lobby room keeps the
 * lobby's music (docs/ARCHER.md AR8: a member's Ready opens it).
 */
export function musicPlace(runActive: boolean, menuScreen: string, under?: string): MusicPlace {
	if (runActive) return "run";
	if (menuScreen === "lobby" || (menuScreen === "character" && under === "lobby")) return "lobby";
	return menuScreen === "none" ? "none" : "menu";
}

/** The track that should be playing now, or undefined for silence. `playable` decides the fallbacks. */
export function musicFor(view: MusicView, playable: Playable = EVERY_ID): string | undefined {
	const place = view.place ?? "run";
	if (place === "menu") return MUSIC.menu;
	if (place === "lobby") return playable(MUSIC.lobby) ? MUSIC.lobby : MUSIC.menu;
	if (place === "none") return undefined;
	if (view.outcome === "dead") return undefined;
	if (view.outcome === "playing" && view.bossVisible) return MUSIC.boss;
	if (view.tutorial === true && playable(MUSIC.tutorial)) return MUSIC.tutorial;
	if (view.biome >= 1 && view.biome <= BIOME_MUSIC_COUNT) return biomeMusic(view.biome);
	return undefined;
}

/** The ambience bed that should be playing now (amb.b<n> of the floor's biome during a run), or undefined. */
export function ambienceFor(view: MusicView): string | undefined {
	if ((view.place ?? "run") !== "run" || view.outcome === "dead") return undefined;
	return biomeAmbience(view.biome);
}

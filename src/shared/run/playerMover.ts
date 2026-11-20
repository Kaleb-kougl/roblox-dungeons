/**
 * The player's mover for every world's SimConfig (docs/WALL_SLIDE.md Design 5, decision WSD1; a Roblox-port retune,
 * no web source): the slide (`playerSlideMover`, shared/dungeon slide.ts, `PLAYER_SLIDE`) in every live world, M1
 * included; the web build's `circleMover` only as `PlayerMover.WEB`, which the parity specs set next to
 * `setSwordTimings(WEB_SWORD_TIMINGS)` so the golden fixtures still replay bit for bit. Pure and Roblox-API-free: the
 * client's live run and the server's replay build the same mover from the same config builder.
 *
 * @module
 */
import { circleMover, playerSlideMover, type Dungeon } from "shared/dungeon";
import { PLAYER_RADIUS, type MoveResolver } from "shared/sim";

/** Which mover `playerMover` builds (setPlayerMover; specs only). */
export const PlayerMover = {
	/** The port's mover (the default): `playerSlideMover(d, PLAYER_RADIUS)`, slides round corners and pillars. */
	SLIDE: 0,
	/** The web build's mover: `circleMover(d, PLAYER_RADIUS)` (moveCircle). What every golden fixture was recorded with. */
	WEB: 1,
} as const;
export type PlayerMoverKind = (typeof PlayerMover)[keyof typeof PlayerMover];

let currentKind: PlayerMoverKind = PlayerMover.SLIDE;

/**
 * Specs only: sets the mover `playerMover` builds (e.g. to PlayerMover.WEB for a golden replay) and returns the
 * previous kind to restore. It is read when a config is built (buildRunConfig, buildEndlessRunConfig and the tutorial
 * capture it for every floor they build), so set it before building the config you replay.
 */
export function setPlayerMover(kind: PlayerMoverKind): PlayerMoverKind {
	const previous = currentKind;
	currentKind = kind;
	return previous;
}

/** The kind `playerMover` builds by default (PlayerMover.SLIDE unless a spec set another). */
export function playerMoverKind(): PlayerMoverKind {
	return currentKind;
}

/** `SimConfig.moveResolver` for the player on `d`: the slide (SLIDE, the default) or the web build's circleMover (WEB). */
export function playerMover(d: Dungeon, kind: PlayerMoverKind = currentKind): MoveResolver {
	return kind === PlayerMover.WEB ? circleMover(d, PLAYER_RADIUS) : playerSlideMover(d, PLAYER_RADIUS);
}

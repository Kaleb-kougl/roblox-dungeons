/**
 * Co-op presentation rules (M4). Presentation only: nothing here feeds the sim.
 *
 * Large parties (LARGE_PARTY_MIN_SIZE players or more): a teammate's bullets draw at TEAMMATE_BULLET_OPACITY so the
 * screen stays readable (enemy bullets and your own are untouched). Ownership comes from the bullet's emitter id
 * (shared/sim playerBulletOwner).
 *
 * @module
 */
import { playerBulletOwner } from "shared/sim";

/** Parties of this many players or more draw teammates' bullets faded. */
export const LARGE_PARTY_MIN_SIZE = 5;
/** Opacity of a teammate's bullet in a large party (0..1). */
export const TEAMMATE_BULLET_OPACITY = 0.4;

/** Part transparency for a player bullet with emitter id `emitter`, seen by player `localIndex`. */
export function playerBulletTransparency(partySize: number, emitter: number, localIndex: number): number {
	if (partySize < LARGE_PARTY_MIN_SIZE || playerBulletOwner(emitter) === localIndex) return 0;
	return 1 - TEAMMATE_BULLET_OPACITY;
}

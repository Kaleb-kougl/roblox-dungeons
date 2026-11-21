/**
 * Boss hp retune (Roblox port, CLAUDE.md decision log 2026-11-06): every boss's base hp is BOSS_HP, half the web
 * build's WEB_BOSS_HP (./shared.ts). setBossHp lets the parity specs replay the golden fixtures under the web value.
 *
 * @module
 */
import { BOSS_ACT1_DATA } from "./act1";
import { DEMONLORD_DATA } from "./demonlord";

/**
 * Specs only: sets every boss's base hp (e.g. to WEB_BOSS_HP for a golden replay) and returns the previous value to
 * restore. Hp is read at spawn, so it applies to every boss spawned afterwards.
 */
export function setBossHp(hp: number): number {
	const previous = BOSS_ACT1_DATA.hp;
	BOSS_ACT1_DATA.hp = hp;
	DEMONLORD_DATA.hp = hp;
	return previous;
}

/**
 * The crack's openers (docs/SECRET_ROOMS.md SR3, Rules "Openers", SRD2 / SRD3 / SRD8): leaf hooks, called from the four
 * places that already reach the crack's pieces. Each opens the crack only while it is HIDDEN and only through one of
 * the plan's crack slots; anything else returns false and the caller knocks as before (SR2).
 *   secretsOpenPiece(state, slot, how, player)   breakables.ts meleeHitBreakables (the sword's FINISHER only: the flag
 *                 sweepArc passes for the combo's third hit; swings 1 and 2, the guard, novas and every build effect never
 *                 pass it), rollSmashBreakables (a Wrecker owner's ROLL: buildsRollSmash checks the boon), combat.ts
 *                 playerBulletHit's piece branch (a HEAVY arrow, isHeavyArrow; stream arrows, Volatile bolts and
 *                 Ballista's bursts are not)
 *   secretsSlamAt(state, x, z, owner)   builds/siege.ts's slam: Siege Bolt slams its pin with the slam point's cell or
 *                 one of its 4-neighbours a crack cell (HEAVY, the archer's)
 *   secretsChargeAt(state, x, z, r)   the Charger's charge tick (charger.ts, before slamBreakables): a crack piece whose
 *                 cell centre is within r of (x, z), its slam test (CHARGER, credited to nobody)
 * The open breaks EVERY piece of the crack that tick (hp 0, brokenTick = tick, out of slotByCell, intact down) without
 * the breakables' break bookkeeping (no breakablesBroken / brokenSlots, no breakable score, loot, smash proc or Goldling
 * release), HIDDEN -> OPEN, openTick / openedBy / openHow, found += 1, byHow[how] += 1, SECRET points (the open's award,
 * combo-neutral) and events.opened. No rng.
 *
 * @module
 */
import { cellKey, gridToWorld, worldToGrid } from "shared/dungeon";
import type { SimState } from "../state";
import { NOT_BROKEN } from "../breakables/breakablesData";
import { hasLeft, partySize, playerAt } from "../party";
import { scoreSecret, secretOpenAwardPoints } from "../score/score";
import { SECRET_UNSET, SecretHow, SecretStatus, type SecretHowId } from "./secretsData";

/** True when `slot` is one of the HIDDEN crack's pieces. */
function crackSlotOf(state: Readonly<SimState>, slot: number): boolean {
	const sc = state.secrets;
	if (sc === undefined || sc.status !== SecretStatus.HIDDEN) return false;
	return slot >= sc.crackSlot && slot < sc.crackSlot + sc.cells;
}

/** The nearest living present player (index order breaks ties) to (x, z); SECRET_UNSET for none. */
function nearestLiving(state: Readonly<SimState>, x: number, z: number): number {
	let best = SECRET_UNSET;
	let bestD = math.huge;
	const n = partySize(state);
	for (let i = 0; i < n; i++) {
		const p = playerAt(state, i);
		if (p.dead !== 0 || hasLeft(state, i)) continue;
		const dx = p.x - x;
		const dz = p.z - z;
		const d2 = dx * dx + dz * dz;
		if (d2 < bestD) {
			bestD = d2;
			best = i;
		}
	}
	return best;
}

/** Opens the HIDDEN crack (file comment), credited to `player` (SECRET_UNSET: nobody). */
function openCrack(state: SimState, how: SecretHowId, player: number): void {
	const sc = state.secrets!;
	const b = state.breakables!;
	for (let c = 0; c < sc.cells; c++) {
		const p = b.pieces[sc.crackSlot + c];
		if (p === undefined || p.brokenTick !== NOT_BROKEN) continue;
		p.hp = 0;
		p.brokenTick = state.tick;
		b.slotByCell.delete(cellKey(p.x, p.y));
		b.intact -= 1;
	}
	sc.status = SecretStatus.OPEN;
	sc.openTick = state.tick;
	sc.openedBy = player;
	sc.openHow = how;
	sc.found += 1;
	sc.byHow[how] += 1;
	// The crack's centre: between its first and last cells.
	const x = gridToWorld(sc.crackX) + (sc.ax * (sc.cells - 1)) / 2;
	const z = gridToWorld(sc.crackY) + (sc.az * (sc.cells - 1)) / 2;
	const s = state.score;
	const points = s !== undefined ? scoreSecret(state, secretOpenAwardPoints(state, s, sc.config.openPoints)) : 0;
	sc.events.opened = {
		tick: state.tick,
		how,
		player,
		finder: player >= 0 ? player : nearestLiving(state, x, z),
		slot: sc.crackSlot,
		x,
		z,
		points,
	};
}

/**
 * An opener reached breakables slot `slot` (`how`, credited to `player`): opens the crack when `slot` is one of the
 * HIDDEN crack's pieces. Returns true when it opened (the caller then neither knocks nor counts it).
 */
export function secretsOpenPiece(state: SimState, slot: number, how: SecretHowId, player: number): boolean {
	if (state.breakables === undefined || !crackSlotOf(state, slot)) return false;
	const p = state.breakables.pieces[slot];
	if (p === undefined || p.brokenTick !== NOT_BROKEN) return false;
	openCrack(state, how, player);
	return true;
}

/** A crack piece of the HIDDEN crack on cell (gx, gy), or -1. */
function crackSlotAtCell(state: Readonly<SimState>, gx: number, gy: number): number {
	const sc = state.secrets;
	const b = state.breakables;
	if (sc === undefined || b === undefined || sc.status !== SecretStatus.HIDDEN) return -1;
	for (let c = 0; c < sc.cells; c++) {
		const p = b.pieces[sc.crackSlot + c];
		if (p !== undefined && p.brokenTick === NOT_BROKEN && p.x === gx && p.y === gy) return sc.crackSlot + c;
	}
	return -1;
}

/** The slam point's cell and its 4-neighbours, in this order. */
const SLAM_CELLS: ReadonlyArray<readonly [number, number]> = [
	[0, 0],
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
];

/**
 * Siege Bolt's slam at world (x, z) for `owner` (builds/siege.ts): the slam point's cell or one of its 4-neighbours
 * is a crack cell -> opens it (HEAVY). Returns true when it opened.
 */
export function secretsSlamAt(state: SimState, x: number, z: number, owner: number): boolean {
	const gx = worldToGrid(x);
	const gy = worldToGrid(z);
	for (const [ox, oy] of SLAM_CELLS) {
		const slot = crackSlotAtCell(state, gx + ox, gy + oy);
		if (slot >= 0) return secretsOpenPiece(state, slot, SecretHow.HEAVY, owner);
	}
	return false;
}

/**
 * A Charger's charge tick at world (x, z) with reach `r` (charger.ts, its slamBreakables test): a crack piece whose
 * cell centre is within r -> opens it (CHARGER, credited to nobody). Returns true when it opened.
 */
export function secretsChargeAt(state: SimState, x: number, z: number, r: number): boolean {
	const sc = state.secrets;
	const b = state.breakables;
	if (sc === undefined || b === undefined || sc.status !== SecretStatus.HIDDEN) return false;
	const r2 = r * r;
	for (let c = 0; c < sc.cells; c++) {
		const slot = sc.crackSlot + c;
		const p = b.pieces[slot];
		if (p === undefined || p.brokenTick !== NOT_BROKEN) continue;
		const dx = gridToWorld(p.x) - x;
		const dz = gridToWorld(p.y) - z;
		if (dx * dx + dz * dz > r2) continue;
		return secretsOpenPiece(state, slot, SecretHow.CHARGER, SECRET_UNSET);
	}
	return false;
}

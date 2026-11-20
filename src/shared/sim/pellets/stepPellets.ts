/**
 * Pellets in the tick (docs/PELLETS.md PL3 / PL4): pickups and the power pellet. Only with state.pellets
 * (SimConfig.pellets); step() / stepParty() call stepPellets between stepDrops and stepScore, so a pickup on a room's
 * clear tick counts toward its Sweep (stepScore's clearRoom judges it right after). The live / gone / sweep room hooks
 * run from stepScore (pelletRooms.ts). No rng.
 *
 *   pickups   living players in index order; for each, the pellets in its grid cell and the 8 around it (byCell; the
 *             pickup radius is under a tile and a half, so nothing farther can be in reach), in pellet index order: a
 *             pellet of a LIVE room, not taken, whose centre is within config.pickupRadius of the player's centre is
 *             taken (taken = 1). A regular pellet: its room's left -= 1, scorePellet, events.eaten. The power pellet
 *             (PD8: not a Sweep pellet, so left is untouched): pelletsPower. A dead (or departed) player takes nothing;
 *             a rolling player takes like a walking one (the position is read after the tick's movement). In co-op a
 *             pellet in reach of two players goes to the lower index.
 *   power     pelletsPower: every active enemy bullet but goo (BulletKind.GOO, PD6) and lightning strikes
 *             (BulletKind.STRIKE: no sweep erases them, docs/NEW_ENEMIES.md NED7) is erased (the pool walk sweepArc
 *             uses), counted in events.bulletsDeleted as a guard's erase is, and paid by scorePowerBullets (one award
 *             per bullet, at most config.powerMaxBullets; every bullet is erased regardless). events.power records the
 *             picker, each erased bullet's position and the points. Delayed (not yet fired) bullets are not on screen
 *             and stay, as for sweepArc.
 * Neither feeds the combo or refills its timer (PD1).
 *
 * In a tutorial run (state.tutorial) a room's last regular pickup calls tutorialOnPelletsSwept (tutorial/tutorial.ts, a
 * leaf: no require cycle), which releases the pellet lesson's sweep lock (docs/PELLETS.md PL12).
 *
 * A Snatcher killed as its record's last living member (docs/NEW_ENEMIES_2.md NXD18) hands what it carried to its
 * killer through the same pickup (pelletsCreditCarried, from the archetype's onDeath): the kill lands in stepCombat,
 * before stepPellets and stepScore, so the clear's Sweep test in stepScore sees the lowered `left` that same tick.
 *
 * @module
 */
import { cellKey, worldToGrid } from "shared/dungeon";
import type { SimState } from "../state";
import type { Vec3 } from "../combat/bullets";
import { BulletKind, BulletPayload } from "../combat/patterns";
import { partySize, playerAt } from "../party";
import { scorePellet, scorePowerBullets, scoreRoomDown } from "../score/score";
import { tutorialOnPelletsSwept } from "../tutorial/tutorial";
import { pactHoldsRoom } from "../pacts/pactRooms";
import { PELLET_STOLEN, PelletPhase } from "./pelletsData";
import { NO_PELLET_RECORD, type PelletsState } from "./pellets";

/** Scratch: the pellet indices around one player, ascending (at most 9). */
const near: number[] = [];

/** The power pellet's erase sink while its pool walk runs. */
let sinkX: number[] = [];
let sinkZ: number[] = [];

function eraseVisit(_i: number, pos: Readonly<Vec3>, payload: number): boolean {
	const kind = BulletPayload.get(payload, "kind");
	if (kind === BulletKind.GOO || kind === BulletKind.STRIKE) return false;
	sinkX.push(pos.x);
	sinkZ.push(pos.z);
	return true; // consume
}

/**
 * The power pellet, taken by `player` this tick (see the file comment). Returns the number of bullets erased. No-op
 * (0) without state.pellets.
 */
export function pelletsPower(state: SimState, player: number): number {
	const p = state.pellets;
	if (p === undefined) return 0;
	const x: number[] = [];
	const z: number[] = [];
	sinkX = x;
	sinkZ = z;
	state.combat.enemyBullets.forEachActive(eraseVisit);
	sinkX = [];
	sinkZ = [];
	const n = x.size();
	state.events.bulletsDeleted += n;
	const points = scorePowerBullets(state, n);
	p.events.power = { player, x, z, points };
	return n;
}

/** Collects the pellets around (gx, gy) into `near`, ascending. */
function gatherNear(p: Readonly<PelletsState>, gx: number, gy: number): void {
	near.clear();
	for (let dy = -1; dy <= 1; dy++) {
		for (let dx = -1; dx <= 1; dx++) {
			const k = p.byCell.get(cellKey(gx + dx, gy + dy));
			if (k === undefined) continue;
			// Insertion into the ascending list (at most 9 entries).
			let at = near.size();
			while (at > 0 && near[at - 1] > k) at--;
			near.insert(at, k);
		}
	}
}

/** True while any score record's pellets are live. */
function anyLive(p: Readonly<PelletsState>): boolean {
	for (const r of p.rooms) if (r.phase === PelletPhase.LIVE) return true;
	return false;
}

/**
 * Player `player`'s pickup of regular pellet `k` (never the power pellet) of live record `rec`: taken = 1, the room's
 * left -= 1, scorePellet (pacts' Horde: a pellet of the horde record pays x2), events.eaten and, in a tutorial run, the
 * room's last pellet releases the pellet lesson's sweep lock (docs/PELLETS.md PL12). stepPellets' pickups and the
 * Snatcher's killed-last credit (pelletsCreditCarried) both go through it.
 */
function takeRegular(state: SimState, p: PelletsState, k: number, rec: number, player: number): void {
	const room = p.rooms[rec];
	p.taken[k] = 1;
	room.left -= 1;
	const points = scorePellet(state, rec);
	p.events.eaten.push({ index: k, x: p.x[k], z: p.z[k], player, points });
	if (room.left === 0 && state.tutorial !== undefined) tutorialOnPelletsSwept(state, rec);
}

/**
 * True when score record `rec` clears this tick unless something revives it: no member present and alive
 * (scoreRoomDown) and not pacts' horde record waiting for its second wave (pactHoldsRoom): stepScore's own clear test.
 * False for -1 or without scoring.
 */
export function pelletRecordFalls(state: Readonly<SimState>, rec: number): boolean {
	const r = rec >= 0 ? state.score?.rooms[rec] : undefined;
	if (r === undefined || r.cleared !== 0) return false;
	return scoreRoomDown(state, r) && !(state.pacts !== undefined && pactHoldsRoom(state, rec));
}

/**
 * A Snatcher killed as its record's last living member (docs/NEW_ENEMIES_2.md NXD18; its onDeath, when
 * pelletRecordFalls): every pellet of record `rec` it carried (taken = PELLET_STOLEN) is credited to `player` (the
 * killer, ctx.playerIndex) as that player's pickup (takeRegular: taken = 1, left -= 1, the PELLETS points,
 * events.eaten), in index order, so the clear's Sweep can still pay this tick (stepScore runs after the kill). Only
 * while the record's pellets are LIVE. Returns how many. No-op (0) without state.pellets.
 */
export function pelletsCreditCarried(state: SimState, rec: number, player: number): number {
	const p = state.pellets;
	if (p === undefined || rec < 0) return 0;
	const r = p.rooms[rec];
	if (r === undefined || r.phase !== PelletPhase.LIVE) return 0;
	let n = 0;
	const last = r.first + r.span - 1;
	for (let k = r.first; k <= last; k++) {
		if (p.taken[k] !== PELLET_STOLEN || k === p.power) continue;
		takeRegular(state, p, k, rec, player);
		n += 1;
	}
	return n;
}

/** One tick of pickups (see the file comment). No-op without state.pellets or while no room is live. */
export function stepPellets(state: SimState): void {
	const p = state.pellets;
	if (p === undefined || !anyLive(p)) return;
	const reach = p.config.pickupRadius;
	const reach2 = reach * reach;
	const n = partySize(state);
	for (let i = 0; i < n; i++) {
		const pl = playerAt(state, i);
		if (pl.dead !== 0) continue;
		gatherNear(p, worldToGrid(pl.x), worldToGrid(pl.z));
		for (const k of near) {
			if (p.taken[k] !== 0) continue;
			const rec = p.rec[k];
			if (rec === NO_PELLET_RECORD) continue;
			const room = p.rooms[rec];
			if (room.phase !== PelletPhase.LIVE) continue;
			const dx = pl.x - p.x[k];
			const dz = pl.z - p.z[k];
			if (dx * dx + dz * dz > reach2) continue;
			if (k === p.power) {
				p.taken[k] = 1;
				pelletsPower(state, i);
				continue;
			}
			takeRegular(state, p, k, rec, i);
		}
	}
}

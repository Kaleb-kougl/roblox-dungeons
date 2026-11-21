/**
 * Full Heart (Hearty + Sharpened, docs/BUILDS_V2.md BV7; a Roblox-port duo, no web source). At full hearts (hearts ===
 * heartsMax, alive), every finisher swing (./evolutions.ts buildsOnFinisher, along the facing) and every heavy arrow
 * release (combat/weapons/defs/bow.ts, along the arrow's aim) strikes a BEAM: every living enemy within
 * FULL_HEART_RADIUS of the segment from the player to FULL_HEART_RANGE along that direction (./segment.ts nearSegment,
 * Skewer's test; centres, no actor radius; nearestEnemy's skips: free slots, corpses, actors spawned this tick), chosen
 * in slot order before any strike, each for playerHitDamage(owner, the sword's finisherDamage) through ctx.damageActor
 * at procGen 0 (the player's own move: its kills proc at gen 0 like a swing's). One BuildEvents beam entry per beam
 * (beamStruck may be 0: the beam still shows). The beam neither erases bullets nor hits breakables.
 *
 * Imports only data, types, the weapon registry and runMods, so bow.ts can call it without a require cycle (the sword's
 * finisher damage is read through the registry: FULL_HEART_WEAPON_ID).
 *
 * @module
 */
import type { SimCtx } from "../combat/ctx";
import { NO_KIND } from "../combat/actors/types";
import type { SwordData } from "../combat/weapons/defs/sword";
import { weaponAt, weaponIndex } from "../combat/weapons/registry";
import { playerHitDamage } from "../progression/runMods";
import { Duo } from "./buildsData";
import { FULL_HEART_RADIUS, FULL_HEART_RANGE, FULL_HEART_WEAPON_ID } from "./effectsData";
import { hasDuo } from "./hooks";
import { nearSegment } from "./segment";

const FULL_HEART_RADIUS2 = FULL_HEART_RADIUS * FULL_HEART_RADIUS;

/** Scratch: the beam's targets (slot order; never re-entered: a strike only damages). */
const beamed: number[] = [];

/** The beam's damage before Sharpened / Fury: the sword's finisherDamage. */
function finisherDamage(): number {
	return (weaponAt(weaponIndex(FULL_HEART_WEAPON_ID)).data as SwordData).finisherDamage;
}

/**
 * ctx's bound player struck a finisher or released a heavy arrow along the unit direction (dirX, dirZ): Full Heart's
 * beam when they own the duo and stand at full hearts (see the file comment). Returns the enemies struck (-1: no beam).
 */
export function fullHeartBeam(ctx: SimCtx, dirX: number, dirZ: number): number {
	const s = ctx.state.builds;
	if (s === undefined) return -1;
	const owner = ctx.playerIndex;
	if (!hasDuo(s.players[owner], Duo.FULL_HEART)) return -1;
	const p = ctx.player;
	if (p.dead !== 0 || p.hearts !== p.heartsMax) return -1;
	const x1 = p.x;
	const z1 = p.z;
	const x2 = x1 + dirX * FULL_HEART_RANGE;
	const z2 = z1 + dirZ * FULL_HEART_RANGE;
	beamed.clear();
	const actors = ctx.actors;
	for (let j = 0; j < actors.size(); j++) {
		const a = actors[j];
		if (a.kind === NO_KIND || a.alive === 0 || a.spawnTick === ctx.tick) continue;
		if (nearSegment(a.x, a.z, x1, z1, x2, z2, FULL_HEART_RADIUS2)) beamed.push(j);
	}
	const n = beamed.size();
	if (n > 0) {
		const damage = playerHitDamage(ctx.state, owner, finisherDamage());
		const gen = ctx.procGen;
		ctx.procGen = 0;
		for (let k = 0; k < n; k++) ctx.damageActor(actors[beamed[k]], damage);
		ctx.procGen = gen;
	}
	beamed.clear();
	const e = s.events;
	e.beamX1.push(x1);
	e.beamZ1.push(z1);
	e.beamX2.push(x2);
	e.beamZ2.push(z2);
	e.beamOwner.push(owner);
	e.beamStruck.push(n);
	return n;
}

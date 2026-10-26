/**
 * Per-player and per-floor audio edges read from sim state (docs/FX_AUDIO.md A3, X4), the way the decor director and
 * WeaponViewController read it: each frame the watch compares the state with what it saw last frame and raises edges.
 * The summed SimEvents do not say WHICH player rolled or was hit, so co-op attribution comes from here:
 *
 *   hurt       PlayerState.hurtTicks rose (a landed hit restarts the post-hit invulnerability; a lethal hit is a death)
 *   death      PlayerState.dead went 0 -> 1, unless the player left the run this frame or earlier (party.left)
 *   roll       PlayerState.rollTicks rose (a roll starts at ROLL_TICKS and can not restart while rolling)
 *   flask      PlayerState.flaskTicks rose (drinking starts at FLASK_USE_TICKS)
 *   swing      WeaponsState.swingTick changed (sweepArc records every counted melee swing); a finisher when the sword
 *              slot's SWORD_V_LAST is SWORD_FINISHER
 *   swap       WeaponsState.activeSet changed
 *   mayDeflect the player could have deleted enemy bullets this frame: the sword guard of the active set is up now or
 *              was last frame (it sweeps every tick while up), or a swing landed (swings delete bullets too). The sim
 *              sums bulletsDeleted over the party and keeps no per-player count, so this is who MAY have made them
 *   shot       (local player only) a ranged weapon slot's cooldown rose (fire() or a heavy arrow sets it)
 *   charged    (local player only) the bow slot's charge reached BOW_DATA.chargeTicks
 *   room clear state.score room records: the count of cleared rooms rose on the same floor
 *   relic      state.run.pedestalTaken: the count of taken pedestals rose on the same floor
 *   shrine     state.run.shrineUsed went 0 -> 1 on the same floor
 *   wiped      isPartyWiped went false -> true (solo: the player died; co-op: the last living player died)
 *
 * A new run (another SimState object) or reset() takes a fresh baseline: no edges on that frame. Presentation only:
 * reads the state, never writes it; no allocation per frame once the arrays have grown to the party size.
 */
import {
	BOW,
	BOW_DATA,
	BOW_V_CHARGE,
	NO_WEAPON,
	SWORD,
	SWORD_FINISHER,
	SWORD_V_LAST,
	isPartyWiped,
	swordGuard,
	partySize,
	playerAt,
	weaponAt,
	weaponsAt,
	type SimState,
	type WeaponsState,
} from "shared/sim";

/** WeaponsState.swingTick before any swing. */
const NO_SWING = -1;

/** A player's last swing kind (swingEdge): none, a combo swing, the sword's finisher. */
export const SwingEdge = { none: 0, swing: 1, finisher: 2 } as const;

function countCleared(state: Readonly<SimState>): number {
	const score = state.score;
	if (score === undefined) return 0;
	let n = 0;
	for (const r of score.rooms) if (r.cleared !== 0) n++;
	return n;
}

function countTaken(state: Readonly<SimState>): number {
	const run = state.run;
	if (run === undefined) return 0;
	let n = 0;
	for (const t of run.pedestalTaken) if (t !== 0) n++;
	return n;
}

function hasLeft(state: Readonly<SimState>, i: number): boolean {
	const party = state.party;
	return party !== undefined && party.left[i] === 1;
}

/** The weapon id of a slot's weapon index ("" for an empty slot). */
function weaponId(index: number): string {
	return index === NO_WEAPON ? "" : weaponAt(index).id;
}

/** The sword guard of the active weapon set is up. */
function guardUp(w: Readonly<WeaponsState>): boolean {
	const active = w.sets[w.activeSet];
	return active !== undefined && weaponId(active.weapon) === SWORD.id && swordGuard(active) > 0;
}

export class AudioStateWatch {
	private seen: Readonly<SimState> | undefined;
	private fresh = true;
	private size = 0;
	private readonly hurt = new Array<number>();
	private readonly roll = new Array<number>();
	private readonly flaskTicks = new Array<number>();
	private readonly dead = new Array<number>();
	private readonly swingTick = new Array<number>();
	private readonly activeSet = new Array<number>();
	private readonly guard = new Array<boolean>();
	private readonly localCooldown = new Array<number>();
	private localCharge = 0;
	private floor = 0;
	private cleared = 0;
	private taken = 0;
	private shrine = 0;
	private wipedBefore = false;

	/** Per player index (0 .. players() - 1): this frame's edges. */
	readonly hurtEdge = new Array<boolean>();
	readonly deathEdge = new Array<boolean>();
	readonly rollEdge = new Array<boolean>();
	readonly flaskEdge = new Array<boolean>();
	readonly swingEdge = new Array<number>();
	readonly swapEdge = new Array<boolean>();
	/** The player could have deleted this frame's enemy bullets (guard up now or last frame, or a swing). */
	readonly mayDeflect = new Array<boolean>();
	/** The local player fired a ranged weapon / its bow charge became full. */
	localShot = false;
	localCharged = false;
	roomCleared = false;
	relicTaken = false;
	shrineUsed = false;
	/** Every player is dead now and was not last frame: the run is over. */
	wiped = false;

	/** Forget the run: the next update takes a baseline. */
	reset(): void {
		this.fresh = true;
	}

	/** Players in the last update. */
	players(): number {
		return this.size;
	}

	/** Reads `state` (the local player is `localIndex`) and sets this frame's edges. */
	update(state: Readonly<SimState>, localIndex: number): void {
		const baseline = this.fresh || state !== this.seen;
		this.fresh = false;
		this.seen = state;
		const n = partySize(state);
		this.size = n;
		const floor = state.endless !== undefined ? state.endless.floor : 0;
		const sameFloor = !baseline && floor === this.floor;
		for (let i = 0; i < n; i++) {
			const p = playerAt(state, i);
			const w = weaponsAt(state, i);
			const left = hasLeft(state, i);
			const known = !baseline && i < this.hurt.size();
			this.hurtEdge[i] = known && !left && p.hurtTicks > this.hurt[i];
			this.deathEdge[i] = known && !left && p.dead !== 0 && this.dead[i] === 0;
			this.rollEdge[i] = known && !left && p.rollTicks > this.roll[i];
			this.flaskEdge[i] = known && !left && p.flaskTicks > this.flaskTicks[i];
			this.swapEdge[i] = known && !left && w.activeSet !== this.activeSet[i];
			const swung = known && !left && w.swingTick !== NO_SWING && w.swingTick !== this.swingTick[i];
			this.swingEdge[i] = !swung ? SwingEdge.none : this.isFinisher(w) ? SwingEdge.finisher : SwingEdge.swing;
			const guard = guardUp(w);
			this.mayDeflect[i] = known && !left && (guard || this.guard[i] || swung);
			this.guard[i] = guard;
			this.hurt[i] = p.hurtTicks;
			this.dead[i] = p.dead;
			this.roll[i] = p.rollTicks;
			this.flaskTicks[i] = p.flaskTicks;
			this.swingTick[i] = w.swingTick;
			this.activeSet[i] = w.activeSet;
		}
		this.readLocal(state, localIndex, baseline);

		const cleared = countCleared(state);
		const taken = countTaken(state);
		const shrine = state.run !== undefined ? state.run.shrineUsed : 0;
		this.roomCleared = sameFloor && cleared > this.cleared;
		this.relicTaken = sameFloor && taken > this.taken;
		this.shrineUsed = sameFloor && shrine !== 0 && this.shrine === 0;
		this.floor = floor;
		this.cleared = cleared;
		this.taken = taken;
		this.shrine = shrine;

		const wiped = isPartyWiped(state);
		this.wiped = !baseline && wiped && !this.wipedBefore;
		this.wipedBefore = wiped;
	}

	private isFinisher(w: Readonly<WeaponsState>): boolean {
		for (const set of w.sets) {
			if (weaponId(set.weapon) === SWORD.id) return set.v[SWORD_V_LAST] === SWORD_FINISHER;
		}
		return false;
	}

	private readLocal(state: Readonly<SimState>, localIndex: number, baseline: boolean): void {
		const w = weaponsAt(state, localIndex);
		let shot = false;
		let charge = 0;
		for (let k = 0; k < w.sets.size(); k++) {
			const set = w.sets[k];
			const known = !baseline && k < this.localCooldown.size();
			if (set.weapon !== NO_WEAPON) {
				const def = weaponAt(set.weapon);
				if (known && def.data.style === "ranged" && set.cooldown > this.localCooldown[k]) shot = true;
				if (def.id === BOW.id && set.v[BOW_V_CHARGE] > charge) charge = set.v[BOW_V_CHARGE];
			}
			this.localCooldown[k] = set.cooldown;
		}
		const full = BOW_DATA.chargeTicks;
		this.localShot = shot;
		this.localCharged = !baseline && charge >= full && this.localCharge < full;
		this.localCharge = charge;
	}
}

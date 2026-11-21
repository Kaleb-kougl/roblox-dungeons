/**
 * Per-player and per-floor edges read from sim state for audio and game feel (docs/FX_AUDIO.md A3, X4; docs/FEEL.md
 * J1: moved here from shared/view/audio as AudioStateWatch, unchanged, plus hurtKind), the way the decor director and
 * WeaponViewController read it: each frame the watch compares the state with what it saw last frame and raises edges.
 * The summed SimEvents do not say WHICH player rolled or was hit, so co-op attribution comes from here. The audio
 * mapper (shared/view/audio cues.ts) and each feel controller own their own instance:
 *
 *   hurt       PlayerState.hurtTicks rose (a landed hit restarts the post-hit invulnerability; a lethal hit is a death)
 *   hurtKind   what this frame's hit cost (HurtKind; "none" without a hurt or death edge): "lethal" with the death edge
 *              (a lethal hit clears hurtTicks, so it raises no hurt edge), else on a hurt edge "heart" when hearts
 *              dropped, "armor" when only an armor pip or the Aegis pip (state.drops, docs/BOOSTS.md) dropped,
 *              "harmless" when nothing dropped in the tutorial's harmless mode; nothing dropped outside it is "heart"
 *              (the hit reached the hearts and something gave them back in the same frame: M2 Second Wind)
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
 *              ("local" is the index update() is given: the view index, the watched teammate while spectating,
 *              docs/SPECTATE.md; a frame whose index differs from the last one is a fresh baseline for these two
 *              only, so a switch never plays the new player's earlier shot or full charge)
 *   room clear state.score room records: the count of cleared rooms rose on the same floor
 *   relic      state.run.pedestalTaken: the count of taken pedestals rose on the same floor
 *   shrine     state.run.shrineUsed went 0 -> 1 on the same floor (the classic shrine only: a pact taken at an altar
 *              plays its own sfx.pact.take from the run view's pact events, docs/FORTUNE.md FO9)
 *   wiped      isPartyWiped went false -> true (solo: the player died; co-op: the last living player died)
 *
 * A new run (another SimState object) or reset() takes a fresh baseline: no edges on that frame. Presentation only:
 * reads the state, never writes it; no allocation per frame once the arrays have grown to the party size.
 *
 * @module
 */
import {
	BOW,
	BOW_DATA,
	BOW_V_CHARGE,
	NO_WEAPON,
	SWORD,
	SWORD_FINISHER,
	SWORD_V_LAST,
	aegisPips,
	isPartyWiped,
	swordGuard,
	swordGuardTicks,
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

/** What a player's hit this frame cost (StateWatch.hurtKind), weakest to strongest after "none". */
export type HurtKind = "none" | "harmless" | "armor" | "heart" | "lethal";

/** Every HurtKind, weakest first (specs, tunable tables). */
export const HURT_KINDS: ReadonlyArray<HurtKind> = ["none", "harmless", "armor", "heart", "lethal"];

/** The tutorial's harmless hits are on (SimConfig.tutorial.harmless). */
function harmlessHits(state: Readonly<SimState>): boolean {
	const tutorial = state.tutorial;
	return tutorial !== undefined && tutorial.harmless !== 0;
}

/** What a landed hit cost, from the player's hearts / armor / Aegis pips before and after it (see hurtKind above). */
function costOf(
	hearts: number,
	heartsBefore: number,
	absorbers: number,
	absorbersBefore: number,
	harmless: boolean,
): HurtKind {
	if (hearts < heartsBefore) return "heart";
	if (absorbers < absorbersBefore) return "armor";
	return harmless ? "harmless" : "heart";
}

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

/**
 * Player `i`'s sword guard of the active weapon set is up, over its own length (swordGuardTicks: Bastion's 27,
 * docs/LEGENDARIES.md LG6). The length is read only while the guard's timer runs (it never changes whether it is up).
 */
function guardUp(state: Readonly<SimState>, i: number, w: Readonly<WeaponsState>): boolean {
	const active = w.sets[w.activeSet];
	if (active === undefined || weaponId(active.weapon) !== SWORD.id || swordGuard(active) <= 0) return false;
	return swordGuard(active, swordGuardTicks(state, i)) > 0;
}

/**
 * The per-frame edge detector over a run's state (see the file comment for each edge). `update(state, localIndex)` once
 * per rendered frame compares the state with last frame's and fills the public fields: the per-player arrays (indexed
 * by player index) and the party and floor flags. Read them before the next update. The first update of a run, or the
 * one after `reset()`, only takes a baseline. Each reader owns its own instance: the audio cue mapper and the feel
 * controllers (hurt flash, freeze frame, haptics, room clear).
 */
export class StateWatch {
	private seen: Readonly<SimState> | undefined;
	private fresh = true;
	private size = 0;
	private readonly hurt = new Array<number>();
	private readonly hearts = new Array<number>();
	/** Armor pips + Aegis pips (either absorbs a whole hit before the hearts). */
	private readonly absorbers = new Array<number>();
	private readonly roll = new Array<number>();
	private readonly flaskTicks = new Array<number>();
	private readonly dead = new Array<number>();
	private readonly swingTick = new Array<number>();
	private readonly activeSet = new Array<number>();
	private readonly guard = new Array<boolean>();
	private readonly localCooldown = new Array<number>();
	private localCharge = 0;
	/** The index the local reads (localCooldown, localCharge) were taken for; -1 before any. */
	private localSeen = -1;
	private floor = 0;
	private cleared = 0;
	private taken = 0;
	private shrine = 0;
	private wipedBefore = false;

	/** Per player index (0 .. players() - 1): this frame's edges. */
	readonly hurtEdge = new Array<boolean>();
	/** What this frame's hit cost ("none" without a hurt or death edge). */
	readonly hurtKind = new Array<HurtKind>();
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
		const harmless = harmlessHits(state);
		for (let i = 0; i < n; i++) {
			const p = playerAt(state, i);
			const w = weaponsAt(state, i);
			const left = hasLeft(state, i);
			const known = !baseline && i < this.hurt.size();
			this.hurtEdge[i] = known && !left && p.hurtTicks > this.hurt[i];
			this.deathEdge[i] = known && !left && p.dead !== 0 && this.dead[i] === 0;
			const absorbers = p.armor + aegisPips(state, i);
			this.hurtKind[i] = this.deathEdge[i]
				? "lethal"
				: this.hurtEdge[i]
				? costOf(p.hearts, this.hearts[i], absorbers, this.absorbers[i], harmless)
				: "none";
			this.rollEdge[i] = known && !left && p.rollTicks > this.roll[i];
			this.flaskEdge[i] = known && !left && p.flaskTicks > this.flaskTicks[i];
			this.swapEdge[i] = known && !left && w.activeSet !== this.activeSet[i];
			const swung = known && !left && w.swingTick !== NO_SWING && w.swingTick !== this.swingTick[i];
			this.swingEdge[i] = !swung ? SwingEdge.none : this.isFinisher(w) ? SwingEdge.finisher : SwingEdge.swing;
			const guard = guardUp(state, i, w);
			this.mayDeflect[i] = known && !left && (guard || this.guard[i] || swung);
			this.guard[i] = guard;
			this.hurt[i] = p.hurtTicks;
			this.hearts[i] = p.hearts;
			this.absorbers[i] = absorbers;
			this.dead[i] = p.dead;
			this.roll[i] = p.rollTicks;
			this.flaskTicks[i] = p.flaskTicks;
			this.swingTick[i] = w.swingTick;
			this.activeSet[i] = w.activeSet;
		}
		// Another local index (spectating switched players): its shot / charge edges start from a fresh baseline.
		this.readLocal(state, localIndex, baseline || localIndex !== this.localSeen);
		this.localSeen = localIndex;

		const cleared = countCleared(state);
		const taken = countTaken(state);
		const shrine = state.run !== undefined ? state.run.shrineUsed : 0;
		this.roomCleared = sameFloor && cleared > this.cleared;
		this.relicTaken = sameFloor && taken > this.taken;
		this.shrineUsed = sameFloor && shrine > this.shrine;
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

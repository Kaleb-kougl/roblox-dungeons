/**
 * The run-over recap's run-long tally (docs/RUN_RECAP.md RR1, docs/RUN_CONTRIBUTION.md CT2): per player over the whole
 * run, for the recap's highlights (shared/view/hud recap.ts: `Parries 14`, co-op `You` rows) and the co-op contribution
 * card (CT3). The sim's ScoreEvents (shared/sim score.ts) are per TICK and NOT hashed: one `guardPlayer` entry per enemy
 * bullet a sword guard erased this tick, one `grazePlayer` entry per graze awarded, one `popPlayer` per score pop, one
 * `dealtPlayer` / `dealtAmount` / `dealtBoss` per damaging hit on an actor, one `hurtPlayer` per landed hit. The run
 * views (shared/play LiveRun, shared/lockstep LockstepClient) `collect` after every tick, as they do RoomClearEvents;
 * unlike the per-frame collectors this one is NOT reset per frame: it lives as long as its run view (a new run is a new
 * view), and `reset()` starts it over by hand.
 *
 *   - Parries: one per GROUP, grouped exactly as the NearMissDirector groups them (nearMissRules.ts
 *     `parryStartsGroup`: a player's erases within their guard's length, swordGuardTicks, of the group's first erase
 *     tick are one guard). Unlike the director it has no `quiet` gate: the tally counts what the sim did, the stage cover or run over
 *     never splits a guard. A guard erasing 5 bullets is 1 parry.
 *   - Grazes: one per graze, per grazing player (solo: counts[GRAZES] exactly).
 *   - Kills: one per score pop, per killer (the team's sum is every pop: counts[KILLS] plus boss kills and Goldling
 *     jackpots, docs/RUN_CONTRIBUTION.md CT0). Damage: the sum of `dealtAmount` per player; boss damage the part with
 *     `dealtBoss` 1. Hits: one per landed hit (the team's sum is ScoreState.hitsTaken).
 *   - Pellets: one per pellet a player took (`state.pellets` events: each `eaten` entry, plus the power pellet's
 *     `power` event). Boosts: one per GROUND pickup (`state.drops` events `collected` with a real ground slot, a
 *     chest's boost that landed on the floor and was picked up included); a chest boost given straight to a player
 *     (slot GIVEN_DROP_SLOT) is not counted: nothing was picked up.
 *   - Deaths: `deathTick` is the state.tick collected when the player's `dead` flag was seen turning 1 (-1 while
 *     alive), `deathFloor` the floor then (state.endless's, else 1; 0 while alive). A revive (an endless floor change)
 *     clears both, so at run over they hold the player's last death. Leaving is not a death: a `dead` flag that turns 1
 *     with `hasLeft` true records only `leftFloor` (the floor when `hasLeft` was first seen true; 0 never left), and a
 *     player who died and later left keeps their death. `lastDeath` is the index of the most recent death (-1 none);
 *     two deaths seen on the same tick: the LOWER index (players are checked in index order, a later one on the same
 *     tick does not replace it). `lastTick` is the last state.tick collected.
 *   - Records of a player outside the party (index < 0 or >= partySize) are ignored, like the director's. After a
 *     collect every per-player array has partySize entries.
 *   - Unscored runs (`state.score === undefined`) collect nothing (pellets and drops only exist in scored runs).
 *
 * Read-only on the sim. No allocation per tick: the per-player counters grow once per new player index. Presentation
 * only: nothing here is hashed or written back.
 *
 * @module
 */
import { GIVEN_DROP_SLOT, hasLeft, partySize, playerAt, scoreFloor, swordGuardTicks, type SimState } from "shared/sim";
import { parryStartsGroup } from "./nearMissRules";

/** What the recap reads (RecapTally satisfies it). Index = player index; a player never seen reads 0 (-1 deathTick). */
export interface RecapTallySource {
	/** Parries (guard groups) per player. */
	readonly parries: ReadonlyArray<number>;
	/** Grazes per player. */
	readonly grazes: ReadonlyArray<number>;
	/** Scored kills (score pops) per killer. */
	readonly kills: ReadonlyArray<number>;
	/** Damage dealt per player (hp removed: after caps, shields, Executioner; never overkill). */
	readonly damage: ReadonlyArray<number>;
	/** The part of `damage` dealt to bosses. */
	readonly bossDamage: ReadonlyArray<number>;
	/** Landed hits taken per player. */
	readonly hits: ReadonlyArray<number>;
	/** Pellets taken per player (the power pellet included). */
	readonly pellets: ReadonlyArray<number>;
	/** Boosts picked up off the ground per player. */
	readonly boosts: ReadonlyArray<number>;
	/** Per player: the tick of their current death, -1 while alive. */
	readonly deathTick: ReadonlyArray<number>;
	/** Per player: the floor of their current death, 0 while alive. */
	readonly deathFloor: ReadonlyArray<number>;
	/** Per player: the floor they left the run on, 0 never left. */
	readonly leftFloor: ReadonlyArray<number>;
	/** Index of the most recent death (ties on one tick: the lower index), -1 none. */
	readonly lastDeath: number;
	/** The last state.tick collected (0 before any). */
	readonly lastTick: number;
}

/** deathTick of a living player. */
export const RECAP_ALIVE_TICK = -1;
/** deathFloor / leftFloor of a player who never died / left. */
export const RECAP_NO_FLOOR = 0;
/** lastDeath before any death. */
export const RECAP_NO_PLAYER = -1;

export class RecapTally implements RecapTallySource {
	readonly parries: number[] = [];
	readonly grazes: number[] = [];
	readonly kills: number[] = [];
	readonly damage: number[] = [];
	readonly bossDamage: number[] = [];
	readonly hits: number[] = [];
	readonly pellets: number[] = [];
	readonly boosts: number[] = [];
	readonly deathTick: number[] = [];
	readonly deathFloor: number[] = [];
	readonly leftFloor: number[] = [];
	lastDeath = RECAP_NO_PLAYER;
	lastTick = 0;

	/** Per player: a guard group seen, and its first erase tick (the parry grouping's state). */
	private readonly hasGroup: boolean[] = [];
	private readonly groupFirstTick: number[] = [];
	/** Per player: the `dead` flag at the last collect (the death edge). */
	private readonly wasDead: boolean[] = [];
	/** The tick lastDeath died on (-1 none). */
	private lastDeathTick = RECAP_ALIVE_TICK;

	/** Starts over (a new run on the same view; a new view starts empty). */
	reset(): void {
		this.parries.clear();
		this.grazes.clear();
		this.kills.clear();
		this.damage.clear();
		this.bossDamage.clear();
		this.hits.clear();
		this.pellets.clear();
		this.boosts.clear();
		this.deathTick.clear();
		this.deathFloor.clear();
		this.leftFloor.clear();
		this.lastDeath = RECAP_NO_PLAYER;
		this.lastTick = 0;
		this.hasGroup.clear();
		this.groupFirstTick.clear();
		this.wasDead.clear();
		this.lastDeathTick = RECAP_ALIVE_TICK;
	}

	/** After every tick. No-op without scoring. */
	collect(state: Readonly<SimState>): void {
		const s = state.score;
		if (s === undefined) return;
		const e = s.events;
		const n = partySize(state);
		const tick = state.tick;
		this.lastTick = tick;
		if (n > 0) this.grow(n - 1);
		const ng = e.grazePlayer.size();
		for (let i = 0; i < ng; i++) {
			const p = e.grazePlayer[i];
			if (p < 0 || p >= n) continue;
			this.grazes[p] += 1;
		}
		const nc = e.guardPlayer.size();
		for (let i = 0; i < nc; i++) {
			const p = e.guardPlayer[i];
			if (p < 0 || p >= n) continue;
			if (parryStartsGroup(this.hasGroup[p], this.groupFirstTick[p], tick, swordGuardTicks(state, p))) {
				this.hasGroup[p] = true;
				this.groupFirstTick[p] = tick;
				this.parries[p] += 1;
			}
		}
		addOnePer(this.kills, e.popPlayer, n);
		addOnePer(this.hits, e.hurtPlayer, n);
		const nd = e.dealtPlayer.size();
		for (let i = 0; i < nd; i++) {
			const p = e.dealtPlayer[i];
			if (p < 0 || p >= n) continue;
			const dmg = e.dealtAmount[i];
			this.damage[p] += dmg;
			if (e.dealtBoss[i] !== 0) this.bossDamage[p] += dmg;
		}
		this.collectPickups(state, n);
		this.collectStanding(state, n, tick);
	}

	/** Player `p`'s parries (0 when never seen). */
	parriesOf(p: number): number {
		return this.parries[p] ?? 0;
	}

	/** Player `p`'s grazes (0 when never seen). */
	grazesOf(p: number): number {
		return this.grazes[p] ?? 0;
	}

	/** Player `p`'s scored kills (0 when never seen). */
	killsOf(p: number): number {
		return this.kills[p] ?? 0;
	}

	/** Player `p`'s damage dealt (0 when never seen). */
	damageOf(p: number): number {
		return this.damage[p] ?? 0;
	}

	/** Player `p`'s damage dealt to bosses (0 when never seen). */
	bossDamageOf(p: number): number {
		return this.bossDamage[p] ?? 0;
	}

	/** Player `p`'s landed hits taken (0 when never seen). */
	hitsOf(p: number): number {
		return this.hits[p] ?? 0;
	}

	/** Pellets: each eaten entry, plus the power pellet's event; boosts: ground pickups only (file comment). */
	private collectPickups(state: Readonly<SimState>, n: number): void {
		const pe = state.pellets?.events;
		if (pe !== undefined) {
			for (const eaten of pe.eaten) {
				const p = eaten.player;
				if (p >= 0 && p < n) this.pellets[p] += 1;
			}
			const power = pe.power;
			if (power !== undefined && power.player >= 0 && power.player < n) this.pellets[power.player] += 1;
		}
		const de = state.drops?.events;
		if (de !== undefined) {
			for (const c of de.collected) {
				if (c.slot === GIVEN_DROP_SLOT) continue;
				const p = c.player;
				if (p >= 0 && p < n) this.boosts[p] += 1;
			}
		}
	}

	/** The death / revive / leave edges, players in index order (file comment). */
	private collectStanding(state: Readonly<SimState>, n: number, tick: number): void {
		for (let i = 0; i < n; i++) {
			const dead = playerAt(state, i).dead !== 0;
			const left = hasLeft(state, i);
			if (left && this.leftFloor[i] === RECAP_NO_FLOOR) this.leftFloor[i] = scoreFloor(state);
			if (dead && !this.wasDead[i] && !left) {
				this.deathTick[i] = tick;
				this.deathFloor[i] = scoreFloor(state);
				if (tick > this.lastDeathTick) {
					this.lastDeath = i;
					this.lastDeathTick = tick;
				}
			} else if (!dead && this.wasDead[i]) {
				this.deathTick[i] = RECAP_ALIVE_TICK;
				this.deathFloor[i] = RECAP_NO_FLOOR;
			}
			this.wasDead[i] = dead;
		}
	}

	private grow(p: number): void {
		while (this.parries.size() <= p) {
			this.parries.push(0);
			this.grazes.push(0);
			this.kills.push(0);
			this.damage.push(0);
			this.bossDamage.push(0);
			this.hits.push(0);
			this.pellets.push(0);
			this.boosts.push(0);
			this.deathTick.push(RECAP_ALIVE_TICK);
			this.deathFloor.push(RECAP_NO_FLOOR);
			this.leftFloor.push(RECAP_NO_FLOOR);
			this.hasGroup.push(false);
			this.groupFirstTick.push(0);
			this.wasDead.push(false);
		}
	}
}

/** `counts[p] += 1` per entry `p` of `players` inside [0, n). */
function addOnePer(counts: number[], players: ReadonlyArray<number>, n: number): void {
	const m = players.size();
	for (let i = 0; i < m; i++) {
		const p = players[i];
		if (p >= 0 && p < n) counts[p] += 1;
	}
}

const EMPTY: ReadonlyArray<number> = table.freeze([] as number[]);

/** Nothing tallied (a run view without scoring, the specs' default). Frozen. */
export const NO_RECAP_TALLY: RecapTallySource = table.freeze({
	parries: EMPTY,
	grazes: EMPTY,
	kills: EMPTY,
	damage: EMPTY,
	bossDamage: EMPTY,
	hits: EMPTY,
	pellets: EMPTY,
	boosts: EMPTY,
	deathTick: EMPTY,
	deathFloor: EMPTY,
	leftFloor: EMPTY,
	lastDeath: RECAP_NO_PLAYER,
	lastTick: 0,
});

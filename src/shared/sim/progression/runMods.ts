/**
 * Run progression state and THE accessor every gameplay rule reads it through (M2 boons / relics / curses).
 *
 * A leaf module: it imports only data modules and types, so player.ts, combat.ts, the weapons, actors.ts and
 * score.ts can all call it without a require cycle. The draft, pedestals and shrines (the parts that change the
 * state from input) live in progression.ts.
 *
 * Per player: `state.run.players[i]`, one entry per party member (index = the party's player index; a solo run has
 * one, SOLO_PLAYER). Every gameplay read of a personal modifier goes through `runMods(state, playerIndex)` or a helper
 * below that takes a player index, with the player the rule is about (co-op, M4, bound by SimCtx):
 *   the acting / owning player   damage (the bullet's owner or the swinging player), pierce, cooldown / recovery, the
 *                                Ember Wake ring, Mirror Cloak, Bounty (the killer)
 *   the player it happens to     roll i-frames, the Hourglass trigger, Second Wind, Vampire Fang (the killer), the
 *                                graze radius (the grazing player)
 * Team-wide rules read the `team*` accessors instead (one value for the whole world, never stacked per player):
 *   teamComboWindowTicks              Lingering if ANY counted player owns it; Impatience once if ANY player took it
 *   teamComboCutDivisorMultiplier     Composure if ANY counted player owns it
 *   teamEnemyBulletSpeedMultiplier    Haste once if ANY player took it
 *   consumeEnemyBulletTimeScale       the Hourglass slow while ANY player's timer runs
 * "Counted" players are the living ones; when nobody is alive, every player (so a solo run's dead player keeps their
 * boons, exactly as before co-op). Curses are world state: they count whether their taker lives or not.
 * Outside endless runs (`state.run` absent) every accessor returns the neutral value and every hook is a no-op, so the
 * M1 golden runs are untouched (the neutral paths are guarded to return their input unchanged, not x 100 / 100).
 *
 * Arithmetic that feeds the hash:
 *   damage        amount x percent / 100 (integer payload damage x 125 / 100: a multiple of 0.25, exact)
 *   ticks         round-half-up(ticks x percent / 100) in integers: (n - n % 100) / 100 with n = ticks x percent + 50
 *                 (12 -> 10 at 80 %, 21 -> 17 at 80 %, 12 -> 18 at 150 %)
 *   graze radius  (PLAYER_RADIUS + ENEMY_BULLET_RADIUS + margin)^2, as score.ts's GRAZE_R2 (identical for 0.5)
 *   bullet speed  floor multiplier x 1.15, then capped (endlessData enemyBulletSpeedMultiplier)
 *   kill points   score.ts awardPoints with an extra integer percent (110)
 */
import { jsMin } from "shared/jsmath";
import type { PlayerState, SimState } from "../state";
import { PLAYER_RADIUS } from "../playerData";
import { ENEMY_BULLET_RADIUS } from "../combat/combatData";
import { COMBO_WINDOW_TICKS, GRAZE_MARGIN } from "../score/scoreData";
import {
	ATTACK_TICKS_BOON_PERCENT,
	BOW_PIERCE_BOON,
	Boon,
	COMBO_CUT_BOON_DIVISOR_MULTIPLIER,
	COMBO_WINDOW_BOON_BONUS_TICKS,
	CURSE_BULLET_SPEED_MULTIPLIER,
	CURSE_COMBO_WINDOW_LOSS_TICKS,
	CURSE_MIN_COMBO_WINDOW_TICKS,
	Curse,
	DAMAGE_BOON_PERCENT,
	FANG_HEAL_HALF_HEARTS,
	FANG_KILLS,
	GRAZE_MARGIN_BOON,
	HOURGLASS_TICKS,
	HOURGLASS_TIME_SCALE,
	KILL_POINTS_BOON_PERCENT,
	PERCENT,
	ROLL_IFRAME_BOON_PERCENT,
	Relic,
	SECOND_WIND_HALF_HEARTS,
} from "./progressionData";

/** The player index of a solo run (player 0, state.player). */
export const SOLO_PLAYER = 0;

/** What a player's boons, relics and curses add up to. Derived from them (refreshRunMods); never hashed itself. */
export interface RunMods {
	/** Player damage percent when it hits (100 = unchanged). */
	readonly damagePercent: number;
	/** Sword recovery / bow cooldown percent (100 = unchanged). */
	readonly attackTicksPercent: number;
	/** Extra pierce on every bow arrow. */
	readonly bowPierce: number;
	/** Ember Wake: a roll start fires a ring of player bullets. */
	readonly rollRing: boolean;
	/** Roll i-frames percent. */
	readonly rollIframePercent: number;
	/** Warding: armor refills when a room's enemies spawn. */
	readonly armorOnRoomSpawn: boolean;
	/** The combo window, ticks. */
	readonly comboWindowTicks: number;
	/** Graze margin (world units) and the squared graze radius. */
	readonly grazeMargin: number;
	readonly grazeR2: number;
	/** Kill points percent. */
	readonly killPointsPercent: number;
	/** The combo hit cut's divisor multiplier (1 = unchanged). */
	readonly comboCutDivisorMultiplier: number;
	/** Enemy bullet speed multiplier on top of the floor scaling (1 = unchanged). */
	readonly enemyBulletSpeedMultiplier: number;
	readonly mirror: boolean;
	readonly hourglass: boolean;
	readonly fang: boolean;
	readonly secondWind: boolean;
}

/** One player's run progression. Every field but `mods` is hashed (progression.ts writeRunHash). */
export interface RunPlayerState {
	/** Owned boons (Boon indices), in the order taken. */
	boons: number[];
	/** Owned relics (Relic indices), in the order collected. */
	relics: number[];
	/** Curses taken (Curse indices), in the order accepted. */
	curses: number[];
	/** 1 while this player's boon draft is open (the world is frozen). */
	draftOpen: number;
	/** Ticks the open draft has run (0 on the tick it opened). */
	draftTicks: number;
	/** Index into draftOffers under the stick, NO_SELECTION (-1) for none. */
	draftSelected: number;
	/** The offered boons (Boon indices), card order left to right; empty when no draft is open. */
	draftOffers: number[];
	/** Hourglass: ticks of slowed enemy bullets left. */
	hourglassTicks: number;
	/** Vampire Fang: kills toward the next heal. */
	fangKills: number;
	/** Second Wind: 1 once spent on the current floor. */
	secondWindUsed: number;
	/** Derived, NOT hashed: rebuilt by refreshRunMods whenever boons / relics / curses change. */
	mods: RunMods;
	/** This player's presentation events of the current tick (NOT hashed; cleared every tick). */
	events: RunPlayerEvents;
}

/** One player's presentation events of the current tick (the HUD's toasts for the local player). Indices + 1. */
export interface RunPlayerEvents {
	draftChosen: number;
	relicCollected: number;
	curseAccepted: number;
	secondWind: number;
	fangHealed: number;
}

/**
 * Presentation-only events of the current tick (cleared every tick, never hashed). Indices + 1, 0 = none. Co-op: any
 * player's (the last one this tick); RunPlayerState.events has each player's own.
 */
export interface RunEvents {
	/** Cards offered by a draft that opened this tick (the offers are in draftOffers), else 0. */
	draftOpened: number;
	draftChosen: number;
	relicCollected: number;
	curseAccepted: number;
	/** 1 when Second Wind saved the player this tick. */
	secondWind: number;
	/** Half hearts Vampire Fang healed this tick. */
	fangHealed: number;
}

/** SimState.run: endless runs only. */
export interface RunState {
	/** One entry per player, party index order (a solo run: one, SOLO_PLAYER). */
	players: RunPlayerState[];
	/** The current floor's TREASURE rooms (room ids, ascending) and whether each pedestal's relic was taken. */
	pedestalRooms: number[];
	pedestalTaken: number[];
	/** The current floor's SHRINE room id (the first one), -1 for none; 1 once its curse was accepted. */
	shrineRoom: number;
	shrineUsed: number;
	/** Not hashed. */
	events: RunEvents;
}

function owns(list: ReadonlyArray<number>, id: number): boolean {
	return list.includes(id);
}

const NEUTRAL_GRAZE_R = PLAYER_RADIUS + ENEMY_BULLET_RADIUS + GRAZE_MARGIN;

/** The modifiers of nobody's boons: every rule as in a run without progression. */
export const NEUTRAL_RUN_MODS: RunMods = table.freeze({
	damagePercent: PERCENT,
	attackTicksPercent: PERCENT,
	bowPierce: 0,
	rollRing: false,
	rollIframePercent: PERCENT,
	armorOnRoomSpawn: false,
	comboWindowTicks: COMBO_WINDOW_TICKS,
	grazeMargin: GRAZE_MARGIN,
	grazeR2: NEUTRAL_GRAZE_R * NEUTRAL_GRAZE_R,
	killPointsPercent: PERCENT,
	comboCutDivisorMultiplier: 1,
	enemyBulletSpeedMultiplier: 1,
	mirror: false,
	hourglass: false,
	fang: false,
	secondWind: false,
});

/** The combo window in ticks with / without Lingering and Impatience (floored at CURSE_MIN_COMBO_WINDOW_TICKS). */
function comboWindowFor(lingering: boolean, impatience: boolean): number {
	let combo = COMBO_WINDOW_TICKS;
	if (lingering) combo += COMBO_WINDOW_BOON_BONUS_TICKS;
	if (impatience) combo -= CURSE_COMBO_WINDOW_LOSS_TICKS;
	return combo < CURSE_MIN_COMBO_WINDOW_TICKS ? CURSE_MIN_COMBO_WINDOW_TICKS : combo;
}

/**
 * RunMods from a player's boons, relics and curses (pure). The combo window, the hit-cut multiplier and the enemy
 * bullet speed are this player's own share; the rules read the team-wide accessors below (teamComboWindowTicks, ...).
 */
export function computeRunMods(p: Readonly<Pick<RunPlayerState, "boons" | "relics" | "curses">>): RunMods {
	const b = p.boons;
	const c = p.curses;
	const combo = comboWindowFor(owns(b, Boon.LINGERING), owns(c, Curse.IMPATIENCE));
	const margin = owns(b, Boon.DAREDEVIL) ? GRAZE_MARGIN_BOON : GRAZE_MARGIN;
	const grazeR = PLAYER_RADIUS + ENEMY_BULLET_RADIUS + margin;
	return {
		damagePercent: owns(b, Boon.SHARPENED) ? DAMAGE_BOON_PERCENT : PERCENT,
		attackTicksPercent: owns(b, Boon.SWIFT_STRIKES) ? ATTACK_TICKS_BOON_PERCENT : PERCENT,
		bowPierce: owns(b, Boon.PIERCING_ARROWS) ? BOW_PIERCE_BOON : 0,
		rollRing: owns(b, Boon.EMBER_WAKE),
		rollIframePercent: owns(b, Boon.SLIPPERY) ? ROLL_IFRAME_BOON_PERCENT : PERCENT,
		armorOnRoomSpawn: owns(b, Boon.WARDING),
		comboWindowTicks: combo,
		grazeMargin: margin,
		grazeR2: grazeR * grazeR,
		killPointsPercent: owns(b, Boon.BOUNTY) ? KILL_POINTS_BOON_PERCENT : PERCENT,
		comboCutDivisorMultiplier: owns(b, Boon.COMPOSURE) ? COMBO_CUT_BOON_DIVISOR_MULTIPLIER : 1,
		enemyBulletSpeedMultiplier: owns(c, Curse.HASTE) ? CURSE_BULLET_SPEED_MULTIPLIER : 1,
		mirror: owns(p.relics, Relic.MIRROR_CLOAK),
		hourglass: owns(p.relics, Relic.HOURGLASS),
		fang: owns(p.relics, Relic.VAMPIRE_FANG),
		secondWind: owns(p.relics, Relic.SECOND_WIND),
	};
}

/** Rebuilds a player's derived mods (call after changing boons, relics or curses). */
export function refreshRunMods(p: RunPlayerState): void {
	p.mods = computeRunMods(p);
}

/** The run progression of player `playerIndex`, or undefined outside endless runs / for a player that is not there. */
export function runPlayer(state: Readonly<SimState>, playerIndex: number): RunPlayerState | undefined {
	return state.run?.players[playerIndex];
}

/** THE accessor: player `playerIndex`'s modifiers (NEUTRAL_RUN_MODS outside endless runs). */
export function runMods(state: Readonly<SimState>, playerIndex: number): Readonly<RunMods> {
	const p = state.run?.players[playerIndex];
	return p !== undefined ? p.mods : NEUTRAL_RUN_MODS;
}

/** True while any player's draft is open: the world is frozen (step.ts). */
export function isDraftOpen(state: Readonly<SimState>): boolean {
	const r = state.run;
	if (r === undefined) return false;
	for (const p of r.players) if (p.draftOpen !== 0) return true;
	return false;
}

// ---------------------------------------------------------------------------------------------
// Integer helpers

/** amount x percent / 100; `amount` itself at 100. */
export function scalePercent(amount: number, percent: number): number {
	return percent === PERCENT ? amount : (amount * percent) / PERCENT;
}

/** round-half-up(ticks x percent / 100) for integer ticks, in integer arithmetic; `ticks` itself at 100. */
export function scaleTicks(ticks: number, percent: number): number {
	if (percent === PERCENT) return ticks;
	const n = ticks * percent + PERCENT / 2;
	return (n - (n % PERCENT)) / PERCENT;
}

// ---------------------------------------------------------------------------------------------
// Gameplay reads (each takes the player index)

/** Damage a player's bullet / swing deals when it hits (Sharpened). */
export function playerHitDamage(state: Readonly<SimState>, playerIndex: number, amount: number): number {
	return scalePercent(amount, runMods(state, playerIndex).damagePercent);
}

/** Attack recovery / cooldown ticks (Swift Strikes). */
export function attackTicks(state: Readonly<SimState>, playerIndex: number, ticks: number): number {
	return scaleTicks(ticks, runMods(state, playerIndex).attackTicksPercent);
}

/** Roll i-frame ticks (Slippery). */
export function rollIframeTicks(state: Readonly<SimState>, playerIndex: number, ticks: number): number {
	return scaleTicks(ticks, runMods(state, playerIndex).rollIframePercent);
}

// ---------------------------------------------------------------------------------------------
// Gameplay hooks (no-ops outside endless runs)

/** damagePlayer: a hit landed on player `playerIndex` (Hourglass starts / restarts its slow). */
export function runOnPlayerHit(state: SimState, playerIndex: number): void {
	const p = runPlayer(state, playerIndex);
	if (p !== undefined && p.mods.hourglass) p.hourglassTicks = HOURGLASS_TICKS;
}

/**
 * damagePlayer: the hit would leave player `playerIndex` at 0 hearts. With Second Wind unspent on this floor it is
 * spent, the run event set, and SECOND_WIND_HALF_HEARTS returned (the hearts to keep); else 0 (the player dies).
 */
export function runSecondWind(state: SimState, playerIndex: number): number {
	const p = runPlayer(state, playerIndex);
	if (p === undefined || !p.mods.secondWind || p.secondWindUsed !== 0) return 0;
	p.secondWindUsed = 1;
	state.run!.events.secondWind = 1;
	p.events.secondWind = 1;
	return SECOND_WIND_HALF_HEARTS;
}

/**
 * killActor: an actor died, credited to player `playerIndex`. Vampire Fang counts it (an archetype that revives,
 * `reviving`, never counts: no turret farming) and heals every FANG_KILLS kills.
 */
export function runOnKill(state: SimState, playerIndex: number, reviving: boolean): void {
	const p = runPlayer(state, playerIndex);
	if (p === undefined || !p.mods.fang || reviving) return;
	p.fangKills += 1;
	if (p.fangKills < FANG_KILLS) return;
	p.fangKills -= FANG_KILLS;
	const pl = playerStateAt(state, playerIndex);
	if (pl.dead !== 0) return;
	const healed = jsMin(pl.heartsMax, pl.hearts + FANG_HEAL_HALF_HEARTS) - pl.hearts;
	pl.hearts += healed;
	state.run!.events.fangHealed += healed;
	p.events.fangHealed += healed;
}

/**
 * stepCombat, before the bullet pools step: the enemy bullet time scale of this tick (HOURGLASS_TIME_SCALE while ANY
 * player's Hourglass runs, else 1: one global slow, never stacked), counting every running Hourglass down (player
 * index order). A hit at tick T slows ticks T+1..T+60.
 */
export function consumeEnemyBulletTimeScale(state: SimState): number {
	const r = state.run;
	if (r === undefined) return 1;
	let slowed = false;
	for (const p of r.players) {
		if (p.hourglassTicks <= 0) continue;
		p.hourglassTicks -= 1;
		slowed = true;
	}
	return slowed ? HOURGLASS_TIME_SCALE : 1;
}

// ---------------------------------------------------------------------------------------------
// Team-wide reads (co-op: one value for the whole world; see the file comment)

/**
 * Player `i`'s PlayerState (0 = state.player; co-op: state.party.players[i]). Read directly rather than through
 * party.ts: this module stays a leaf (party.ts imports player.ts, which imports this).
 */
function playerStateAt(state: Readonly<SimState>, i: number): PlayerState {
	const party = state.party;
	return party !== undefined ? party.players[i] : state.player;
}

/** True when nobody in the run is alive (solo: the player is dead). */
function nobodyAlive(state: Readonly<SimState>): boolean {
	const party = state.party;
	if (party === undefined) return state.player.dead !== 0;
	for (const p of party.players) if (p.dead === 0) return false;
	return true;
}

/** A counted player (living; everyone when nobody is alive) owns `boon`. */
export function teamOwnsBoon(state: Readonly<SimState>, boon: number): boolean {
	const r = state.run;
	if (r === undefined) return false;
	const all = nobodyAlive(state);
	for (let i = 0; i < r.players.size(); i++) {
		if (!all && playerStateAt(state, i).dead !== 0) continue;
		if (owns(r.players[i].boons, boon)) return true;
	}
	return false;
}

/** Any player in the run (living, dead or left) accepted `curse`: world curses apply once, whoever took them. */
export function teamCursed(state: Readonly<SimState>, curse: number): boolean {
	const r = state.run;
	if (r === undefined) return false;
	for (const p of r.players) if (owns(p.curses, curse)) return true;
	return false;
}

/** The combo window in ticks for the whole team: Lingering (any counted owner), Impatience (once), the floor. */
export function teamComboWindowTicks(state: Readonly<SimState>): number {
	if (state.run === undefined) return COMBO_WINDOW_TICKS;
	return comboWindowFor(teamOwnsBoon(state, Boon.LINGERING), teamCursed(state, Curse.IMPATIENCE));
}

/** The combo hit cut's divisor multiplier for the whole team (Composure: any counted owner). */
export function teamComboCutDivisorMultiplier(state: Readonly<SimState>): number {
	return teamOwnsBoon(state, Boon.COMPOSURE) ? COMBO_CUT_BOON_DIVISOR_MULTIPLIER : 1;
}

/** The enemy bullet speed multiplier on top of the floor scaling for the whole world (Haste once, any taker). */
export function teamEnemyBulletSpeedMultiplier(state: Readonly<SimState>): number {
	return teamCursed(state, Curse.HASTE) ? CURSE_BULLET_SPEED_MULTIPLIER : 1;
}

/** Players other than `playerIndex` whose boon draft is still open (co-op: the HUD's "waiting for N teammates"). */
export function teammatesDrafting(state: Readonly<SimState>, playerIndex: number): number {
	const r = state.run;
	if (r === undefined) return 0;
	let n = 0;
	for (let i = 0; i < r.players.size(); i++) if (i !== playerIndex && r.players[i].draftOpen !== 0) n++;
	return n;
}

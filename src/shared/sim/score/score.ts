/**
 * Scoring (M2, GDD "Scoring"): an OPT-IN part of the sim. With `SimConfig.scoring` absent there is no score state,
 * nothing extra is hashed, no payload bit is touched and no rng is drawn, so every M1 golden run is unchanged.
 * With it set, `state.score` holds everything below and is hashed as the "score" subsystem, after the six M1 ones.
 *
 *   points per award = floor(base x combo x depth x curse)       (integer arithmetic, see award())
 *
 * Sources (ScoreSource), when they are awarded:
 *   kills    killActor (hook): KILL_POINTS[id] x floor scaling (1 + 0.08 (floor - 1)), then combo +0.1.
 *            An archetype that revives (def.stepDead: turrets) scores its first death only (no 6 s turret farming).
 *   boss     killActor of a data.boss archetype: KILL_POINTS[id] (no floor scaling), + BOSS_NO_HIT_BONUS when no
 *            hit landed on the player since its final phase (BOSS_FINAL_PHASE) began; then combo +0.1.
 *   grazes   enemy bullet collision walk (combat.ts): an enemy bullet that came within GRAZE_MARGIN of the hit distance
 *            and LEFT the graze ring without ever entering the hit circle, once per bullet, never for a dead player;
 *            then combo +0.1. A bullet that entered the hit circle (hit, or passed through i-frames) never grazes.
 *   guard    the sword's guard sweep (sword.ts): per enemy bullet it erased (ordinary swings score nothing).
 *   rooms    stepScore: an encounter room's members (its initial non-boss spawns; on endless floors its deferred
 *            spawns, attached by attachScoreRoomMembers when the player first enters the room) are all down.
 *   perfect  ... and no hit landed from the room's engagement to its clear.
 *   fast     ... + (par - clear time) ticks, par = 6 s + 1.5 s x the room's encounter cost.
 *   breakables  a player breaks a barrel / crate (docs/DECOR.md D4; scoreBreakable from breakables/breakables.ts):
 *            BREAKABLE_POINTS[kind] x floor; never feeds the combo, never touches a room record.
 *   pellets  (pellet runs only, docs/PELLETS.md) scorePellet: config.pelletPoints x the kills' floor scaling per pellet
 *            taken; scorePowerBullets: config.powerBulletPoints per enemy bullet the power pellet converted (at most
 *            config.powerMaxBullets); neither feeds the combo nor refills its timer (PD1)
 *   sweep    (pellet runs only) scoreSweep: config.sweepPoints when a room clears with every regular pellet taken; no
 *            combo either
 *   treasure (treasure runs only, docs/TREASURE.md) scoreTreasure: the open's tier points x Depth x curses, once per
 *            open, combo-neutral (the combo is neither applied, x1.0, nor fed)
 *   floors   awardFloorClear(state, floor, ...), called by the floor transition (endless mode): 1000 x floor x (rooms
 *            cleared / rooms with enemies on that floor; a boss floor's boss is one more room), rounded down before
 *            the multipliers (floorClearBase); a floor without enemy rooms pays the full 1000 x floor.
 *
 * Combo: tenths in [10, 50]. A kill / graze adds 1 (cap 50) AFTER its own award and refills the 360-tick timer;
 * stepScore counts the timer down on ticks without a kill or graze and resets the combo to 10 when it runs out.
 * Each landed hit (events.playerHits, applied in stepScore after the tick's awards) cuts it to
 * max(10, floor(combo x (d - 1) / d)) with d = max(2, n), i.e. a cut of min(1/2, 1/n) rounded down to the tenth;
 * n = the players PRESENT at the tick of the hit (co-op: not left, `party.left`, so a party that lost members to
 * leaves / stalls is cut as the smaller party it now is), else ScoringConfig.partySize (solo: 1, d = 2).
 *
 * Room engagement (start of perfect / fast): the end of the first tick at which the living player stands inside the
 * room's bounds, or any member is engaged (room-enemy aggro), damaged, dead or gone. Hits landed during that tick
 * count against perfect. Endless floors: the tick the room's deferred enemies spawn (attachScoreRoomMembers).
 *
 * Co-op (M4, ../party.ts): one shared team score and combo (`partySize` = the party's size; the hit cut uses the players
 * still present). Any player's kill or
 * graze feeds it, every landed hit on any player cuts it (events.playerHits is the party's), a dead player never
 * grazes (the graze ring is the nearest LIVING player's), and a room engages when any living player stands in it.
 *
 * Integration points (the only places outside this folder that know about scoring): step.ts (clearScoreEvents /
 * stepScore), state.ts (createScoreState / cloneScoreState), replay.ts + hashLayout.ts (hash), actors.ts killActor
 * (scoreKill), combat.ts enemyBulletHit (scoreBulletVisit), sword.ts guard (scoreGuardCancels), endless.ts
 * (awardFloorClear before a floor change, rebuildScoreRooms after it, attachScoreRoomMembers on a room's spawns).
 * Depth and floor come from state.endless (scoreDepth / scoreFloor).
 *
 * M2 boons / curses (endless runs, read through progression/runMods.ts; neutral otherwise): the combo window
 * (Lingering +3 s, Impatience -2 s) and the hit cut's divisor x 2 (Composure) are TEAM-WIDE (teamComboWindowTicks /
 * teamComboCutDivisorMultiplier: Lingering / Composure if any living player owns it, Impatience once if any player
 * took it); kill points x 110 % (Bounty: kills and boss kills, not the no-hit bonus) follow the KILLER's boons; the
 * graze margin (Daredevil 0.75 tiles) the grazing player's (combat.ts passes the radius).
 *
 * Builds duos (docs/BUILDS.md BU6, only with state.builds; sim/builds hooks.ts): Gold Rush (the killer's duo) scores a
 * kill at combo >= GOLD_RUSH_MIN_COMBO x GOLD_RUSH_PERCENT / 100 after Bounty (awardPoints' extraPercent; kills and
 * boss kills, not the no-hit bonus); Unshaken's hits taken on armor (BuildEvents.unshakenKept) are left out of
 * stepScore's combo cuts (they still count in hitsTaken, so PERFECT still sees them).
 */

import { PLAYER_RADIUS } from "../playerData";
import { ENEMY_BULLET_RADIUS } from "../combat/combatData";
import { PAYLOAD_BITS } from "../combat/payload";
import { archetypeAt } from "../combat/actors/registry";
import { NO_KIND, type ActorState } from "../combat/actors/types";
import { V_AGGRO, isRoomEnemyData } from "../combat/actors/archetypes/enemyShared";
import { roomAt, type ActorSpawn, type EncounterConfig, type EncounterRoom } from "../combat/actors/encounter";
import type { BulletSimulation } from "../combat/bullets";
import type { SimState } from "../state";
import { partySize, playerAt, presentPlayerCount } from "../party";
import { AffixKind, encounterCost } from "shared/dungeon";
import { affixKillPercent } from "../affixes/affixes";
import { AFFIX_PAR_COST } from "../affixes/affixesData";
import {
	buildsGoldRush,
	buildsGoldRushPop,
	buildsOnGraze,
	buildsOnPerfectRoom,
	buildsUnshakenKept,
} from "../builds/hooks";
import { pelletRoomClear, pelletRoomLive } from "../pellets/pelletRooms";
import { SOLO_PLAYER, runMods, teamComboCutDivisorMultiplier, teamComboWindowTicks } from "../progression/runMods";
import {
	BOSS_FINAL_PHASE,
	BOSS_NO_HIT_BONUS,
	BREAKABLE_POINTS,
	COMBO_CUT_MIN_DIVISOR,
	COMBO_DENOMINATOR,
	COMBO_MAX,
	COMBO_MIN,
	COMBO_STEP,
	CURSE_BASE,
	CURSE_DENOMINATOR,
	CURSE_STEP,
	DEFAULT_DEPTH,
	DEFAULT_FLOOR,
	DEFAULT_KILL_POINTS,
	DEFAULT_PARTY_SIZE,
	FAST_POINTS_PER_TICK,
	FLOOR_CLEAR_POINTS,
	FLOOR_SCALE_DENOMINATOR,
	FLOOR_SCALE_PERCENT_PER_FLOOR,
	GOLD_RUSH_MIN_COMBO,
	GOLD_RUSH_PERCENT,
	GRAZE_MARGIN,
	GRAZE_POINTS,
	GUARD_CANCEL_POINTS,
	JACKPOT_POINTS,
	KILL_POINTS,
	ROOM_CLEAR_POINTS,
	ROOM_PAR_BASE_TICKS,
	ROOM_PAR_TICKS_PER_COST,
	ROOM_PERFECT_POINTS,
	BUILD_SCORE_SOURCE_NAMES,
	PELLET_SCORE_SOURCE_NAMES,
	TREASURE_SCORE_SOURCE_NAMES,
	SCORE_SOURCE_COUNT,
	SCORE_SOURCE_NAMES,
	ScoreSource,
	type ScoreSourceId,
} from "./scoreData";

/** SimConfig.scoring: presence turns scoring on. */
export interface ScoringConfig {
	/** Players in the party (the combo hit cut is 1 / max(2, partySize)). Integer >= 1; default 1 (solo). */
	readonly partySize?: number;
}

/** One encounter room's scoring record. Rooms without members (entrance, empty rooms, the boss room) have none. */
export interface RoomScore {
	/** EncounterRoom.id. */
	room: number;
	/** The room's bounds (copied from the encounter, so floor changes cannot move them under a live record). */
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	/** Par time, ticks. */
	parTicks: number;
	/** Tick the room engaged (see the file comment), -1 not yet. */
	engageTick: number;
	/** ScoreState.hitsTaken before the engagement tick's hits. */
	hitsAtEngage: number;
	/** 1 once cleared (each room clears once). */
	cleared: number;
	/** Members: actor slot and ActorState.id (a slot whose id changed is a member that is gone). */
	memberSlots: number[];
	memberIds: number[];
}

/** Per-tick scoring events for presentation (HUD, score pops). Cleared at the start of every tick; NOT hashed. */
export interface ScoreEvents {
	/** Points gained this tick. */
	points: number;
	kills: number;
	grazes: number;
	guardCancels: number;
	roomsCleared: number;
	/** 1 when the combo value at the end of the tick differs from its start. */
	comboChanged: number;
	/** 1 when the combo timer ran out and reset a combo above x1.0. */
	comboBroken: number;
	/** Landed hits that cut the combo this tick. */
	comboCut: number;
	/** Score pops (one per kill): world position and the points of that kill (incl. a boss bonus). */
	popX: number[];
	popZ: number[];
	popPoints: number[];
	/**
	 * Grazes (docs/GRAZE_PARRY.md GP1, presentation only): per graze awarded this tick, the bullet's position and
	 * velocity at the award (it has just left the graze ring) and the grazing player's index (solo 0; co-op the nearest
	 * living player). Parallel arrays; size() === grazes.
	 */
	grazeX: number[];
	grazeZ: number[];
	grazeVX: number[];
	grazeVZ: number[];
	grazePlayer: number[];
	/**
	 * Guard cancels (GP1): per enemy bullet a sword guard erased this tick, its position when erased and the guarding
	 * player's index. Parallel arrays; size() === guardCancels.
	 */
	guardX: number[];
	guardZ: number[];
	guardPlayer: number[];
	/** Internal: the combo at the start of the tick, and 1 once a kill / graze fed it this tick. */
	comboStart: number;
	comboFed: number;
}

export interface ScoreState {
	/** The run's score. */
	total: number;
	/** Combo in tenths (10 = x1.0 .. 50 = x5.0). */
	combo: number;
	/** Ticks left before the combo resets (COMBO_WINDOW_TICKS after a kill / graze; 0 = idle). */
	comboTimer: number;
	/** Highest combo this run, tenths. */
	maxCombo: number;
	/** Curses taken (curse multiplier = (4 + curses) / 4). */
	curses: number;
	/** From ScoringConfig.partySize. */
	partySize: number;
	/** Landed hits on the player so far (events.playerHits, summed by stepScore). */
	hitsTaken: number;
	/** hitsTaken when a boss's final phase began, -1 when no boss is in its final phase. */
	bossFinalHits: number;
	/** Points per source (ScoreSource order). */
	points: number[];
	/** Awards per source (ScoreSource order). */
	counts: number[];
	/** Ids of reviving actors (turrets) whose kill already scored. */
	scoredReviverIds: number[];
	/** Encounter rooms with members, by room id ascending. */
	rooms: RoomScore[];
	/** Not hashed. */
	events: ScoreEvents;
}

// ---------------------------------------------------------------------------------------------
// Accessors the merge wires (single points of truth)

/**
 * The Depth multiplier (integer >= 1): endless mode's Depth (state.endless, read as a plain field so this module never
 * imports ../endless), DEFAULT_DEPTH outside endless runs.
 */
export function scoreDepth(state: Readonly<SimState>): number {
	return state.endless?.depth ?? DEFAULT_DEPTH;
}

/** The current floor (1-based), for the kill floor scaling: endless mode's floor, DEFAULT_FLOOR outside endless runs. */
export function scoreFloor(state: Readonly<SimState>): number {
	return state.endless?.floor ?? DEFAULT_FLOOR;
}

/** Non-boss kill scaling for `floor`, percent: 100 + 8 (floor - 1). */
export function floorScalePercent(floor: number): number {
	return FLOOR_SCALE_DENOMINATOR + FLOOR_SCALE_PERCENT_PER_FLOOR * (floor - 1);
}

/** The combo multiplier as a number (display only; the sim keeps tenths). */
export function comboMultiplier(s: Readonly<ScoreState>): number {
	return s.combo / COMBO_DENOMINATOR;
}

/** The curse multiplier as a number (display only). */
export function curseMultiplier(s: Readonly<ScoreState>): number {
	return (CURSE_BASE + s.curses * CURSE_STEP) / CURSE_DENOMINATOR;
}

// ---------------------------------------------------------------------------------------------
// Creation

function zeros(n: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(0);
	return out;
}

function emptyScoreEvents(): ScoreEvents {
	return {
		points: 0,
		kills: 0,
		grazes: 0,
		guardCancels: 0,
		roomsCleared: 0,
		comboChanged: 0,
		comboBroken: 0,
		comboCut: 0,
		popX: [],
		popZ: [],
		popPoints: [],
		grazeX: [],
		grazeZ: [],
		grazeVX: [],
		grazeVZ: [],
		grazePlayer: [],
		guardX: [],
		guardZ: [],
		guardPlayer: [],
		comboStart: COMBO_MIN,
		comboFed: 0,
	};
}

/**
 * Room records for the actors present now (call right after the encounter spawned): every present non-boss actor is
 * a member of the encounter room containing it (roomAt); par = base + per-cost x its encounterCost. Slot order in,
 * room id order out. Pure in the state.
 */
export function buildScoreRooms(state: Readonly<SimState>, encounter: EncounterConfig | undefined): RoomScore[] {
	if (encounter === undefined) return [];
	const byRoom = new Map<number, RoomScore>();
	const actors = state.combat.actors;
	for (let k = 0; k < actors.size(); k++) {
		const a = actors[k];
		if (a.kind === NO_KIND) continue;
		const def = archetypeAt(a.kind);
		if (def.data.boss === true) continue;
		const room = roomAt(encounter, a.x, a.z);
		if (room === undefined) continue;
		let r = byRoom.get(room.id);
		if (r === undefined) {
			r = newRoomScore(room);
			byRoom.set(room.id, r);
		}
		r.memberSlots.push(k);
		r.memberIds.push(a.id);
		r.parTicks += ROOM_PAR_TICKS_PER_COST * encounterCost(def.id);
	}
	const out: RoomScore[] = [];
	for (const room of encounter.rooms) {
		const r = byRoom.get(room.id);
		if (r !== undefined) out.push(r);
	}
	return out;
}

function newRoomScore(room: Readonly<EncounterRoom>): RoomScore {
	return {
		room: room.id,
		minX: room.minX,
		maxX: room.maxX,
		minZ: room.minZ,
		maxZ: room.maxZ,
		parTicks: ROOM_PAR_BASE_TICKS,
		engageTick: -1,
		hitsAtEngage: 0,
		cleared: 0,
		memberSlots: [],
		memberIds: [],
	};
}

/**
 * Room records for a floor whose room enemies are DEFERRED (endless mode: `roomSpawns[id]` spawn when the player
 * first walks into room `id`): one record per encounter room with spawns, room id order, par = base + per-cost x the
 * summed encounterCost of its spawns. Elite affixes (docs/ENEMY_VARIANTS.md EVD8; `roomAffixes`, the floor's affix per
 * planned spawn, given only when the run has affixes): + per-cost x AFFIX_PAR_COST per affixed planned spawn. No
 * members yet: attachScoreRoomMembers adds them (and engages the room) on the tick they spawn; until then stepScore
 * skips the record. Pure.
 */
export function buildDeferredScoreRooms(
	encounter: EncounterConfig | undefined,
	roomSpawns: ReadonlyArray<ReadonlyArray<ActorSpawn>>,
	roomAffixes?: ReadonlyArray<ReadonlyArray<number>>,
): RoomScore[] {
	const out: RoomScore[] = [];
	if (encounter === undefined) return out;
	for (const room of encounter.rooms) {
		const spawns = roomSpawns[room.id];
		if (spawns === undefined || spawns.size() === 0) continue;
		const r = newRoomScore(room);
		for (const sp of spawns) r.parTicks += ROOM_PAR_TICKS_PER_COST * encounterCost(sp.kind);
		const affixes = roomAffixes?.[room.id];
		if (affixes !== undefined) {
			for (let i = 0; i < spawns.size(); i++) {
				const affix = affixes[i];
				if (affix !== undefined && affix !== AffixKind.NONE)
					r.parTicks += ROOM_PAR_TICKS_PER_COST * AFFIX_PAR_COST;
			}
		}
		out.push(r);
	}
	return out;
}

/**
 * Deferred room spawns (endless mode, stepEndless): `spawned` (in spawn order; the pool may have dropped some) are
 * room `roomId`'s members from now on, and the room engages at this tick (this tick's landed hits count against
 * perfect, as for an M1 room). No-op without scoring, for a room without a record, or one that already has members.
 */
export function attachScoreRoomMembers(state: SimState, roomId: number, spawned: ReadonlyArray<ActorState>): void {
	const s = state.score;
	if (s === undefined) return;
	const r = s.rooms.find((x) => x.room === roomId);
	if (r === undefined || r.memberSlots.size() > 0 || r.cleared !== 0) return;
	const actors = state.combat.actors;
	for (const a of spawned) {
		const slot = actors.indexOf(a);
		if (slot < 0) continue;
		r.memberSlots.push(slot);
		r.memberIds.push(a.id);
	}
	if (r.memberSlots.size() === 0) return;
	r.engageTick = state.tick;
	r.hitsAtEngage = s.hitsTaken;
}

/**
 * A runtime child (docs/ENEMY_VARIANTS.md: a slime's split, a summoner's summons) joins its parent's room record: the
 * record whose members hold `parent`'s slot with `parent`'s id (alive or a corpse: a split runs in onDeath) gains
 * `child` as one more member, so the room stays open (scoreRoomDown) until the child is down too. No-op without
 * scoring, when the parent is in no record, when that room is already cleared, or when `child` is not in the pool or
 * already a member. Par is unchanged (planned spawns fix it at floor start). Never called for boss adds.
 */
export function adoptScoreRoomMember(state: SimState, parent: Readonly<ActorState>, child: ActorState): void {
	const s = state.score;
	if (s === undefined) return;
	const actors = state.combat.actors;
	const parentSlot = actors.indexOf(parent as ActorState);
	const childSlot = actors.indexOf(child);
	if (parentSlot < 0 || childSlot < 0) return;
	for (const r of s.rooms) {
		let holdsParent = false;
		let holdsChild = false;
		for (let k = 0; k < r.memberSlots.size(); k++) {
			const slot = r.memberSlots[k];
			const id = r.memberIds[k];
			if (slot === parentSlot && id === parent.id) holdsParent = true;
			if (slot === childSlot && id === child.id) holdsChild = true;
		}
		if (!holdsParent) continue;
		if (r.cleared !== 0 || holdsChild) return;
		r.memberSlots.push(childSlot);
		r.memberIds.push(child.id);
		return;
	}
}

/** Validated party size: an integer >= 1. */
function partySizeOf(config: ScoringConfig): number {
	const n = config.partySize ?? DEFAULT_PARTY_SIZE;
	if (!(n >= 1 && n % 1 === 0 && n !== math.huge)) error(`scoring: partySize must be an integer >= 1, got ${n}`, 0);
	return n;
}

/**
 * Score state for a new run (createSimState calls it after the encounter spawned). With `roomSpawns` (endless mode:
 * the first floor's deferred room enemies, and its `roomAffixes`) the room records are buildDeferredScoreRooms', else
 * buildScoreRooms' from the actors present. Draws no rng.
 */
export function createScoreState(
	state: Readonly<SimState>,
	config: ScoringConfig,
	encounter: EncounterConfig | undefined,
	roomSpawns?: ReadonlyArray<ReadonlyArray<ActorSpawn>>,
	roomAffixes?: ReadonlyArray<ReadonlyArray<number>>,
): ScoreState {
	return {
		total: 0,
		combo: COMBO_MIN,
		comboTimer: 0,
		maxCombo: COMBO_MIN,
		curses: 0,
		partySize: partySizeOf(config),
		hitsTaken: 0,
		bossFinalHits: -1,
		points: zeros(SCORE_SOURCE_COUNT),
		counts: zeros(SCORE_SOURCE_COUNT),
		scoredReviverIds: [],
		rooms: roomRecords(state, encounter, roomSpawns, roomAffixes),
		events: emptyScoreEvents(),
	};
}

function roomRecords(
	state: Readonly<SimState>,
	encounter: EncounterConfig | undefined,
	roomSpawns: ReadonlyArray<ReadonlyArray<ActorSpawn>> | undefined,
	roomAffixes: ReadonlyArray<ReadonlyArray<number>> | undefined,
): RoomScore[] {
	// Affix par only in runs with affixes (SimConfig.affixes): a floor's roomAffixes alone changes nothing.
	return roomSpawns !== undefined
		? buildDeferredScoreRooms(encounter, roomSpawns, state.affixes !== undefined ? roomAffixes : undefined)
		: buildScoreRooms(state, encounter);
}

/**
 * A new floor's encounter (endless mode's floor transition, after its initial actors spawned): replaces the room
 * records (deferred ones when `roomSpawns` is given, with the floor's `roomAffixes`, as in createScoreState) and
 * forgets a pending boss final phase. Score, combo, curses and the breakdown carry over.
 */
export function rebuildScoreRooms(
	state: SimState,
	encounter: EncounterConfig | undefined,
	roomSpawns?: ReadonlyArray<ReadonlyArray<ActorSpawn>>,
	roomAffixes?: ReadonlyArray<ReadonlyArray<number>>,
): void {
	const s = state.score;
	if (s === undefined) return;
	s.rooms = roomRecords(state, encounter, roomSpawns, roomAffixes);
	s.bossFinalHits = -1;
}

function cloneRoom(r: Readonly<RoomScore>): RoomScore {
	return { ...r, memberSlots: [...r.memberSlots], memberIds: [...r.memberIds] };
}

export function cloneScoreState(s: Readonly<ScoreState>): ScoreState {
	const e = s.events;
	return {
		...s,
		points: [...s.points],
		counts: [...s.counts],
		scoredReviverIds: [...s.scoredReviverIds],
		rooms: s.rooms.map(cloneRoom),
		events: {
			...e,
			popX: [...e.popX],
			popZ: [...e.popZ],
			popPoints: [...e.popPoints],
			grazeX: [...e.grazeX],
			grazeZ: [...e.grazeZ],
			grazeVX: [...e.grazeVX],
			grazeVZ: [...e.grazeVZ],
			grazePlayer: [...e.grazePlayer],
			guardX: [...e.guardX],
			guardZ: [...e.guardZ],
			guardPlayer: [...e.guardPlayer],
		},
	};
}

/** Start of every tick (step.ts, after clearEvents). */
export function clearScoreEvents(s: ScoreState): void {
	const e = s.events;
	e.points = 0;
	e.kills = 0;
	e.grazes = 0;
	e.guardCancels = 0;
	e.roomsCleared = 0;
	e.comboChanged = 0;
	e.comboBroken = 0;
	e.comboCut = 0;
	e.popX.clear();
	e.popZ.clear();
	e.popPoints.clear();
	e.grazeX.clear();
	e.grazeZ.clear();
	e.grazeVX.clear();
	e.grazeVZ.clear();
	e.grazePlayer.clear();
	e.guardX.clear();
	e.guardZ.clear();
	e.guardPlayer.clear();
	e.comboStart = s.combo;
	e.comboFed = 0;
}

// ---------------------------------------------------------------------------------------------
// Awards

const AWARD_DENOMINATOR = COMBO_DENOMINATOR * CURSE_DENOMINATOR * FLOOR_SCALE_DENOMINATOR;

/**
 * floor(base x combo/10 x depth x curse/4 x scale/100) as integer arithmetic: the numerator is an integer below 2^53
 * (exact), `num % den` is exact, so (num - num % den) / den is the exact floor. `bonusPercent` (M2 Bounty, affixes)
 * and `extraPercent` (builds Gold Rush, applied after it) are more integer factors over 100 each; at their default
 * (100) the arithmetic is exactly the shorter form, so a run without them scores bit-identically.
 */
export function awardPoints(
	state: Readonly<SimState>,
	s: Readonly<ScoreState>,
	base: number,
	scalePercent: number = FLOOR_SCALE_DENOMINATOR,
	bonusPercent: number = FLOOR_SCALE_DENOMINATOR,
	extraPercent: number = FLOOR_SCALE_DENOMINATOR,
): number {
	const num = base * s.combo * scoreDepth(state) * (CURSE_BASE + s.curses * CURSE_STEP) * scalePercent;
	if (extraPercent === FLOOR_SCALE_DENOMINATOR) {
		if (bonusPercent === FLOOR_SCALE_DENOMINATOR) return (num - (num % AWARD_DENOMINATOR)) / AWARD_DENOMINATOR;
		// An extra integer percent (M2 Bounty): one more factor over 100, still an exact integer numerator.
		const big = num * bonusPercent;
		const den = AWARD_DENOMINATOR * FLOOR_SCALE_DENOMINATOR;
		return (big - (big % den)) / den;
	}
	// Two more factors over 100 (Bounty, then Gold Rush): the numerator stays an exact integer (far below 2^53 for any
	// kill: base <= 5000, combo <= 50, curse and scale factors in the tens and hundreds, percents <= 200).
	const huge = num * bonusPercent * extraPercent;
	const hugeDen = AWARD_DENOMINATOR * FLOOR_SCALE_DENOMINATOR * FLOOR_SCALE_DENOMINATOR;
	return (huge - (huge % hugeDen)) / hugeDen;
}

function award(
	state: Readonly<SimState>,
	s: ScoreState,
	source: ScoreSourceId,
	base: number,
	scalePercent?: number,
	bonusPercent?: number,
	extraPercent?: number,
): number {
	return credit(s, source, awardPoints(state, s, base, scalePercent, bonusPercent, extraPercent));
}

/** Books `pts` under `source`: the total, the source's points and count, this tick's points event. Returns `pts`. */
function credit(s: ScoreState, source: ScoreSourceId, pts: number): number {
	s.total += pts;
	s.points[source] += pts;
	s.counts[source] += 1;
	s.events.points += pts;
	return pts;
}

/**
 * The combo window in ticks: COMBO_WINDOW_TICKS, or what the M2 boons / curses make of it (endless runs; team-wide in
 * co-op, runMods.ts teamComboWindowTicks).
 */
export function comboWindowTicks(state: Readonly<SimState>): number {
	return teamComboWindowTicks(state);
}

/** A kill or graze: +0.1 (capped), timer refilled. */
function feedCombo(state: Readonly<SimState>, s: ScoreState): void {
	const raised = s.combo + COMBO_STEP;
	s.combo = raised > COMBO_MAX ? COMBO_MAX : raised;
	if (s.combo > s.maxCombo) s.maxCombo = s.combo;
	s.comboTimer = comboWindowTicks(state);
	s.events.comboFed = 1;
}

/**
 * One landed hit: combo x (1 - 1/d), d = max(2, players) x divisorMultiplier (M2 Composure: 2), floored to the
 * tenth, at least x1.0. `players`: the players present at the hit (stepScore passes presentPlayerCount in co-op);
 * default ScoringConfig.partySize.
 */
export function cutCombo(s: ScoreState, divisorMultiplier = 1, players: number = s.partySize): void {
	const d = (players > COMBO_CUT_MIN_DIVISOR ? players : COMBO_CUT_MIN_DIVISOR) * divisorMultiplier;
	const num = s.combo * (d - 1);
	const cut = (num - (num % d)) / d;
	s.combo = cut < COMBO_MIN ? COMBO_MIN : cut;
	s.events.comboCut += 1;
}

/**
 * killActor hook: `a` just died (alive is already 0), killed by player `killer` (SimCtx.playerIndex: the bullet's
 * owner or the swinging player; 0 in a solo run). Bounty follows the killer's boons.
 */
export function scoreKill(state: SimState, a: Readonly<ActorState>, killer = 0): void {
	const s = state.score;
	if (s === undefined) return;
	const def = archetypeAt(a.kind);
	if (def.stepDead !== undefined) {
		if (s.scoredReviverIds.includes(a.id)) return;
		s.scoredReviverIds.push(a.id);
	}
	const base = KILL_POINTS.get(def.id) ?? DEFAULT_KILL_POINTS;
	// Bounty (the killer's boons), then (elite affixes, EVD8) x killPointsPercent for an affixed kill.
	const bonus = affixKillPercent(state, a, runMods(state, killer).killPointsPercent);
	// Builds (docs/BUILDS.md BU6, opt-in): Gold Rush, after Bounty, at combo x3 or more (before this kill's +0.1).
	const gold =
		state.builds !== undefined && s.combo >= GOLD_RUSH_MIN_COMBO && buildsGoldRush(state, killer)
			? GOLD_RUSH_PERCENT
			: undefined;
	let pts: number;
	if (def.data.boss === true) {
		pts = award(state, s, ScoreSource.BOSS, base, undefined, bonus, gold);
		const finalPhase = BOSS_FINAL_PHASE.get(def.id);
		if (finalPhase !== undefined && a.phase >= finalPhase) {
			// Hits landed so far, this tick's included (events.playerHits is live during the tick).
			const hitsNow = s.hitsTaken + state.events.playerHits;
			const since = s.bossFinalHits >= 0 ? s.bossFinalHits : s.hitsTaken;
			if (hitsNow === since) pts += award(state, s, ScoreSource.BOSS, BOSS_NO_HIT_BONUS);
		}
		s.bossFinalHits = -1;
	} else {
		pts = award(state, s, ScoreSource.KILLS, base, floorScalePercent(scoreFloor(state)), bonus, gold);
	}
	if (gold !== undefined) buildsGoldRushPop(state, killer, a.x, a.z, pts);
	const e = s.events;
	e.kills += 1;
	e.popX.push(a.x);
	e.popZ.push(a.z);
	e.popPoints.push(pts);
	feedCombo(state, s);
}

/**
 * Breakables hook (docs/DECOR.md D4, breakables/breakables.ts): a player broke a piece of `kind` (BreakableKind).
 * BREAKABLE_POINTS[kind] x the floor, through the usual multipliers; the combo is NOT fed (no farming) and no room
 * record is touched. Returns the points.
 */
export function scoreBreakable(state: SimState, kind: number): number {
	const s = state.score;
	if (s === undefined) return 0;
	const base = BREAKABLE_POINTS[kind];
	if (base === undefined) return 0;
	return award(state, s, ScoreSource.BREAKABLES, base * scoreFloor(state));
}

/**
 * Builds runs (docs/BUILDS.md BU5, state.ts createSimState): appends the build-only sources (BUILD_SCORE_SOURCE_NAMES:
 * JACKPOT) to points / counts, so they hash only in builds runs. Idempotent.
 */
export function addBuildScoreSources(s: ScoreState): void {
	const total = SCORE_SOURCE_COUNT + BUILD_SCORE_SOURCE_NAMES.size();
	while (s.points.size() < total) s.points.push(0);
	while (s.counts.size() < total) s.counts.push(0);
}

/**
 * Jackpot hook (sim/builds procs.ts, Bounty III): JACKPOT_POINTS x the floor into ScoreSource.JACKPOT, through the
 * usual multipliers; never feeds the combo, touches no room record. Returns the points (0 without scoring or without
 * the builds sources).
 */
export function scoreJackpot(state: SimState): number {
	const s = state.score;
	if (s === undefined || s.points.size() <= ScoreSource.JACKPOT) return 0;
	return award(state, s, ScoreSource.JACKPOT, JACKPOT_POINTS * scoreFloor(state));
}

/**
 * Treasure runs (docs/TREASURE.md TR2, state.ts createSimState, after the builds and pellets padding): pads points /
 * counts to every source up to TREASURE_SCORE_SOURCE_NAMES (JACKPOT / PELLETS / SWEEP included when the run lacks
 * builds or pellets: they stay 0), so TREASURE hashes only in treasure runs. Idempotent.
 */
export function addTreasureScoreSources(s: ScoreState): void {
	const total =
		SCORE_SOURCE_COUNT +
		BUILD_SCORE_SOURCE_NAMES.size() +
		PELLET_SCORE_SOURCE_NAMES.size() +
		TREASURE_SCORE_SOURCE_NAMES.size();
	while (s.points.size() < total) s.points.push(0);
	while (s.counts.size() < total) s.counts.push(0);
}

/**
 * The TREASURE award for `base` (docs/TREASURE.md TRD11, correction 5): floor(base x depth x (4 + curses) / 4), the
 * room bonuses' multipliers without the combo (fixed at COMBO_MIN, x1.0), as exact integer arithmetic. Pure.
 */
export function treasureAwardPoints(state: Readonly<SimState>, s: Readonly<ScoreState>, base: number): number {
	const num = base * scoreDepth(state) * (CURSE_BASE + s.curses * CURSE_STEP);
	return (num - (num % CURSE_DENOMINATOR)) / CURSE_DENOMINATOR;
}

/**
 * Treasure hook (sim/treasure, a chest's open, TR4): treasureAwardPoints(base) into ScoreSource.TREASURE, once per
 * open; never feeds the combo or its timer, touches no room record. Returns the points (0 without scoring or without
 * the treasure sources: addTreasureScoreSources).
 */
export function scoreTreasure(state: SimState, base: number): number {
	const s = state.score;
	if (s === undefined || s.points.size() <= ScoreSource.TREASURE) return 0;
	return credit(s, ScoreSource.TREASURE, treasureAwardPoints(state, s, base));
}

/**
 * Pellet runs (docs/PELLETS.md PL2, state.ts createSimState): pads points / counts to every source up to
 * PELLET_SCORE_SOURCE_NAMES (JACKPOT included when the run has no builds: it stays 0), so they hash only in pellet runs.
 * Idempotent.
 */
export function addPelletScoreSources(s: ScoreState): void {
	const total = SCORE_SOURCE_COUNT + BUILD_SCORE_SOURCE_NAMES.size() + PELLET_SCORE_SOURCE_NAMES.size();
	while (s.points.size() < total) s.points.push(0);
	while (s.counts.size() < total) s.counts.push(0);
}

/**
 * Pellet hook (docs/PELLETS.md PL3, sim/pellets): one pellet taken. The run's PelletsConfig.pelletPoints at the kills'
 * floor scaling (floorScalePercent) into ScoreSource.PELLETS, through the usual multipliers; it NEVER feeds the combo or
 * refills its timer (PD1) and touches no room record. Returns the points (0 without scoring, pellets or their sources).
 * Reads state.pellets through the state types only (this module never requires sim/pellets).
 */
export function scorePellet(state: SimState): number {
	const s = state.score;
	const p = state.pellets;
	if (s === undefined || p === undefined || s.points.size() <= ScoreSource.PELLETS) return 0;
	return award(state, s, ScoreSource.PELLETS, p.config.pelletPoints, floorScalePercent(scoreFloor(state)));
}

/**
 * Sweep hook (PL3, from a room's clear): PelletsConfig.sweepPoints, flat, into ScoreSource.SWEEP, through the usual
 * multipliers; never feeds the combo (PD1). Returns the points (0 without scoring, pellets or their sources).
 */
export function scoreSweep(state: SimState): number {
	const s = state.score;
	const p = state.pellets;
	if (s === undefined || p === undefined || s.points.size() <= ScoreSource.SWEEP) return 0;
	return award(state, s, ScoreSource.SWEEP, p.config.sweepPoints);
}

/**
 * Power pellet hook (PL4): `n` enemy bullets converted. One award of PelletsConfig.powerBulletPoints (flat) per bullet
 * into ScoreSource.PELLETS, at most PelletsConfig.powerMaxBullets of them; never feeds the combo (PD1). Returns the
 * points (0 without scoring, pellets or their sources, or for n <= 0).
 */
export function scorePowerBullets(state: SimState, n: number): number {
	const s = state.score;
	const p = state.pellets;
	if (s === undefined || p === undefined || s.points.size() <= ScoreSource.PELLETS) return 0;
	const paid = n < p.config.powerMaxBullets ? n : p.config.powerMaxBullets;
	let pts = 0;
	for (let k = 0; k < paid; k++) pts += award(state, s, ScoreSource.PELLETS, p.config.powerBulletPoints);
	return pts;
}

/** Sword guard hook: `n` enemy bullets erased by this tick's guard sweep. One award per bullet. */
export function scoreGuardCancels(state: SimState, n: number): void {
	const s = state.score;
	if (s === undefined) return;
	for (let k = 0; k < n; k++) award(state, s, ScoreSource.GUARD, GUARD_CANCEL_POINTS);
	s.events.guardCancels += n;
}

/**
 * The floor clear's base before the multipliers: floor(FLOOR_CLEAR_POINTS x floor x cleared / total), integer-exact
 * (the numerator is an integer far below 2^53, `num % total` is exact, so (num - num % total) / total is the exact
 * floor: rounded DOWN to the point). `total` = the floor's rooms with enemies (+1 for the boss on a boss floor),
 * `cleared` = those cleared (+1 when the boss died). A floor with nothing to clear pays the full FLOOR_CLEAR_POINTS x
 * floor. Pure.
 */
export function floorClearBase(floor: number, cleared: number, total: number): number {
	const full = FLOOR_CLEAR_POINTS * floor;
	if (total <= 0) return full;
	const num = full * (cleared < total ? cleared : total);
	return (num - (num % total)) / total;
}

/** The current floor's room records: [cleared, total] (rooms with enemies; deferred ones count before their spawn). */
export function floorRoomTally(s: Readonly<ScoreState>): [number, number] {
	let cleared = 0;
	for (const r of s.rooms) if (r.cleared !== 0) cleared++;
	return [cleared, s.rooms.size()];
}

/**
 * Floor clear (call from the floor transition, before the room records are rebuilt): floorClearBase(floor, rooms
 * cleared, rooms with enemies) through the multipliers, so sprinting to the stairwell past every room pays nothing and
 * clearing half the rooms pays half. `bossRoom`: the floor is a boss floor (the boss counts as one more room);
 * `bossCleared`: the boss died on it. No-op without scoring.
 */
export function awardFloorClear(state: SimState, floor: number, bossRoom = false, bossCleared = false): number {
	const s = state.score;
	if (s === undefined) return 0;
	const [cleared, total] = floorRoomTally(s);
	const base = floorClearBase(floor, cleared + (bossRoom && bossCleared ? 1 : 0), total + (bossRoom ? 1 : 0));
	return award(state, s, ScoreSource.FLOORS, base);
}

/** One more curse: the curse multiplier +0.25 (shrines). No-op without scoring. */
export function addCurse(state: SimState): void {
	const s = state.score;
	if (s === undefined) return;
	s.curses += 1;
}

// ---------------------------------------------------------------------------------------------
// Graze (payload flag bits above the BulletPayload layout: hashed with the bullet, follow its slot through
// swap-remove, reset when fireAt writes a new payload into the slot)

const GRAZE_FLAG_BITS = 2;
/** Most bits a payload may use (bit 31 is the sign; see projectilePatterns.ts MAX_BITS). */
const PAYLOAD_MAX_BITS = 31;
if (PAYLOAD_BITS + GRAZE_FLAG_BITS > PAYLOAD_MAX_BITS) {
	error(`scoring: the graze flags need 2 payload bits above the ${PAYLOAD_BITS}-bit BulletPayload layout`, 0);
}
/** The bullet has been inside the graze ring (not the hit circle). */
export const GRAZE_NEAR_BIT = bit32.lshift(1, PAYLOAD_BITS);
/** The bullet is settled for scoring: grazed, entered the hit circle, or came near a dead player. */
export const GRAZE_DONE_BIT = bit32.lshift(1, PAYLOAD_BITS + 1);

const GRAZE_R = PLAYER_RADIUS + ENEMY_BULLET_RADIUS + GRAZE_MARGIN;
/** (PLAYER_RADIUS + ENEMY_BULLET_RADIUS + GRAZE_MARGIN)^2. */
export const GRAZE_R2 = GRAZE_R * GRAZE_R;

/**
 * combat.ts enemyBulletHit, for every enemy bullet that was not stopped by a wall (scoring on). `d2` = squared center
 * distance to the player, `inHit` = inside the hit circle (before the hit is attempted), `grazeR2` = this tick's
 * squared graze radius (GRAZE_R2; wider with M2 Daredevil). `dead`: that player is dead
 * (default: player 0; co-op passes its graze target, the nearest living player, so a dead player never grazes).
 * `grazer`: that player's index (default SOLO_PLAYER; co-op passes the graze target). An awarded graze pushes the
 * bullet's position and velocity (read at once, never kept) and `grazer` into the events' graze arrays
 * (docs/GRAZE_PARRY.md GP1, presentation only).
 */
export function scoreBulletVisit(
	state: SimState,
	sim: BulletSimulation,
	i: number,
	payload: number,
	d2: number,
	inHit: boolean,
	grazeR2: number = GRAZE_R2,
	dead: boolean = state.player.dead !== 0,
	grazer: number = SOLO_PLAYER,
): void {
	if (bit32.band(payload, GRAZE_DONE_BIT) !== 0) return;
	if (inHit) {
		sim.setPayload(i, bit32.bor(payload, GRAZE_DONE_BIT));
		return;
	}
	const near = bit32.band(payload, GRAZE_NEAR_BIT) !== 0;
	if (d2 < grazeR2) {
		if (dead) sim.setPayload(i, bit32.bor(payload, GRAZE_DONE_BIT));
		else if (!near) sim.setPayload(i, bit32.bor(payload, GRAZE_NEAR_BIT));
		return;
	}
	if (!near) return;
	sim.setPayload(i, bit32.bor(payload, GRAZE_DONE_BIT));
	const s = state.score;
	if (dead || s === undefined) return;
	award(state, s, ScoreSource.GRAZES, GRAZE_POINTS);
	const e = s.events;
	e.grazes += 1;
	const pos = sim.positionAt(i);
	e.grazeX.push(pos.x);
	e.grazeZ.push(pos.z);
	const vel = sim.velocityAt(i);
	e.grazeVX.push(vel.x);
	e.grazeVZ.push(vel.z);
	e.grazePlayer.push(grazer);
	feedCombo(state, s);
	// Builds (docs/BUILDS.md BU5, opt-in): the graze counters (Thrill Seeker; released in stepBuilds).
	if (state.builds !== undefined) buildsOnGraze(state, grazer);
}

// ---------------------------------------------------------------------------------------------
// The end-of-tick pass

function member(state: Readonly<SimState>, r: Readonly<RoomScore>, k: number): ActorState | undefined {
	const a = state.combat.actors[r.memberSlots[k]];
	return a !== undefined && a.kind !== NO_KIND && a.id === r.memberIds[k] ? a : undefined;
}

/**
 * A room record's engagement test (stepScore latches engageTick on the first tick it holds): a living player inside
 * its bounds, or a member gone, dead, hurt or (room enemies) aggroed. Exported for the room-edge view
 * (docs/ROOM_EDGES.md), which judges unscored runs with it. Pure.
 */
export function scoreRoomEngaged(state: Readonly<SimState>, r: Readonly<RoomScore>): boolean {
	// Any living player inside (co-op: index order; solo: the player).
	const n = partySize(state);
	for (let i = 0; i < n; i++) {
		const p = playerAt(state, i);
		if (p.dead === 0 && p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ) return true;
	}
	for (let k = 0; k < r.memberSlots.size(); k++) {
		const a = member(state, r, k);
		if (a === undefined || a.alive === 0 || a.hp < a.hpMax) return true;
		if (isRoomEnemyData(archetypeAt(a.kind).data) && a.v[V_AGGRO] !== 0) return true;
	}
	return false;
}

/** A room record's clear test: no member present and alive. Exported for the room-edge view, as scoreRoomEngaged. */
export function scoreRoomDown(state: Readonly<SimState>, r: Readonly<RoomScore>): boolean {
	for (let k = 0; k < r.memberSlots.size(); k++) {
		const a = member(state, r, k);
		if (a !== undefined && a.alive !== 0) return false;
	}
	return true;
}

function clearRoom(state: SimState, s: ScoreState, r: RoomScore, k: number): void {
	r.cleared = 1;
	s.events.roomsCleared += 1;
	// Pellets (docs/PELLETS.md PL3, opt-in): before the other awards, the room's pellets go and its Sweep pays when every
	// regular pellet was taken (this tick's pickups included: stepPellets runs before stepScore).
	if (state.pellets !== undefined && pelletRoomClear(state, k)) scoreSweep(state);
	award(state, s, ScoreSource.ROOMS, ROOM_CLEAR_POINTS);
	if (s.hitsTaken === r.hitsAtEngage) {
		award(state, s, ScoreSource.PERFECT, ROOM_PERFECT_POINTS);
		// Builds (docs/BUILDS.md BU5, opt-in): Lionheart heals on a PERFECT clear.
		if (state.builds !== undefined) buildsOnPerfectRoom(state);
	}
	const under = r.parTicks - (state.tick - r.engageTick);
	if (under > 0) award(state, s, ScoreSource.FAST, under * FAST_POINTS_PER_TICK);
}

/** A live boss reached its final phase this tick: open the no-hit window (this tick's hits count against it). */
function markBossFinalPhase(state: Readonly<SimState>, s: ScoreState): void {
	if (s.bossFinalHits >= 0) return;
	for (const a of state.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0) continue;
		const def = archetypeAt(a.kind);
		if (def.data.boss !== true) continue;
		const finalPhase = BOSS_FINAL_PHASE.get(def.id);
		if (finalPhase !== undefined && a.phase >= finalPhase) {
			s.bossFinalHits = s.hitsTaken;
			return;
		}
	}
}

/**
 * End of every tick (step.ts, after stepCombat, before tick += 1), fixed order:
 *   1. a boss's final phase began -> open its no-hit window
 *   2. this tick's landed hits: cut the combo once per hit, hitsTaken += hits
 *   3. combo timer (only on ticks without a kill / graze): count down, reset at 0
 *   4. rooms, by room id: engagement (pellet runs: the record's pellets go live), then clear (pellet runs: the
 *      pellets go, + sweep; then + rooms, + perfect, + fast)
 */
export function stepScore(state: SimState): void {
	const s = state.score;
	if (s === undefined) return;
	const e = s.events;
	const ev = state.events;

	if (ev.bossPhase !== 0) markBossFinalPhase(state, s);

	const hits = ev.playerHits;
	const cutMultiplier = teamComboCutDivisorMultiplier(state);
	const present = presentPlayerCount(state) ?? s.partySize;
	// Builds (docs/BUILDS.md BU6, opt-in): Unshaken's hits taken on armor never cut the combo (they still count).
	const cuts = state.builds !== undefined ? hits - buildsUnshakenKept(state) : hits;
	for (let k = 0; k < cuts; k++) cutCombo(s, cutMultiplier, present);
	const hitsBefore = s.hitsTaken;
	s.hitsTaken += hits;

	if (e.comboFed === 0 && s.comboTimer > 0) {
		s.comboTimer -= 1;
		if (s.comboTimer === 0 && s.combo > COMBO_MIN) {
			s.combo = COMBO_MIN;
			e.comboBroken = 1;
		}
	}

	const pellets = state.pellets !== undefined;
	for (let k = 0; k < s.rooms.size(); k++) {
		const r = s.rooms[k];
		// Cleared, or a deferred room whose enemies have not spawned yet (attachScoreRoomMembers).
		if (r.cleared !== 0 || r.memberSlots.size() === 0) continue;
		if (r.engageTick < 0) {
			if (!scoreRoomEngaged(state, r)) continue;
			r.engageTick = state.tick;
			r.hitsAtEngage = hitsBefore;
		}
		// Pellets (docs/PELLETS.md PL3, opt-in): an engaged record's pellets go live (once; endless records engage in
		// attachScoreRoomMembers, so this is their first pass here).
		if (pellets) pelletRoomLive(state, k);
		if (scoreRoomDown(state, r)) clearRoom(state, s, r, k);
	}

	e.comboChanged = s.combo !== e.comboStart ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Hash ("score" subsystem, appended after playerBullets only when state.score exists)

/** Scalar ScoreState fields, in hash order. Append only. */
export const SCORE_HASH_FIELDS = [
	"total",
	"combo",
	"comboTimer",
	"maxCombo",
	"curses",
	"partySize",
	"hitsTaken",
	"bossFinalHits",
] as const;

const ROOM_HASH_FIELDS = [
	"room",
	"minX",
	"maxX",
	"minZ",
	"maxZ",
	"parTicks",
	"engageTick",
	"hitsAtEngage",
	"cleared",
] as const;

export function writeScoreHash(s: Readonly<ScoreState>, out: number[]): void {
	for (const f of SCORE_HASH_FIELDS) out.push(s[f]);
	for (const n of s.points) out.push(n);
	for (const n of s.counts) out.push(n);
	out.push(s.scoredReviverIds.size());
	for (const id of s.scoredReviverIds) out.push(id);
	out.push(s.rooms.size());
	for (const r of s.rooms) {
		for (const f of ROOM_HASH_FIELDS) out.push(r[f]);
		out.push(r.memberSlots.size());
		for (let k = 0; k < r.memberSlots.size(); k++) out.push(r.memberSlots[k], r.memberIds[k]);
	}
}

/**
 * The dump name of source index `k` (SCORE_SOURCE_NAMES, then BUILD_SCORE_SOURCE_NAMES, then PELLET_..., then
 * TREASURE_...).
 */
function sourceName(k: number): string {
	if (k < SCORE_SOURCE_COUNT) return SCORE_SOURCE_NAMES[k];
	const build = k - SCORE_SOURCE_COUNT;
	if (build < BUILD_SCORE_SOURCE_NAMES.size()) return BUILD_SCORE_SOURCE_NAMES[build];
	const pellet = build - BUILD_SCORE_SOURCE_NAMES.size();
	if (pellet < PELLET_SCORE_SOURCE_NAMES.size()) return PELLET_SCORE_SOURCE_NAMES[pellet];
	return TREASURE_SCORE_SOURCE_NAMES[pellet - PELLET_SCORE_SOURCE_NAMES.size()];
}

/** Dump names for writeScoreHash, same order (`score.total`, `score.points.kills`, `score.rooms[0].cleared`, ...). */
export function scoreHashNames(s: Readonly<ScoreState>, out: string[]): void {
	for (const f of SCORE_HASH_FIELDS) out.push(`score.${f}`);
	for (let k = 0; k < s.points.size(); k++) out.push(`score.points.${sourceName(k)}`);
	for (let k = 0; k < s.counts.size(); k++) out.push(`score.counts.${sourceName(k)}`);
	out.push("score.scoredReviverIds.length");
	for (let k = 0; k < s.scoredReviverIds.size(); k++) out.push(`score.scoredReviverIds[${k}]`);
	out.push("score.rooms.length");
	for (let i = 0; i < s.rooms.size(); i++) {
		const r = s.rooms[i];
		const p = `score.rooms[${i}]`;
		for (const f of ROOM_HASH_FIELDS) out.push(`${p}.${f}`);
		out.push(`${p}.members.length`);
		for (let k = 0; k < r.memberSlots.size(); k++) out.push(`${p}.members[${k}].slot`, `${p}.members[${k}].id`);
	}
}

/**
 * Pacts in the tick (docs/FORTUNE.md "Pacts", PS3 / PS4, decisions FD3-FD8): the altars and the Horde's second wave.
 * Only with state.pacts (SimConfig.pacts) and endless mode; step() / stepParty() call stepPacts right after stepRun
 * (stepRun's slot 5: after the pedestals' draws, so the main rng order is the classic shrine's) and stepPactsWave
 * between stepPellets and stepScore. The room hooks (rousing, the hold, the x2) are the leaf ./pactRooms.ts.
 *
 * stepPacts (not on a floor-change tick: that tick belongs to the floor's drafts; nothing on a floor without altars), per
 * player in index order, living and present, with a SHRINE_BUTTON press edge (against prevButtons from before the
 * tick, as the classic shrine) inside an altar's zone (SHRINE_RADIUS around its cell centre; the zones never overlap,
 * shared/dungeon placePactAltars) whose pact is available to them (pactAvailability):
 *   Greed  the curse pactCurseIndex(floor seed, player, unused curses) picks from their unused curses (Curse order; NO
 *          rng draw: the view showed this curse) is applied (progression acceptCurse: its one-off effect, the team score
 *          x +0.25, the mods; run events curseAccepted as the classic shrine's), greedTaken = 1, draftKind = GREED,
 *          taken[GREED] += 1, then the Legendary deal (drawLegendaryOffers on the main rng, config.legendaryCards cards;
 *          without builds: one rngInt pick per card among the unowned legendary classic boons) opens as the player's
 *          draft (progression openDealtDraft: one deal). The world freezes from the next tick like every draft
 *          (holdTimers.ts holds the absolute-tick timers through it: FAST, waveDueTick, the Goldling's appearance).
 *   Horde  hordeTaken = 1, horde.armed = 1, taken[HORDE] += 1. No draw. The next room with planned spawns any living
 *          player enters becomes the horde room (pactRooms.ts pactsOnRoomSpawned, from endless.ts enterRoom).
 *
 * stepPactsWave (a roused horde room whose second wave has not spawned; someone alive):
 *   trigger   no telegraph yet and the record's living first-wave members (entries 0 .. firstWave - 1; a member gone or
 *             dead is down) number at most floor(firstWave / 2) (a one-enemy room: when it dies): the room's planned
 *             spawns again (EndlessFloorWorld.roomSpawns, in order, the first config.hordeMaxWave of them) through
 *             safeRoomSpawns (kept off the living players as a room's spawns are) give wave 2's kinds and tiles (stored);
 *             waveDueTick = tick + config.waveTelegraphTicks. No draw.
 *   spawn     at waveDueTick: each wave entry in order through spawnActor with NO affix (a full pool drops the rest; init
 *             hooks may draw the main rng, a consequence of the pact taken), appended to the record
 *             (appendScoreRoomMembers, its par + the wave's encounter cost x ROOM_PAR_TICKS_PER_COST + the telegraph);
 *             spawned = how many got a slot. From then on the record may clear (pactRooms.ts pactHoldsRoom).
 *
 * The view's queries (pure reads of hashed state): pactAltarAt, pactAvailability, greedCurseFor, hordePhase,
 * pactAltarOffered, pactDraftKind, greedTakes, pactsSpent.
 */
import { encounterCost, pactCurseIndex } from "shared/dungeon";
import { rngInt } from "../rng";
import type { InputFrame } from "../input";
import type { SimState } from "../state";
import type { SimConfig } from "../step";
import { SimCtx } from "../combat/ctx";
import { spawnActor } from "../combat/actors/actors";
import { archetypeAt, archetypeIndex } from "../combat/actors/registry";
import { NO_KIND, type ActorState } from "../combat/actors/types";
import type { ActorSpawn } from "../combat/actors/encounter";
import { endlessFloorWorld, safeRoomSpawns } from "../endless";
import { hasLeft, partySize, playerAt } from "../party";
import { appendScoreRoomMembers } from "../score/score";
import { ROOM_PAR_TICKS_PER_COST } from "../score/scoreData";
import { acceptCurse, openDealtDraft } from "../progression/progression";
import { runPlayer } from "../progression/runMods";
import { vaultParGrown } from "../treasure/stepTreasure";
import {
	BOONS,
	CLASSIC_BOON_COUNT,
	CURSE_COUNT,
	Rarity,
	SHRINE_BUTTON,
	SHRINE_RADIUS,
} from "../progression/progressionData";
import { buildPlayer } from "../builds/builds";
import { drawLegendaryOffers, legendaryPool } from "../builds/cards";
import {
	HORDE_NONE,
	HORDE_WAVE_PENDING,
	NO_PACT,
	PACT_KIND_COUNT,
	PactDim,
	PactKind,
	type PactDimId,
	type PactKindId,
} from "./pactsData";
import type { PactsState } from "./pacts";

const ctx = new SimCtx();

// ---------------------------------------------------------------------------------------------
// Reads (the view's queries too)

/** The unused curses of player `playerIndex` (Curse order); empty without run state. */
function unusedCurses(state: Readonly<SimState>, playerIndex: number): number[] {
	const out: number[] = [];
	const me = runPlayer(state, playerIndex);
	if (me === undefined) return out;
	for (let c = 0; c < CURSE_COUNT; c++) if (!me.curses.includes(c)) out.push(c);
	return out;
}

/** Without builds: the unowned legendary classic boons (Boon order), the only legendary cards there are. */
function classicLegendaryPool(state: Readonly<SimState>, playerIndex: number): number[] {
	const out: number[] = [];
	const me = runPlayer(state, playerIndex);
	if (me === undefined) return out;
	for (let b = 0; b < CLASSIC_BOON_COUNT; b++)
		if (BOONS[b].rarity === Rarity.LEGENDARY && !me.boons.includes(b)) out.push(b);
	return out;
}

/** The cards Greed's deal could draw from for player `playerIndex` (legendaryPool with builds). */
function greedPool(state: Readonly<SimState>, playerIndex: number): number[] {
	const bp = buildPlayer(state, playerIndex);
	return bp !== undefined ? legendaryPool(bp.levels, bp.duos) : classicLegendaryPool(state, playerIndex);
}

/**
 * The curse the Pact of Greed would give player `playerIndex` on this floor (a Curse index; pactCurseIndex over their
 * unused curses), or -1 (no pacts, no altars on this floor, or no curse left). Pure; the altar's card shows it.
 */
export function greedCurseFor(state: Readonly<SimState>, playerIndex: number): number {
	const p = state.pacts;
	if (p === undefined || p.room < 0) return -1;
	const unused = unusedCurses(state, playerIndex);
	const k = pactCurseIndex(p.seed, playerIndex, unused.size());
	return k >= 0 ? unused[k] : -1;
}

/** True when the Horde could rouse a room now: an enemy room (planned spawns) of the floor nobody has entered. */
function hordeRoomLeft(state: Readonly<SimState>, config: Readonly<SimConfig>): boolean {
	const world = endlessFloorWorld(state, config);
	const e = state.endless;
	if (world === undefined || e === undefined || state.score === undefined) return false;
	const boss = world.config.encounter?.bossRoom ?? -1;
	for (let id = 0; id < world.roomSpawns.size(); id++) {
		if (id === boss || e.roomsEntered[id] !== 0) continue;
		if (world.roomSpawns[id].size() > 0) return true;
	}
	return false;
}

/** pactAvailability for Greed (it needs no config). */
function greedAvailability(state: Readonly<SimState>, playerIndex: number): PactDimId {
	const p = state.pacts;
	if (p === undefined || p.room < 0) return PactDim.UNABLE;
	const me = p.players[playerIndex];
	if (me === undefined || playerAt(state, playerIndex).dead !== 0 || hasLeft(state, playerIndex))
		return PactDim.UNABLE;
	if (me.greedTaken !== 0) return PactDim.TAKEN;
	if (unusedCurses(state, playerIndex).size() === 0) return PactDim.NO_CURSE;
	if (greedPool(state, playerIndex).size() === 0) return PactDim.NO_LEGENDARY;
	return PactDim.NONE;
}

/** How many players took Greed at this floor's altars (0 without pacts). Pure; the view's "shrine used" cue. */
export function greedTakes(state: Readonly<SimState>): number {
	const p = state.pacts;
	if (p === undefined) return 0;
	let n = 0;
	for (const q of p.players) if (q.greedTaken !== 0) n++;
	return n;
}

/**
 * True when this floor's altars stand and nothing is left at them: the Horde taken or out of rooms (pactAvailability's
 * NO_ROOM: no enemy room left that nobody entered), and no player can take Greed any more (taken, nothing to give, dead
 * or gone). Pure; the view dims the shrine's crystal then.
 */
export function pactsSpent(state: Readonly<SimState>, config: Readonly<SimConfig>): boolean {
	const p = state.pacts;
	if (p === undefined || p.room < 0) return false;
	let horde = false;
	for (const q of p.players) if (q.hordeTaken !== 0) horde = true;
	if (!horde && hordeRoomLeft(state, config)) return false;
	for (let i = 0; i < p.players.size(); i++) if (greedAvailability(state, i) === PactDim.NONE) return false;
	return true;
}

/**
 * Whether pact `kind` (PactKind) at this floor's altar is available to player `playerIndex` (PactDim.NONE) or why not
 * (the altar's grey-out line): UNABLE without altars on this floor, or for a dead / departed player; Greed: TAKEN (this
 * player took it at this shrine), NO_CURSE, NO_LEGENDARY (an empty pool); Horde: TAKEN (anyone took it here), NO_ROOM
 * (no enemy room left that nobody entered; or no scoring). Pure.
 */
export function pactAvailability(
	state: Readonly<SimState>,
	config: Readonly<SimConfig>,
	playerIndex: number,
	kind: number,
): PactDimId {
	const p = state.pacts;
	if (p === undefined || p.room < 0 || kind < 0 || kind >= PACT_KIND_COUNT) return PactDim.UNABLE;
	if (kind === PactKind.GREED) return greedAvailability(state, playerIndex);
	const me = p.players[playerIndex];
	if (me === undefined || playerAt(state, playerIndex).dead !== 0 || hasLeft(state, playerIndex))
		return PactDim.UNABLE;
	for (const q of p.players) if (q.hordeTaken !== 0) return PactDim.TAKEN;
	if (!hordeRoomLeft(state, config)) return PactDim.NO_ROOM;
	return PactDim.NONE;
}

function within(x: number, z: number, cx: number, cz: number, radius: number): boolean {
	const dx = x - cx;
	const dz = z - cz;
	return dx * dx + dz * dz <= radius * radius;
}

/**
 * The altar (PactKind) whose zone (SHRINE_RADIUS around its cell centre) living player `playerIndex` stands in, or -1
 * (none, no altars on this floor, a dead or departed player). Pure; the view's "Press 1" hint and the altar card.
 */
export function pactAltarAt(state: Readonly<SimState>, playerIndex: number): PactKindId | -1 {
	const p = state.pacts;
	if (p === undefined || p.room < 0) return -1;
	const pl = playerAt(state, playerIndex);
	if (pl.dead !== 0 || hasLeft(state, playerIndex)) return -1;
	for (let k = 0; k < p.altarX.size(); k++)
		if (within(pl.x, pl.z, p.altarX[k], p.altarZ[k], SHRINE_RADIUS)) return k as PactKindId;
	return -1;
}

/**
 * True when living player `playerIndex` stands on an altar whose pact is available to them (a SHRINE_BUTTON press there
 * takes it). Pure; the HUD's shrine hint and the touch shrine button.
 */
export function pactAltarOffered(state: Readonly<SimState>, config: Readonly<SimConfig>, playerIndex: number): boolean {
	const kind = pactAltarAt(state, playerIndex);
	return kind >= 0 && pactAvailability(state, config, playerIndex, kind) === PactDim.NONE;
}

/**
 * The kind of player `playerIndex`'s open draft: PactKind.GREED for Greed's Legendary deal (the HUD title), NO_PACT for an
 * ordinary draft or none open. Pure.
 */
export function pactDraftKind(state: Readonly<SimState>, playerIndex: number): number {
	const p = state.pacts;
	const me = runPlayer(state, playerIndex);
	if (p === undefined || me === undefined || me.draftOpen === 0) return NO_PACT;
	return p.players[playerIndex]?.draftKind ?? NO_PACT;
}

/** The Horde on this floor, as the view reads it (hordePhase). Append only. */
export const HordePhase = {
	/** Not taken at this floor's shrine (or no pacts). */
	IDLE: 0,
	/** Taken; waiting for the next enemy room someone enters. */
	ARMED: 1,
	/** The horde room's first wave is fighting. */
	FIGHT: 2,
	/** Wave 2 is telegraphed (its tiles in state.pacts.horde.waveX / waveZ), spawning at waveDueTick. */
	TELEGRAPH: 3,
	/** Wave 2 has spawned; the record clears when every member is down. */
	WAVE: 4,
	/** The horde room cleared (its x2 paid). */
	CLEARED: 5,
} as const;
export type HordePhaseId = (typeof HordePhase)[keyof typeof HordePhase];

/** The Horde's phase on this floor (HordePhase). Pure. */
export function hordePhase(state: Readonly<SimState>): HordePhaseId {
	const p = state.pacts;
	if (p === undefined) return HordePhase.IDLE;
	const h = p.horde;
	if (h.armed !== 0) return HordePhase.ARMED;
	if (h.room < 0) return HordePhase.IDLE;
	if (state.score?.rooms[h.record]?.cleared === 1) return HordePhase.CLEARED;
	if (h.spawned !== HORDE_WAVE_PENDING) return HordePhase.WAVE;
	if (h.waveDueTick !== HORDE_NONE) return HordePhase.TELEGRAPH;
	return HordePhase.FIGHT;
}

// ---------------------------------------------------------------------------------------------
// The altars

function takeGreed(state: SimState, p: PactsState, i: number): void {
	const r = state.run!;
	const me = r.players[i];
	const curse = greedCurseFor(state, i);
	if (me === undefined || curse < 0) return;
	acceptCurse(state, i, curse);
	r.events.curseAccepted = curse + 1;
	me.events.curseAccepted = curse + 1;
	const q = p.players[i];
	q.greedTaken = 1;
	q.draftKind = PactKind.GREED;
	p.taken[PactKind.GREED] += 1;
	// The Legendary deal (main rng: a consequence of the pact taken).
	const bp = buildPlayer(state, i);
	let offers: number[];
	if (bp !== undefined) {
		offers = drawLegendaryOffers(state, bp.levels, bp.duos, p.config.legendaryCards);
	} else {
		const pool = classicLegendaryPool(state, i);
		offers = [];
		while (offers.size() < p.config.legendaryCards && pool.size() > 0)
			offers.push(pool.remove(rngInt(state, 0, pool.size() - 1))!);
	}
	openDealtDraft(state, i, offers);
	p.events.greedPlayer.push(i);
	p.events.greedCurse.push(curse);
	p.events.greedCards.push(offers.size());
}

function takeHorde(p: PactsState, i: number): void {
	p.players[i].hordeTaken = 1;
	p.horde.armed = 1;
	p.taken[PactKind.HORDE] += 1;
	p.events.hordePlayer.push(i);
}

/**
 * The altars' phase of a tick (see the file comment). `inputs[i]` / `prevButtons[i]` as for stepRun (prevButtons from
 * BEFORE this tick's stepPlayer).
 */
export function stepPacts(
	state: SimState,
	inputs: ReadonlyArray<Readonly<InputFrame>>,
	config: Readonly<SimConfig>,
	prevButtons: ReadonlyArray<number>,
): void {
	const p = state.pacts;
	if (p === undefined || state.run === undefined || p.room < 0 || state.events.floorChanged !== 0) return;
	const n = partySize(state);
	for (let i = 0; i < n; i++) {
		const buttons = inputs[i].buttons;
		const press = bit32.band(buttons, SHRINE_BUTTON) !== 0 && bit32.band(prevButtons[i], SHRINE_BUTTON) === 0;
		if (!press) continue;
		const kind = pactAltarAt(state, i);
		if (kind < 0 || pactAvailability(state, config, i, kind) !== PactDim.NONE) continue;
		if (kind === PactKind.GREED) takeGreed(state, p, i);
		else takeHorde(p, i);
	}
}

// ---------------------------------------------------------------------------------------------
// The second wave

/** The record's living first-wave members (entries 0 .. firstWave - 1 present and alive). */
function livingFirstWave(state: Readonly<SimState>, record: number, firstWave: number): number {
	const r = state.score?.rooms[record];
	if (r === undefined) return 0;
	let n = 0;
	const last = math.min(firstWave, r.memberSlots.size());
	for (let k = 0; k < last; k++) {
		const a = state.combat.actors[r.memberSlots[k]];
		if (a !== undefined && a.kind !== NO_KIND && a.id === r.memberIds[k] && a.alive !== 0) n++;
	}
	return n;
}

/** Wave 2's trigger: its kinds and tiles (the room's planned spawns again, capped), the telegraph's due tick. */
function telegraphWave(state: SimState, p: PactsState, config: Readonly<SimConfig>): boolean {
	const h = p.horde;
	const world = endlessFloorWorld(state, config);
	if (world === undefined) return false;
	const planned = world.roomSpawns[h.room] ?? [];
	const cut: ActorSpawn[] = [];
	for (let k = 0; k < planned.size() && k < p.config.hordeMaxWave; k++) cut.push(planned[k]);
	const tiles = world.roomSpawnTiles?.[h.room];
	const placed = tiles !== undefined ? safeRoomSpawns(state, cut, tiles) : cut;
	h.waveKinds.clear();
	h.waveX.clear();
	h.waveZ.clear();
	for (const sp of placed) {
		h.waveKinds.push(archetypeIndex(sp.kind));
		h.waveX.push(sp.x);
		h.waveZ.push(sp.z);
	}
	h.waveDueTick = state.tick + p.config.waveTelegraphTicks;
	p.events.waveTelegraphed = placed.size();
	return true;
}

/** Wave 2 spawns (no affixes) and joins the record. */
function spawnWave(
	state: SimState,
	p: PactsState,
	inputs: ReadonlyArray<Readonly<InputFrame>>,
	config: Readonly<SimConfig>,
): void {
	const h = p.horde;
	const world = endlessFloorWorld(state, config);
	if (world === undefined) return;
	ctx.bind(state, world.config, inputs[0]);
	const spawned: ActorState[] = [];
	let par = p.config.waveTelegraphTicks;
	for (let k = 0; k < h.waveKinds.size(); k++) {
		const a = spawnActor(ctx, h.waveKinds[k], h.waveX[k], h.waveZ[k], 0);
		if (a === undefined) continue;
		spawned.push(a);
		par += ROOM_PAR_TICKS_PER_COST * encounterCost(archetypeAt(h.waveKinds[k]).id);
	}
	const oldPar = state.score?.rooms[h.record]?.parTicks;
	appendScoreRoomMembers(state, h.record, spawned, par);
	// Treasure rooms (docs/TREASURE.md TR3): a SWIFT vault on this record counts down the grown par too.
	if (oldPar !== undefined) vaultParGrown(state, h.record, oldPar);
	h.spawned = spawned.size();
	p.events.waveSpawned = spawned.size() + 1;
}

/** The second wave's phase of a tick (see the file comment). Between stepPellets and stepScore. */
export function stepPactsWave(
	state: SimState,
	inputs: ReadonlyArray<Readonly<InputFrame>>,
	config: Readonly<SimConfig>,
): void {
	const p = state.pacts;
	if (p === undefined || state.score === undefined) return;
	const h = p.horde;
	if (h.room < 0 || h.spawned !== HORDE_WAVE_PENDING) return;
	let anyAlive = false;
	const n = partySize(state);
	for (let i = 0; i < n; i++) if (playerAt(state, i).dead === 0) anyAlive = true;
	if (!anyAlive) return;
	if (h.waveDueTick === HORDE_NONE) {
		if (livingFirstWave(state, h.record, h.firstWave) > math.floor(h.firstWave / 2)) return;
		if (!telegraphWave(state, p, config)) return;
	}
	if (state.tick >= h.waveDueTick) spawnWave(state, p, inputs, config);
}

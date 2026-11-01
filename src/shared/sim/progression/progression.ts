/**
 * In-run progression (M2, GDD "Boons", "Relics", "Curse shrines"; a Roblox-port feature, no web source): the boon
 * draft after every endless floor, relic pedestals in TREASURE rooms, the curse shrine in the SHRINE room.
 *
 * Opt-in like endless mode itself: only a SimConfig with `endless` creates `SimState.run` (createSimState), and only
 * then do these phases run and the hash grow the "run" group (after "score"). Without it nothing here runs and every
 * accessor in runMods.ts is neutral, so every golden fixture replays exactly as before.
 *
 * Tick order (step.ts):
 *   - a draft is open (any player): clearEvents, clearScoreEvents, clearRunEvents, then ONLY stepDraft: the world is
 *     frozen (no stepPlayer / stepCombat / stepEndless / stepScore: no actor acts, no bullet moves, no timer runs, the
 *     player cannot be hurt); tick += 1
 *   - else, after stepEndless and before stepScore: stepRun
 *
 * stepRun order (every per-player loop in player index order; a solo run has one player, SOLO_PLAYER):
 *   1. the floor changed this tick (events.floorChanged): the new floor's pedestals / shrine, Second Wind re-armed
 *      for everyone, then a draft opens for the floor just cleared for EVERY player who has not left (openDraft, the
 *      offers drawn from the sim rng in player index order). Stop.
 *   2. nobody alive: stop (a dead player collects nothing)
 *   3. a room's enemies spawned this tick (events.roomEntered, a room with deferred spawns): Warding refills the armor
 *      of every living player who owns it
 *   4. pedestals, in room id order: the first living player (index order) whose centre is within PEDESTAL_RADIUS of
 *      an untaken one and who has a relic left to get collects one drawn from THEIR unowned set (one rngInt draw);
 *      with nobody able to take it the pedestal stays (inert)
 *   5. the shrine: unused, the first living player (index order) whose centre is within SHRINE_RADIUS of it with a
 *      SHRINE_BUTTON (SKILL1) press edge and a curse left: a curse drawn from THEIR unused set (one rngInt draw),
 *      applied to them, plus addCurse (the team score x +0.25); the shrine is then used for everyone
 *
 * The draft (stepDraft, every frozen tick; per player, index order, each with their own input): draftTicks += 1; the
 * stick picks the card (draftColumn: the move vector's screen-horizontal component, left / centre / right beyond a
 * dead zone); a DRAFT_CONFIRM_BUTTON (FIRE) press edge once draftTicks >= DRAFT_MIN_OPEN_TICKS takes the selected
 * boon (grantBoon) and closes that player's draft. The world stays frozen until EVERY open draft is closed (co-op: a
 * player who leaves mid-draft has theirs closed without a pick). Every player's and their weapons' prevButtons
 * follow their input during the draft, so a button pressed in the draft (the confirm included) never fires its action
 * on the first tick after it.
 *
 * Offers (drawBoonOffers): with DRAFT_OFFER_COUNT or fewer unowned boons left, all of them (Boon order, no rng);
 * else per card one rngInt(0, 99) rarity roll (rarityPercents of the floor just cleared) and one rngInt pick among
 * the unowned, not yet offered boons of that rarity; a rarity with none left falls back to every remaining boon.
 * Only the classic boons (CLASSIC_BOON_COUNT): the on-kill boons appended after them are builds-only.
 *
 * Builds (docs/BUILDS.md BU2, only with SimConfig.builds: endless worlds): the offers are draft CARDS (sim/builds
 * cards.ts drawCardOffers: new boons, upgrades / evolutions of owned ones, duos; card ids in draftOffers), a confirm
 * takes the card through grantCard (levels, duos), and the draft after a boss floor is dealt twice (BUD4: the first
 * deal guarantees a duo when one is available; a confirm with draftsLeft > 1 re-deals for that player instead of
 * closing, with one more drawCardOffers, the draft timer back at 0).
 */
import { jsMax, jsMin } from "shared/jsmath";
import { isBossFloor } from "shared/dungeon";
import { rngInt, type RngHolder } from "../rng";
import type { InputFrame } from "../input";
import type { SimState } from "../state";
import type { SimConfig } from "../step";
import type { EncounterConfig } from "../combat/actors/encounter";
import { endlessFloorWorld } from "../endless";
import { addCurse } from "../score/score";
import { hasLeft, partySize, playerAt, weaponsAt } from "../party";
import { buildPlayer } from "../builds/builds";
import { drawPlayerCardOffers, grantCard } from "../builds/cards";
import { rarityForRoll } from "./rarity";
import {
	ARMOR_BOON_PIPS,
	BOONS,
	Boon,
	CLASSIC_BOON_COUNT,
	CURSE_COUNT,
	CURSE_FLASK_LOSS,
	CURSE_HEART_LOSS,
	CURSE_MIN_FLASK_MAX,
	CURSE_MIN_HEARTS_MAX,
	Curse,
	DRAFT_COLUMN_CENTRE,
	DRAFT_COLUMN_LEFT,
	DRAFT_COLUMN_RIGHT,
	DRAFT_CONFIRM_BUTTON,
	DRAFT_MIN_OPEN_TICKS,
	DRAFT_OFFER_COUNT,
	DRAFT_SCREEN_RIGHT_X,
	DRAFT_SCREEN_RIGHT_Z,
	DRAFT_SELECT_DEAD_ZONE_AXIS,
	FLASK_BOON_CHARGES,
	HEART_BOON_HALF_HEARTS,
	NO_SELECTION,
	PEDESTAL_RADIUS,
	RARITY_ROLL_RANGE,
	RELIC_COUNT,
	SHRINE_BUTTON,
	SHRINE_RADIUS,
} from "./progressionData";
import {
	NEUTRAL_RUN_MODS,
	refreshRunMods,
	runPlayer,
	type RunEvents,
	type RunPlayerEvents,
	type RunPlayerState,
	type RunState,
} from "./runMods";

// ---------------------------------------------------------------------------------------------
// Creation

function newPlayer(): RunPlayerState {
	return {
		boons: [],
		relics: [],
		curses: [],
		draftOpen: 0,
		draftTicks: 0,
		draftSelected: NO_SELECTION,
		draftOffers: [],
		hourglassTicks: 0,
		fangKills: 0,
		secondWindUsed: 0,
		mods: NEUTRAL_RUN_MODS,
		events: emptyPlayerEvents(),
	};
}

function emptyPlayerEvents(): RunPlayerEvents {
	return { draftChosen: 0, relicCollected: 0, curseAccepted: 0, secondWind: 0, fangHealed: 0 };
}

function emptyRunEvents(): RunEvents {
	return { draftOpened: 0, draftChosen: 0, relicCollected: 0, curseAccepted: 0, secondWind: 0, fangHealed: 0 };
}

/** Pedestals (TREASURE rooms, id order) and the shrine (the first SHRINE room) of a floor's encounter. Pure. */
function placeFloor(r: RunState, encounter: EncounterConfig | undefined): void {
	r.pedestalRooms = [];
	r.pedestalTaken = [];
	r.shrineRoom = -1;
	r.shrineUsed = 0;
	if (encounter === undefined) return;
	for (const room of encounter.rooms) {
		if (room.type === "treasure") {
			r.pedestalRooms.push(room.id);
			r.pedestalTaken.push(0);
		} else if (room.type === "shrine" && r.shrineRoom < 0) {
			r.shrineRoom = room.id;
		}
	}
}

/** Run progression at run start (`players`: the party size, 1 solo), on the first floor's encounter. Draws no rng. */
export function createRunState(encounter: EncounterConfig | undefined, players = 1): RunState {
	const r: RunState = {
		players: [],
		pedestalRooms: [],
		pedestalTaken: [],
		shrineRoom: -1,
		shrineUsed: 0,
		events: emptyRunEvents(),
	};
	for (let i = 0; i < players; i++) r.players.push(newPlayer());
	placeFloor(r, encounter);
	return r;
}

export function cloneRunState(r: Readonly<RunState>): RunState {
	return {
		...r,
		players: r.players.map((p) => ({
			...p,
			boons: [...p.boons],
			relics: [...p.relics],
			curses: [...p.curses],
			draftOffers: [...p.draftOffers],
			events: { ...p.events },
		})),
		pedestalRooms: [...r.pedestalRooms],
		pedestalTaken: [...r.pedestalTaken],
		events: { ...r.events },
	};
}

/** Start of every tick (step.ts, after clearEvents). */
export function clearRunEvents(r: RunState): void {
	const e = r.events;
	e.draftOpened = 0;
	e.draftChosen = 0;
	e.relicCollected = 0;
	e.curseAccepted = 0;
	e.secondWind = 0;
	e.fangHealed = 0;
	for (const p of r.players) {
		const pe = p.events;
		pe.draftChosen = 0;
		pe.relicCollected = 0;
		pe.curseAccepted = 0;
		pe.secondWind = 0;
		pe.fangHealed = 0;
	}
}

// ---------------------------------------------------------------------------------------------
// Offers

export { rarityForRoll, rarityPercents } from "./rarity";

/**
 * The boons a draft after `floorCleared` offers a player owning `owned` (see the file comment), without builds: only
 * the classic boons (CLASSIC_BOON_COUNT; the on-kill boons are builds-only, docs/BUILDS.md), so it draws exactly as
 * before they were appended.
 */
export function drawBoonOffers(rng: RngHolder, owned: ReadonlyArray<number>, floorCleared: number): number[] {
	const left: number[] = [];
	for (let b = 0; b < CLASSIC_BOON_COUNT; b++) if (!owned.includes(b)) left.push(b);
	if (left.size() <= DRAFT_OFFER_COUNT) return left;
	const out: number[] = [];
	while (out.size() < DRAFT_OFFER_COUNT) {
		const rarity = rarityForRoll(rngInt(rng, 0, RARITY_ROLL_RANGE - 1), floorCleared);
		let pool = left.filter((b) => BOONS[b].rarity === rarity);
		if (pool.size() === 0) pool = left;
		const pick = pool[rngInt(rng, 0, pool.size() - 1)];
		out.push(pick);
		left.remove(left.indexOf(pick));
	}
	return out;
}

/**
 * Opens player `playerIndex`'s draft after `floorCleared`; false (no draft) when nothing is left to offer. With builds
 * (docs/BUILDS.md BU2) the offers are cards (drawCardOffers) and `deals` drafts are dealt one after the other (a boss
 * floor's double draft: 2, its first deal with a guaranteed duo); without builds, drawBoonOffers and one deal.
 */
export function openDraft(state: SimState, playerIndex: number, floorCleared: number, deals = 1): boolean {
	const p = runPlayer(state, playerIndex);
	if (p === undefined) return false;
	const bp = buildPlayer(state, playerIndex);
	const offers =
		bp !== undefined
			? drawPlayerCardOffers(state, playerIndex, floorCleared, deals > 1)
			: drawBoonOffers(state, p.boons, floorCleared);
	if (bp !== undefined) bp.draftsLeft = offers.size() > 0 ? deals : 0;
	if (offers.size() === 0) return false;
	dealOffers(state, p, offers);
	return true;
}

/** Puts `offers` on the table for `p` (a fresh draft or a builds re-deal): open, timer 0, the centre card selected. */
function dealOffers(state: SimState, p: RunPlayerState, offers: number[]): void {
	p.draftOpen = 1;
	p.draftTicks = 0;
	p.draftOffers = offers;
	p.draftSelected = draftCardFor(DRAFT_COLUMN_CENTRE, offers.size());
	state.run!.events.draftOpened = offers.size();
}

/**
 * Builds: after a pick, the next deal of a multi-deal draft (draftsLeft > 1: the boss double draft), on the floor just
 * cleared (the current floor - 1), no guaranteed duo. False (the draft closes) when no deal is left or nothing is left
 * to offer.
 */
function redeal(state: SimState, playerIndex: number, p: RunPlayerState): boolean {
	const bp = buildPlayer(state, playerIndex);
	if (bp === undefined || bp.draftsLeft <= 1) return false;
	bp.draftsLeft -= 1;
	const floorCleared = (state.endless?.floor ?? 1) - 1;
	const offers = drawPlayerCardOffers(state, playerIndex, floorCleared, false);
	if (offers.size() === 0) return false;
	dealOffers(state, p, offers);
	return true;
}

// ---------------------------------------------------------------------------------------------
// The draft

/**
 * The card column the input's move stick points at: its screen-horizontal component (DRAFT_SCREEN_RIGHT_*) beyond
 * the dead zone is right / left, else centre. Pure; the HUD calls it on the live input too.
 */
export function draftColumn(input: Readonly<InputFrame>): number {
	const right = input.moveX * DRAFT_SCREEN_RIGHT_X + input.moveZ * DRAFT_SCREEN_RIGHT_Z;
	if (right > DRAFT_SELECT_DEAD_ZONE_AXIS) return DRAFT_COLUMN_RIGHT;
	if (right < -DRAFT_SELECT_DEAD_ZONE_AXIS) return DRAFT_COLUMN_LEFT;
	return DRAFT_COLUMN_CENTRE;
}

/**
 * The offer index in `column` for `count` cards: three cards fill left / centre / right; two sit left and right
 * (centre selects none); one card is selected from any column.
 */
export function draftCardFor(column: number, count: number): number {
	if (count >= DRAFT_OFFER_COUNT) return column;
	if (count === 1) return 0;
	if (count === 2) return column === DRAFT_COLUMN_LEFT ? 0 : column === DRAFT_COLUMN_RIGHT ? 1 : NO_SELECTION;
	return NO_SELECTION;
}

/** Closes player `p`'s draft (no pick: a confirm calls grantBoon after it; a player who left gets nothing). */
export function closeDraft(p: RunPlayerState): void {
	p.draftOpen = 0;
	p.draftTicks = 0;
	p.draftOffers = [];
	p.draftSelected = NO_SELECTION;
}

/**
 * A frozen draft tick (see the file comment). `inputs[i]` is player i's frame (a solo run: one). Players who left
 * (co-op) have their open draft closed without a pick.
 */
export function stepDraft(state: SimState, inputs: ReadonlyArray<Readonly<InputFrame>>): void {
	const r = state.run;
	if (r === undefined) return;
	const n = partySize(state);
	for (let i = 0; i < n; i++) {
		const input = inputs[i];
		const pl = playerAt(state, i);
		const p = r.players[i];
		if (p !== undefined && p.draftOpen !== 0) {
			if (hasLeft(state, i)) {
				closeDraft(p);
				const bp = buildPlayer(state, i);
				if (bp !== undefined) bp.draftsLeft = 0;
			} else {
				p.draftTicks += 1;
				p.draftSelected = draftCardFor(draftColumn(input), p.draftOffers.size());
				const confirm =
					bit32.band(input.buttons, DRAFT_CONFIRM_BUTTON) !== 0 &&
					bit32.band(pl.prevButtons, DRAFT_CONFIRM_BUTTON) === 0;
				if (confirm && p.draftTicks >= DRAFT_MIN_OPEN_TICKS && p.draftSelected !== NO_SELECTION) {
					const card = p.draftOffers[p.draftSelected];
					const bp = buildPlayer(state, i);
					if (bp !== undefined) {
						// Builds: the card (a level, an evolution or a duo); a boss double draft re-deals.
						grantCard(state, i, card);
						if (!redeal(state, i, p)) {
							closeDraft(p);
							bp.draftsLeft = 0;
						}
					} else {
						closeDraft(p);
						grantBoon(state, i, card);
					}
					r.events.draftChosen = card + 1;
					p.events.draftChosen = card + 1;
				}
			}
		}
		pl.prevX = pl.x;
		pl.prevZ = pl.z;
		pl.prevButtons = input.buttons;
		weaponsAt(state, i).prevButtons = input.buttons;
	}
}

// ---------------------------------------------------------------------------------------------
// Granting (the player-state side applies to that player's PlayerState, playerAt(state, i))

/** Player `playerIndex` takes `boon` (no-op if owned): one-off effects (hearts, flask, armor), then the mods. */
export function grantBoon(state: SimState, playerIndex: number, boon: number): void {
	const p = runPlayer(state, playerIndex);
	if (p === undefined || p.boons.includes(boon) || BOONS[boon] === undefined) return;
	// Builds (docs/BUILDS.md): level I through grantCard, so the levels and the boons list stay in step.
	if (buildPlayer(state, playerIndex) !== undefined) {
		grantCard(state, playerIndex, boon);
		return;
	}
	p.boons.push(boon);
	const pl = playerAt(state, playerIndex);
	if (boon === Boon.HEARTY) {
		pl.heartsMax += HEART_BOON_HALF_HEARTS;
		if (pl.dead === 0) pl.hearts = jsMin(pl.heartsMax, pl.hearts + HEART_BOON_HALF_HEARTS);
	} else if (boon === Boon.DEEP_FLASK) {
		pl.flaskMax += FLASK_BOON_CHARGES;
		pl.flask += FLASK_BOON_CHARGES;
	} else if (boon === Boon.WARDING) {
		pl.armorMax += ARMOR_BOON_PIPS;
		pl.armor += ARMOR_BOON_PIPS;
	}
	refreshRunMods(p, buildPlayer(state, playerIndex));
}

/** Player `playerIndex` gets `relic` (no-op if owned). Relics have no one-off effect. */
export function grantRelic(state: SimState, playerIndex: number, relic: number): void {
	const p = runPlayer(state, playerIndex);
	if (p === undefined || p.relics.includes(relic) || relic < 0 || relic >= RELIC_COUNT) return;
	p.relics.push(relic);
	refreshRunMods(p, buildPlayer(state, playerIndex));
}

/** Player `playerIndex` takes `curse` (no-op if taken): one-off effects (hearts, flask), the score's +0.25, the mods. */
export function acceptCurse(state: SimState, playerIndex: number, curse: number): void {
	const p = runPlayer(state, playerIndex);
	if (p === undefined || p.curses.includes(curse) || curse < 0 || curse >= CURSE_COUNT) return;
	p.curses.push(curse);
	const pl = playerAt(state, playerIndex);
	if (curse === Curse.FRAILTY) {
		pl.heartsMax = jsMax(CURSE_MIN_HEARTS_MAX, pl.heartsMax - CURSE_HEART_LOSS);
		pl.hearts = jsMin(pl.hearts, pl.heartsMax);
	} else if (curse === Curse.THIRST) {
		pl.flaskMax = jsMax(CURSE_MIN_FLASK_MAX, pl.flaskMax - CURSE_FLASK_LOSS);
		pl.flask = jsMin(pl.flask, pl.flaskMax);
	}
	addCurse(state);
	refreshRunMods(p, buildPlayer(state, playerIndex));
}

function unowned(owned: ReadonlyArray<number>, count: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < count; i++) if (!owned.includes(i)) out.push(i);
	return out;
}

// ---------------------------------------------------------------------------------------------
// The run phase of a tick

function within(x: number, z: number, cx: number, cz: number, radius: number): boolean {
	const dx = x - cx;
	const dz = z - cz;
	return dx * dx + dz * dz <= radius * radius;
}

/**
 * The run phase of an unfrozen tick (order at the top of this file). `inputs[i]` is player i's frame this tick and
 * `prevButtons[i]` that player's prevButtons from BEFORE this tick's stepPlayer (the shrine's press edge); a solo run
 * passes one of each.
 */
export function stepRun(
	state: SimState,
	inputs: ReadonlyArray<Readonly<InputFrame>>,
	config: Readonly<SimConfig>,
	prevButtons: ReadonlyArray<number>,
): void {
	const r = state.run;
	if (r === undefined) return;
	const world = endlessFloorWorld(state, config);
	const encounter = world?.config.encounter;
	const ev = state.events;
	const n = partySize(state);

	// 1. A new floor: its pedestals and shrine, Second Wind re-armed, then every present player's draft.
	if (ev.floorChanged !== 0) {
		placeFloor(r, encounter);
		for (const p of r.players) p.secondWindUsed = 0;
		const floorCleared = ev.floorChanged - 1;
		const builds = state.builds;
		// Builds: a boss floor's draft is dealt twice (docs/BUILDS.md BUD4); without builds, one draft as always.
		const deals =
			builds === undefined
				? 1
				: isBossFloor(floorCleared)
				? builds.config.bossFloorDrafts
				: builds.config.floorDrafts;
		for (let i = 0; i < n; i++) if (!hasLeft(state, i)) openDraft(state, i, floorCleared, deals);
		return;
	}

	// 2. The dead collect nothing.
	let anyAlive = false;
	for (let i = 0; i < n; i++) if (playerAt(state, i).dead === 0) anyAlive = true;
	if (!anyAlive) return;

	// 3. Warding: a room's enemies spawned.
	if (ev.roomEntered !== 0 && world !== undefined) {
		const spawns = world.roomSpawns[ev.roomEntered - 1];
		if (spawns !== undefined && spawns.size() > 0) {
			for (let i = 0; i < n; i++) {
				const pl = playerAt(state, i);
				const me = r.players[i];
				if (pl.dead === 0 && me !== undefined && me.mods.armorOnRoomSpawn) pl.armor = pl.armorMax;
			}
		}
	}
	if (encounter === undefined) return;

	// 4. Pedestals: the first living player on it (index order) with a relic left to get.
	for (let k = 0; k < r.pedestalRooms.size(); k++) {
		if (r.pedestalTaken[k] !== 0) continue;
		const room = encounter.rooms[r.pedestalRooms[k]];
		if (room === undefined) continue;
		for (let i = 0; i < n; i++) {
			const pl = playerAt(state, i);
			const me = r.players[i];
			if (pl.dead !== 0 || me === undefined || !within(pl.x, pl.z, room.cx, room.cz, PEDESTAL_RADIUS)) continue;
			const left = unowned(me.relics, RELIC_COUNT);
			if (left.size() === 0) continue;
			const relic = left[rngInt(state, 0, left.size() - 1)];
			r.pedestalTaken[k] = 1;
			grantRelic(state, i, relic);
			r.events.relicCollected = relic + 1;
			me.events.relicCollected = relic + 1;
			break;
		}
	}

	// 5. The shrine: the first living player in its zone (index order) pressing SHRINE_BUTTON with a curse left.
	if (r.shrineRoom >= 0 && r.shrineUsed === 0) {
		const room = encounter.rooms[r.shrineRoom];
		for (let i = 0; i < n && room !== undefined; i++) {
			const pl = playerAt(state, i);
			const me = r.players[i];
			if (pl.dead !== 0 || me === undefined) continue;
			const buttons = inputs[i].buttons;
			const press = bit32.band(buttons, SHRINE_BUTTON) !== 0 && bit32.band(prevButtons[i], SHRINE_BUTTON) === 0;
			if (!press || !within(pl.x, pl.z, room.cx, room.cz, SHRINE_RADIUS)) continue;
			const left = unowned(me.curses, CURSE_COUNT);
			if (left.size() === 0) continue;
			const curse = left[rngInt(state, 0, left.size() - 1)];
			r.shrineUsed = 1;
			acceptCurse(state, i, curse);
			r.events.curseAccepted = curse + 1;
			me.events.curseAccepted = curse + 1;
			break;
		}
	}
}

/** True when the player stands in the current floor's unused shrine zone with a curse left to take (HUD hint). */
export function atShrine(state: Readonly<SimState>, config: Readonly<SimConfig>, playerIndex: number): boolean {
	const r = state.run;
	const p = runPlayer(state, playerIndex);
	if (r === undefined || p === undefined || r.shrineRoom < 0 || r.shrineUsed !== 0) return false;
	if (p.curses.size() >= CURSE_COUNT) return false;
	const room = endlessFloorWorld(state, config)?.config.encounter?.rooms[r.shrineRoom];
	const pl = playerAt(state, playerIndex);
	return room !== undefined && within(pl.x, pl.z, room.cx, room.cz, SHRINE_RADIUS);
}

// ---------------------------------------------------------------------------------------------
// Hash: the "run" group, appended after "score" only when state.run exists

/** Scalar RunPlayerState fields after the three lists and the offers, in hash order. Append only. */
const RUN_PLAYER_SCALARS = [
	"draftOpen",
	"draftTicks",
	"draftSelected",
	"hourglassTicks",
	"fangKills",
	"secondWindUsed",
] as const;

function pushList(out: number[], list: ReadonlyArray<number>): void {
	out.push(list.size());
	for (const v of list) out.push(v);
}

function pushListNames(out: string[], prefix: string, list: ReadonlyArray<number>): void {
	out.push(`${prefix}.length`);
	for (let i = 0; i < list.size(); i++) out.push(`${prefix}[${i}]`);
}

/**
 * players.length; per player: boons, relics, curses, draftOffers (each length + values), RUN_PLAYER_SCALARS;
 * then pedestals.length, (room, taken) per pedestal, shrineRoom, shrineUsed.
 */
export function writeRunHash(r: Readonly<RunState>, out: number[]): void {
	out.push(r.players.size());
	for (const p of r.players) {
		pushList(out, p.boons);
		pushList(out, p.relics);
		pushList(out, p.curses);
		pushList(out, p.draftOffers);
		for (const f of RUN_PLAYER_SCALARS) out.push(p[f]);
	}
	out.push(r.pedestalRooms.size());
	for (let k = 0; k < r.pedestalRooms.size(); k++) out.push(r.pedestalRooms[k], r.pedestalTaken[k]);
	out.push(r.shrineRoom, r.shrineUsed);
}

/** Dump names for writeRunHash, same order (`run.players[0].boons[1]`, `run.pedestals[0].taken`, ...). */
export function runHashNames(r: Readonly<RunState>, out: string[]): void {
	out.push("run.players.length");
	for (let i = 0; i < r.players.size(); i++) {
		const p = r.players[i];
		const prefix = `run.players[${i}]`;
		pushListNames(out, `${prefix}.boons`, p.boons);
		pushListNames(out, `${prefix}.relics`, p.relics);
		pushListNames(out, `${prefix}.curses`, p.curses);
		pushListNames(out, `${prefix}.draftOffers`, p.draftOffers);
		for (const f of RUN_PLAYER_SCALARS) out.push(`${prefix}.${f}`);
	}
	out.push("run.pedestals.length");
	for (let k = 0; k < r.pedestalRooms.size(); k++) out.push(`run.pedestals[${k}].room`, `run.pedestals[${k}].taken`);
	out.push("run.shrineRoom", "run.shrineUsed");
}

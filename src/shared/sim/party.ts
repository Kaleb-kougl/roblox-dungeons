/**
 * Co-op parties in the sim (M4 "Co-op lockstep", 2-8 players; a Roblox-port feature, no web source). Opt-in: only a
 * SimConfig with `party.size > 1` creates `SimState.party`, and only then does the hash grow the appended "party"
 * group. A solo run (no `party`, or size 1) has no party state and every solo hash, score and fixture is unchanged.
 *
 * Players are numbered 0 .. size-1 and EVERY per-player loop runs in that index order (ties go to the lower index).
 * Player 0 is `state.player` with `state.combat.weapons`, exactly as in a solo run (hashed in "core" / "weapons");
 * `party.players[0]` / `party.weapons[0]` ALIAS them (same tables), and players 1 .. size-1 live only here (hashed in
 * "party"). Read players through `playerAt` / `weaponsAt` / `partySize`, never by indexing `party` with a raw 0.
 *
 * Each player: its own PlayerState (movement, hearts, armor, i-frames, flask, Embers, death) and WeaponsState (two
 * sets, cooldowns, scratch, last swing), whose `emitterId` (player i: i + 1) is the emitter id stamped on every player
 * bullet it fires, so a bullet's owner is `emitter - 1` (`playerBulletOwner`); the pool keeps the emitter per slot,
 * so ownership survives swap-remove and is hashed with the bullet.
 *
 * Rules (step.ts stepParty, combat.ts, actors.ts, endless.ts, score.ts):
 *   targeting   enemies target the NEAREST LIVING player by squared distance, ties to the lower index; with nobody
 *               alive, player 0 (nearestLivingPlayer; SimCtx.targetNearest binds it before every actor hook)
 *   hits        enemy bullets and contact damage hit any player (index order; one bullet hurts one player)
 *   death       a dead player stays dead (spectating) for the rest of the floor; at the floor change every dead
 *               player who has not left comes back at the entrance with PARTY_REVIVE_HALF_HEARTS; armor / flask /
 *               Embers refill for everyone. The run is over when every player is dead at once (isPartyWiped).
 *   leaving     PARTY_LEFT_BUTTON in a player's frame (the server's merged log): `left` = 1, killed, never revived
 *   stairwell   the floor ends when every LIVING player stands in the stairwell zone, or on any present player's
 *               debug floor skip
 *
 * @module
 */
import type { PlayerState, SimState } from "./state";
import { PLAYER_HASH_FIELDS, killPlayerState, newPlayerState, writePlayerStateHash } from "./player";
import { cloneWeaponsState, createWeaponsState, weaponsHashNames, writeWeaponsHash } from "./combat/weapons/weapons";
import type { WeaponsState } from "./combat/weapons/types";
import { DEFAULT_LOADOUT } from "./combat/weapons/loadout";
import { MAX_PARTY_SIZE, PARTY_LEFT_BUTTON, SOLO_PARTY_SIZE, isValidPartySize } from "./partyData";
import { boostsOnPlayerDied } from "./drops/boostMods";
import type { PlayerTraits } from "./playerData";

/** SimConfig.party. */
export interface PartyConfig {
	/** Players, 1 .. MAX_PARTY_SIZE. 1 is a solo run (no party state). */
	readonly size: number;
	/**
	 * Per player index: that player's loadout (weapon id per set). Missing entries: the run's loadout (SimConfig.loadout
	 * of the run config, else of the first world, else DEFAULT_LOADOUT). Index 0 overrides player 0's too.
	 */
	readonly loadouts?: ReadonlyArray<ReadonlyArray<string | undefined> | undefined>;
	/**
	 * Per player index: that player's roll traits (docs/ARCHER.md AR3; player.ts playerTraits). Missing entries:
	 * SimConfig.traits, else NEUTRAL_TRAITS. Index 0 overrides player 0's too. Config, not hashed.
	 */
	readonly traits?: ReadonlyArray<PlayerTraits | undefined>;
}

/** SimState.party (only for size > 1). Plain numbers; hashed in the "party" group (writePartyHash). */
export interface PartyState {
	/** Players in the run (2 .. MAX_PARTY_SIZE); fixed for the run (no drop-in). */
	size: number;
	/** Every player's state by index; [0] IS state.player. */
	players: PlayerState[];
	/** Every player's weapon sets by index; [0] IS state.combat.weapons. */
	weapons: WeaponsState[];
	/** Per player index: 1 once the player left the run (never revived). */
	left: number[];
}

/** The party size a config asks for (1 without `party`). Throws on an invalid size. */
export function configPartySize(party: PartyConfig | undefined): number {
	if (party === undefined) return SOLO_PARTY_SIZE;
	if (!isValidPartySize(party.size)) {
		error(`party: size must be an integer in [1, ${MAX_PARTY_SIZE}], got ${tostring(party.size)}`, 0);
	}
	return party.size;
}

/**
 * Party state for a new run (createSimState, after combat state exists): players 1 .. size-1 at the spawn, each with
 * its loadout and the next emitter id of the player bullet simulation (player i: i + 1). Undefined for a solo run.
 */
export function createPartyState(
	state: SimState,
	party: PartyConfig | undefined,
	runLoadout: ReadonlyArray<string | undefined> | undefined,
	spawnX: number,
	spawnZ: number,
): PartyState | undefined {
	const n = configPartySize(party);
	if (n === SOLO_PARTY_SIZE) return undefined;
	const loadouts = party?.loadouts;
	const c = state.combat;
	const first = loadouts?.[0];
	if (first !== undefined) c.weapons = createWeaponsState(first, c.weapons.emitterId);
	const players = [state.player];
	const weapons = [c.weapons];
	const left = [0];
	for (let i = 1; i < n; i++) {
		players.push(newPlayerState(spawnX, spawnZ));
		const emitterId = c.playerBullets.acquireEmitter();
		weapons.push(createWeaponsState(loadouts?.[i] ?? runLoadout ?? DEFAULT_LOADOUT, emitterId));
		left.push(0);
	}
	return { size: n, players, weapons, left };
}

/**
 * Copy of party state for cloneSimState: `player` / `weapons` are the clone's player 0 (aliased again); acquires the
 * party's emitter ids on the clone's (pristine) player bullet simulation, as createPartyState did.
 */
export function cloneParty(s: Readonly<PartyState>, clone: SimState): PartyState {
	const players = [clone.player];
	const weapons = [clone.combat.weapons];
	for (let i = 1; i < s.size; i++) {
		players.push({ ...s.players[i] });
		weapons.push(cloneWeaponsState(s.weapons[i]));
		clone.combat.playerBullets.acquireEmitter();
	}
	return { size: s.size, players, weapons, left: [...s.left] };
}

// ---------------------------------------------------------------------------------------------
// Accessors (the single way any module reads a player by index)

/** Players in the run: party.size, 1 for a solo run. */
export function partySize(state: Readonly<SimState>): number {
	return state.party !== undefined ? state.party.size : SOLO_PARTY_SIZE;
}

/** Player `i`'s state (0 = state.player). */
export function playerAt(state: Readonly<SimState>, i: number): PlayerState {
	if (i === 0) return state.player;
	const p = state.party?.players[i];
	if (p === undefined) error(`party: no player ${i}`, 0);
	return p;
}

/** Player `i`'s weapon sets (0 = state.combat.weapons). */
export function weaponsAt(state: Readonly<SimState>, i: number): WeaponsState {
	if (i === 0) return state.combat.weapons;
	const w = state.party?.weapons[i];
	if (w === undefined) error(`party: no weapons for player ${i}`, 0);
	return w;
}

/** 1 when player `i` left the run (always 0 in a solo run). */
export function hasLeft(state: Readonly<SimState>, i: number): boolean {
	const party = state.party;
	return party !== undefined && party.left[i] !== 0;
}

/**
 * Players who have not left the run (dead ones included); undefined outside a party state (the caller keeps its own
 * notion of the party size there). The score's combo hit cut divides by this at the tick of the hit.
 */
export function presentPlayerCount(state: Readonly<SimState>): number | undefined {
	const party = state.party;
	if (party === undefined) return undefined;
	let n = 0;
	for (const v of party.left) if (v === 0) n++;
	return n;
}

/** Players alive right now. */
export function livingPlayerCount(state: Readonly<SimState>): number {
	const n = partySize(state);
	let alive = 0;
	for (let i = 0; i < n; i++) if (playerAt(state, i).dead === 0) alive++;
	return alive;
}

/** Every player is dead (solo: the player is dead): the run is over. */
export function isPartyWiped(state: Readonly<SimState>): boolean {
	return livingPlayerCount(state) === 0;
}

/**
 * The nearest LIVING player to (x, z) by squared distance, ties to the lower index; 0 when nobody is alive (and
 * always 0 in a solo run, alive or not, which is what every solo hook read before parties existed).
 */
export function nearestLivingPlayer(state: Readonly<SimState>, x: number, z: number): number {
	const n = partySize(state);
	if (n === SOLO_PARTY_SIZE) return 0;
	let best = -1;
	let bestD2 = 0;
	for (let i = 0; i < n; i++) {
		const p = playerAt(state, i);
		if (p.dead !== 0) continue;
		const dx = p.x - x;
		const dz = p.z - z;
		const d2 = dx * dx + dz * dz;
		if (best < 0 || d2 < bestD2) {
			best = i;
			bestD2 = d2;
		}
	}
	return best < 0 ? 0 : best;
}

/** The player index owning a player bullet with emitter id `emitter` (player i fires with emitter i + 1). */
export function playerBulletOwner(emitter: number): number {
	return emitter - 1;
}

/** True when `buttons` carries the server's "player left" bit. */
export function hasLeftBit(buttons: number): boolean {
	return bit32.band(buttons, PARTY_LEFT_BUTTON) !== 0;
}

/**
 * A player who left (PARTY_LEFT_BUTTON): marked `left` and killed (no events: leaving is not a death on screen).
 * Idempotent. Called by stepParty before the players step.
 */
export function markPlayerLeft(state: SimState, i: number): void {
	const party = state.party;
	if (party === undefined || party.left[i] !== 0) return;
	party.left[i] = 1;
	killPlayerState(playerAt(state, i));
	boostsOnPlayerDied(state, i); // boost drops (docs/BOOSTS.md): the leaver's boosts end
}

/**
 * A dead party member comes back (the floor change, endless.ts): alive with `halfHearts` (at most heartsMax), roll /
 * i-frames / invulnerability / drinking cleared. Position and refills are the caller's.
 */
export function revivePartyMember(p: PlayerState, halfHearts: number): void {
	p.dead = 0;
	p.hearts = halfHearts < p.heartsMax ? halfHearts : p.heartsMax;
	p.rollTicks = 0;
	p.rollDirX = 0;
	p.rollDirZ = 0;
	p.iframeTicks = 0;
	p.hurtTicks = 0;
	p.flaskTicks = 0;
}

// ---------------------------------------------------------------------------------------------
// Hash: the "party" group, appended after score and run (only "tutorial" follows it) only when state.party exists.
//   size, left[0 .. size-1], then per player 1 .. size-1: PLAYER_HASH_FIELDS, then writeWeaponsHash

/**
 * Appends the `party` hash group to `out`: the size, the `left` flag of every player, then for players 1 .. size-1 the
 * player fields and the weapons. Player 0 is skipped: it is hashed in `core` / `weapons`. Called only when
 * `state.party` exists.
 */
export function writePartyHash(party: Readonly<PartyState>, out: number[]): void {
	out.push(party.size);
	for (const v of party.left) out.push(v);
	for (let i = 1; i < party.size; i++) {
		writePlayerStateHash(party.players[i], out);
		writeWeaponsHash(party.weapons[i], out);
	}
}

/** Dump names for writePartyHash (`party.size`, `party.left[1]`, `party.players[1].x`, `party.weapons[1].activeSet`). */
export function partyHashNames(party: Readonly<PartyState>, out: string[]): void {
	out.push("party.size");
	for (let i = 0; i < party.left.size(); i++) out.push(`party.left[${i}]`);
	for (let i = 1; i < party.size; i++) {
		for (const f of PLAYER_HASH_FIELDS) out.push(`party.players[${i}].${f}`);
		weaponsHashNames(party.weapons[i], out, `party.weapons[${i}]`);
	}
}

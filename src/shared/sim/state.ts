/**
 * The live simulation state (source: `src/sim/state.ts`). Mutated in place by step(); never put it in UI state
 * (render reads it through the client's sim controller).
 *
 * Keep it plain data (numbers, nested plain objects, arrays of numbers). When you add a field, also append it to
 * writeHashFields() in replay.ts (or the module's write*Hash) so the determinism hash covers it. The ONE exception is
 * `combat`'s two bullet simulations: stateful pools created per run by createSimState and hashed through their own
 * writeStateHash (see combat/combat.ts).
 */

import { seedToState } from "./rng";
import { newPlayerState, playerTraits } from "./player";
import { playerStartArmorMax, playerStartFlaskMax, playerStartHalfHearts } from "./playerData";
import { cloneCombatState, createCombatState, startCombat, type CombatState } from "./combat/combat";
import type { SimConfig } from "./step";
import { cloneEndlessState, createEndlessState, endlessStartFloor, type EndlessState } from "./endless";
import {
	addBuildScoreSources,
	addPactScoreSources,
	addGoldenScoreSources,
	addOvercapScoreSources,
	addSecretScoreSources,
	addPelletScoreSources,
	addTreasureScoreSources,
	cloneScoreState,
	createScoreState,
	type ScoreState,
} from "./score/score";
import { cloneRunState, createRunState } from "./progression/progression";
import { refreshRunMods, type RunState } from "./progression/runMods";
import { cloneParty, createPartyState, partySize, playerAt, type PartyState } from "./party";
import {
	cloneTutorialState,
	createTutorialState,
	tutorialStartHalfHearts,
	type TutorialState,
} from "./tutorial/tutorial";
import { cloneBreakablesState, createBreakablesState, type BreakablesState } from "./breakables/breakables";
import { cloneDropsState, createDropsState, type DropsState } from "./drops/drops";
import { dropsOnFloorPieces } from "./drops/breakLoot";
import { cloneAffixesState, createAffixesState, type AffixesState } from "./affixes/affixes";
import { cloneDevState, createDevState, type DevState } from "./dev/dev";
import { cloneBuildsState, createBuildsState, type BuildsState } from "./builds/builds";
import { clonePelletsState, createPelletsState, pelletsOnFloor, type PelletsState } from "./pellets/pellets";
import { cloneTreasureState, createTreasureState, treasureOnFloor, type TreasureState } from "./treasure/treasure";
import { clonePactsState, createPactsState, pactsOnFloor, type PactsState } from "./pacts/pacts";
import { cloneGoldenState, createGoldenState, goldenOnFloor, type GoldenState } from "./golden/golden";
import { cloneSecretsState, createSecretsState, secretsOnFloor, type SecretsState } from "./secrets/secrets";
import { cloneSilverState, createSilverState, silverOnFloorPieces, type SilverState } from "./silver/silver";

export interface PlayerState {
	x: number;
	z: number;
	/** Position at the start of the last tick, for render interpolation. */
	prevX: number;
	prevZ: number;
	/** Facing as a unit vector on the ground plane (no angles in the sim). */
	faceX: number;
	faceZ: number;

	// --- E1.5 player controller (player.ts, data in playerData.ts). Plain numbers only: 0/1 for flags, integer tick
	// counters for durations (counted down at the start of each stepPlayer).
	/** Health in HALF hearts (6 = 3 hearts). */
	hearts: number;
	heartsMax: number;
	/** Armor pips: each absorbs one whole hit before hearts. Refilled to armorMax at checkpoints. */
	armor: number;
	armorMax: number;
	/** Flask charges left / per checkpoint. */
	flask: number;
	flaskMax: number;
	/** Embers (bullet clears) left / per area. */
	embers: number;
	emberMax: number;
	/** Roll ticks remaining, including the current tick. > 0 = rolling. */
	rollTicks: number;
	/** Roll direction, a unit vector locked when the roll starts. */
	rollDirX: number;
	rollDirZ: number;
	/** Dodge i-frames remaining (roll start, Ember). > 0 = damagePlayer() ignores hits. */
	iframeTicks: number;
	/** Post-hit invulnerability remaining. > 0 = damagePlayer() ignores hits (render blinks). */
	hurtTicks: number;
	/** Flask drinking time remaining. > 0 = walking at FLASK_MOVE_MULTIPLIER. */
	flaskTicks: number;
	/** Last tick's InputFrame.buttons, for press edges that replay exactly. */
	prevButtons: number;
	/** 1 once hearts reach 0: no movement or actions until respawnPlayer(). */
	dead: number;
}

/**
 * Things that happened during the current tick, cleared at the start of every tick. Render / audio read them after a
 * tick and never write them. Not hashed.
 */
export interface SimEvents {
	/** 1 if the Ember (bullet clear) fired this tick. Set by stepPlayer, consumed by stepCombat. */
	emberUsed: number;
	/** Number of hits that landed on the player this tick. */
	playerHits: number;
	/** 1 if a dodge roll started this tick. */
	rollStarted: number;
	/** 1 if a flask charge was drunk this tick. */
	flaskUsed: number;
	/** 1 if the player died this tick. */
	playerDied: number;

	// --- E1.6 combat (set by stepCombat)
	/** Enemy bullets removed by this tick's Ember. */
	bulletsCleared: number;
	/** 1 if the player's weapon fired a volley this tick. */
	shotsFired: number;
	/** Player bullets that hit an enemy this tick. */
	enemyHits: number;
	/** Enemies killed this tick (same as actorsKilled; kept from E1.6). */
	enemiesKilled: number;

	// --- E1.8 actors and weapons
	/** Archetype index of the enemy that landed the last player hit this tick; -1 unknown / no hit. */
	lastHitSource: number;
	/** Actors that died this tick. */
	actorsKilled: number;
	/** Actors spawned this tick (runtime spawns). */
	actorsSpawned: number;
	/** A boss phase changed this tick: the new phase number, else 0. */
	bossPhase: number;
	/** Telegraphed attacks that started winding up this tick. */
	telegraphs: number;
	/** Melee swings this tick (sweepArc calls). */
	meleeSwings: number;
	/** Enemy bullets deleted by melee arcs this tick. */
	bulletsDeleted: number;
	/** 1 if the player swapped weapon sets this tick. */
	weaponSwapped: number;
	/** Hit points removed from actors this tick (after immunity and damage caps). */
	damageDealt: number;

	// --- E1.8 boss
	/** 1 on the tick a boss fight starts, else 0. */
	bossEngaged: number;
	/** 1 on the tick a boss dies, else 0. */
	bossDefeated: number;

	// --- Endless mode (Roblox port; set by stepEndless, always 0 outside endless runs). Not in SIM_EVENT_FIELDS.
	/** The new floor number on the tick the floor changed, else 0. */
	floorChanged: number;
	/** The new Depth on the tick it grew (a boss kill), else 0. */
	depthChanged: number;
	/** 1 on the tick a boss floor's stairwell opened, else 0. */
	stairwellOpened: number;
	/** Room id + 1 of the room the player entered for the first time this floor (its enemies spawned), else 0. */
	roomEntered: number;

	// --- Breakables (docs/DECOR.md D4; breakables/breakables.ts, always 0 without SimConfig.breakables). Not in
	// SIM_EVENT_FIELDS.
	/** Hits that landed on breakable pieces this tick (the breaking hit included). */
	breakableHits: number;
	/** Breakable pieces broken this tick. */
	breakablesBroken: number;

	// --- Enemy variants (docs/ENEMY_VARIANTS.md EVD14; always 0 without goo). Not in SIM_EVENT_FIELDS.
	/** Goo puddles (BulletKind.GOO) fired this tick; also in combat.enemySpawned, so the enemy-shoot sound skips them. */
	gooSpawned: number;

	// --- New enemies (docs/NEW_ENEMIES.md; always 0 without them). Not in SIM_EVENT_FIELDS.
	/** Strikes (BulletKind.STRIKE) fired this tick; also in combat.enemySpawned, so the enemy-shoot sound skips them. */
	strikes: number;

	// --- New enemies 2 (docs/NEW_ENEMIES_2.md; always 0 without a Bulwark, Chainhook or Pyre-keeper). Not in SIM_EVENT_FIELDS.
	/** Hits a Bulwark's shield blocked this tick (combat/shield.ts; where: CombatState.guardEvents). */
	shieldBlocks: number;
	/** Bulwark guards broken this tick (NXD7; which: CombatState.guardEvents.breakSlot). */
	guardBreaks: number;
	/** Pyres a Pyre-keeper lit this tick (they landed: the new `pyre` actors spawned this tick). */
	pyresLanded: number;
	/** Pyres withered this tick (their keeper died; a pyre killed by a player is not counted). */
	pyresWithered: number;
	/** Chainhook latches this tick (NX3; who and by which slot: CombatState.hookEvents). */
	hookLatched: number;
	/** Chainhook drags broken this tick (a roll, lost sight, its death, breakDamage, the player's death; NX3). */
	hookBroken: number;

	// --- New enemies 3 (docs/NEW_ENEMIES_3.md; always 0 without a Mortar, a Mender or a Jackal). Not in SIM_EVENT_FIELDS.
	/**
	 * Mortar shells (a BulletKind.STRIKE fired by a Mortar, living or its corpse, NT2) landed this tick; also counted in
	 * `strikes`, so the view plays the Stormcaller's lightning only for `strikes - shells` (NT0 finding 3).
	 */
	shells: number;
	/**
	 * Hp the Mender healed this tick (healActor, NT3; which ally and how much: CombatState.healEvents). Never through
	 * damageActor: no score, combo, cap bucket, flash or build proc sees it.
	 */
	heals: number;
	/** Mender channels cut this tick (healEndCuts: sight lost, a body on the beam, a hit; why: CombatState.healEvents). */
	healCuts: number;
	/** Jackal lunges started this tick (the wind-up ran out, NT4; the view's `sfx.enemy.lunge`). */
	lunges: number;
	/** Jackal wind-ups called off this tick (the target faced it, NT4; the hop back, `sfx.enemy.spooked`). */
	spooks: number;
}

/**
 * The web build's SimEvents fields, in declaration order (telemetry and the parity tools: the run fixtures' events and
 * totals have exactly these). The port's endless fields are ENDLESS_EVENT_FIELDS; ALL_EVENT_FIELDS has both.
 */
export const SIM_EVENT_FIELDS = [
	"emberUsed",
	"playerHits",
	"rollStarted",
	"flaskUsed",
	"playerDied",
	"bulletsCleared",
	"shotsFired",
	"enemyHits",
	"enemiesKilled",
	"lastHitSource",
	"actorsKilled",
	"actorsSpawned",
	"bossPhase",
	"telegraphs",
	"meleeSwings",
	"bulletsDeleted",
	"weaponSwapped",
	"damageDealt",
	"bossEngaged",
	"bossDefeated",
] as const;

/** The endless-mode event fields (Roblox port), in declaration order. All default to 0. */
export const ENDLESS_EVENT_FIELDS = ["floorChanged", "depthChanged", "stairwellOpened", "roomEntered"] as const;

/** The breakables event fields (Roblox port, docs/DECOR.md D4), in declaration order. All default to 0. */
export const BREAKABLE_EVENT_FIELDS = ["breakableHits", "breakablesBroken"] as const;

/** The enemy variants' event fields (Roblox port, docs/ENEMY_VARIANTS.md), in declaration order. All default to 0. */
export const ENEMY_VARIANT_EVENT_FIELDS = ["gooSpawned"] as const;

/** The new enemies' event fields (Roblox port, docs/NEW_ENEMIES.md), in declaration order. All default to 0. */
export const NEW_ENEMY_EVENT_FIELDS = ["strikes"] as const;

/** The second new enemies' event fields (Roblox port, docs/NEW_ENEMIES_2.md), in declaration order. All default to 0. */
export const NEW_ENEMY_2_EVENT_FIELDS = [
	"shieldBlocks",
	"guardBreaks",
	"pyresLanded",
	"pyresWithered",
	"hookLatched",
	"hookBroken",
] as const;

/** The third new enemies' event fields (Roblox port, docs/NEW_ENEMIES_3.md), in declaration order. All default to 0. */
export const NEW_ENEMY_3_EVENT_FIELDS = ["shells", "heals", "healCuts", "lunges", "spooks"] as const;

/**
 * Every SimEvents field: SIM_EVENT_FIELDS, then ENDLESS_EVENT_FIELDS, then BREAKABLE_EVENT_FIELDS, then
 * ENEMY_VARIANT_EVENT_FIELDS, then NEW_ENEMY_EVENT_FIELDS, then NEW_ENEMY_2_EVENT_FIELDS, then NEW_ENEMY_3_EVENT_FIELDS.
 */
export const ALL_EVENT_FIELDS: ReadonlyArray<keyof SimEvents> = [
	...SIM_EVENT_FIELDS,
	...ENDLESS_EVENT_FIELDS,
	...BREAKABLE_EVENT_FIELDS,
	...ENEMY_VARIANT_EVENT_FIELDS,
	...NEW_ENEMY_EVENT_FIELDS,
	...NEW_ENEMY_2_EVENT_FIELDS,
	...NEW_ENEMY_3_EVENT_FIELDS,
];

/** Default value of an event field: 0, except lastHitSource (-1). */
export function eventDefault(field: keyof SimEvents): number {
	return field === "lastHitSource" ? -1 : 0;
}

export function clearEvents(e: SimEvents): void {
	for (const f of ALL_EVENT_FIELDS) e[f] = eventDefault(f);
}

function emptyEvents(): SimEvents {
	return {
		emberUsed: 0,
		playerHits: 0,
		rollStarted: 0,
		flaskUsed: 0,
		playerDied: 0,
		bulletsCleared: 0,
		shotsFired: 0,
		enemyHits: 0,
		enemiesKilled: 0,
		lastHitSource: -1,
		actorsKilled: 0,
		actorsSpawned: 0,
		bossPhase: 0,
		telegraphs: 0,
		meleeSwings: 0,
		bulletsDeleted: 0,
		weaponSwapped: 0,
		damageDealt: 0,
		bossEngaged: 0,
		bossDefeated: 0,
		floorChanged: 0,
		depthChanged: 0,
		stairwellOpened: 0,
		roomEntered: 0,
		breakableHits: 0,
		breakablesBroken: 0,
		gooSpawned: 0,
		strikes: 0,
		shieldBlocks: 0,
		guardBreaks: 0,
		pyresLanded: 0,
		pyresWithered: 0,
		hookLatched: 0,
		hookBroken: 0,
		shells: 0,
		heals: 0,
		healCuts: 0,
		lunges: 0,
		spooks: 0,
	};
}

export interface SimState {
	/** Number of ticks stepped so far. */
	tick: number;
	/** mulberry32 state word (uint32). */
	rngState: number;
	player: PlayerState;
	events: SimEvents;
	/** Bullets (two pools), actors, weapon sets, stress emitter. See combat/combat.ts. */
	combat: CombatState;
	/** Endless mode (floor, Depth, stairwell, rooms entered); undefined unless SimConfig.endless. See endless.ts. */
	endless?: EndlessState;
	/** Scoring (M2), only when the run's SimConfig.scoring is set; hashed as the "score" subsystem. See score/score.ts. */
	score?: ScoreState;
	/**
	 * In-run progression (M2: boons, relics, curse shrines), endless runs only; hashed as the "run" subsystem after
	 * "score". Per player (`run.players[i]`). See progression/progression.ts.
	 */
	run?: RunState;
	/**
	 * Co-op (M4), only when SimConfig.party.size > 1: every player by index ([0] is `player`), their weapons, who left.
	 * Hashed as the "party" subsystem, after every other group but "tutorial". See party.ts.
	 */
	party?: PartyState;
	/**
	 * First-run tutorial (docs/TUTORIAL.md), only when SimConfig.tutorial is set: the harmless flag and the harmless
	 * hit count. Hashed as the "tutorial" subsystem, appended after "party" (only "breakables" and "drops" come after
	 * it). See tutorial/tutorial.ts.
	 */
	tutorial?: TutorialState;
	/**
	 * Breakable barrels and crates (docs/DECOR.md D4), only when SimConfig.breakables is set: the current floor's pieces
	 * (kind, cell, hp, broken tick). Hashed as the "breakables" subsystem, appended after "tutorial" (only "drops"
	 * comes after it). See breakables/breakables.ts.
	 */
	breakables?: BreakablesState;
	/**
	 * Boost drops (docs/BOOSTS.md), only when SimConfig.drops is set: the drop stream, pity, ground slots, guards and
	 * every player's boost timers / Aegis pips. Hashed as the "drops" subsystem, appended after every other group (after
	 * "breakables"). See drops/drops.ts.
	 */
	drops?: DropsState;
	/**
	 * Elite affixes (docs/ENEMY_VARIANTS.md EV7), only when SimConfig.affixes is set: one affix slot per actor slot
	 * (affix, actorId guard, shield, Vengeful timer). Hashed as the "affixes" subsystem, appended after every other group
	 * (after "drops"). See affixes/affixes.ts.
	 */
	affixes?: AffixesState;
	/**
	 * Developer mode (docs/DEV_MODE.md), only when SimConfig.dev is set: god mode, blocked hits, toggles. Hashed as the
	 * "dev" subsystem, appended after "affixes". See dev/dev.ts.
	 */
	dev?: DevState;
	/**
	 * Builds (docs/BUILDS.md BU1), only when SimConfig.builds is set: every player's boon levels, duos and counters, the
	 * proc queue, the boss double draft's deals left. Hashed as the "builds" subsystem, appended after every other group
	 * (after "dev"). See builds/builds.ts.
	 */
	builds?: BuildsState;
	/**
	 * Pellets (docs/PELLETS.md PL2), only when SimConfig.pellets is set: the current floor's pellets (position, score
	 * record, taken), the power pellet, per score record its range, regular count, pellets left, phase and Sweep. Hashed
	 * as the "pellets" subsystem, appended after every other group (after "builds"). See pellets/pellets.ts.
	 */
	pellets?: PelletsState;
	/**
	 * Treasure rooms (docs/TREASURE.md TR2), only when SimConfig.treasure is set: the treasure stream, the current
	 * floor's vault (status, room, record, chest slot and centre, lock, tiers, arm / crack ticks, countdown, allowance,
	 * miss / spare), per player bonus deals, the run's chest counters. Hashed as the "treasure" subsystem, appended after
	 * every other group (after "pellets"). See treasure/treasure.ts.
	 */
	treasure?: TreasureState;
	/**
	 * Pacts (docs/FORTUNE.md PS2), only when SimConfig.pacts is set: the current floor's altars, every player's takes and
	 * draft kind, the Horde (armed, its room and record, the second wave), the run counters. Hashed as the "pacts"
	 * subsystem, after "treasure" (only "golden" after it). See pacts/pacts.ts.
	 */
	pacts?: PactsState;
	/**
	 * The Goldling (docs/FORTUNE.md GE2), only when SimConfig.golden is set: its own rng stream, this floor's status
	 * (none / waiting / running / caught / escaped / skipped), room and record, engage / appear ticks, actor slot and id,
	 * coins, hits, the run counters and the flee field's sources. Hashed as the "golden" subsystem, appended after every
	 * other group (after "pacts"). See golden/golden.ts.
	 */
	golden?: GoldenState;
	/**
	 * Secret rooms (docs/SECRET_ROOMS.md SR4), only when SimConfig.secrets is set: its own rng stream (the chest's
	 * draws), this floor's secret (status hidden / open / taken, its room, crack and chest slots, the chest's centre,
	 * facing and tier, the open's tick, credit and opener kind, who took the chest) and the run counters (found, taken,
	 * opens by kind). Hashed as the "secrets" subsystem, appended after every other group (after "golden"). See
	 * secrets/secrets.ts.
	 */
	secrets?: SecretsState;
	/**
	 * Silver in crates (docs/SILVER.md SC2), only when SimConfig.silver is set: the run's total from broken Silver pieces
	 * and the current floor's Silver per breakables slot. No rng. Hashed as the "silver" subsystem, appended after every
	 * other group (after "secrets"). See silver/silver.ts.
	 */
	silver?: SilverState;
}

/**
 * A fresh run. `config` is the run's SimConfig (the same one every step() and the replay get): combat state is built
 * from it (encounter spawns, loadout, stress mode, bullet culling), so live play and runReplay create identical worlds.
 * Omitted: an empty config (no actors, default loadout, bounds-culled bullets). With `config.endless`, combat state is
 * built from floor 1's world (`worldForFloor(ENDLESS_FIRST_FLOOR).config`, or its `startFloor`'s) and `endless` state is
 * created.
 * With `config.party` (size > 1) every party member starts at the spawn too (party.ts), before the encounter spawns.
 * With `config.tutorial`, `tutorial` state is created and every player starts with its `startHalfHearts` (if set).
 * With `config.breakables`, `breakables` state is created (floor 1's pieces in endless mode, else its `pieces`).
 * With `config.drops`, `drops` state is created (its own rng stream from `seed`, one boost entry per player); with
 * its `breakableLoot` too, the first floor's loaded pieces (docs/BREAKABLE_DROPS.md).
 * With `config.affixes`, `affixes` state is created before the encounter spawns (its slots follow the actor pool).
 * With `config.dev`, `dev` state is created (developer mode's god mode, docs/DEV_MODE.md).
 * `config.endless.startFloor` / `startDepth` (developer mode's floor jump) start on that floor and Depth instead of
 * floor 1 / Depth 1; absent, exactly as before.
 * With `config.builds`, `builds` state is created (an empty build per player).
 * With `config.pellets`, `pellets` state is created after the score state (its rooms hang off the score's room
 * records): the first floor's pellets (endless: its world's, dev mode's startFloor included; else
 * `config.pellets.floor`), and a scored run's points / counts gain the pellet sources (addPelletScoreSources).
 * With `config.treasure`, `treasure` state is created after the pellets (its vault hangs off a score record and a
 * breakables slot): the first floor's vault (endless: its world's, dev mode's startFloor included; floor 1 never has
 * one), and a scored run's points / counts gain TREASURE (addTreasureScoreSources, after the builds and pellet padding).
 * With `config.pacts`, `pacts` state is created after the pellet state: the first floor's altars (endless: its world's;
 * else `config.pacts.floor`), and a scored run's points / counts gain the pact source (addPactScoreSources).
 * With `config.golden`, `golden` state is created after the score state (its own stream from `seed`; the first floor's
 * Goldling room in endless mode, none otherwise), and a scored run's points / counts gain the GOLDEN source
 * (addGoldenScoreSources).
 * With `config.builds`, a scored run's points / counts finally gain OVERCAP (docs/BUILDS_V2.md BV9,
 * addOvercapScoreSources, padding every earlier gated source).
 * With `config.secrets`, `secrets` state is created last (its own stream from `seed`; the first floor's secret in
 * endless mode, none otherwise; it reads the breakables' pieces), and a scored run's points / counts gain SECRET last
 * (docs/SECRET_ROOMS.md SR4, addSecretScoreSources, padding every earlier gated source, OVERCAP included).
 * With `config.silver`, `silver` state is created after that (docs/SILVER.md SC2): the first floor's Silver pieces
 * (endless: its world's, dev mode's startFloor included; else `config.silver.floor`). No score source.
 */
export function createSimState(
	seed: number,
	spawnX: number,
	spawnZ: number,
	config: Readonly<SimConfig> = {},
): SimState {
	const endless = config.endless;
	const firstFloor = endless !== undefined ? endless.worldForFloor(endlessStartFloor(endless)) : undefined;
	const world = firstFloor !== undefined ? firstFloor.config : config;
	const state: SimState = {
		tick: 0,
		rngState: seedToState(seed),
		// Faces the camera (screen-down) until there is input.
		player: newPlayerState(spawnX, spawnZ),
		events: emptyEvents(),
		// docs/ARCHER.md AR3: the run config's loadout first (an endless run's character), else the world's.
		combat: createCombatState(world, config.loadout ?? world.loadout),
		endless: firstFloor !== undefined ? createEndlessState(firstFloor, endless?.startDepth) : undefined,
	};
	// Co-op: the other players (and their player bullet emitter ids) exist before anything spawns. No rng.
	state.party = createPartyState(state, config.party, config.loadout ?? world.loadout, spawnX, spawnZ);
	// docs/ARCHER.md: each player's starting and maximum health from their traits (the run config's, like the roll;
	// START_HALF_HEARTS without traits, so a run without them is unchanged); docs/SILVER.md SV5: their armor and flask
	// maxima the same way (START_ARMOR_MAX / FLASK_CHARGES without traits), each starting full. No rng.
	const players = partySize(state);
	for (let i = 0; i < players; i++) {
		const p = playerAt(state, i);
		const traits = playerTraits(config, i);
		const max = playerStartHalfHearts(traits);
		p.heartsMax = max;
		p.hearts = max;
		const armorMax = playerStartArmorMax(traits);
		p.armorMax = armorMax;
		p.armor = armorMax;
		const flaskMax = playerStartFlaskMax(traits);
		p.flaskMax = flaskMax;
		p.flask = flaskMax;
	}
	// Tutorial: harmless hits and the wounded start (every player, max hearts unchanged). No rng.
	const tutorial = config.tutorial;
	if (tutorial !== undefined) {
		state.tutorial = createTutorialState(tutorial);
		const n = partySize(state);
		for (let i = 0; i < n; i++) {
			const p = playerAt(state, i);
			p.hearts = tutorialStartHalfHearts(tutorial, p.heartsMax);
		}
	}
	// Breakables (endless: floor 1's pieces; else config.breakables.pieces). No rng.
	const breakables = config.breakables;
	if (breakables !== undefined) {
		const list = firstFloor !== undefined ? firstFloor.breakables : breakables.pieces;
		state.breakables = createBreakablesState(breakables, list ?? []);
	}
	// Boost drops: their own rng stream (seed ^ DROPS.salt), never state.rngState. No sim rng.
	if (config.drops !== undefined) {
		state.drops = createDropsState(config.drops, seed, partySize(state));
		// Boosts from breakables (DropsConfig.breakableLoot): the first floor's loot (endless: its world's, dev mode's
		// startFloor included; else config.breakables.loot). No rng.
		dropsOnFloorPieces(state, firstFloor !== undefined ? firstFloor.breakableLoot : breakables?.loot);
	}
	// Elite affixes: before any spawn, so the slots grow with the pool. No rng.
	if (config.affixes !== undefined) state.affixes = createAffixesState(config.affixes);
	// Developer mode (god mode). No rng.
	if (config.dev !== undefined) state.dev = createDevState(config.dev);
	// Spawns the encounter (archetype init hooks may draw from the sim rng) and the stress emitter.
	startCombat(state, world);
	// After the spawns (scoring's room records read them; endless floors: the floor's deferred room spawns). No rng.
	if (config.scoring !== undefined) {
		state.score = createScoreState(
			state,
			config.scoring,
			world.encounter,
			firstFloor?.roomSpawns,
			firstFloor?.roomAffixes,
		);
	}
	// Endless runs: boons, relics and curses (floor 1's pedestals and shrine). No rng.
	if (firstFloor !== undefined) state.run = createRunState(world.encounter, partySize(state));
	// Builds (docs/BUILDS.md): an empty build per player. No rng.
	if (config.builds !== undefined) {
		state.builds = createBuildsState(config.builds, partySize(state));
		// The build-only score sources (BU5: Jackpot), so they hash only in builds runs.
		if (state.score !== undefined) addBuildScoreSources(state.score);
	}
	// Pellets (docs/PELLETS.md): after the score state (the room records). No rng.
	const pellets = config.pellets;
	if (pellets !== undefined) {
		state.pellets = createPelletsState(pellets);
		pelletsOnFloor(state, firstFloor !== undefined ? firstFloor.pellets : pellets.floor);
		// The pellet-only score sources (PELLETS, SWEEP; JACKPOT padded without builds), so they hash only here.
		if (state.score !== undefined) addPelletScoreSources(state.score);
	}
	// Treasure rooms (docs/TREASURE.md): after the score's room records and the breakables (the vault's record and
	// chest). Its own stream (seed ^ TREASURE.salt), never state.rngState. No rng drawn.
	const treasure = config.treasure;
	if (treasure !== undefined) {
		state.treasure = createTreasureState(treasure, seed, partySize(state));
		treasureOnFloor(state, firstFloor?.vault);
		// The treasure-only score source (TREASURE; JACKPOT / PELLETS / SWEEP padded without them), so it hashes only here.
		if (state.score !== undefined) addTreasureScoreSources(state.score);
	}
	// Pacts (docs/FORTUNE.md): the first floor's altars. No rng.
	const pacts = config.pacts;
	if (pacts !== undefined) {
		state.pacts = createPactsState(pacts, partySize(state));
		pactsOnFloor(state, firstFloor !== undefined ? firstFloor.pactAltars : pacts.floor);
		// The pact-only score source (HORDE; the gated ones before it padded), so it hashes only here.
		if (state.score !== undefined) addPactScoreSources(state.score);
	}
	// The Goldling (docs/FORTUNE.md GE2): its own stream (seed ^ GOLDEN_SIM_SALT), after the score state (its record).
	// No sim rng.
	const golden = config.golden;
	if (golden !== undefined) {
		state.golden = createGoldenState(golden, seed);
		goldenOnFloor(state, firstFloor?.golden);
		// The Goldling's score source (GOLDEN; the earlier gated ones padded), so it hashes only here.
		if (state.score !== undefined) addGoldenScoreSources(state.score);
	}
	// Overcap points (docs/BUILDS_V2.md BV9): builds runs' last gated source (OVERCAP; every earlier one padded), so
	// it hashes only in builds runs.
	if (config.builds !== undefined && state.score !== undefined) addOvercapScoreSources(state.score);
	// Secret rooms (docs/SECRET_ROOMS.md SR4): its own stream (seed ^ SECRETS_SALT), after the breakables (its pieces).
	// No sim rng. Its score source last (SECRET; every earlier gated one padded), so it hashes only here.
	const secrets = config.secrets;
	if (secrets !== undefined) {
		state.secrets = createSecretsState(secrets, seed);
		secretsOnFloor(state, firstFloor?.secret);
		if (state.score !== undefined) addSecretScoreSources(state.score);
	}
	// Silver in crates (docs/SILVER.md SC2): after the breakables (its pieces). No rng, no score source.
	const silver = config.silver;
	if (silver !== undefined) {
		state.silver = createSilverState(silver);
		silverOnFloorPieces(state, firstFloor !== undefined ? firstFloor.breakableSilver : silver.floor);
	}
	return state;
}

/**
 * An independent copy of `s`. LIMITED: the bullet pools can only be rebuilt while pristine (no bullet ever spawned in
 * this run); once any bullet has been spawned this THROWS. Re-simulate from the recording instead.
 */
function cloneRun(r: Readonly<RunState>, builds: Readonly<BuildsState> | undefined): RunState {
	const out = cloneRunState(r);
	for (let i = 0; i < out.players.size(); i++) refreshRunMods(out.players[i], builds?.players[i]);
	return out;
}

export function cloneSimState(s: Readonly<SimState>): SimState {
	const clone: SimState = {
		tick: s.tick,
		rngState: s.rngState,
		player: { ...s.player },
		events: { ...s.events },
		combat: cloneCombatState(s.combat),
		endless: s.endless !== undefined ? cloneEndlessState(s.endless) : undefined,
		score: s.score !== undefined ? cloneScoreState(s.score) : undefined,
		run: s.run !== undefined ? cloneRun(s.run, s.builds) : undefined,
		tutorial: s.tutorial !== undefined ? cloneTutorialState(s.tutorial) : undefined,
		breakables: s.breakables !== undefined ? cloneBreakablesState(s.breakables) : undefined,
		drops: s.drops !== undefined ? cloneDropsState(s.drops) : undefined,
		affixes: s.affixes !== undefined ? cloneAffixesState(s.affixes) : undefined,
		dev: s.dev !== undefined ? cloneDevState(s.dev) : undefined,
		builds: s.builds !== undefined ? cloneBuildsState(s.builds) : undefined,
		pellets: s.pellets !== undefined ? clonePelletsState(s.pellets) : undefined,
		treasure: s.treasure !== undefined ? cloneTreasureState(s.treasure) : undefined,
		pacts: s.pacts !== undefined ? clonePactsState(s.pacts) : undefined,
		golden: s.golden !== undefined ? cloneGoldenState(s.golden) : undefined,
		secrets: s.secrets !== undefined ? cloneSecretsState(s.secrets) : undefined,
		silver: s.silver !== undefined ? cloneSilverState(s.silver) : undefined,
	};
	if (s.party !== undefined) clone.party = cloneParty(s.party, clone);
	return clone;
}

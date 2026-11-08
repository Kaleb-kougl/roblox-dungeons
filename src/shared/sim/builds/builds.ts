/**
 * Builds in the sim (docs/BUILDS.md BU1 / BU2; a Roblox-port feature, no web source): boon levels, duos, the per-player
 * counters the evolutions and duos read, the proc queue, and the boss double draft's deals left. OPT-IN like affixes:
 * only a SimConfig with `builds` (endless worlds, shared/run buildEndlessRunConfig) creates `SimState.builds`, and only
 * then is anything here reached or the hash's "builds" group written (appended after every other group, after
 * "affixes"). Without it (M1, every golden fixture, the tutorial) the draft is today's (drawBoonOffers / grantBoon) and
 * every boon is level I (runMods.ts computeRunMods without a build).
 *
 * State per player (state.builds.players[i], party index order, one per RunState player):
 *   levels           one per Boon index (BOON_COUNT): 0 = not owned, 1..boonMaxLevel. RunPlayerState.boons keeps the
 *                    distinct boons in the order taken (level I pushes there), so every existing reader still works
 *   duos             duo indices, in the order taken
 *   grazes / kills / arrows / bigHits   counters for the evolutions and duos that count: BU5 grazes (Thrill
 *                    Seeker: grazes toward the next ring), kills (Jackpot: kills toward the next pay), arrows (Flurry:
 *                    stream arrows toward the next triple); each counts only while its boon is evolved. bigHits (BU6,
 *                    Storm Blade): arrow hits toward the next spark, counts only while the duo is owned
 *   bulwarkPending   (BU5, appended) armor pips broken whose Bulwark nova has not been released yet
 *   closeGrazes      (BU6, appended) Close Call: grazes toward the next shard, counts only while the duo is owned
 *   braceCount       (docs/LEGENDARIES.md LG1, appended) Bastion: enemy bullets stopped by the current guard or roll
 *                    (LG3's rule: ./hooks.ts; reset when a guard or roll starts)
 *   braceReady       (LG1, appended) Bastion: 1 while this room's brace is still to come, else 0 (LG3: set by the
 *                    pick, a floor's start and a room's spawn; cleared by a brace that restored something)
 *   braceCooldown    (owner's tuning, appended) Citadel: ticks before its next brace (CITADEL_BRACE_COOLDOWN_TICKS
 *                    after one; counted down by stepBuilds)
 *   draftsLeft       deals left in the open draft, the one on screen included: 1 after a floor, 2 after a boss floor
 *                    (BUD4); a confirm with draftsLeft > 1 re-deals (./cards.ts) instead of closing. 0 while closed
 *   riposteCount     (docs/BUILDS_V2.md BV1, appended) Riposte: enemy bullets the current guard erased (BV2's rule;
 *                    reset on the guard's start tick, discarded by a roll's cut or a swap)
 *   overcap          (BV1, appended) boss damage the cap dropped from this player's hits, not paid out yet (BV9: 1 is
 *                    taken per OVERCAP_POINTS payout)
 *   happyHourTicks   (BV1, appended) Happy Hour: ticks of doubled kill points left (BV7: set by a flask drink)
 * and for the world:
 *   procs            the proc queue (BU3, ./procs.ts: { x, z, owner, gen, slot, id, excess, kind } per entry, oldest
 *                    first). `excess`, appended by docs/LEGENDARIES.md LG1, is the kill's Overkill carry (LG2:
 *                    execute.ts buildsKillCarry, set only when the owner has Overkill; 0 for a proc that carries
 *                    nothing). `kind` (docs/BUILDS_V2.md BV1, appended): ProcKind.KILL (every proc in BV1) or SMASH
 *                    (BV5: a piece an owner broke; x / z its cell centre, slot / id -1)
 *   pins             (BV1, appended) Siege Bolt's pins (BV4, ./siege.ts): a heavy arrow's bullet slot carrying an actor
 *   waves            (BV1, appended) Riposte's counter-waves (BV2, ./riposte.ts): growing sweeps, each enemy hit once
 *   stillCombo / stillTick   (BV1, appended) Stillwater: the team combo a hit cut and the tick it was cut (BV6;
 *                    stillTick STILL_NONE -1: nothing recorded)
 *
 * Events (BuildEvents) are presentation only: cleared every tick, NOT hashed.
 */
import type { SimState } from "../state";
import { BOON_COUNT } from "../progression/progressionData";
import {
	CardKind,
	BUILD_RULES,
	cardBoon,
	cardDuo,
	type BuildRules,
	type CardKindId,
	type ProcKindId,
} from "./buildsData";
import { STILL_NONE } from "./effectsData";

// ---------------------------------------------------------------------------------------------
// Config

/** SimConfig.builds: presence turns builds on; the rules (BUILDS_CONFIG is the game's). */
export type BuildsConfig = BuildRules;

/** The game's builds config (endless solo and co-op). */
export const BUILDS_CONFIG: BuildsConfig = BUILD_RULES;

// ---------------------------------------------------------------------------------------------
// State

/** One player's build. Every field hashed. */
export interface BuildPlayerState {
	/** Per Boon index: 0 = not owned, else the level (1..boonMaxLevel). */
	levels: number[];
	/** Duo indices, in the order taken. */
	duos: number[];
	/** Counters (BU5 / BU6). */
	grazes: number;
	kills: number;
	arrows: number;
	bigHits: number;
	/** Deals left in the open draft (the one on screen included); 0 while no draft is open. */
	draftsLeft: number;
	/** Bulwark (BU5): armor pips broken whose nova stepBuilds has not released yet (./hooks.ts buildsOnArmorBreak). */
	bulwarkPending: number;
	/** Close Call (BU6): grazes toward the next shard (./hooks.ts buildsOnGraze; released by stepBuilds, ./duos.ts). */
	closeGrazes: number;
	/** Bastion (docs/LEGENDARIES.md LG1; the rule is LG3): enemy bullets stopped by the current guard or roll. */
	braceCount: number;
	/** Bastion (LG1; LG3): 1 while this room's brace is still to come (re-armed when a room's enemies spawn), else 0. */
	braceReady: number;
	/** Citadel (owner's tuning, LGD14; appended): ticks before its next brace may fire (0: ready; ./hooks.ts). */
	braceCooldown: number;
	/** Riposte (docs/BUILDS_V2.md BV1; the rule is BV2): enemy bullets the current guard erased (goo never). */
	riposteCount: number;
	/** Overcap (BV1; BV9): boss damage the cap dropped from this player's hits, not paid out yet. */
	overcap: number;
	/** Happy Hour (BV1; BV7): ticks of doubled kill points left (0: off). */
	happyHourTicks: number;
}

/** One queued proc: a kill (BU3) or, from BV5, a smash (docs/BUILDS_V2.md, `kind`). Every field hashed. */
export interface BuildProc {
	/** The corpse's position. */
	x: number;
	z: number;
	/** The credited player (party index). */
	owner: number;
	/** The generation (0: the player's own swing / arrow; n + 1: a kill by an effect of generation n). */
	gen: number;
	/** The victim's actor slot and id (skipped as a target). */
	slot: number;
	id: number;
	/** Overkill's carry (docs/LEGENDARIES.md LG1, appended; LG2: 0 for a proc that carries nothing or no Overkill). */
	excess: number;
	/** What the proc is (docs/BUILDS_V2.md BV1, appended; ProcKind): KILL, or SMASH (BV5: a broken piece). */
	kind: ProcKindId;
}

/**
 * Siege Bolt's pin (docs/BUILDS_V2.md "Siege Bolt", BV1 declares it, BV4 the rule): a heavy arrow carrying an actor.
 * Every field hashed. At most SIEGE_PINS_MAX at once.
 */
export interface BuildPin {
	/** The heavy arrow's player bullet slot (checked live right after the move phase, before anything can spawn). */
	bullet: number;
	/** The archer (party index). */
	owner: number;
	/** The pinned actor's slot and id (the id tells a freed and reused slot apart). */
	slot: number;
	id: number;
	/** Where the pin started (the actor's position when pinned): the distance carried is measured from here. */
	x0: number;
	z0: number;
	/** 1 once a drag left the body more than SIEGE_SLAM_SHORT short of the arrow (the next walk visit slams), else 0. */
	slam: number;
}

/**
 * Riposte's counter-wave (docs/BUILDS_V2.md "Riposte", BVD1; BV1 declares it, BV2 the rule): a sweep from (x, z) whose
 * radius grows by `speed` x SIM_DT a tick up to `range`, striking every enemy it reaches inside its cone once. Every
 * field hashed (`hits` as its length, then its values).
 */
export interface BuildWave {
	/** The credited player (party index). */
	owner: number;
	/** The origin (the guarding player's position when the wave went out). */
	x: number;
	z: number;
	/** The unit direction (the facing) and the cone's half-angle cosine (a full ring: below -1). */
	dirX: number;
	dirZ: number;
	halfCos: number;
	/** The current radius, where it ends, and its growth per second (world units). */
	radius: number;
	range: number;
	speed: number;
	/** Damage per enemy struck (before playerHitDamage). */
	damage: number;
	/** WaveKind (FORWARD / RING / REBUKE). */
	kind: number;
	/** Actor ids already struck (each enemy once), in the order struck. */
	hits: number[];
}

/**
 * Per tick, presentation only (cleared every tick, NOT hashed; ScoreEvents' shape: parallel lists, one entry per
 * event). BU2 the takes; BU3 / BU4 the on-kill effects, pushed by stepBuilds (./procs.ts) in resolution order.
 */
export interface BuildEvents {
	/** Players (party index) whose pick this tick was an evolution (level III), and the boon. */
	evolvedPlayer: number[];
	evolvedBoon: number[];
	/** Players whose pick this tick was a duo, and the duo. */
	duoPlayer: number[];
	duoTaken: number[];
	/**
	 * Chain Spark, one entry per hop that hit: from (sparkX1, sparkZ1) (the corpse for the first hop, else the previous
	 * target's position) to (sparkX2, sparkZ2) (the target's position when hit); the credited player and the proc's
	 * generation (0: the player's own kill; climbs along a cascade).
	 */
	sparkX1: number[];
	sparkZ1: number[];
	sparkX2: number[];
	sparkZ2: number[];
	sparkOwner: number[];
	sparkGen: number[];
	/** Volatile rings that spawned at least one bolt: the corpse, owner, the proc's generation, bolts spawned. */
	burstX: number[];
	burstZ: number[];
	burstOwner: number[];
	burstGen: number[];
	burstFired: number[];
	/** Soul Shards volleys that spawned at least one shard: the corpse, owner, the proc's generation, shards spawned. */
	shardX: number[];
	shardZ: number[];
	shardOwner: number[];
	shardGen: number[];
	shardFired: number[];
	/** Effect bullets the effect budget (or a full pool) refused this tick; combat.dropped counts them too. */
	effectDropped: number;
	// --- BU5 (evolutions). Parallel lists per group, one entry per event, pushed in resolution order. ---
	/** Parallel to the spark lists (one entry per segment): 0 a hop, 1 a Storm Crown fork (from the hop's start). */
	sparkFork: number[];
	/**
	 * Novas (Overflowing: a flask drink; Bulwark: an armor pip broke): the centre (the player when released), the
	 * radius (world units), the owner, NovaKind, and the enemy bullets erased (goo included).
	 */
	novaX: number[];
	novaZ: number[];
	novaRadius: number[];
	novaOwner: number[];
	novaKind: number[];
	novaErased: number[];
	/** Executioner kills: the enemy's position, the credited player. */
	execX: number[];
	execZ: number[];
	execOwner: number[];
	/** Phantom Step: per enemy bullet erased by a rolling player (goo erased quietly, not listed), where, and who. */
	phantomX: number[];
	phantomZ: number[];
	phantomOwner: number[];
	/** Jackpot pops: the corpse, the owner, the points paid (ScoreSource.JACKPOT). */
	jackpotX: number[];
	jackpotZ: number[];
	jackpotOwner: number[];
	jackpotPoints: number[];
	/** Lionheart heals: the player and the half hearts restored (only heals that restored anything). */
	lionPlayer: number[];
	lionHealed: number[];
	/** Momentum volleys (>= 1 shard spawned): the player's position, the owner, the tier crossed (2..5), shards spawned. */
	momentumX: number[];
	momentumZ: number[];
	momentumOwner: number[];
	momentumTier: number[];
	momentumFired: number[];
	/** Thrill Seeker rings (>= 1 bolt spawned): the player's position, the owner, bolts spawned. */
	thrillX: number[];
	thrillZ: number[];
	thrillOwner: number[];
	thrillFired: number[];
	/** Flurry: the origin, the owner, FlurryKind (crescent / arrows), bullets spawned (crescent: bolts; arrows: 3). */
	flurryX: number[];
	flurryZ: number[];
	flurryOwner: number[];
	flurryKind: number[];
	flurryFired: number[];
	/** Ricochet splits (>= 1 arrow spawned): where the arrow ended, the owner, arrows spawned. */
	ricochetX: number[];
	ricochetZ: number[];
	ricochetOwner: number[];
	ricochetFired: number[];
	// --- BU6 (duos). Parallel lists per group, one entry per event, pushed in resolution order. ---
	/** Embers spawned (Fire Arrows, Blazing Trail): where, the owner, the Duo that dropped it. */
	emberX: number[];
	emberZ: number[];
	emberOwner: number[];
	emberDuo: number[];
	/**
	 * Duo rules that fired (one entry each; embers and Shrapnel's bolts have none): the Duo, the owner, where (Storm
	 * Blade / Conductor: the enemy the spark started from; Chain Reaction: the corpse; Close Call / Unshaken: the
	 * player; Gold Rush: the corpse) and a value (Storm Blade / Conductor / Chain Reaction's spark: enemies struck;
	 * Chain Reaction's burst / Close Call: bullets spawned; Gold Rush: the kill's points; Unshaken: 1). Legendary duos
	 * (docs/LEGENDARIES.md LG4): Supernova at the corpse, bolts spawned by its larger ring; Skewer at the corpse,
	 * enemies its streak struck (the target included; only when the line struck anyone besides it).
	 */
	duoProcDuo: number[];
	duoProcOwner: number[];
	duoProcX: number[];
	duoProcZ: number[];
	duoProcValue: number[];
	// --- docs/LEGENDARIES.md LG2 (Overkill). Parallel lists, one entry per streak, pushed in resolution order. ---
	/**
	 * Overkill streaks that struck: from the corpse (overkillX1, overkillZ1) to the target's position when struck
	 * (overkillX2, overkillZ2), the credited player, the proc's generation (0: the player's own kill; climbs along a
	 * chain) and the carry dealt (world damage, the kill's excess).
	 */
	overkillX1: number[];
	overkillZ1: number[];
	overkillX2: number[];
	overkillZ2: number[];
	overkillOwner: number[];
	overkillGen: number[];
	overkillCarry: number[];
	// --- LG3 (Bastion). Parallel lists, one entry per brace, in the order they happened. ---
	/**
	 * Braces: the player (party index) and what it did (BraceKind: PIP a pip restored, HEAL Stone Heart; SPENT is
	 * never pushed since the owner's tuning: a brace with nothing to restore is not spent).
	 */
	bracePlayer: number[];
	braceKind: number[];
	// --- docs/BUILDS_V2.md (builds v2, wave 1; BV1 declares the lists, BV2-BV9 push them). Parallel lists per group,
	// one entry per event, pushed in resolution order. Thunder Guard's sparks go through the spark lists (sparkFork
	// SparkFork.THUNDER, from the erased bullet's position). ---
	/**
	 * Counter-waves spawned (BV2 Riposte / Counterstrike, BV6 Rebuke): the origin, the unit direction, the cone's
	 * half-angle cosine, the range and growth speed (world units, per second), the owner, the damage per enemy and the
	 * WaveKind; the view grows its crescent / ring from these numbers.
	 */
	waveX: number[];
	waveZ: number[];
	waveDirX: number[];
	waveDirZ: number[];
	waveHalfCos: number[];
	waveRange: number[];
	waveSpeed: number[];
	waveOwner: number[];
	waveDamage: number[];
	waveKind: number[];
	/** Per spawned wave, parallel to the wave lists: the guard's (or roll's) erased count it answers (COUNTER xN). */
	counterCount: number[];
	/**
	 * Ballista bursts (BV3) that spawned at least one bolt: where, the owner, bolts spawned, and 1 for a wall's (or an
	 * unbroken piece's) back fan, 0 for the last pierce's ring.
	 */
	ballistaX: number[];
	ballistaZ: number[];
	ballistaOwner: number[];
	ballistaFired: number[];
	ballistaWall: number[];
	/** Siege Bolt pins that started (BV4): the actor's slot, the archer, and where (the actor's position). */
	pinStartSlot: number[];
	pinStartOwner: number[];
	pinStartX: number[];
	pinStartZ: number[];
	/**
	 * Pins that ended (BV4): the actor's slot, the archer, the distance carried (world units, from the pin's start) and
	 * 1 when it ended in a slam (0: dropped: the arrow expired, or the actor died).
	 */
	pinEndSlot: number[];
	pinEndOwner: number[];
	pinEndCarried: number[];
	pinEndSlam: number[];
	/** Slams (BV4): the pinned actor's position, the archer, enemies the slam and its shockwave struck (it included). */
	slamX: number[];
	slamZ: number[];
	slamOwner: number[];
	slamStruck: number[];
	/**
	 * Smashes resolved (BV5, Wrecker / Powder Keg): the piece's cell centre, the owner, the smash's generation and the
	 * splinters spawned.
	 */
	smashX: number[];
	smashZ: number[];
	smashOwner: number[];
	smashGen: number[];
	smashFired: number[];
	/** Demolition blasts (BV5): the piece's cell centre, the owner. */
	demolitionX: number[];
	demolitionZ: number[];
	demolitionOwner: number[];
	/**
	 * Full Heart beams (BV7): from the player (beamX1, beamZ1) to the line's end (beamX2, beamZ2), the owner, enemies
	 * struck.
	 */
	beamX1: number[];
	beamZ1: number[];
	beamX2: number[];
	beamZ2: number[];
	beamOwner: number[];
	beamStruck: number[];
	/** Happy Hour (BV7): players whose drink started (or restarted) it this tick. */
	happyPlayer: number[];
	/** Overcap payouts (BV9): where (the boss), the hitter, the points paid (ScoreSource.OVERCAP). */
	overcapX: number[];
	overcapZ: number[];
	overcapOwner: number[];
	overcapPoints: number[];
	/**
	 * Unshaken: hits taken on armor this tick by its owners, which stepScore leaves out of the combo cuts. The one
	 * BuildEvents field the sim reads (same tick only: written in stepCombat, read in stepScore, cleared next tick).
	 */
	unshakenKept: number;
}

/** BuildEvents' lists (every field but effectDropped and unshakenKept), for the clear and the clone. */
const BUILD_EVENT_LISTS = [
	"evolvedPlayer",
	"evolvedBoon",
	"duoPlayer",
	"duoTaken",
	"sparkX1",
	"sparkZ1",
	"sparkX2",
	"sparkZ2",
	"sparkOwner",
	"sparkGen",
	"burstX",
	"burstZ",
	"burstOwner",
	"burstGen",
	"burstFired",
	"shardX",
	"shardZ",
	"shardOwner",
	"shardGen",
	"shardFired",
	"sparkFork",
	"novaX",
	"novaZ",
	"novaRadius",
	"novaOwner",
	"novaKind",
	"novaErased",
	"execX",
	"execZ",
	"execOwner",
	"phantomX",
	"phantomZ",
	"phantomOwner",
	"jackpotX",
	"jackpotZ",
	"jackpotOwner",
	"jackpotPoints",
	"lionPlayer",
	"lionHealed",
	"momentumX",
	"momentumZ",
	"momentumOwner",
	"momentumTier",
	"momentumFired",
	"thrillX",
	"thrillZ",
	"thrillOwner",
	"thrillFired",
	"flurryX",
	"flurryZ",
	"flurryOwner",
	"flurryKind",
	"flurryFired",
	"ricochetX",
	"ricochetZ",
	"ricochetOwner",
	"ricochetFired",
	"emberX",
	"emberZ",
	"emberOwner",
	"emberDuo",
	"duoProcDuo",
	"duoProcOwner",
	"duoProcX",
	"duoProcZ",
	"duoProcValue",
	"overkillX1",
	"overkillZ1",
	"overkillX2",
	"overkillZ2",
	"overkillOwner",
	"overkillGen",
	"overkillCarry",
	"bracePlayer",
	"braceKind",
	"waveX",
	"waveZ",
	"waveDirX",
	"waveDirZ",
	"waveHalfCos",
	"waveRange",
	"waveSpeed",
	"waveOwner",
	"waveDamage",
	"waveKind",
	"counterCount",
	"ballistaX",
	"ballistaZ",
	"ballistaOwner",
	"ballistaFired",
	"ballistaWall",
	"pinStartSlot",
	"pinStartOwner",
	"pinStartX",
	"pinStartZ",
	"pinEndSlot",
	"pinEndOwner",
	"pinEndCarried",
	"pinEndSlam",
	"slamX",
	"slamZ",
	"slamOwner",
	"slamStruck",
	"smashX",
	"smashZ",
	"smashOwner",
	"smashGen",
	"smashFired",
	"demolitionX",
	"demolitionZ",
	"demolitionOwner",
	"beamX1",
	"beamZ1",
	"beamX2",
	"beamZ2",
	"beamOwner",
	"beamStruck",
	"happyPlayer",
	"overcapX",
	"overcapZ",
	"overcapOwner",
	"overcapPoints",
] as const;

/** SimState.builds. */
export interface BuildsState {
	/** The run's rules (config, constant for the run: not hashed). */
	readonly config: Readonly<BuildsConfig>;
	/** One per player, party index order. */
	players: BuildPlayerState[];
	/** The proc queue, oldest first (BU3, ./procs.ts; docs/BUILDS_V2.md: kills and smashes, BuildProc.kind). */
	procs: BuildProc[];
	/** Siege Bolt's pins, oldest first (docs/BUILDS_V2.md BV1; BV4). At most SIEGE_PINS_MAX. */
	pins: BuildPin[];
	/** Riposte's counter-waves, oldest first (BV1; BV2). At most RIPOSTE_WAVES_MAX. */
	waves: BuildWave[];
	/** Stillwater (BV1; BV6): the team combo (tenths) a hit cut, and the tick it was cut (STILL_NONE: none). */
	stillCombo: number;
	stillTick: number;
	/** NOT hashed. */
	events: BuildEvents;
}

function newPlayer(): BuildPlayerState {
	const levels: number[] = [];
	for (let b = 0; b < BOON_COUNT; b++) levels.push(0);
	return {
		levels,
		duos: [],
		grazes: 0,
		kills: 0,
		arrows: 0,
		bigHits: 0,
		draftsLeft: 0,
		bulwarkPending: 0,
		closeGrazes: 0,
		braceCount: 0,
		braceReady: 0,
		braceCooldown: 0,
		riposteCount: 0,
		overcap: 0,
		happyHourTicks: 0,
	};
}

function emptyEvents(): BuildEvents {
	return {
		evolvedPlayer: [],
		evolvedBoon: [],
		duoPlayer: [],
		duoTaken: [],
		sparkX1: [],
		sparkZ1: [],
		sparkX2: [],
		sparkZ2: [],
		sparkOwner: [],
		sparkGen: [],
		burstX: [],
		burstZ: [],
		burstOwner: [],
		burstGen: [],
		burstFired: [],
		shardX: [],
		shardZ: [],
		shardOwner: [],
		shardGen: [],
		shardFired: [],
		effectDropped: 0,
		sparkFork: [],
		novaX: [],
		novaZ: [],
		novaRadius: [],
		novaOwner: [],
		novaKind: [],
		novaErased: [],
		execX: [],
		execZ: [],
		execOwner: [],
		phantomX: [],
		phantomZ: [],
		phantomOwner: [],
		jackpotX: [],
		jackpotZ: [],
		jackpotOwner: [],
		jackpotPoints: [],
		lionPlayer: [],
		lionHealed: [],
		momentumX: [],
		momentumZ: [],
		momentumOwner: [],
		momentumTier: [],
		momentumFired: [],
		thrillX: [],
		thrillZ: [],
		thrillOwner: [],
		thrillFired: [],
		flurryX: [],
		flurryZ: [],
		flurryOwner: [],
		flurryKind: [],
		flurryFired: [],
		ricochetX: [],
		ricochetZ: [],
		ricochetOwner: [],
		ricochetFired: [],
		emberX: [],
		emberZ: [],
		emberOwner: [],
		emberDuo: [],
		duoProcDuo: [],
		duoProcOwner: [],
		duoProcX: [],
		duoProcZ: [],
		duoProcValue: [],
		overkillX1: [],
		overkillZ1: [],
		overkillX2: [],
		overkillZ2: [],
		overkillOwner: [],
		overkillGen: [],
		overkillCarry: [],
		bracePlayer: [],
		braceKind: [],
		waveX: [],
		waveZ: [],
		waveDirX: [],
		waveDirZ: [],
		waveHalfCos: [],
		waveRange: [],
		waveSpeed: [],
		waveOwner: [],
		waveDamage: [],
		waveKind: [],
		counterCount: [],
		ballistaX: [],
		ballistaZ: [],
		ballistaOwner: [],
		ballistaFired: [],
		ballistaWall: [],
		pinStartSlot: [],
		pinStartOwner: [],
		pinStartX: [],
		pinStartZ: [],
		pinEndSlot: [],
		pinEndOwner: [],
		pinEndCarried: [],
		pinEndSlam: [],
		slamX: [],
		slamZ: [],
		slamOwner: [],
		slamStruck: [],
		smashX: [],
		smashZ: [],
		smashOwner: [],
		smashGen: [],
		smashFired: [],
		demolitionX: [],
		demolitionZ: [],
		demolitionOwner: [],
		beamX1: [],
		beamZ1: [],
		beamX2: [],
		beamZ2: [],
		beamOwner: [],
		beamStruck: [],
		happyPlayer: [],
		overcapX: [],
		overcapZ: [],
		overcapOwner: [],
		overcapPoints: [],
		unshakenKept: 0,
	};
}

/** Builds state at run start: an empty build per player (`players`: the party size, 1 solo). No rng. */
export function createBuildsState(config: Readonly<BuildsConfig>, players = 1): BuildsState {
	const out: BuildPlayerState[] = [];
	for (let i = 0; i < players; i++) out.push(newPlayer());
	return {
		config,
		players: out,
		procs: [],
		pins: [],
		waves: [],
		stillCombo: 0,
		stillTick: STILL_NONE,
		events: emptyEvents(),
	};
}

export function cloneBuildsState(s: Readonly<BuildsState>): BuildsState {
	const events = emptyEvents();
	for (const f of BUILD_EVENT_LISTS) for (const v of s.events[f]) events[f].push(v);
	events.effectDropped = s.events.effectDropped;
	events.unshakenKept = s.events.unshakenKept;
	return {
		config: s.config,
		players: s.players.map((p) => ({ ...p, levels: [...p.levels], duos: [...p.duos] })),
		procs: s.procs.map((q) => ({ ...q })),
		pins: s.pins.map((q) => ({ ...q })),
		waves: s.waves.map((w) => ({ ...w, hits: [...w.hits] })),
		stillCombo: s.stillCombo,
		stillTick: s.stillTick,
		events,
	};
}

/** Start of every tick (step.ts, with the other event clears). */
export function clearBuildEvents(s: BuildsState): void {
	const e = s.events;
	for (const f of BUILD_EVENT_LISTS) e[f].clear();
	e.effectDropped = 0;
	e.unshakenKept = 0;
}

/**
 * The floor change (endless.ts nextFloor): queued procs, pins and waves are dropped with the floor's actors and
 * bullets, and Stillwater's recorded combo with them (docs/BUILDS_V2.md BV1).
 */
export function clearBuildProcs(s: BuildsState): void {
	s.procs.clear();
	s.pins.clear();
	s.waves.clear();
	s.stillCombo = 0;
	s.stillTick = STILL_NONE;
}

// ---------------------------------------------------------------------------------------------
// Reads

/** Player `playerIndex`'s build, or undefined (no builds in this run, or no such player). */
export function buildPlayer(state: Readonly<SimState>, playerIndex: number): BuildPlayerState | undefined {
	return state.builds?.players[playerIndex];
}

/** The level of `boon` for a build (0 = not owned). */
export function buildLevel(p: Readonly<BuildPlayerState>, boon: number): number {
	return p.levels[boon] ?? 0;
}

/** This tick's presentation events, or undefined without builds. */
export function buildEvents(state: Readonly<SimState>): Readonly<BuildEvents> | undefined {
	return state.builds?.events;
}

/**
 * What picking `card` does for player `playerIndex` (CardKind): a duo card is DUO; a boon card is NEW (level 0),
 * UPGRADE (level 1) or EVOLUTION (level 2 and above). Without builds every boon card is NEW (today's draft). -1 for an
 * id that is no card.
 */
export function cardKind(state: Readonly<SimState>, playerIndex: number, card: number): CardKindId | -1 {
	if (cardDuo(card) >= 0) return CardKind.DUO;
	const b = cardBoon(card);
	if (b < 0) return -1;
	const p = buildPlayer(state, playerIndex);
	const level = p !== undefined ? buildLevel(p, b) : 0;
	return level <= 0 ? CardKind.NEW : level === 1 ? CardKind.UPGRADE : CardKind.EVOLUTION;
}

// ---------------------------------------------------------------------------------------------
// Hash: the "builds" group, appended after every other group (after "affixes") only when state.builds exists.
//   players.length; per player: levels (length + values), duos (length + values), BUILD_PLAYER_SCALARS;
//   procs.length; per proc BUILD_PROC_FIELDS;
//   (docs/BUILDS_V2.md BV1, appended) pins.length; per pin BUILD_PIN_FIELDS; waves.length; per wave BUILD_WAVE_FIELDS
//   then hits (length + values); BUILD_WORLD_SCALARS

/** Scalar BuildPlayerState fields after the two lists, in hash order. Append only. */
export const BUILD_PLAYER_SCALARS = [
	"grazes",
	"kills",
	"arrows",
	"bigHits",
	"draftsLeft",
	"bulwarkPending",
	"closeGrazes",
	"braceCount",
	"braceReady",
	"braceCooldown",
	"riposteCount",
	"overcap",
	"happyHourTicks",
] as const;

/** Per proc, in hash order. Append only. */
export const BUILD_PROC_FIELDS = ["x", "z", "owner", "gen", "slot", "id", "excess", "kind"] as const;

/** Per pin, in hash order (docs/BUILDS_V2.md BV1). Append only. */
export const BUILD_PIN_FIELDS = ["bullet", "owner", "slot", "id", "x0", "z0", "slam"] as const;

/** Per wave, in hash order, before its `hits` list (BV1). Append only. */
export const BUILD_WAVE_FIELDS = [
	"owner",
	"x",
	"z",
	"dirX",
	"dirZ",
	"halfCos",
	"radius",
	"range",
	"speed",
	"damage",
	"kind",
] as const;

/** The world's scalars after the waves, in hash order (BV1). Append only. */
export const BUILD_WORLD_SCALARS = ["stillCombo", "stillTick"] as const;

function pushList(out: number[], list: ReadonlyArray<number>): void {
	out.push(list.size());
	for (const v of list) out.push(v);
}

function pushListNames(out: string[], prefix: string, list: ReadonlyArray<number>): void {
	out.push(`${prefix}.length`);
	for (let i = 0; i < list.size(); i++) out.push(`${prefix}[${i}]`);
}

export function writeBuildsHash(s: Readonly<BuildsState>, out: number[]): void {
	out.push(s.players.size());
	for (const p of s.players) {
		pushList(out, p.levels);
		pushList(out, p.duos);
		for (const f of BUILD_PLAYER_SCALARS) out.push(p[f]);
	}
	out.push(s.procs.size());
	for (const q of s.procs) for (const f of BUILD_PROC_FIELDS) out.push(q[f]);
	out.push(s.pins.size());
	for (const q of s.pins) for (const f of BUILD_PIN_FIELDS) out.push(q[f]);
	out.push(s.waves.size());
	for (const w of s.waves) {
		for (const f of BUILD_WAVE_FIELDS) out.push(w[f]);
		pushList(out, w.hits);
	}
	for (const f of BUILD_WORLD_SCALARS) out.push(s[f]);
}

/** Dump names for writeBuildsHash, same order (`builds.players[0].levels[3]`, `builds.procs[0].gen`, ...). */
export function buildsHashNames(s: Readonly<BuildsState>, out: string[]): void {
	out.push("builds.players.length");
	for (let i = 0; i < s.players.size(); i++) {
		const p = s.players[i];
		const prefix = `builds.players[${i}]`;
		pushListNames(out, `${prefix}.levels`, p.levels);
		pushListNames(out, `${prefix}.duos`, p.duos);
		for (const f of BUILD_PLAYER_SCALARS) out.push(`${prefix}.${f}`);
	}
	out.push("builds.procs.length");
	for (let k = 0; k < s.procs.size(); k++) for (const f of BUILD_PROC_FIELDS) out.push(`builds.procs[${k}].${f}`);
	out.push("builds.pins.length");
	for (let k = 0; k < s.pins.size(); k++) for (const f of BUILD_PIN_FIELDS) out.push(`builds.pins[${k}].${f}`);
	out.push("builds.waves.length");
	for (let k = 0; k < s.waves.size(); k++) {
		const prefix = `builds.waves[${k}]`;
		for (const f of BUILD_WAVE_FIELDS) out.push(`${prefix}.${f}`);
		pushListNames(out, `${prefix}.hits`, s.waves[k].hits);
	}
	for (const f of BUILD_WORLD_SCALARS) out.push(`builds.${f}`);
}
